import { fetchOddsAPI } from "./odds-keys";
// lib/props.js — Player Props EV Scanner + Full Conviction Engine
// v2: Real player stats from ESPN, L5 form, matchup defense, pace, home/away splits

// ── BallDontLie rate limiter ──────────────────────────────────────────────────
const bdlRequestTimestamps = [];
async function bdlFetch(endpoint) {
  if (!process.env.BALLDONTLIE_API_KEY) return null;
  try {
    const now = Date.now();
    while (bdlRequestTimestamps.length && now - bdlRequestTimestamps[0] > 60000) {
      bdlRequestTimestamps.shift();
    }
    if (bdlRequestTimestamps.length >= 60) {
      const waitMs = 60000 - (now - bdlRequestTimestamps[0]) + 500;
      console.log(`[BDL] Rate limit — waiting ${Math.round(waitMs/1000)}s`);
      await new Promise(r => setTimeout(r, waitMs));
    }
    bdlRequestTimestamps.push(Date.now());
    const res = await fetch(`https://api.balldontlie.io/v1${endpoint}`, {
      headers: { "Authorization": `Bearer ${process.env.BALLDONTLIE_API_KEY}` },
      cache: "no-store",
    });
    if (!res.ok) { console.warn(`[BDL] HTTP ${res.status}`); return null; }
    return await res.json();
  } catch(e) {
    console.warn("[BDL] Error:", e.message);
    return null;
  }
}


const PROP_MARKETS = [
  "player_points", "player_rebounds", "player_assists", "player_threes",
  "player_points_rebounds_assists", "player_points_rebounds", "player_points_assists",
];
const PROP_BOOKS = "draftkings,fanduel,betmgm,betrivers,pinnacle,fliff";
const MIN_PROP_EDGE = 0.035; // 3.5% — matches standard EV threshold
const MIN_BOOKS_FOR_EDGE = 3;
const PROP_KELLY_FRACTION = 0.25;
const PROP_KELLY_CAP = 2.0;
const PROP_CONVICTION_THRESHOLD = 70;

function americanToDecimal(o) { return o < 0 ? (100/(-o)+1) : (o/100+1); }
function americanToImplied(o) { return o < 0 ? (-o)/(-o+100) : 100/(o+100); }
function kellyPct(edge, decOdds) {
  if(edge<=0||decOdds<=1) return 0;
  return Math.min((edge*decOdds)/(decOdds-1)*PROP_KELLY_FRACTION*100, PROP_KELLY_CAP);
}

// ── PLAYER STATS FETCH ────────────────────────────────────────────────────────
// Fetches per-player season averages + last 5 game log from ESPN

export async function fetchPlayerStats() {
  const stats = {};

  try {
    // 1. Get today's scoreboard to find active players/teams
    const sbRes = await fetch(
      "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard",
      { cache: "no-store" }
    );
    if (!sbRes.ok) return stats;
    const sbData = await sbRes.json();
    const events = sbData.events || [];

    // 2. For each game, fetch team rosters + player stats
    for (const event of events) {
      const comp = event.competitions?.[0];
      if (!comp) continue;
      const now = new Date();
      const gameStart = new Date(event.date);
      if (gameStart < now) continue; // only upcoming games

      for (const competitor of (comp.competitors || [])) {
        const teamId = competitor.team?.id;
        const teamName = competitor.team?.displayName || "";
        const isHome = competitor.homeAway === "home";

        try {
          // Fetch team roster with stats
          const rosterRes = await fetch(
            `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${teamId}/roster`,
            { cache: "no-store" }
          );
          if (!rosterRes.ok) continue;
          const rosterData = await rosterRes.json();

          for (const athlete of (rosterData.athletes || [])) {
            const playerId = athlete.id;
            const playerName = athlete.fullName || athlete.displayName || "";
            if (!playerName || !playerId) continue;

            try {
              // Season averages
              const statsRes = await fetch(
                `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/athletes/${playerId}/stats`,
                { cache: "no-store" }
              );
              if (!statsRes.ok) continue;
              const statsData = await statsRes.json();

              // Parse season averages
              const seasonAvg = parseESPNPlayerStats(statsData);
              if (!seasonAvg || !seasonAvg.gp || seasonAvg.gp < 5) continue;

              // Game log — last 5 games
              const logRes = await fetch(
                `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/athletes/${playerId}/gamelog`,
                { cache: "no-store" }
              );
              const l5 = {};
              if (logRes.ok) {
                const logData = await logRes.json();
                Object.assign(l5, parseL5(logData));
              }

              stats[playerName.toLowerCase()] = {
                name: playerName,
                teamName,
                teamId,
                isHome,
                season: seasonAvg,
                l5,
              };
            } catch(e) { /* skip individual player */ }
          }
        } catch(e) { /* skip team */ }
      }
    }
  } catch(e) {
    console.warn("[Props] fetchPlayerStats failed:", e.message);
  }

  console.log(`[Props] Loaded stats for ${Object.keys(stats).length} players`);

  // BDL enrichment — BDL is primary source for season averages + L5 game logs
  // Runs for all players; rate limiter handles throttling at 60 req/min
  if (process.env.BALLDONTLIE_API_KEY) {
    let enriched = 0;
    const now = new Date();
    const seasonYear = now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1;

    for (const [nameKey, pData] of Object.entries(stats)) {
      const s = pData.season;
      try {
        const searchRes = await bdlFetch(`/players?search=${encodeURIComponent(pData.name)}&per_page=3`);
        if (!searchRes?.data?.length) continue;
        const player = searchRes.data[0];

        // Season averages — BDL preferred over ESPN
        const avgRes = await bdlFetch(`/season_averages?season=${seasonYear}&player_ids[]=${player.id}`);
        if (avgRes?.data?.length) {
          const avg = avgRes.data[0];
          stats[nameKey].season = {
            pts:  avg.pts  || s?.pts  || 0,
            reb:  avg.reb  || s?.reb  || 0,
            ast:  avg.ast  || s?.ast  || 0,
            tpm:  avg.fg3m || s?.tpm  || 0,
            min:  parseFloat(avg.min || "0") || s?.min || 0,
            gp:   avg.games_played || s?.gp  || 0,
            pra:  (avg.pts||0) + (avg.reb||0) + (avg.ast||0),
            source: "balldontlie",
          };
        }

        // L5 game logs — fetch per-game BDL stats for last 5 completed games
        const teamId = player.team?.id;
        if (teamId) {
          const gamesRes = await bdlFetch(`/games?team_ids[]=${teamId}&per_page=6&postseason=false`);
          const completedGames = (gamesRes?.data || [])
            .filter(g => g.status === "Final")
            .sort((a, b) => new Date(b.date) - new Date(a.date))
            .slice(0, 5);

          const l5Games = [];
          for (const g of completedGames) {
            try {
              const statRes = await bdlFetch(`/stats?game_ids[]=${g.id}&player_ids[]=${player.id}&per_page=1`);
              const sl = statRes?.data?.[0];
              if (sl) l5Games.push({ pts: sl.pts||0, reb: sl.reb||0, ast: sl.ast||0, tpm: sl.fg3m||0 });
            } catch(_) { /* skip game */ }
          }

          if (l5Games.length >= 2) {
            const avgStat = key => l5Games.reduce((sum, g) => sum + (g[key]||0), 0) / l5Games.length;
            stats[nameKey].l5 = {
              pts: avgStat("pts"),
              reb: avgStat("reb"),
              ast: avgStat("ast"),
              tpm: avgStat("tpm"),
              pra: avgStat("pts") + avgStat("reb") + avgStat("ast"),
              gamesPlayed: l5Games.length,
              source: "balldontlie",
            };
          }
        }

        enriched++;
        console.log(`[BDL] Enriched ${pData.name} (${enriched}/${Object.keys(stats).length})`);
      } catch(e) { console.warn(`[BDL] Enrich failed for ${pData.name}:`, e.message); }
    }
    console.log(`[BDL] Enrichment complete — ${enriched} players`);
  } else {
    console.warn("[BDL] API key not set — ESPN stats only");
  }

  return stats;
}

function parseESPNPlayerStats(data) {
  try {
    // ESPN stats endpoint returns splits — find the "Total" or "Regular Season" split
    const splits = data.splits?.categories || data.athlete?.statistics?.splits || [];
    let cats = null;

    // Try nested structure
    for (const split of splits) {
      if (split.name === "Total" || split.displayName === "2025-26" || split.name === "regularSeason") {
        cats = split.stats || split.categories;
        break;
      }
    }
    if (!cats) cats = splits[0]?.stats || splits[0]?.categories || [];

    // Build stat map from name→value arrays
    const statMap = {};
    if (Array.isArray(cats)) {
      for (const cat of cats) {
        if (cat.name && cat.value !== undefined) {
          statMap[cat.name] = parseFloat(cat.value) || 0;
        } else if (cat.displayName && cat.value !== undefined) {
          statMap[cat.displayName] = parseFloat(cat.value) || 0;
        }
      }
    }

    return {
      pts:  statMap["points"]      || statMap["PTS"] || statMap["avgPoints"] || 0,
      reb:  statMap["rebounds"]    || statMap["REB"] || statMap["avgRebounds"] || 0,
      ast:  statMap["assists"]     || statMap["AST"] || statMap["avgAssists"] || 0,
      tpm:  statMap["threePointFieldGoalsMade"] || statMap["3PM"] || statMap["avg3PM"] || 0,
      min:  statMap["minutesPerGame"] || statMap["MIN"] || statMap["avgMinutes"] || 0,
      gp:   statMap["gamesPlayed"] || statMap["GP"] || 0,
      pra:  (statMap["points"]||0) + (statMap["rebounds"]||0) + (statMap["assists"]||0),
    };
  } catch(e) { return null; }
}

function parseL5(logData) {
  try {
    const events = logData.events?.slice(0, 5) || [];
    if (!events.length) return {};

    const statKeys = logData.labels || [];
    const games = events.map(ev => {
      const row = {};
      statKeys.forEach((k, i) => { row[k] = parseFloat(ev.stats?.[i]) || 0; });
      return row;
    });

    const avg = key => {
      const vals = games.map(g => g[key] || 0).filter(v => v > 0);
      return vals.length ? vals.reduce((s,v)=>s+v,0)/vals.length : 0;
    };

    return {
      pts: avg("PTS") || avg("points"),
      reb: avg("REB") || avg("rebounds"),
      ast: avg("AST") || avg("assists"),
      tpm: avg("3PM") || avg("threePointFieldGoalsMade"),
      pra: (avg("PTS")||avg("points")) + (avg("REB")||avg("rebounds")) + (avg("AST")||avg("assists")),
      gamesPlayed: games.length,
    };
  } catch(e) { return {}; }
}

// ── TEAM DEFENSE FETCH ────────────────────────────────────────────────────────
// Fetches opponent defensive stats — points/reb/ast allowed per game

export async function fetchTeamDefenseStats() {
  const defense = {};
  try {
    const res = await fetch(
      "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams",
      { cache: "no-store" }
    );
    if (!res.ok) return defense;
    const data = await res.json();

    for (const entry of (data.sports?.[0]?.leagues?.[0]?.teams || [])) {
      const team = entry.team;
      const name = team.displayName;
      const teamId = team.id;

      try {
        const statsRes = await fetch(
          `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${teamId}/statistics`,
          { cache: "no-store" }
        );
        if (!statsRes.ok) continue;
        const statsData = await statsRes.json();

        // Find opponent stats section
        const oppStats = statsData.results?.stats?.splits?.find(
          s => s.name === "opponent" || s.displayName === "Opponent"
        );
        const teamStats = statsData.results?.stats?.splits?.find(
          s => s.name === "total" || s.displayName === "Total"
        );

        const getVal = (split, key) => {
          if (!split) return 0;
          const stat = (split.stats || []).find(s => s.name === key || s.displayName === key);
          return parseFloat(stat?.value) || 0;
        };

        defense[name] = {
          ptsAllowed:  getVal(oppStats, "points") || getVal(oppStats, "avgPoints"),
          rebAllowed:  getVal(oppStats, "rebounds") || getVal(oppStats, "avgRebounds"),
          astAllowed:  getVal(oppStats, "assists") || getVal(oppStats, "avgAssists"),
          pace:        getVal(teamStats, "possessions") || getVal(teamStats, "pace") || 100,
        };
      } catch(e) { /* skip team */ }
    }
  } catch(e) {
    console.warn("[Props] fetchTeamDefenseStats failed:", e.message);
  }

  console.log(`[Props] Loaded defense stats for ${Object.keys(defense).length} teams`);
  return defense;
}

// ── FETCH ODDS ────────────────────────────────────────────────────────────────

export async function fetchPlayerProps(apiKey, games) {
  if (!apiKey || !games?.length) return [];
  const now = new Date();
  const upcoming = games.filter(g => g.commence_time && new Date(g.commence_time) > now);
  if (!upcoming.length) return [];

  const allPropGames = [];
  const marketsParam = PROP_MARKETS.join(",");

  for (const game of upcoming) {
    if (!game.id) continue;
    try {
      const urlTemplate = `https://api.the-odds-api.com/v4/sports/basketball_nba/events/${game.id}/odds?regions=us,us2&markets=${marketsParam}&bookmakers=${PROP_BOOKS}&oddsFormat=american`;
      const { data, quotaRemaining } = await fetchOddsAPI(urlTemplate);
      if (data.message) { console.warn(`[Props] API error: ${data.message}`); continue; }
      allPropGames.push({ ...data, home_team: game.home_team, away_team: game.away_team, commence_time: game.commence_time });
      console.log(`[Props] ${game.away_team} @ ${game.home_team} — quota: ${quotaRemaining}`);
    } catch(e) { console.warn(`[Props] Failed ${game.id}: ${e.message}`); }
  }
  return allPropGames;
}

// ── EV EXTRACTION ─────────────────────────────────────────────────────────────

export function extractPropEV(propGames, playerStats = {}, defenseStats = {}) {
  const bets = [];

  for (const game of propGames) {
    const gameLabel = `${game.away_team} @ ${game.home_team}`;
    const bookmakers = game.bookmakers || [];
    if (!bookmakers.length) continue;

    // Index: marketKey → playerName → side → bookKey → {price, point}
    const propIndex = {};
    for (const bk of bookmakers) {
      for (const mkt of (bk.markets || [])) {
        if (!propIndex[mkt.key]) propIndex[mkt.key] = {};
        for (const outcome of (mkt.outcomes || [])) {
          const player = outcome.description || outcome.name;
          const side = outcome.name;
          if (!player || !side) continue;
          if (!propIndex[mkt.key][player]) propIndex[mkt.key][player] = {};
          if (!propIndex[mkt.key][player][side]) propIndex[mkt.key][player][side] = {};
          propIndex[mkt.key][player][side][bk.key] = { price: outcome.price, point: outcome.point };
        }
      }
    }

    for (const [marketKey, players] of Object.entries(propIndex)) {
      const marketLabel = formatMarketLabel(marketKey);

      for (const [player, sides] of Object.entries(players)) {
        for (const side of ["Over", "Under"]) {
          const sideData = sides[side];
          const oppData = sides[side === "Over" ? "Under" : "Over"];
          if (!sideData || !oppData) continue;
          if (Object.keys(sideData).length < MIN_BOOKS_FOR_EDGE) continue;

          const points = Object.values(sideData).map(v => v.point).filter(Boolean);
          const line = points.length ? points.sort((a,b)=>a-b)[Math.floor(points.length/2)] : null;
          if (line === null) continue;

          let trueProb = null;
          const pinnOver = sideData["pinnacle"]?.price;
          const pinnUnder = oppData["pinnacle"]?.price;
          if (pinnOver && pinnUnder) {
            const iO = americanToImplied(pinnOver), iU = americanToImplied(pinnUnder);
            trueProb = side === "Over" ? iO/(iO+iU) : iU/(iO+iU);
          } else {
            const thisArr = Object.values(sideData).map(v => americanToImplied(v.price));
            const oppArr  = Object.values(oppData).map(v => americanToImplied(v.price));
            if (!thisArr.length || !oppArr.length) continue;
            const aT = thisArr.reduce((s,v)=>s+v,0)/thisArr.length;
            const aO = oppArr.reduce((s,v)=>s+v,0)/oppArr.length;
            trueProb = aT/(aT+aO);
          }
          if (!trueProb || trueProb<=0 || trueProb>=1) continue;

          let bestOdds = null, bestBook = null;
          const allLines = {};
          for (const [bk, val] of Object.entries(sideData)) {
            if (bk === "pinnacle") continue;
            allLines[bk] = { odds: val.price, point: val.point };
            if (bestOdds === null || val.price > bestOdds) { bestOdds = val.price; bestBook = bk; }
          }
          if (bestOdds === null) continue;

          const decOdds = americanToDecimal(bestOdds);
          const edge = trueProb * decOdds - 1;
          if (edge < MIN_PROP_EDGE) continue;

          const allOddsArr = Object.values(allLines).map(v => v.odds);
          if (allOddsArr.length >= 3) {
            const avg = allOddsArr.reduce((s,v)=>s+v,0)/allOddsArr.length;
            if (bestOdds - avg > 150) continue;
          }

          const kPct = kellyPct(edge, decOdds);
          if (kPct <= 0) continue;

          // Find player stats
          const pStats = findPlayerStats(playerStats, player);
          // Find opponent team name
          const opponentTeam = isPlayerOnTeam(pStats?.teamName, game.home_team)
            ? game.away_team : game.home_team;
          const oppDefense = findTeamDefense(defenseStats, opponentTeam);
          const projResult = projectStatLine(pStats, oppDefense, marketKey);
          const projectedLine = projResult?.projected ?? null;
          const projectionBasis = projResult?.basis ?? null;

          const convictionScore = scorePropConviction({
            edge, trueProb, allLines, side, line, marketKey,
            playerStats: pStats, defenseStats: oppDefense,
            isHome: pStats?.isHome ?? null,
            projectedLine,
          });

          const id = `prop_${marketKey}_${player.replace(/\s+/g,"_")}_${side}_${line}`.toLowerCase();

          bets.push({
            id,
            game: gameLabel,
            gameTime: game.commence_time,
            player,
            market: marketKey,
            marketLabel,
            selection: `${player} ${side} ${line} ${marketLabel}`,
            side, line,
            bestOdds, bestBook, allLines,
            edge,
            ev: edge * 100,
            trueProb: trueProb * 100,
            kellyPct: kPct,
            type: "Player Prop",
            betType: "Player Prop",
            isProp: true,
            convictionScore,
            getAtOrBetter: (() => {
              const worstImplied = trueProb - 0.035; // 3.5% buffer
              if (worstImplied <= 0 || worstImplied >= 1) return null;
              return worstImplied >= 0.5
                ? Math.round(-(worstImplied / (1 - worstImplied)) * 100)
                : Math.round(((1 - worstImplied) / worstImplied) * 100);
            })(),
            // Attach stat signals for UI display
            playerSeasonAvg: pStats?.season ? getStatForMarket(pStats.season, marketKey) : null,
            playerL5Avg: pStats?.l5 ? getStatForMarket(pStats.l5, marketKey) : null,
            opponentTeam,
            signals: convictionScore > 0 ? buildSignalBreakdown({
              edge, trueProb, allLines, side, line, marketKey,
              playerStats: pStats, defenseStats: oppDefense, isHome: pStats?.isHome ?? null,
              projectedLine,
            }) : [],
            projectedLine,
            projectionBasis,
            hitRate: Math.round(40 + (convictionScore / 100) * 45),
          });
        }
      }
    }
  }

  return bets.sort((a, b) => b.convictionScore - a.convictionScore || b.edge - a.edge);
}

// ── ALL PROPS — unfiltered, one entry per player/market, sorted by trueProb ──
// Used by the Props tab to show EVERY player playing today ranked by hit likelihood
export function extractAllProps(propGames, playerStats = {}, defenseStats = {}) {
  const seen = new Set(); // dedup: one entry per player+market
  const bets = [];

  for (const game of propGames) {
    const gameLabel = `${game.away_team} @ ${game.home_team}`;
    const bookmakers = game.bookmakers || [];
    if (!bookmakers.length) continue;

    // Build same index as extractPropEV
    const propIndex = {};
    for (const bk of bookmakers) {
      for (const mkt of (bk.markets || [])) {
        if (!propIndex[mkt.key]) propIndex[mkt.key] = {};
        for (const outcome of (mkt.outcomes || [])) {
          const player = outcome.description || outcome.name;
          const side = outcome.name;
          if (!player || !side) continue;
          if (!propIndex[mkt.key][player]) propIndex[mkt.key][player] = {};
          if (!propIndex[mkt.key][player][side]) propIndex[mkt.key][player][side] = {};
          propIndex[mkt.key][player][side][bk.key] = { price: outcome.price, point: outcome.point };
        }
      }
    }

    for (const [marketKey, players] of Object.entries(propIndex)) {
      const marketLabel = formatMarketLabel(marketKey);
      for (const [player, sides] of Object.entries(players)) {
        const dedupeKey = `${player}:${marketKey}`;
        if (seen.has(dedupeKey)) continue;

        // Pick the side with higher implied probability (the likely direction)
        let bestBet = null;
        for (const side of ["Over", "Under"]) {
          const sideData = sides[side];
          const oppData  = sides[side === "Over" ? "Under" : "Over"];
          if (!sideData || !oppData) continue;

          const points = Object.values(sideData).map(v => v.point).filter(v => v != null);
          const line   = points.length ? points.sort((a,b)=>a-b)[Math.floor(points.length/2)] : null;
          if (line === null) continue;

          // Compute implied probability (Pinnacle sharp if available, else averaged market)
          const pinnSide = sideData["pinnacle"]?.price;
          const pinnOpp  = oppData["pinnacle"]?.price;
          let trueProb;
          if (pinnSide && pinnOpp) {
            const iS = americanToImplied(pinnSide), iO = americanToImplied(pinnOpp);
            trueProb = iS / (iS + iO);
          } else {
            const arr = Object.values(sideData).map(v => americanToImplied(v.price));
            const opp = Object.values(oppData).map(v => americanToImplied(v.price));
            if (!arr.length || !opp.length) continue;
            const aT = arr.reduce((s,v)=>s+v,0)/arr.length;
            const aO = opp.reduce((s,v)=>s+v,0)/opp.length;
            trueProb = aT / (aT + aO);
          }
          if (!trueProb || trueProb <= 0 || trueProb >= 1) continue;

          let bestOdds = null, bestBook = null;
          const allLines = {};
          for (const [bk, val] of Object.entries(sideData)) {
            if (bk === "pinnacle") continue;
            allLines[bk] = { odds: val.price, point: val.point };
            if (bestOdds === null || val.price > bestOdds) { bestOdds = val.price; bestBook = bk; }
          }
          if (bestOdds === null) {
            // Pinnacle-only line — still useful for display
            const pVal = sideData["pinnacle"];
            if (pVal) { bestOdds = pVal.price; bestBook = "pinnacle"; allLines["pinnacle"] = { odds: pVal.price, point: pVal.point }; }
            else continue;
          }

          const decOdds = americanToDecimal(bestOdds);
          const edge = trueProb * decOdds - 1;
          const kPct = kellyPct(edge, decOdds);

          const pStats     = findPlayerStats(playerStats, player);
          const oppTeam    = isPlayerOnTeam(pStats?.teamName, game.home_team) ? game.away_team : game.home_team;
          const oppDef     = findTeamDefense(defenseStats, oppTeam);
          const projResult = projectStatLine(pStats, oppDef, marketKey);
          const projectedLine   = projResult?.projected ?? null;
          const projectionBasis = projResult?.basis    ?? null;
          const convictionScore = scorePropConviction({
            edge, trueProb, allLines, side, line, marketKey,
            playerStats: pStats, defenseStats: oppDef,
            isHome: pStats?.isHome ?? null, projectedLine,
          });

          if (!bestBet || trueProb > bestBet.trueProb / 100) {
            bestBet = {
              id: `allprop_${marketKey}_${player.replace(/\s+/g,"_")}_${side}_${line}`.toLowerCase(),
              game: gameLabel, gameTime: game.commence_time,
              player, market: marketKey, marketLabel,
              selection: `${player} ${side} ${line} ${marketLabel}`,
              side, line, bestOdds, bestBook, allLines,
              edge, ev: edge * 100, trueProb: trueProb * 100, kellyPct: kPct,
              type: "Player Prop", betType: "Player Prop", isProp: true,
              convictionScore,
              playerSeasonAvg: pStats?.season ? getStatForMarket(pStats.season, marketKey) : null,
              playerL5Avg:     pStats?.l5     ? getStatForMarket(pStats.l5,     marketKey) : null,
              opponentTeam: oppTeam, projectedLine, projectionBasis,
              hitRate: Math.round(trueProb * 100),
            };
          }
        }

        if (bestBet) {
          seen.add(dedupeKey);
          bets.push(bestBet);
        }
      }
    }
  }

  return bets.sort((a, b) => b.trueProb - a.trueProb || b.convictionScore - a.convictionScore);
}

// ── STAT LINE PROJECTION ──────────────────────────────────────────────────────
// 60% season avg + 40% L5 avg, matchup multiplier (0.85–1.15), home/away ±3%
function projectStatLine(playerStats, defenseStats, marketKey) {
  if (!playerStats) return null;
  const seasonAvg = playerStats.season ? getStatForMarket(playerStats.season, marketKey) : null;
  const l5Avg     = playerStats.l5     ? getStatForMarket(playerStats.l5,     marketKey) : null;

  if (!seasonAvg && !l5Avg) return null;

  // Weighted blend: 60% season + 40% L5 (fall back to whichever exists)
  let base;
  if (seasonAvg && l5Avg) base = seasonAvg * 0.6 + l5Avg * 0.4;
  else base = seasonAvg || l5Avg;

  // Matchup multiplier based on opponent defense
  let matchupMult = 1.0;
  if (defenseStats) {
    const leagueAvgPts = 113, leagueAvgReb = 44, leagueAvgAst = 27;
    if (marketKey === "player_points") {
      matchupMult = 1 + ((defenseStats.ptsAllowed || leagueAvgPts) - leagueAvgPts) / leagueAvgPts * 0.5;
    } else if (marketKey === "player_rebounds") {
      matchupMult = 1 + ((defenseStats.rebAllowed || leagueAvgReb) - leagueAvgReb) / leagueAvgReb * 0.5;
    } else if (marketKey === "player_assists") {
      matchupMult = 1 + ((defenseStats.astAllowed || leagueAvgAst) - leagueAvgAst) / leagueAvgAst * 0.5;
    }
    matchupMult = Math.max(0.85, Math.min(1.15, matchupMult));
  }

  // Home/away adjust ±3%
  const homeAdjust = playerStats.isHome === true ? 1.03 : playerStats.isHome === false ? 0.97 : 1.0;

  const projected = +(base * matchupMult * homeAdjust).toFixed(1);
  const basis = seasonAvg && l5Avg ? "season+L5" : seasonAvg ? "season" : "L5";
  return { projected, basis };
}

// ── CONVICTION SCORING — FULL ENGINE ─────────────────────────────────────────
// 7 signals, each 0–100, weighted sum → final 0–100 score

const SIGNAL_WEIGHTS = {
  edgeStrength:        0.22,
  l5Form:              0.18,
  seasonVsLine:        0.13,
  matchupDefense:      0.13,
  projectionAlignment: 0.12,
  bookConsensus:       0.09,
  homeAwayFactor:      0.07,
  paceFactor:          0.06,
};

function scorePropConviction({ edge, trueProb, allLines, side, line, marketKey,
  playerStats, defenseStats, isHome, projectedLine }) {

  const signals = buildSignalBreakdown({ edge, trueProb, allLines, side, line,
    marketKey, playerStats, defenseStats, isHome, projectedLine });

  let score = 0;
  for (const [key, weight] of Object.entries(SIGNAL_WEIGHTS)) {
    const sig = signals.find(s => s.key === key);
    if (sig) score += sig.score * weight;
  }
  return Math.min(Math.round(score), 100);
}

function buildSignalBreakdown({ edge, trueProb, allLines, side, line, marketKey,
  playerStats, defenseStats, isHome, projectedLine }) {

  const signals = [];

  // ── 1. Edge Strength (0–100) ──────────────────────────────────────────────
  const edgePct = edge * 100;
  const edgeScore = Math.min(edgePct * 10, 100); // 10% edge = 100
  signals.push({ key: "edgeStrength", label: "EV Edge", score: edgeScore,
    detail: `+${edgePct.toFixed(1)}% edge` });

  // ── 2. L5 Recent Form vs Line ─────────────────────────────────────────────
  const l5Avg = playerStats?.l5 ? getStatForMarket(playerStats.l5, marketKey) : null;
  let l5Score = 50; // neutral if no data
  if (l5Avg !== null && l5Avg > 0) {
    const diff = side === "Over" ? (l5Avg - line) / line : (line - l5Avg) / line;
    // +10% above/below line = score 75; +20% = 100
    l5Score = Math.max(0, Math.min(100, 50 + diff * 250));
  }
  signals.push({ key: "l5Form", label: "L5 Form", score: l5Score,
    detail: l5Avg !== null ? `L5 avg: ${l5Avg.toFixed(1)} vs line ${line}` : "No recent data" });

  // ── 3. Season Average vs Line ─────────────────────────────────────────────
  const seasonAvg = playerStats?.season ? getStatForMarket(playerStats.season, marketKey) : null;
  let seasonScore = 50;
  if (seasonAvg !== null && seasonAvg > 0) {
    const diff = side === "Over" ? (seasonAvg - line) / line : (line - seasonAvg) / line;
    seasonScore = Math.max(0, Math.min(100, 50 + diff * 200));
  }
  signals.push({ key: "seasonVsLine", label: "Season Avg", score: seasonScore,
    detail: seasonAvg !== null ? `Season: ${seasonAvg.toFixed(1)} vs line ${line}` : "No season data" });

  // ── 4. Matchup Defense ────────────────────────────────────────────────────
  let defScore = 50;
  if (defenseStats) {
    const leagueAvgPts = 113, leagueAvgReb = 44, leagueAvgAst = 27;
    if (marketKey === "player_points") {
      const ptsAllowed = defenseStats.ptsAllowed || leagueAvgPts;
      // More pts allowed = better for Over
      const defFactor = (ptsAllowed - leagueAvgPts) / leagueAvgPts;
      defScore = side === "Over"
        ? Math.max(0, Math.min(100, 50 + defFactor * 300))
        : Math.max(0, Math.min(100, 50 - defFactor * 300));
    } else if (marketKey === "player_rebounds") {
      const rebAllowed = defenseStats.rebAllowed || leagueAvgReb;
      const defFactor = (rebAllowed - leagueAvgReb) / leagueAvgReb;
      defScore = side === "Over"
        ? Math.max(0, Math.min(100, 50 + defFactor * 300))
        : Math.max(0, Math.min(100, 50 - defFactor * 300));
    } else if (marketKey === "player_assists") {
      const astAllowed = defenseStats.astAllowed || leagueAvgAst;
      const defFactor = (astAllowed - leagueAvgAst) / leagueAvgAst;
      defScore = side === "Over"
        ? Math.max(0, Math.min(100, 50 + defFactor * 300))
        : Math.max(0, Math.min(100, 50 - defFactor * 300));
    } else if (marketKey.includes("points")) {
      // Combo markets — use pts allowed as proxy
      const ptsAllowed = defenseStats.ptsAllowed || leagueAvgPts;
      const defFactor = (ptsAllowed - leagueAvgPts) / leagueAvgPts;
      defScore = side === "Over"
        ? Math.max(0, Math.min(100, 50 + defFactor * 250))
        : Math.max(0, Math.min(100, 50 - defFactor * 250));
    }
  }
  signals.push({ key: "matchupDefense", label: "Matchup", score: defScore,
    detail: defenseStats?.ptsAllowed
      ? `Opp allows ${defenseStats.ptsAllowed.toFixed(1)} pts/g`
      : "Defense data unavailable" });

  // ── 5. Book Consensus ─────────────────────────────────────────────────────
  const bookCount = Object.keys(allLines).length;
  const consensusScore = Math.min(bookCount * 20, 100); // 5 books = 100
  signals.push({ key: "bookConsensus", label: "Book Consensus", score: consensusScore,
    detail: `${bookCount} books pricing this line` });

  // ── 6. Home/Away Factor ───────────────────────────────────────────────────
  let homeScore = 50;
  if (isHome !== null && playerStats?.season) {
    // Home players generally score slightly more — use 5% boost/penalty
    homeScore = isHome ? 58 : 42;
  }
  signals.push({ key: "homeAwayFactor", label: "Home/Away", score: homeScore,
    detail: isHome === null ? "Unknown" : isHome ? "Home game (+boost)" : "Away game (-slight)" });

  // ── 7. Pace Factor ────────────────────────────────────────────────────────
  let paceScore = 50;
  if (defenseStats?.pace) {
    const leaguePace = 100;
    const paceDiff = (defenseStats.pace - leaguePace) / leaguePace;
    // High pace = more possessions = better for counting stats (Over)
    paceScore = side === "Over" && marketKey !== "player_threes"
      ? Math.max(0, Math.min(100, 50 + paceDiff * 300))
      : Math.max(0, Math.min(100, 50 - paceDiff * 300));
  }
  signals.push({ key: "paceFactor", label: "Game Pace", score: paceScore,
    detail: defenseStats?.pace
      ? `Pace: ${defenseStats.pace.toFixed(0)} possessions` : "Pace data unavailable" });

  // ── 8. Projection Alignment ───────────────────────────────────────────────
  let projScore = 50;
  if (projectedLine != null) {
    const diff = side === "Over"
      ? (projectedLine - line) / line
      : (line - projectedLine) / line;
    projScore = Math.max(0, Math.min(100, 50 + diff * 200));
  }
  signals.push({ key: "projectionAlignment", label: "Model Projection", score: projScore,
    detail: projectedLine != null
      ? `Projected: ${projectedLine} vs line ${line}`
      : "No projection available" });

  return signals;
}

function getStatForMarket(stats, marketKey) {
  if (!stats) return null;
  switch (marketKey) {
    case "player_points": return stats.pts || null;
    case "player_rebounds": return stats.reb || null;
    case "player_assists": return stats.ast || null;
    case "player_threes": return stats.tpm || null;
    case "player_points_rebounds_assists": return stats.pra || (stats.pts&&stats.reb&&stats.ast ? stats.pts+stats.reb+stats.ast : null);
    case "player_points_rebounds": return (stats.pts && stats.reb) ? stats.pts + stats.reb : null;
    case "player_points_assists": return (stats.pts && stats.ast) ? stats.pts + stats.ast : null;
    default: return null;
  }
}

function findPlayerStats(playerStats, name) {
  if (!playerStats || !name) return null;
  const key = name.toLowerCase().trim();
  if (playerStats[key]) return playerStats[key];
  // Fuzzy: last name match
  const lastName = key.split(" ").pop();
  for (const [k, v] of Object.entries(playerStats)) {
    if (k.endsWith(lastName)) return v;
  }
  return null;
}

function isPlayerOnTeam(playerTeam, teamName) {
  if (!playerTeam || !teamName) return false;
  return playerTeam.toLowerCase().includes(teamName.toLowerCase().split(" ").pop());
}

function findTeamDefense(defenseStats, teamName) {
  if (!defenseStats || !teamName) return null;
  const key = teamName.toLowerCase();
  for (const [k, v] of Object.entries(defenseStats)) {
    if (k.toLowerCase() === key || k.toLowerCase().includes(key.split(" ").pop())) return v;
  }
  return null;
}

function formatMarketLabel(key) {
  return { player_points:"Points", player_rebounds:"Rebounds", player_assists:"Assists",
    player_threes:"3-Pointers", player_points_rebounds_assists:"PRA",
    player_points_rebounds:"Pts+Reb", player_points_assists:"Pts+Ast" }[key] || key;
}

// ── AUTO-BET ──────────────────────────────────────────────────────────────────

export function placePropBets(evProps, currentBankroll, existingHistory) {
  const today = new Date().toDateString();
  const placedToday = new Set(
    existingHistory
      .filter(h => new Date(h.date).toDateString() === today && h.isProp)
      .map(h => h.betId)
  );

  const newEntries = [];
  const autoBet = evProps.filter(p =>
    p.convictionScore >= PROP_CONVICTION_THRESHOLD && p.edge >= MIN_PROP_EDGE
  );

  for (const prop of autoBet) {
    if (placedToday.has(prop.id)) continue;
    const wagerAmt = +(currentBankroll * (prop.kellyPct / 100)).toFixed(2);
    if (wagerAmt < 0.01) continue;
    const decOdds = americanToDecimal(prop.bestOdds);
    const payout = +(wagerAmt * (decOdds - 1)).toFixed(2);
    const MIN_PROP_PAYOUT_RATIO = 0.15; // props need ≥15% return
    if (payout / wagerAmt < MIN_PROP_PAYOUT_RATIO) {
      console.log(`[Props] Skipping ${prop.player} ${prop.side} ${prop.line} — payout ratio ${(payout/wagerAmt*100).toFixed(1)}% below 15% min`);
      continue;
    }

    newEntries.push({
      id: `${prop.id}_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
      betId: prop.id,
      date: new Date().toISOString(),
      game: prop.game, selection: prop.selection,
      player: prop.player, market: prop.market, marketLabel: prop.marketLabel,
      line: prop.line, side: prop.side,
      type: "Player Prop", betType: "Player Prop",
      bestOdds: prop.bestOdds, bestBook: prop.bestBook, allLines: prop.allLines,
      kellyPct: prop.kellyPct, wagerAmt, potentialPayout: payout,
      ev: prop.ev, edge: prop.edge, trueProb: prop.trueProb,
      convictionScore: prop.convictionScore, gameTime: prop.gameTime,
      status: "pending", bankrollBefore: +currentBankroll.toFixed(2),
      bankrollAfter: +currentBankroll.toFixed(2), result: null,
      isProp: true, isConviction: false,
    });
    placedToday.add(prop.id);
  }

  return { newEntries };
}

// ── RESOLUTION ────────────────────────────────────────────────────────────────

export async function resolveProps(history) {
  const pendingProps = history.filter(h => h.isProp && h.status === "pending");
  if (!pendingProps.length) return { history, changed: false };

  const boxScores = await fetchESPNBoxScores();
  if (!boxScores.length) return { history, changed: false };

  let changed = false;
  const updated = history.map(entry => {
    if (!entry.isProp || entry.status !== "pending") return entry;
    const gameAge = (Date.now() - new Date(entry.gameTime || entry.date)) / 3600000;
    if (gameAge < 3) return entry;

    const playerStats = findPlayerInBoxScores(boxScores, entry.player, entry.game);
    if (!playerStats) return entry;

    const actual = getStatValue(playerStats, entry.market);
    if (actual === null) return entry;

    const isPush = actual === entry.line;
    const won = isPush ? null : entry.side === "Over" ? actual > entry.line : actual < entry.line;
    const wagerAmt = entry.wagerAmt || 0;
    const payout = +(wagerAmt * (americanToDecimal(entry.bestOdds || -110) - 1)).toFixed(2);

    changed = true;
    return {
      ...entry,
      status: isPush ? "void" : won ? "won" : "lost",
      result: isPush ? "PUSH" : won ? "WIN" : "LOSS",
      actualStatValue: actual,
      potentialPayout: payout,
    };
  });

  return { history: updated, changed };
}

async function fetchESPNBoxScores() {
  const results = [];
  const dates = [0,1].map(d => {
    const dt = new Date(Date.now()-d*86400000);
    return dt.toISOString().slice(0,10).replace(/-/g,"");
  });

  for (const date of dates) {
    try {
      const res = await fetch(
        `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${date}`,
        { cache:"no-store" }
      );
      if (!res.ok) continue;
      const data = await res.json();

      for (const event of (data.events||[])) {
        const comp = event.competitions?.[0];
        if (!comp?.status?.type?.completed) continue;
        const home = comp.competitors?.find(c=>c.homeAway==="home");
        const away = comp.competitors?.find(c=>c.homeAway==="away");
        if (!home||!away) continue;

        try {
          const bsRes = await fetch(
            `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${event.id}`,
            { cache:"no-store" }
          );
          if (!bsRes.ok) continue;
          const bsData = await bsRes.json();
          const players = [];
          for (const team of (bsData.boxscore?.players||[])) {
            for (const group of (team.statistics||[])) {
              for (const athlete of (group.athletes||[])) {
                const stats = {};
                group.names?.forEach((n,i) => { stats[n] = parseFloat(athlete.stats?.[i])||0; });
                players.push({ name: athlete.athlete?.displayName||"", stats });
              }
            }
          }
          results.push({ home:home.team.displayName, away:away.team.displayName, players });
        } catch(e) {}
      }
    } catch(e) {}
  }
  return results;
}

function findPlayerInBoxScores(boxScores, playerName, gameLabel) {
  const normName = playerName.toLowerCase().trim();
  for (const game of boxScores) {
    const gl = gameLabel.toLowerCase();
    const hw = game.home.toLowerCase().split(" ").pop();
    const aw = game.away.toLowerCase().split(" ").pop();
    if (!gl.includes(hw) && !gl.includes(aw)) continue;
    const player = game.players.find(p => {
      const pn = p.name.toLowerCase();
      return pn === normName || pn.endsWith(normName.split(" ").pop());
    });
    if (player) return player.stats;
  }
  return null;
}

function getStatValue(stats, market) {
  const findStat = keys => {
    for (const k of keys) {
      if (stats[k] !== undefined) return stats[k];
      const m = Object.entries(stats).find(([key]) => key.toLowerCase()===k.toLowerCase());
      if (m) return m[1];
    }
    return null;
  };
  if (market==="player_points_rebounds_assists") {
    const p=findStat(["PTS"])||0, r=findStat(["REB","TREB"])||0, a=findStat(["AST"])||0;
    return p+r+a>0?p+r+a:null;
  }
  if (market==="player_points_rebounds") {
    const p=findStat(["PTS"])||0, r=findStat(["REB","TREB"])||0;
    return p+r>0?p+r:null;
  }
  if (market==="player_points_assists") {
    const p=findStat(["PTS"])||0, a=findStat(["AST"])||0;
    return p+a>0?p+a:null;
  }
  const keyMap = {
    player_points:["PTS"], player_rebounds:["REB","TREB"],
    player_assists:["AST"], player_threes:["3PM","3FGM"],
  };
  return findStat(keyMap[market]||[]);
}
