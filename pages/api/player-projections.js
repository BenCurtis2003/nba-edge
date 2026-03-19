// pages/api/player-projections.js
// Stat projections for all players in today's NBA games.
// ESPN rosters (parallel) + BDL per-team player lists (parallel) + BDL season averages (batched).

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
    console.warn(`[Projections] BDL error: ${e.message}`);
    return null;
  }
}

// ESPN abbreviation → BDL abbreviation for known mismatches
const ESPN_TO_BDL = {
  GS: "GSW", NO: "NOP", UTAH: "UTA",
  SA: "SAS", NY: "NYK", WSH: "WAS",
};

function norm(s) {
  return (s || "").toLowerCase().replace(/[^a-z]/g, " ").replace(/\s+/g, " ").trim();
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");

  try {
    // ── 1. ESPN scoreboard ────────────────────────────────────────────────────
    const sbRes = await fetch(
      "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard",
      { cache: "no-store" }
    );
    if (!sbRes.ok) return res.status(200).json({ projections: [], step: "scoreboard_fail" });
    const sbData = await sbRes.json();
    const events = sbData.events || [];
    if (!events.length) return res.status(200).json({ projections: [], step: "no_games" });

    const teamsMap = {};
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

    // ── 2. ESPN rosters (parallel) ────────────────────────────────────────────
    const espnPlayerMap = {};
    await Promise.all(espnTeams.map(async (team) => {
      try {
        const r = await fetch(
          `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${team.id}/roster`
        );
        if (!r.ok) return;
        const d = await r.json();
        for (const a of (d.athletes || [])) {
          const name = (a.displayName || a.fullName || "").trim();
          if (name && a.id) {
            espnPlayerMap[norm(name)] = {
              espnId: a.id, name,
              teamName: team.displayName,
              abbreviation: team.abbreviation,
              gameLabel: team.gameLabel,
            };
          }
        }
      } catch {}
    }));
    console.log(`[Projections] ${Object.keys(espnPlayerMap).length} ESPN players, ${espnTeams.length} teams`);

    if (!process.env.BALLDONTLIE_API_KEY) {
      return res.status(200).json({ projections: [], step: "no_bdl_key" });
    }

    // ── 3. BDL teams — build lookup ───────────────────────────────────────────
    const bdlTeamsData = await bdlFetch("/teams?per_page=30");
    if (!bdlTeamsData?.data?.length) {
      return res.status(200).json({ projections: [], step: "bdl_teams_fail" });
    }

    const bdlTeamById = {};
    const byNormName = {}, byAbbr = {};
    for (const t of bdlTeamsData.data) {
      bdlTeamById[t.id] = t;
      byNormName[norm(`${t.city} ${t.name}`)] = t.id;
      if (t.abbreviation) byAbbr[t.abbreviation.toLowerCase()] = t.id;
    }

    // Map each ESPN team to a BDL team ID
    const espnToBdl = {}; // espnTeamId → bdlTeamId
    for (const team of espnTeams) {
      // 1) Full display name (most reliable)
      let bdlId = byNormName[norm(team.displayName)];
      // 2) ESPN abbr → known BDL abbr
      if (!bdlId) {
        const mapped = (ESPN_TO_BDL[team.abbreviation] || team.abbreviation || "").toLowerCase();
        bdlId = byAbbr[mapped];
      }
      // 3) Any word in display name > 4 chars
      if (!bdlId) {
        for (const w of norm(team.displayName).split(" ")) {
          if (w.length >= 4 && byNormName[w]) { bdlId = byNormName[w]; break; }
        }
      }
      if (bdlId) espnToBdl[team.id] = bdlId;
      else console.warn(`[Projections] No BDL match for ${team.displayName} (${team.abbreviation})`);
    }

    const uniqueBdlIds = [...new Set(Object.values(espnToBdl))];
    console.log(`[Projections] Matched ${uniqueBdlIds.length}/${espnTeams.length} teams to BDL`);

    if (!uniqueBdlIds.length) {
      return res.status(200).json({ projections: [], step: "no_team_match" });
    }

    // ── 4. BDL players — one request per team, sequential to respect rate limit ──
    const bdlPlayers = {};
    for (const bdlTeamId of uniqueBdlIds) {
      const result = await bdlFetch(`/players?team_ids[]=${bdlTeamId}&per_page=100`);
      for (const p of (result?.data || [])) {
        bdlPlayers[p.id] = { ...p, bdlTeamId: p.team?.id };
      }
    }
    console.log(`[Projections] ${Object.keys(bdlPlayers).length} BDL players`);

    if (!Object.keys(bdlPlayers).length) {
      return res.status(200).json({ projections: [], step: "no_bdl_players", teamsMatched: uniqueBdlIds.length });
    }

    // ── 5. BDL season averages — one player_id per request (proven pattern),  ──
    //       parallel batches of 8 to stay well within 60 req/min               ──
    const allBdlPlayerIds = Object.keys(bdlPlayers).map(Number);
    const seasonYear = (() => {
      const d = new Date();
      return d.getMonth() >= 9 ? d.getFullYear() : d.getFullYear() - 1;
    })();

    const seasonAvg = {};
    const BATCH = 8;
    for (let i = 0; i < allBdlPlayerIds.length; i += BATCH) {
      const batch = allBdlPlayerIds.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map(id => bdlFetch(`/season_averages?season=${seasonYear}&player_ids[]=${id}`))
      );
      for (const r of results) {
        for (const a of (r?.data || [])) seasonAvg[a.player_id] = a;
      }
    }
    console.log(`[Projections] ${Object.keys(seasonAvg).length} season avg records (season=${seasonYear})`);

    if (!Object.keys(seasonAvg).length) {
      return res.status(200).json({ projections: [], step: "no_season_avgs", season: seasonYear, players: allBdlPlayerIds.length });
    }

    // ── 6. Build projection rows ──────────────────────────────────────────────
    const projections = [];
    for (const [idStr, p] of Object.entries(bdlPlayers)) {
      const avg = seasonAvg[parseInt(idStr)];
      if (!avg) continue;

      const pts = +(parseFloat(avg.pts)  || 0).toFixed(1);
      const reb = +(parseFloat(avg.reb)  || 0).toFixed(1);
      const ast = +(parseFloat(avg.ast)  || 0).toFixed(1);
      const tpm = +(parseFloat(avg.fg3m) || 0).toFixed(1);
      const min = +(parseFloat(avg.min)  || 0).toFixed(1);
      const pra = +(pts + reb + ast).toFixed(1);

      if (pts < 1 && reb < 0.5 && ast < 0.3) continue;
      if (min < 5) continue;

      const bdlName = `${p.first_name} ${p.last_name}`;
      let espn = espnPlayerMap[norm(bdlName)];
      if (!espn) {
        const last = norm(p.last_name), fi = (p.first_name || "")[0]?.toLowerCase();
        espn = Object.entries(espnPlayerMap)
          .find(([k]) => k.includes(last) && (fi ? k.startsWith(fi) : true))?.[1];
      }

      const bdlTeam = bdlTeamById[p.bdlTeamId];
      projections.push({
        player: espn?.name || bdlName,
        team: bdlTeam ? `${bdlTeam.city} ${bdlTeam.name}` : (espn?.teamName || ""),
        abbreviation: bdlTeam?.abbreviation || espn?.abbreviation || "",
        espnPlayerId: espn?.espnId || null,
        gameLabel: espn?.gameLabel || "",
        projPts: pts, projReb: reb, projAst: ast, projTpm: tpm, projPra: pra,
        min, gp: avg.games_played || 0,
      });
    }

    projections.sort((a, b) => b.projPra - a.projPra);
    console.log(`[Projections] Returning ${projections.length} projections`);

    return res.status(200).json({ projections, gamesCount: events.length, season: seasonYear });
  } catch (e) {
    console.error("[PlayerProjections] fatal:", e);
    return res.status(500).json({ error: e.message, projections: [] });
  }
}
