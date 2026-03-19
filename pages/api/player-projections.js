// pages/api/player-projections.js
// Stat projections for all players in today's NBA games.
// ESPN scoreboard → rosters → ESPN athlete stats (no BDL, no Odds API needed).

export const config = { maxDuration: 25 };

function parseESPNStats(data) {
  try {
    const splits = data.splits?.categories || data.athlete?.statistics?.splits || [];
    let cats = null;
    for (const split of splits) {
      if (split.name === "Total" || split.displayName?.includes("2025") || split.name === "regularSeason") {
        cats = split.stats || split.categories;
        break;
      }
    }
    if (!cats) cats = splits[0]?.stats || splits[0]?.categories || [];

    const statMap = {};
    if (Array.isArray(cats)) {
      for (const cat of cats) {
        const key = cat.name || cat.displayName || "";
        if (key && cat.value !== undefined) statMap[key] = parseFloat(cat.value) || 0;
      }
    }

    const pts = statMap["points"] || statMap["PTS"] || statMap["avgPoints"] || 0;
    const reb = statMap["rebounds"] || statMap["REB"] || statMap["avgRebounds"] || 0;
    const ast = statMap["assists"] || statMap["AST"] || statMap["avgAssists"] || 0;
    const tpm = statMap["threePointFieldGoalsMade"] || statMap["3PM"] || 0;
    const min = statMap["minutesPerGame"] || statMap["MIN"] || statMap["avgMinutes"] || 0;
    const gp  = statMap["gamesPlayed"] || statMap["GP"] || 0;

    if (!gp || gp < 5) return null; // not enough data
    return { pts, reb, ast, tpm, min, gp, pra: pts + reb + ast };
  } catch { return null; }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");

  try {
    // 1. ESPN scoreboard — all of today's games (including started/finished)
    const espnRes = await fetch(
      "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard",
      { cache: "no-store" }
    );
    if (!espnRes.ok) return res.status(200).json({ projections: [], error: "ESPN unavailable" });
    const espnData = await espnRes.json();
    const events = espnData.events || [];
    if (!events.length) return res.status(200).json({ projections: [], noGames: true });

    // Build team → game label map
    const teamGameLabel = {}; // espnTeamId -> gameLabel
    for (const ev of events) {
      const comps = ev.competitions?.[0]?.competitors || [];
      const away = comps.find(c => c.homeAway === "away");
      const home = comps.find(c => c.homeAway === "home");
      if (!away || !home) continue;
      const label = `${away.team?.abbreviation} @ ${home.team?.abbreviation}`;
      for (const comp of [away, home]) {
        if (comp.team?.id) teamGameLabel[comp.team.id] = label;
      }
    }

    // 2. Collect unique teams from all games
    const teamsMap = {};
    for (const ev of events) {
      const comps = ev.competitions?.[0]?.competitors || [];
      for (const comp of comps) {
        const tid = comp.team?.id;
        if (tid && !teamsMap[tid]) {
          teamsMap[tid] = {
            id: tid,
            displayName: comp.team?.displayName || "",
            abbreviation: comp.team?.abbreviation || "",
          };
        }
      }
    }
    const teams = Object.values(teamsMap);

    // 3. Fetch rosters for all teams in parallel
    const rosterResults = await Promise.allSettled(
      teams.map(team =>
        fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${team.id}/roster`)
          .then(r => r.ok ? r.json() : null)
          .then(d => ({ team, athletes: d?.athletes || [] }))
          .catch(() => ({ team, athletes: [] }))
      )
    );

    // Flatten to player list
    const players = [];
    for (const result of rosterResults) {
      if (result.status !== "fulfilled") continue;
      const { team, athletes } = result.value;
      for (const a of athletes) {
        const name = (a.displayName || a.fullName || "").trim();
        if (!name || !a.id) continue;
        players.push({
          espnId: a.id,
          name,
          teamName: team.displayName,
          abbreviation: team.abbreviation,
          teamId: team.id,
          gameLabel: teamGameLabel[team.id] || "",
        });
      }
    }
    console.log(`[Projections] ${players.length} players from ${teams.length} teams`);

    // 4. Fetch season stats for all players in parallel (batched to avoid hammering ESPN)
    const BATCH = 30;
    const statMap = {};

    for (let i = 0; i < players.length; i += BATCH) {
      const batch = players.slice(i, i + BATCH);
      const results = await Promise.allSettled(
        batch.map(p =>
          fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/athletes/${p.espnId}/stats`)
            .then(r => r.ok ? r.json() : null)
            .catch(() => null)
        )
      );
      for (let j = 0; j < batch.length; j++) {
        const r = results[j];
        if (r.status === "fulfilled" && r.value) {
          const stats = parseESPNStats(r.value);
          if (stats) statMap[batch[j].espnId] = stats;
        }
      }
    }
    console.log(`[Projections] ${Object.keys(statMap).length} players with season stats`);

    // 5. Build projection rows
    const projections = players
      .map(p => {
        const s = statMap[p.espnId];
        if (!s) return null;
        if (s.min < 5) return null;
        return {
          player: p.name,
          team: p.teamName,
          abbreviation: p.abbreviation,
          espnPlayerId: p.espnId,
          gameLabel: p.gameLabel,
          projPts: +s.pts.toFixed(1),
          projReb: +s.reb.toFixed(1),
          projAst: +s.ast.toFixed(1),
          projTpm: +s.tpm.toFixed(1),
          projPra: +(s.pts + s.reb + s.ast).toFixed(1),
          min: +s.min.toFixed(1),
          gp: s.gp,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.projPra - a.projPra);

    console.log(`[Projections] Returning ${projections.length} projections`);
    return res.status(200).json({ projections, gamesCount: events.length });
  } catch (e) {
    console.error("[PlayerProjections] error:", e);
    return res.status(500).json({ error: e.message, projections: [] });
  }
}
