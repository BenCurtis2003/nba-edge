// pages/api/player-projections.js
// Stat projections for all players in today's NBA games.
// No Odds API needed — uses ESPN rosters + BDL season averages.

export const config = { maxDuration: 30 };

const BDL_BASE = "https://api.balldontlie.io/v1";

async function bdlFetch(path) {
  const key = process.env.BALLDONTLIE_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`${BDL_BASE}${path}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

function normName(s) {
  return (s || "").toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
}
function normTeam(s) {
  return (s || "").toLowerCase().replace(/[^a-z]/g, " ").replace(/\s+/g, " ").trim();
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");

  try {
    // 1. ESPN scoreboard — games + teams playing today
    const espnRes = await fetch(
      "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard",
      { cache: "no-store" }
    );
    if (!espnRes.ok) return res.status(200).json({ projections: [] });
    const espnData = await espnRes.json();
    const events = espnData.events || [];
    if (!events.length) return res.status(200).json({ projections: [], noGames: true });

    // Collect unique teams
    const teamsMap = {}; // espnTeamId -> { displayName, abbreviation, gameLabel }
    for (const ev of events) {
      const comps = ev.competitions?.[0]?.competitors || [];
      const away = comps.find(c => c.homeAway === "away");
      const home = comps.find(c => c.homeAway === "home");
      if (!away || !home) continue;
      const gameLabel = `${away.team?.abbreviation} @ ${home.team?.abbreviation}`;
      for (const comp of [away, home]) {
        const tid = comp.team?.id;
        if (tid && !teamsMap[tid]) {
          teamsMap[tid] = {
            espnTeamId: tid,
            displayName: comp.team?.displayName || "",
            abbreviation: comp.team?.abbreviation || "",
            gameLabel,
          };
        }
      }
    }
    const teams = Object.values(teamsMap);

    // 2. ESPN rosters — player names + ESPN athlete IDs (for headshots)
    const espnPlayers = {}; // normName -> { espnId, name, teamName, gameLabel }
    await Promise.all(teams.map(async (team) => {
      try {
        const r = await fetch(
          `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${team.espnTeamId}/roster`
        );
        if (!r.ok) return;
        const d = await r.json();
        for (const a of (d.athletes || [])) {
          const name = (a.displayName || a.fullName || "").trim();
          if (!name) continue;
          espnPlayers[normName(name)] = {
            espnId: a.id,
            name,
            teamName: team.displayName,
            abbreviation: team.abbreviation,
            gameLabel: team.gameLabel,
          };
        }
      } catch {}
    }));

    if (!process.env.BALLDONTLIE_API_KEY) {
      return res.status(200).json({ projections: [], noBdlKey: true });
    }

    // 3. BDL teams — map ESPN team names to BDL team IDs
    const bdlTeamsData = await bdlFetch("/teams?per_page=30");
    const bdlTeams = bdlTeamsData?.data || [];

    const bdlTeamById = {};
    const bdlTeamLookup = {}; // normalized forms -> bdlTeamId
    for (const t of bdlTeams) {
      bdlTeamById[t.id] = t;
      for (const form of [
        normTeam(`${t.city} ${t.name}`),
        normTeam(t.name),
        normTeam(t.city),
        (t.abbreviation || "").toLowerCase(),
        normTeam(t.full_name),
      ]) {
        if (form) bdlTeamLookup[form] = t.id;
      }
    }

    function findBdlTeamId(displayName, abbreviation) {
      const norm = normTeam(displayName);
      if (bdlTeamLookup[norm]) return bdlTeamLookup[norm];
      for (const word of norm.split(" ").reverse()) {
        if (word.length >= 4 && bdlTeamLookup[word]) return bdlTeamLookup[word];
      }
      const abbrLow = (abbreviation || "").toLowerCase();
      return bdlTeamLookup[abbrLow] || null;
    }

    // 4. BDL players per team
    const processedBdlTeams = new Set();
    const bdlPlayers = {}; // bdlPlayerId -> player object + bdlTeamId

    for (const team of teams) {
      const bdlTeamId = findBdlTeamId(team.displayName, team.abbreviation);
      if (!bdlTeamId || processedBdlTeams.has(bdlTeamId)) continue;
      processedBdlTeams.add(bdlTeamId);

      const data = await bdlFetch(`/players?team_ids[]=${bdlTeamId}&per_page=25`);
      for (const p of (data?.data || [])) {
        bdlPlayers[p.id] = { ...p, bdlTeamId };
      }
    }

    const allBdlIds = Object.keys(bdlPlayers).map(Number);
    if (!allBdlIds.length) return res.status(200).json({ projections: [] });

    // 5. Batch BDL season averages (30 per request)
    const now = new Date();
    const seasonYear = now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1;
    const seasonAverages = {};

    for (let i = 0; i < allBdlIds.length; i += 30) {
      const chunk = allBdlIds.slice(i, i + 30);
      const qs = chunk.map(id => `player_ids[]=${id}`).join("&");
      const data = await bdlFetch(`/season_averages?season=${seasonYear}&${qs}`);
      for (const avg of (data?.data || [])) {
        seasonAverages[avg.player_id] = avg;
      }
    }

    // 6. Build projection rows
    const projections = [];

    for (const [bdlIdStr, p] of Object.entries(bdlPlayers)) {
      const avg = seasonAverages[parseInt(bdlIdStr)];
      if (!avg) continue;

      const pts = +(parseFloat(avg.pts) || 0).toFixed(1);
      const reb = +(parseFloat(avg.reb) || 0).toFixed(1);
      const ast = +(parseFloat(avg.ast) || 0).toFixed(1);
      const tpm = +(parseFloat(avg.fg3m) || 0).toFixed(1);
      const pra = +(pts + reb + ast).toFixed(1);
      const min = +(parseFloat(avg.min) || 0).toFixed(1);

      // Skip bench warmers / DNPs
      if (pts < 1 && reb < 0.5 && ast < 0.3) continue;
      if (min < 5) continue;

      // Match to ESPN player for espnId + game info
      const bdlFullName = `${p.first_name} ${p.last_name}`;
      const normBdl = normName(bdlFullName);
      let espnInfo = espnPlayers[normBdl];
      if (!espnInfo) {
        // Fuzzy: last name + first initial match
        const lastNorm = normName(p.last_name);
        const firstInit = (p.first_name || "")[0]?.toLowerCase();
        espnInfo = Object.entries(espnPlayers).find(([k]) =>
          k.includes(lastNorm) && (firstInit ? k.startsWith(firstInit) : true)
        )?.[1];
      }

      const bdlTeam = bdlTeamById[p.bdlTeamId];
      const teamName = bdlTeam ? `${bdlTeam.city} ${bdlTeam.name}` : "";

      projections.push({
        player: espnInfo?.name || bdlFullName,
        team: teamName,
        abbreviation: bdlTeam?.abbreviation || espnInfo?.abbreviation || "",
        espnPlayerId: espnInfo?.espnId || null,
        gameLabel: espnInfo?.gameLabel || "",
        projPts: pts,
        projReb: reb,
        projAst: ast,
        projTpm: tpm,
        projPra: pra,
        min,
        gp: avg.games_played || 0,
      });
    }

    projections.sort((a, b) => b.projPra - a.projPra);

    return res.status(200).json({ projections, gamesCount: events.length });
  } catch (e) {
    console.error("[PlayerProjections] error:", e);
    return res.status(500).json({ error: e.message, projections: [] });
  }
}
