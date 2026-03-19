// pages/api/player-projections.js
// Stat projections for all players in today's NBA games.
// ESPN rosters (parallel) + BDL season averages (batched) — minimal API calls.

export const config = { maxDuration: 25 };

const BDL_BASE = "https://api.balldontlie.io/v1";

async function bdlFetch(path) {
  const key = process.env.BALLDONTLIE_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`${BDL_BASE}${path}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) {
      console.warn(`[BDL] ${path} → ${res.status}`);
      return null;
    }
    return res.json();
  } catch (e) {
    console.warn(`[BDL] fetch error: ${e.message}`);
    return null;
  }
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
    // 1. ESPN scoreboard — teams playing today
    const espnRes = await fetch(
      "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard",
      { cache: "no-store" }
    );
    if (!espnRes.ok) return res.status(200).json({ projections: [], error: "ESPN unavailable" });
    const espnData = await espnRes.json();
    const events = espnData.events || [];
    if (!events.length) return res.status(200).json({ projections: [], noGames: true });

    // Collect unique teams
    const teamsMap = {};
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
    console.log(`[Projections] ${events.length} games, ${teams.length} teams`);

    // 2. ESPN rosters in parallel — player names + ESPN IDs for headshots
    const espnPlayers = {};
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
    console.log(`[Projections] ${Object.keys(espnPlayers).length} ESPN players loaded`);

    if (!process.env.BALLDONTLIE_API_KEY) {
      return res.status(200).json({ projections: [], noBdlKey: true });
    }

    // 3. BDL teams — single call to map ESPN abbreviations to BDL team IDs
    const bdlTeamsData = await bdlFetch("/teams?per_page=30");
    const bdlTeams = bdlTeamsData?.data || [];
    if (!bdlTeams.length) {
      return res.status(200).json({ projections: [], error: "BDL teams unavailable" });
    }

    const bdlTeamById = {};
    const bdlTeamLookup = {};
    for (const t of bdlTeams) {
      bdlTeamById[t.id] = t;
      for (const form of [
        normTeam(`${t.city} ${t.name}`),
        normTeam(t.name),
        normTeam(t.city),
        (t.abbreviation || "").toLowerCase(),
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
      return bdlTeamLookup[(abbreviation || "").toLowerCase()] || null;
    }

    // Resolve BDL team IDs for today's teams
    const bdlTeamIds = [];
    const teamBdlIdToEspn = {}; // bdlTeamId -> ESPN team info
    for (const team of teams) {
      const bdlId = findBdlTeamId(team.displayName, team.abbreviation);
      if (bdlId && !bdlTeamIds.includes(bdlId)) {
        bdlTeamIds.push(bdlId);
        teamBdlIdToEspn[bdlId] = team;
      }
    }
    console.log(`[Projections] Mapped ${bdlTeamIds.length}/${teams.length} teams to BDL`);

    // 4. ONE BDL call to get all players for all today's teams
    const teamIdsQS = bdlTeamIds.map(id => `team_ids[]=${id}`).join("&");
    const bdlPlayersData = await bdlFetch(`/players?${teamIdsQS}&per_page=200`);
    const bdlPlayers = {};
    for (const p of (bdlPlayersData?.data || [])) {
      bdlPlayers[p.id] = { ...p, bdlTeamId: p.team?.id };
    }
    console.log(`[Projections] ${Object.keys(bdlPlayers).length} BDL players`);

    const allBdlIds = Object.keys(bdlPlayers).map(Number);
    if (!allBdlIds.length) {
      return res.status(200).json({ projections: [], error: "No BDL players found" });
    }

    // 5. Batch BDL season averages — 50 per request, run in parallel
    const now = new Date();
    const seasonYear = now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1;
    const chunks = [];
    for (let i = 0; i < allBdlIds.length; i += 50) {
      chunks.push(allBdlIds.slice(i, i + 50));
    }

    const avgResults = await Promise.all(
      chunks.map(chunk => {
        const qs = chunk.map(id => `player_ids[]=${id}`).join("&");
        return bdlFetch(`/season_averages?season=${seasonYear}&${qs}`);
      })
    );

    const seasonAverages = {};
    for (const result of avgResults) {
      for (const avg of (result?.data || [])) {
        seasonAverages[avg.player_id] = avg;
      }
    }
    console.log(`[Projections] ${Object.keys(seasonAverages).length} season avg records`);

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

      if (pts < 1 && reb < 0.5 && ast < 0.3) continue; // skip bench/DNP
      if (parseFloat(avg.min) < 5) continue;

      const bdlFullName = `${p.first_name} ${p.last_name}`;
      const normBdl = normName(bdlFullName);
      let espnInfo = espnPlayers[normBdl];
      if (!espnInfo) {
        const lastNorm = normName(p.last_name);
        const firstInit = (p.first_name || "")[0]?.toLowerCase();
        const match = Object.entries(espnPlayers).find(([k]) =>
          k.includes(lastNorm) && (firstInit ? k.startsWith(firstInit) : true)
        );
        espnInfo = match?.[1];
      }

      const bdlTeam = bdlTeamById[p.bdlTeamId] || bdlTeamById[p.team?.id];
      const espnTeam = teamBdlIdToEspn[p.bdlTeamId] || teamBdlIdToEspn[p.team?.id];
      const teamName = bdlTeam ? `${bdlTeam.city} ${bdlTeam.name}` : (espnTeam?.displayName || "");
      const abbreviation = bdlTeam?.abbreviation || espnTeam?.abbreviation || espnInfo?.abbreviation || "";
      const gameLabel = espnInfo?.gameLabel || espnTeam?.gameLabel || "";

      projections.push({
        player: espnInfo?.name || bdlFullName,
        team: teamName,
        abbreviation,
        espnPlayerId: espnInfo?.espnId || null,
        gameLabel,
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
    console.log(`[Projections] Returning ${projections.length} projections`);

    return res.status(200).json({ projections, gamesCount: events.length });
  } catch (e) {
    console.error("[PlayerProjections] error:", e);
    return res.status(500).json({ error: e.message, projections: [] });
  }
}
