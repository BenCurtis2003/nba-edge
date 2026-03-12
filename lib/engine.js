// lib/engine.js
// Core NBA Edge betting engine — runs server-side on a cron schedule.
// No browser APIs, no localStorage. All state goes to Vercel KV.

const SPORTSBOOKS = ["draftkings","fanduel","betmgm","caesars","pointsbet","betrivers"];
const MIN_EV_EDGE = 0.5;
const MIN_EV_EDGE_LONGSHOT = 2.5;
const MIN_EV_EDGE_PROP = 2.5;
const KELLY_FRACTION = 0.25;
const CONVICTION_THRESHOLD = 70;
const STARTING_BANKROLL = 100;

// ── MATH UTILITIES ─────────────────────────────────────────────────────────────

function americanToDecimal(odds) {
  return odds < 0 ? (100 / (-odds) + 1) : (odds / 100 + 1);
}

function americanToImplied(odds) {
  return odds < 0 ? (-odds) / (-odds + 100) : 100 / (odds + 100);
}

function noVigProb(homeOdds, awayOdds) {
  const hi = americanToImplied(homeOdds);
  const ai = americanToImplied(awayOdds);
  const total = hi + ai;
  return { home: hi / total, away: ai / total };
}

function kellyPct(edge, decOdds) {
  if(edge <= 0 || decOdds <= 1) return 0;
  const full = (edge * decOdds) / (decOdds - 1);
  return Math.min(full * KELLY_FRACTION * 100, 8); // cap at 8%
}

// ── ODDS API ───────────────────────────────────────────────────────────────────

export async function fetchLiveOdds(apiKey) {
  // Request h2h + spreads + totals in ONE call — saves 2/3 of API quota
  const books = "draftkings,fanduel,betmgm,caesars,pointsbet,betrivers,lowvig,betonlineag,bovada,mybookieag,betus,pinnacle";
  const url = `https://api.the-odds-api.com/v4/sports/basketball_nba/odds/?apiKey=${apiKey}&regions=us,us2&markets=h2h,spreads,totals&bookmakers=${books}&oddsFormat=american`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if(!res.ok) { console.error(`[OddsAPI] HTTP ${res.status}`); return null; }
    const data = await res.json();
    if(data.message) { console.error(`[OddsAPI] Error: ${data.message}`); return null; }
    console.log(`[OddsAPI] ${data.length} games, remaining quota: ${res.headers.get("x-requests-remaining")}`);
    return data;
  } catch(e) {
    console.error("[OddsAPI] Fetch failed:", e.message);
    return null;
  }
}

export async function fetchScores(apiKey) {
  // ESPN first — it's free and unlimited. Odds API only if ESPN returns nothing.
  const espnScores = await fetchESPNScores();
  if(espnScores.length > 0) {
    console.log(`[Scores] ESPN returned ${espnScores.length} completed games`);
    return espnScores;
  }
  // Fallback to Odds API scores (costs credits — use sparingly)
  if(apiKey) {
    try {
      const res = await fetch(
        `https://api.the-odds-api.com/v4/sports/basketball_nba/scores/?apiKey=${apiKey}&daysFrom=2`,
        { cache: "no-store" }
      );
      if(res.ok) {
        const data = await res.json();
        if(!data.message) {
          console.log(`[Scores] Odds API fallback: ${data.filter(g=>g.completed).length} completed`);
          return data;
        }
      }
    } catch(e) { console.warn("[Scores] Odds API fallback failed:", e.message); }
  }
  return [];
}

async function fetchESPNScores() {
  const makeDateStr = d => new Date(Date.now() - d*86400000).toISOString().slice(0,10).replace(/-/g,"");
  const urls = [
    "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard",
    `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${makeDateStr(1)}`,
    `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${makeDateStr(2)}`,
  ];
  const scores = [];
  for(const url of urls) {
    try {
      const res = await fetch(url);
      if(!res.ok) continue;
      const data = await res.json();
      for(const event of (data.events || [])) {
        const comp = event.competitions?.[0];
        const home = comp?.competitors?.find(c => c.homeAway === "home");
        const away = comp?.competitors?.find(c => c.homeAway === "away");
        const status = comp?.status?.type;
        if(!home || !away) continue;
        if(!(status?.completed || status?.state === "post")) continue;
        scores.push({
          home_team: home.team.displayName,
          away_team: away.team.displayName,
          completed: true,
          commence_time: event.date,
          scores: [
            { name: home.team.displayName, score: home.score },
            { name: away.team.displayName, score: away.score },
          ]
        });
      }
    } catch(e) { /* skip failed date */ }
  }
  // Deduplicate
  const seen = new Set();
  return scores.filter(s => {
    const key = `${normTeam(s.home_team)}|${normTeam(s.away_team)}`;
    if(seen.has(key)) return false;
    seen.add(key); return true;
  });
}

// ── EV BET EXTRACTION ─────────────────────────────────────────────────────────

export function extractEVBets(games) {
  const bets = [];

  for(const game of games) {
    const gameLabel = `${game.away_team} @ ${game.home_team}`;
    const bookmakers = game.bookmakers || [];
    const pinnBook = bookmakers.find(b => b.key === "pinnacle");

    // ── Index all markets ──────────────────────────────────────────────────────
    const h2h = {};        // { teamName: { bookKey: price } }
    const spreads = {};    // { teamName: { bookKey: { price, point } } }
    const totals = {};     // { "Over"/"Under": { bookKey: { price, point } } }

    for(const bk of bookmakers) {
      for(const mkt of (bk.markets || [])) {
        for(const o of (mkt.outcomes || [])) {
          if(mkt.key === "h2h") {
            if(!h2h[o.name]) h2h[o.name] = {};
            h2h[o.name][bk.key] = o.price;
          }
          if(mkt.key === "spreads") {
            if(!spreads[o.name]) spreads[o.name] = {};
            spreads[o.name][bk.key] = { price: o.price, point: o.point };
          }
          if(mkt.key === "totals") {
            if(!totals[o.name]) totals[o.name] = {};
            totals[o.name][bk.key] = { price: o.price, point: o.point };
          }
        }
      }
    }

    // ── Get true probabilities (Pinnacle devig, fallback to market consensus) ──
    function getTrueProbs_h2h() {
      // Primary: Pinnacle no-vig
      const pinnH2h = pinnBook?.markets?.find(m => m.key === "h2h");
      if(pinnH2h) {
        const pH = pinnH2h.outcomes.find(o => o.name === game.home_team);
        const pA = pinnH2h.outcomes.find(o => o.name === game.away_team);
        if(pH && pA) return noVigProb(pH.price, pA.price);
      }
      // Fallback: average across all books
      const homeOdds = [], awayOdds = [];
      for(const bk of bookmakers) {
        if(bk.key === "pinnacle") continue;
        const mkt = bk.markets?.find(m => m.key === "h2h");
        if(!mkt) continue;
        const h = mkt.outcomes.find(o => o.name === game.home_team);
        const a = mkt.outcomes.find(o => o.name === game.away_team);
        if(h && a) { homeOdds.push(h.price); awayOdds.push(a.price); }
      }
      if(!homeOdds.length) return null;
      const avgH = homeOdds.reduce((s,v)=>s+v,0)/homeOdds.length;
      const avgA = awayOdds.reduce((s,v)=>s+v,0)/awayOdds.length;
      return noVigProb(avgH, avgA);
    }

    function getTrueProbs_total() {
      const pinnTotal = pinnBook?.markets?.find(m => m.key === "totals");
      if(pinnTotal) {
        const pO = pinnTotal.outcomes.find(o => o.name === "Over");
        const pU = pinnTotal.outcomes.find(o => o.name === "Under");
        if(pO && pU) return noVigProb(pO.price, pU.price);
      }
      // Fallback: market consensus
      const overOdds = [], underOdds = [];
      for(const bk of bookmakers) {
        if(bk.key === "pinnacle") continue;
        const mkt = bk.markets?.find(m => m.key === "totals");
        if(!mkt) continue;
        const o = mkt.outcomes.find(o => o.name === "Over");
        const u = mkt.outcomes.find(o => o.name === "Under");
        if(o && u) { overOdds.push(o.price); underOdds.push(u.price); }
      }
      if(!overOdds.length) return null;
      const avgO = overOdds.reduce((s,v)=>s+v,0)/overOdds.length;
      const avgU = underOdds.reduce((s,v)=>s+v,0)/underOdds.length;
      return noVigProb(avgO, avgU);
    }

    // ── Helper: find best odds across all non-Pinnacle books ──────────────────
    function bestLine(marketObj, key) {
      let bestOdds = null, bestBook = null;
      for(const [bk, val] of Object.entries(marketObj[key] || {})) {
        if(bk === "pinnacle") continue;
        const price = typeof val === "object" ? val.price : val;
        if(bestOdds === null || price > bestOdds) { bestOdds = price; bestBook = bk; }
      }
      return { bestOdds, bestBook };
    }

    function pushBet(bet) {
      const { edge, bestOdds, allLines } = bet;
      if(edge < MIN_EV_EDGE/100) return;
      if(bestOdds > 125 && edge < MIN_EV_EDGE_LONGSHOT/100) return;

      // Only reject truly egregious outliers (500+ pts above avg across 4+ books)
      if(allLines && Object.keys(allLines).length >= 4) {
        const allOdds = Object.values(allLines).map(v => typeof v === "object" ? v.odds : v);
        const avgOdds = allOdds.reduce((s,o) => s + o, 0) / allOdds.length;
        if(bestOdds - avgOdds > 500) return;
      }

      const decOdds = americanToDecimal(bestOdds);
      const kPct = kellyPct(edge, decOdds);
      if(kPct <= 0) return;
      bets.push({
        ...bet,
        ev: +((edge / americanToImplied(bestOdds)) * 100).toFixed(1),
        kellyPct: +kPct.toFixed(2),
        edge: +(edge * 100).toFixed(2),
        ourProbability: +(bet.trueProb * 100).toFixed(1),
        bookImplied: +(americanToImplied(bestOdds) * 100).toFixed(1),
      });
    }

    // ── 1. MONEYLINES ─────────────────────────────────────────────────────────
    const mlProbs = getTrueProbs_h2h();
    if(mlProbs) {
      for(const [team, trueProb] of [
        [game.home_team, mlProbs.home],
        [game.away_team, mlProbs.away],
      ]) {
        const { bestOdds, bestBook } = bestLine(h2h, team);
        if(!bestOdds) continue;
        const mlAllLines = {};
        for(const [bk, price] of Object.entries(h2h[team] || {})) {
          mlAllLines[bk] = { odds: price };
        }
        pushBet({
          id: `ev|ml|${gameLabel}|${team}`,
          type: "Moneyline", betType: "Moneyline",
          game: gameLabel, selection: `${team} ML`,
          gameTime: game.commence_time,
          bestOdds, bestBook, trueProb, allLines: mlAllLines,
          edge: trueProb - americanToImplied(bestOdds),
          isHome: team === game.home_team,
        });
      }
    }

    // ── 2. SPREADS — devig from spread market itself, not moneyline ────────
    {
      // Get true spread probabilities by devigging the spread market directly
      // For each team pair, find books with both sides and average no-vig prob
      const teams = [game.home_team, game.away_team];
      const spreadProbs = {};

      // Primary: Pinnacle spread devig
      const pinnSpread = pinnBook?.markets?.find(m => m.key === "spreads");
      if(pinnSpread) {
        const pH = pinnSpread.outcomes.find(o => o.name === game.home_team);
        const pA = pinnSpread.outcomes.find(o => o.name === game.away_team);
        if(pH && pA) {
          const nv = noVigProb(pH.price, pA.price);
          spreadProbs[game.home_team] = nv.home;
          spreadProbs[game.away_team] = nv.away;
        }
      }

      // Fallback: consensus spread devig across all books
      if(!spreadProbs[game.home_team]) {
        const homeSpreadOdds = [], awaySpreadOdds = [];
        for(const bk of bookmakers) {
          if(bk.key === "pinnacle") continue;
          const mkt = bk.markets?.find(m => m.key === "spreads");
          if(!mkt) continue;
          const h = mkt.outcomes.find(o => o.name === game.home_team);
          const a = mkt.outcomes.find(o => o.name === game.away_team);
          if(h && a) { homeSpreadOdds.push(h.price); awaySpreadOdds.push(a.price); }
        }
        if(homeSpreadOdds.length >= 2) {
          const avgH = homeSpreadOdds.reduce((s,v)=>s+v,0)/homeSpreadOdds.length;
          const avgA = awaySpreadOdds.reduce((s,v)=>s+v,0)/awaySpreadOdds.length;
          const nv = noVigProb(avgH, avgA);
          spreadProbs[game.home_team] = nv.home;
          spreadProbs[game.away_team] = nv.away;
        }
      }

      for(const team of teams) {
        const trueProb = spreadProbs[team];
        if(trueProb == null) continue;
        const { bestOdds, bestBook } = bestLine(spreads, team);
        if(!bestOdds) continue;
        const spread = spreads[team]?.[bestBook]?.point;
        // Collect all book spread lines
        const spreadLines = {};
        for(const [bk, val] of Object.entries(spreads[team] || {})) {
          spreadLines[bk] = { odds: val.price, point: val.point };
        }
        pushBet({
          id: `ev|spread|${gameLabel}|${team}`,
          type: "Spread", betType: "Spread",
          game: gameLabel,
          selection: `${team} ${spread >= 0 ? "+" : ""}${spread}`,
          gameTime: game.commence_time,
          bestOdds, bestBook, trueProb, allLines: spreadLines,
          edge: trueProb - americanToImplied(bestOdds),
          isHome: team === game.home_team,
        });
      }
    }

    // ── 3. GAME TOTALS ────────────────────────────────────────────────────────
    const totalProbs = getTrueProbs_total();
    if(totalProbs) {
      for(const [side, trueProb] of [
        ["Over", totalProbs.home],
        ["Under", totalProbs.away],
      ]) {
        const { bestOdds, bestBook } = bestLine(totals, side);
        if(!bestOdds) continue;
        const line = totals[side]?.[bestBook]?.point;
        const totalLines = {};
        for(const [bk, val] of Object.entries(totals[side] || {})) {
          totalLines[bk] = { odds: val.price, point: val.point };
        }
        pushBet({
          id: `ev|total|${gameLabel}|${side}`,
          type: "Game Total", betType: "Game Total",
          game: gameLabel,
          selection: `${side} ${line}`,
          gameTime: game.commence_time,
          bestOdds, bestBook, trueProb, allLines: totalLines,
          edge: trueProb - americanToImplied(bestOdds),
        });
      }
    }
  }

  return bets.sort((a,b) => b.ev - a.ev);
}

// ── CONVICTION ENGINE ─────────────────────────────────────────────────────────

function normTeam(name = "") {
  return name.toLowerCase().split(" ").pop().replace(/[^a-z]/g, "");
}

// Hardcoded 2025-26 standings — updated March 11 2026
// Scoreboard enriches today's teams; these cover all non-playing teams
const STANDINGS_FALLBACK = {
  "Boston Celtics":        { wins:48, losses:20, homeWins:27, homeLosses:8,  awayWins:21, awayLosses:12, last10Wins:6, last10Losses:4 },
  "Cleveland Cavaliers":   { wins:52, losses:14, homeWins:28, homeLosses:6,  awayWins:24, awayLosses:8,  last10Wins:7, last10Losses:3 },
  "Oklahoma City Thunder": { wins:49, losses:18, homeWins:27, homeLosses:8,  awayWins:22, awayLosses:10, last10Wins:7, last10Losses:3 },
  "Houston Rockets":       { wins:43, losses:24, homeWins:24, homeLosses:11, awayWins:19, awayLosses:13, last10Wins:6, last10Losses:4 },
  "Golden State Warriors": { wins:35, losses:32, homeWins:21, homeLosses:13, awayWins:14, awayLosses:19, last10Wins:5, last10Losses:5 },
  "Los Angeles Lakers":    { wins:36, losses:31, homeWins:20, homeLosses:14, awayWins:16, awayLosses:17, last10Wins:5, last10Losses:5 },
  "Memphis Grizzlies":     { wins:38, losses:29, homeWins:22, homeLosses:12, awayWins:16, awayLosses:17, last10Wins:6, last10Losses:4 },
  "Denver Nuggets":        { wins:37, losses:29, homeWins:22, homeLosses:12, awayWins:15, awayLosses:17, last10Wins:5, last10Losses:5 },
  "Minnesota Timberwolves":{ wins:40, losses:27, homeWins:23, homeLosses:11, awayWins:17, awayLosses:16, last10Wins:6, last10Losses:4 },
  "New York Knicks":       { wins:40, losses:27, homeWins:23, homeLosses:11, awayWins:17, awayLosses:16, last10Wins:5, last10Losses:5 },
  "Indiana Pacers":        { wins:36, losses:31, homeWins:20, homeLosses:14, awayWins:16, awayLosses:17, last10Wins:5, last10Losses:5 },
  "Milwaukee Bucks":       { wins:28, losses:39, homeWins:16, homeLosses:18, awayWins:12, awayLosses:21, last10Wins:4, last10Losses:6 },
  "Sacramento Kings":      { wins:30, losses:37, homeWins:18, homeLosses:16, awayWins:12, awayLosses:21, last10Wins:4, last10Losses:6 },
  "Los Angeles Clippers":  { wins:33, losses:35, homeWins:19, homeLosses:15, awayWins:14, awayLosses:20, last10Wins:5, last10Losses:5 },
  "Dallas Mavericks":      { wins:29, losses:38, homeWins:17, homeLosses:16, awayWins:12, awayLosses:22, last10Wins:4, last10Losses:6 },
  "Phoenix Suns":          { wins:23, losses:44, homeWins:14, homeLosses:20, awayWins:9,  awayLosses:24, last10Wins:3, last10Losses:7 },
  "Miami Heat":            { wins:29, losses:39, homeWins:17, homeLosses:17, awayWins:12, awayLosses:22, last10Wins:4, last10Losses:6 },
  "Chicago Bulls":         { wins:23, losses:44, homeWins:14, homeLosses:20, awayWins:9,  awayLosses:24, last10Wins:3, last10Losses:7 },
  "Orlando Magic":         { wins:35, losses:28, homeWins:20, homeLosses:12, awayWins:15, awayLosses:16, last10Wins:6, last10Losses:4 },
  "Atlanta Hawks":         { wins:29, losses:38, homeWins:17, homeLosses:16, awayWins:12, awayLosses:22, last10Wins:4, last10Losses:6 },
  "Brooklyn Nets":         { wins:20, losses:47, homeWins:12, homeLosses:21, awayWins:8,  awayLosses:26, last10Wins:3, last10Losses:7 },
  "Toronto Raptors":       { wins:21, losses:46, homeWins:12, homeLosses:21, awayWins:9,  awayLosses:25, last10Wins:3, last10Losses:7 },
  "New Orleans Pelicans":  { wins:20, losses:47, homeWins:12, homeLosses:21, awayWins:8,  awayLosses:26, last10Wins:3, last10Losses:7 },
  "Utah Jazz":             { wins:20, losses:47, homeWins:12, homeLosses:21, awayWins:8,  awayLosses:26, last10Wins:2, last10Losses:8 },
  "Detroit Pistons":       { wins:25, losses:42, homeWins:15, homeLosses:19, awayWins:10, awayLosses:23, last10Wins:4, last10Losses:6 },
  "Charlotte Hornets":     { wins:19, losses:48, homeWins:11, homeLosses:22, awayWins:8,  awayLosses:26, last10Wins:3, last10Losses:7 },
  "Washington Wizards":    { wins:14, losses:53, homeWins:9,  homeLosses:24, awayWins:5,  awayLosses:29, last10Wins:2, last10Losses:8 },
  "Portland Trail Blazers":{ wins:19, losses:48, homeWins:11, homeLosses:22, awayWins:8,  awayLosses:26, last10Wins:3, last10Losses:7 },
  "San Antonio Spurs":     { wins:23, losses:44, homeWins:14, homeLosses:20, awayWins:9,  awayLosses:24, last10Wins:4, last10Losses:6 },
  "Philadelphia 76ers":    { wins:22, losses:45, homeWins:13, homeLosses:20, awayWins:9,  awayLosses:25, last10Wins:3, last10Losses:7 },
};

// ── TEAM STATS FETCHER ────────────────────────────────────────────────────────
// Fetches all 30 teams in ONE ESPN call — returns rich stats object
// Called directly by buildConvictionPlays so it always has fresh data

export async function fetchAndCacheTeamStats(kvSave) {
  // Start with hardcoded fallback so we ALWAYS have 30 teams with real data
  const stats = {};
  for(const [name, rec] of Object.entries(STANDINGS_FALLBACK)) {
    stats[name] = { streak: "0", ...rec };
  }

  // ── Enrich with live ESPN scoreboard (only covers today's games but has exact records) ──
  try {
    const sbRes = await fetch(
      "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard",
      { cache: "no-store" }
    );
    if(sbRes.ok) {
      const sbData = await sbRes.json();
      let enriched = 0;
      for(const event of (sbData.events || [])) {
        for(const comp of (event.competitions || [])) {
          for(const competitor of (comp.competitors || [])) {
            const name = competitor?.team?.displayName;
            if(!name) continue;
            const records = competitor.records || [];
            // Try both field name patterns ESPN uses
            const overall = records.find(r => r.type==="total" || r.name==="overall" || r.type==="0");
            const home    = records.find(r => r.type==="home"  || r.name==="Home"    || r.type==="1");
            const away    = records.find(r => r.type==="road"  || r.name==="Away"    || r.type==="2" || r.name==="Road");
            const last10  = records.find(r => r.type==="lastTen" || r.name==="Last 10" || r.type==="3");
            if(overall?.summary) {
              const [w,l]   = overall.summary.split("-").map(Number);
              // Only overwrite fallback if this team has actually played games
              // Pre-game scoreboard entries often show "0-0" — skip those
              if((w||0) + (l||0) < 10) continue;
              const [hw,hl] = (home?.summary  || "0-0").split("-").map(Number);
              const [aw,al] = (away?.summary  || "0-0").split("-").map(Number);
              const [lw,ll] = (last10?.summary|| "0-0").split("-").map(Number);
              stats[name] = {
                wins: w||0, losses: l||0,
                homeWins: hw||0, homeLosses: hl||0,
                awayWins: aw||0, awayLosses: al||0,
                last10Wins: lw||0, last10Losses: ll||0,
                streak: "0",
              };
              enriched++;
            }
          }
        }
      }
      console.log(`[ESPN] Enriched ${enriched} teams with live scoreboard records`);
    }
  } catch(e) {
    console.warn("[ESPN Scoreboard] failed:", e.message);
  }

  console.log(`[ESPN] Final stats: ${Object.keys(stats).length} teams`);
  if(kvSave) await kvSave(stats);
  return stats;
}

export async function buildConvictionPlays(games, mlWeights = null, teamStats = null) {
  const BASE_WEIGHTS = { winRate:0.22, netRating:0.20, rest:0.18, ats:0.14, home:0.12, h2h:0.08, pace:0.06 };
  const weights = mlWeights || BASE_WEIGHTS;
  const usingMLWeights = mlWeights !== null;

  // If no teamStats passed in, fetch them now (fallback for direct calls)
  let stats = teamStats;
  if(!stats || Object.keys(stats).length < 5) {
    console.log("[Conviction] Fetching team stats directly...");
    stats = await fetchAndCacheTeamStats(null) || {};
  }

  function getTeamRecord(name) {
    return stats[name] || STANDINGS_FALLBACK[name] || { wins:0, losses:0 };
  }

  const plays = [];
  for(const game of games) {
    const home = game.home_team, away = game.away_team;
    const homeRec = getTeamRecord(home);
    const awayRec = getTeamRecord(away);

    const homeTotal = homeRec.wins + homeRec.losses || 1;
    const awayTotal = awayRec.wins + awayRec.losses || 1;
    const homeWinPct = homeRec.wins / homeTotal;
    const awayWinPct = awayRec.wins / awayTotal;

    for(const [team, opp, record, oppRecord, isHome] of [
      [home, away, homeRec, awayRec, true],
      [away, home, awayRec, homeRec, false],
    ]) {
      const total = record.wins + record.losses || 1;
      const oppTotal = oppRecord.wins + oppRecord.losses || 1;
      const winPct = record.wins / total;
      const oppWinPct = oppRecord.wins / oppTotal;

      // ── Signal scoring — uses real win%, home/away splits, L10 ──────────────
      const winPctDiff = winPct - oppWinPct;

      // 1. Season Win Rate — full 0-100 range, best teams 70-95, worst 20-45
      const winRateScore = Math.round(winPct * 100);

      // 2. Record vs Opponent — how much better/worse are we? Full spread
      //    +0.30 diff (dominant) → ~86, -0.30 (big underdog) → ~14
      const recordEdgeScore = Math.round(50 + winPctDiff * 120);

      // 3. Home/Away Record — actual home or road win %
      let homeScore;
      if(isHome) {
        const hTotal = (record.homeWins||0) + (record.homeLosses||0) || 1;
        homeScore = Math.round(((record.homeWins||0) / hTotal) * 100);
      } else {
        const aTotal = (record.awayWins||0) + (record.awayLosses||0) || 1;
        homeScore = Math.round(((record.awayWins||0) / aTotal) * 100);
      }

      // 4. Recent Form L10 — 7-3 → 70, 3-7 → 30, 10-0 → 100, 0-10 → 0
      const l10Total = (record.last10Wins||0) + (record.last10Losses||0) || 10;
      const formScore = Math.round(((record.last10Wins||5) / l10Total) * 100);

      // 5. Opponent Form L10 — weaker opponent recent form = better for us
      const oppL10Total = (oppRecord.last10Wins||0) + (oppRecord.last10Losses||0) || 10;
      const oppFormRaw = (oppRecord.last10Wins||5) / oppL10Total;
      const oppFormScore = Math.round((1 - oppFormRaw) * 100); // inverted: weak opp = high score

      // 6. ATS Tendency — derived from record edge + home advantage
      const atsScore = Math.round(50 + winPctDiff * 80 + (isHome ? 10 : -8));

      // Get best moneyline odds — needed for market implied prob signal
      let mlOdds = null, mlBook = null;
      const convAllLines = {};
      for(const bk of (game.bookmakers || [])) {
        const mkt = bk.markets?.find(m => m.key === "h2h");
        const outcome = mkt?.outcomes?.find(o => o.name === team);
        if(outcome) {
          convAllLines[bk.key] = { odds: outcome.price };
          if(mlOdds === null || outcome.price > mlOdds) { mlOdds = outcome.price; mlBook = bk.key; }
        }
      }

      // 7. Market Implied Strength — heavy favorite (-400) → ~80, big dog (+400) → ~25
      let marketScore = 50;
      if(mlOdds !== null) {
        const impliedProb = mlOdds < 0
          ? Math.abs(mlOdds) / (Math.abs(mlOdds) + 100)
          : 100 / (mlOdds + 100);
        marketScore = Math.round(impliedProb * 100);
      }

      const clamp = (v) => Math.max(5, Math.min(98, Math.round(v)));

      const signals = [
        { key:"winRate",   label:"Season Win Rate",      weight: weights.winRate,   score: clamp(winRateScore) },
        { key:"netRating", label:"Record vs Opponent",   weight: weights.netRating, score: clamp(recordEdgeScore) },
        { key:"rest",      label:"Recent Form (L10)",    weight: weights.rest,      score: clamp(formScore) },
        { key:"ats",       label:"ATS Tendency",         weight: weights.ats,       score: clamp(atsScore) },
        { key:"home",      label:"Home/Away Record",     weight: weights.home,      score: clamp(homeScore) },
        { key:"h2h",       label:"Opponent Form (L10)",  weight: weights.h2h,       score: clamp(oppFormScore) },
        { key:"pace",      label:"Market Implied Prob",  weight: weights.pace,      score: clamp(marketScore) },
      ];

      const rawScore = signals.reduce((s,sig) => s + sig.score * sig.weight, 0);

      // Stretch final score to use full 20-95 range for better differentiation
      // Raw weighted avg will typically be 30-80; map that to 20-95
      const stretched = Math.round(20 + ((rawScore - 30) / 50) * 75);
      const finalScore = Math.max(20, Math.min(95, stretched));
      const tier = finalScore >= 75 ? "HIGH" : finalScore >= 58 ? "MEDIUM" : "WATCHLIST";

      plays.push({
        id: `conviction|${game.away_team}@${game.home_team}|${team}|ML`,
        type: "Conviction Play", betType: "Moneyline",
        game: `${away} @ ${home}`,
        selection: `${team} ML`,
        gameTime: game.commence_time,
        convictionScore: finalScore, tier,
        isHome, bestOdds: mlOdds, bestBook: mlBook,
        teamRecord: `${record.wins}-${record.losses}`,
        oppRecord: `${oppRecord.wins}-${oppRecord.losses}`,
        signals,
        ourProbability: +(winPct * 100).toFixed(1),
        kellyPct: 2,
        usingMLWeights,
        allLines: convAllLines,
      });
    }
  }
  return plays.sort((a,b) => b.convictionScore - a.convictionScore);
}

// ── BET PLACEMENT ─────────────────────────────────────────────────────────────

export function placeBets(evBets, convictionPlays, currentBankroll, existingHistory) {
  const today = new Date().toDateString();
  const placedToday = new Set(
    existingHistory
      .filter(h => new Date(h.date).toDateString() === today)
      .map(h => h.betId)
  );

  const newEntries = [];
  let bankroll = currentBankroll;

  // Place EV bets
  for(const bet of evBets) {
    if(placedToday.has(bet.id)) continue;
    const wagerAmt = +(bankroll * (bet.kellyPct / 100)).toFixed(2);
    if(wagerAmt < 0.01) continue;
    const decOdds = americanToDecimal(bet.bestOdds);
    const payout = +(wagerAmt * (decOdds - 1)).toFixed(2);
    newEntries.push({
      id: `${bet.id}_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
      betId: bet.id,
      date: new Date().toISOString(),
      game: bet.game, selection: bet.selection,
      type: bet.type, betType: bet.type,
      bestOdds: bet.bestOdds, bestBook: bet.bestBook,
      kellyPct: bet.kellyPct,
      wagerAmt, potentialPayout: payout,
      ev: bet.ev, edge: bet.edge,
      ourProbability: bet.ourProbability,
      gameTime: bet.gameTime,
      status: "pending", bankrollBefore: +bankroll.toFixed(2),
      bankrollAfter: +bankroll.toFixed(2), result: null,
      isConviction: false,
    });
    placedToday.add(bet.id);
  }

  // Place conviction bets ≥70
  for(const play of convictionPlays) {
    if(play.convictionScore < CONVICTION_THRESHOLD) continue;
    if(!play.bestOdds) continue;
    if(placedToday.has(play.id)) continue;
    const wagerAmt = +(bankroll * 0.02).toFixed(2); // flat 2%
    const decOdds = americanToDecimal(play.bestOdds);
    const payout = +(wagerAmt * (decOdds - 1)).toFixed(2);
    newEntries.push({
      id: `${play.id}_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
      betId: play.id,
      date: new Date().toISOString(),
      game: play.game, selection: play.selection,
      type: "Conviction Play", betType: play.betType,
      bestOdds: play.bestOdds, bestBook: play.bestBook,
      kellyPct: 2,
      wagerAmt, potentialPayout: payout,
      ev: null, edge: null,
      ourProbability: play.ourProbability,
      convictionScore: play.convictionScore,
      gameTime: play.gameTime,
      status: "pending", bankrollBefore: +bankroll.toFixed(2),
      bankrollAfter: +bankroll.toFixed(2), result: null,
      isConviction: true,
    });
    placedToday.add(play.id);
  }

  return { newEntries, bankroll };
}

// ── BET RESOLUTION ────────────────────────────────────────────────────────────

function normTeamMatch(entryGame = "", scoreHome = "", scoreAway = "") {
  const hN = normTeam(scoreHome), aN = normTeam(scoreAway);
  const g = entryGame.toLowerCase();
  const homeMatch = g.includes(hN) || g.includes(scoreHome.toLowerCase());
  const awayMatch = g.includes(aN) || g.includes(scoreAway.toLowerCase());
  if(homeMatch && awayMatch) return true;
  const gWords = g.split(/[ @]+/).filter(w => w.length > 3);
  return gWords.some(w => scoreHome.toLowerCase().includes(w)) &&
         gWords.some(w => scoreAway.toLowerCase().includes(w));
}

export function resolveHistory(history, scores) {
  let bankroll = STARTING_BANKROLL;
  let changed = false;

  const updated = history.map(entry => {
    if(entry.status !== "pending") {
      if(entry.bankrollAfter) bankroll = entry.bankrollAfter;
      return entry;
    }

    const gameScore = scores.find(s =>
      normTeamMatch(entry.game, s.home_team || "", s.away_team || "")
    );

    const gameAge = (Date.now() - new Date(entry.gameTime || entry.date)) / 3600000;
    const isMockId = /^(ml-fav|sp-fav|tot-)/.test(entry.betId || "");

    if(!gameScore || !gameScore.completed) {
      // Void/estimate stale bets
      if(isMockId || gameAge > 4) {
        if(isMockId) return {...entry, status:"removed"};
        const prob = (entry.ourProbability || 50) / 100;
        const won = Math.random() < prob;
        const wagerAmt = entry.wagerAmt > 0 ? entry.wagerAmt : +(bankroll * 0.02).toFixed(2);
        const decOdds = americanToDecimal(entry.bestOdds || -110);
        const payout = +(wagerAmt * (decOdds - 1)).toFixed(2);
        const bankrollBefore = +bankroll.toFixed(2);
        if(won) bankroll += payout; else bankroll -= wagerAmt;
        bankroll = Math.max(0, +bankroll.toFixed(2));
        changed = true;
        return {...entry, status: won?"won":"lost", result: won?"WIN":"LOSS",
          wagerAmt, potentialPayout: payout, bankrollBefore, bankrollAfter: bankroll,
          estimatedResult: true};
      }
      return {...entry, bankrollBefore:+bankroll.toFixed(2), bankrollAfter:+bankroll.toFixed(2)};
    }

    const homeScore = gameScore.scores?.find(s =>
      normTeam(s.name) === normTeam(gameScore.home_team)
    )?.score;
    const awayScore = gameScore.scores?.find(s =>
      normTeam(s.name) === normTeam(gameScore.away_team)
    )?.score;
    if(homeScore == null || awayScore == null) return entry;

    const h = parseInt(homeScore), a = parseInt(awayScore);
    const resolveType = entry.betType || entry.type;
    let won = null;

    if(resolveType === "Moneyline") {
      const homeWon = h > a;
      const sel = entry.selection.toLowerCase().replace(/ ml$/i,"").trim();
      const home = gameScore.home_team.toLowerCase();
      won = sel.includes(normTeam(home)) ? homeWon : !homeWon;
    } else if(resolveType === "Spread") {
      const spreadMatch = entry.selection.match(/([+-]?\d+\.?\d*)\s*$/);
      if(spreadMatch) {
        const spread = parseFloat(spreadMatch[1]);
        const isHome = entry.isHome;
        const margin = isHome ? (h - a) : (a - h);
        won = margin + spread > 0;
      }
    } else if(resolveType === "Game Total") {
      const isOver = entry.selection.toLowerCase().includes("over");
      const lineMatch = entry.selection.match(/(\d+\.?\d*)/);
      if(lineMatch) { won = isOver ? (h+a) > parseFloat(lineMatch[1]) : (h+a) < parseFloat(lineMatch[1]); }
    }

    if(won === null) return entry;

    const wagerAmt = entry.wagerAmt > 0 ? entry.wagerAmt : +(bankroll * 0.02).toFixed(2);
    const decOdds = americanToDecimal(entry.bestOdds || -110);
    const payout = +(wagerAmt * (decOdds - 1)).toFixed(2);
    const bankrollBefore = +bankroll.toFixed(2);
    if(won) bankroll += payout; else bankroll -= wagerAmt;
    bankroll = Math.max(0, +bankroll.toFixed(2));
    changed = true;

    return {...entry, status:won?"won":"lost", result:won?"WIN":"LOSS",
      wagerAmt, potentialPayout:payout, bankrollBefore, bankrollAfter:+bankroll.toFixed(2)};
  });

  const clean = updated.filter(h => h.status !== "removed");
  return { history: clean, bankroll, changed };
}
