// pages/api/player-projections.js
// Stat projections for all players in today's NBA games.
// ESPN scoreboard + rosters (player names/IDs) + BDL season averages (stat data).

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
      console.warn(`[Projections] BDL ${path} → ${res.status}`);
      return null;
    }
    return res.json();
  } catch (e) {
    console.warn(`[Projections] BDL fetch error: ${e.message}`);
    return null;
  }
}

// Known abbreviation mismatches between ESPN and BDL
const ESPN_ABBR_TO_BDL = {
  "GS":   "GSW",
  "NO":   "NOP",
  "UTAH": "UTA",
  "SA":   "SAS",
  "NY":   "NYK",
  "WSH":  "WAS",
  "PHX":  "PHO",
};

function normStr(s) {
  return (s || "").toLowerCase().replace(/[^a-z]/g, " ").replace(/\s+/g, " ").trim();
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");

  try {
    // 1. ESPN scoreboard — all of today's games (started or not)
    const espnRes = await fetch(
      "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard",
      { cache: "no-store" }
    );
    if (!espnRes.ok) return res.status(200).json({ projections: [], error: "ESPN scoreboard failed" });
    const espnData = await espnRes.json();
    const events = espnData.events || [];
    if (!events.length) return res.status(200).json({ projections: [], noGames: true });

    // Collect teams + game labels
    const teamsMap = {}; // espnTeamId → { id, displayName, abbreviation, gameLabel }
    for (const ev of events) {
      const comps = ev.competitions?.[0]?.competitors || [];
      const away = comps.find(c => c.homeAway === "away");
      const home = comps.find(c => c.homeAway === "home");
      if (!away || !home) continue;
      const label = `${away.team?.abbreviation} @ ${home.team?.abbreviation}`;
      for (const comp of [away, home]) {
        const tid = comp.team?.id;
        if (tid && !teamsMap[tid]) {
          teamsMap[tid] = {
            id: tid,
            displayName: comp.team?.displayName || "",
            abbreviation: comp.team?.abbreviation || "",
            gameLabel: label,
          };
        }
      }
    }
    const espnTeams = Object.values(teamsMap);
    console.log(`[Projections] ${events.length} games, ${espnTeams.length} teams`);

    // 2. ESPN rosters — parallel, gives us player names + ESPN IDs for headshots
    const espnPlayerMap = {}; // normName → { espnId, name, teamName, abbreviation, gameLabel }
    await Promise.all(espnTeams.map(async (team) => {
      try {
        const r = await fetch(
          `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${team.id}/roster`
        );
        if (!r.ok) return;
        const d = await r.json();
        for (const a of (d.athletes || [])) {
          const name = (a.displayName || a.fullName || "").trim();
          if (!name || !a.id) continue;
          espnPlayerMap[normStr(name)] = {
            espnId: a.id,
            name,
            teamName: team.displayName,
            abbreviation: team.abbreviation,
            gameLabel: team.gameLabel,
          };
        }
      } catch {}
    }));
    console.log(`[Projections] ${Object.keys(espnPlayerMap).length} ESPN players loaded`);

    if (!process.env.BALLDONTLIE_API_KEY) {
      return res.status(200).json({ projections: [], error: "No BDL key configured" });
    }

    // 3. BDL teams — single call, build lookup by full name + abbreviation
    const bdlTeamsData = await bdlFetch("/teams?per_page=30");
    if (!bdlTeamsData?.data?.length) {
      return res.status(200).json({ projections: [], error: "BDL teams fetch failed" });
    }

    const bdlTeamById = {};
    const bdlTeamLookup = {}; // various normalized forms → bdlTeamId
    for (const t of bdlTeamsData.data) {
      bdlTeamById[t.id] = t;
      // Full name (most reliable)
      const fullNorm = normStr(`${t.city} ${t.name}`);
      if (fullNorm) bdlTeamLookup[fullNorm] = t.id;
      // BDL abbreviation
      const bdlAbbr = (t.abbreviation || "").toLowerCase();
      if (bdlAbbr) bdlTeamLookup[bdlAbbr] = t.id;
    }

    // Map ESPN teams to BDL team IDs
    const bdlTeamIds = [];
    const bdlTeamToEspn = {}; // bdlTeamId → espnTeam
    for (const team of espnTeams) {
      // Try full display name first (most reliable)
      const fullNorm = normStr(team.displayName);
      let bdlId = bdlTeamLookup[fullNorm];

      // Fallback: translate ESPN abbreviation to BDL abbreviation
      if (!bdlId) {
        const bdlAbbr = (ESPN_ABBR_TO_BDL[team.abbreviation] || team.abbreviation || "").toLowerCase();
        bdlId = bdlTeamLookup[bdlAbbr];
      }

      // Fallback: try city name alone
      if (!bdlId) {
        const words = fullNorm.split(" ");
        for (const w of words) {
          if (w.length >= 4 && bdlTeamLookup[w]) { bdlId = bdlTeamLookup[w]; break; }
        }
      }

      if (bdlId && !bdlTeamIds.includes(bdlId)) {
        bdlTeamIds.push(bdlId);
        bdlTeamToEspn[bdlId] = team;
      } else if (!bdlId) {
        console.warn(`[Projections] No BDL match for ESPN team: ${team.displayName} (${team.abbreviation})`);
      }
    }
    console.log(`[Projections] Matched ${bdlTeamIds.length}/${espnTeams.length} teams to BDL`);

    if (!bdlTeamIds.length) {
      return res.status(200).json({ projections: [], error: "No BDL teams matched" });
    }

    // 4. BDL players — paginate with per_page=100 (BDL max)
    const teamIdsQS = bdlTeamIds.map(id => `team_ids[]=${id}`).join("&");
    const bdlPlayers = {};

    const page1 = await bdlFetch(`/players?${teamIdsQS}&per_page=100&page=1`);
    for (const p of (page1?.data || [])) {
      bdlPlayers[p.id] = { ...p, bdlTeamId: p.team?.id };
    }
    // If we got a full page, fetch page 2 (handles slates with 100+ active players)
    if ((page1?.data || []).length === 100) {
      const page2 = await bdlFetch(`/players?${teamIdsQS}&per_page=100&page=2`);
      for (const p of (page2?.data || [])) {
        bdlPlayers[p.id] = { ...p, bdlTeamId: p.team?.id };
      }
    }
    console.log(`[Projections] ${Object.keys(bdlPlayers).length} BDL players`);

    const allBdlIds = Object.keys(bdlPlayers).map(Number);
    if (!allBdlIds.length) {
      return res.status(200).json({ projections: [], error: "BDL returned no players" });
    }

    // 5. BDL season averages — parallel chunks of 50
    const now = new Date();
    const seasonYear = now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1;

    const chunks = [];
    for (let i = 0; i < allBdlIds.length; i += 50) chunks.push(allBdlIds.slice(i, i + 50));

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

    // 6. Build projections
    const projections = [];
    for (const [bdlIdStr, p] of Object.entries(bdlPlayers)) {
      const avg = seasonAverages[parseInt(bdlIdStr)];
      if (!avg) continue;

      const pts = +(parseFloat(avg.pts)  || 0).toFixed(1);
      const reb = +(parseFloat(avg.reb)  || 0).toFixed(1);
      const ast = +(parseFloat(avg.ast)  || 0).toFixed(1);
      const tpm = +(parseFloat(avg.fg3m) || 0).toFixed(1);
      const min = +(parseFloat(avg.min)  || 0).toFixed(1);
      const pra = +(pts + reb + ast).toFixed(1);

      if (pts < 1 && reb < 0.5 && ast < 0.3) continue; // skip bench/DNP
      if (min < 5) continue;

      const bdlFullName = `${p.first_name} ${p.last_name}`;
      const normBdl = normStr(bdlFullName);
      let espnInfo = espnPlayerMap[normBdl];
      if (!espnInfo) {
        // fuzzy: last name + first initial
        const lastNorm = normStr(p.last_name);
        const firstInit = (p.first_name || "")[0]?.toLowerCase();
        const match = Object.entries(espnPlayerMap).find(([k]) =>
          k.includes(lastNorm) && (firstInit ? k.startsWith(firstInit) : true)
        );
        espnInfo = match?.[1];
      }

      const bdlTeam = bdlTeamById[p.bdlTeamId];
      const espnTeam = bdlTeamToEspn[p.bdlTeamId];
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
    console.error("[PlayerProjections] fatal error:", e);
    return res.status(500).json({ error: e.message, projections: [] });
  }
}
