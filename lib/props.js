// lib/props.js — Player Props EV Scanner + Auto-Bet
// Fetches player prop markets from The Odds API, devigs using market consensus
// (Pinnacle rarely has props), finds EV edges, scores conviction, places bets.

const PROP_MARKETS = [
  "player_points",
  "player_rebounds",
  "player_assists",
  "player_threes",
  "player_points_rebounds_assists",
  "player_points_rebounds",
  "player_points_assists",
];

const PROP_BOOKS = "draftkings,fanduel,betmgm,betrivers,pinnacle";
const MIN_PROP_EDGE = 0.03;       // 3% minimum edge for props
const MIN_BOOKS_FOR_EDGE = 3;     // need at least 3 books pricing a prop to trust it
const PROP_KELLY_FRACTION = 0.25; // quarter Kelly — props are higher variance
const PROP_KELLY_CAP = 2.0;       // max 2% of bankroll per prop bet
const PROP_CONVICTION_THRESHOLD = 65;

function americanToDecimal(odds) {
  return odds < 0 ? (100 / (-odds) + 1) : (odds / 100 + 1);
}
function americanToImplied(odds) {
  return odds < 0 ? (-odds) / (-odds + 100) : 100 / (odds + 100);
}
function kellyPct(edge, decOdds) {
  if (edge <= 0 || decOdds <= 1) return 0;
  const full = (edge * decOdds) / (decOdds - 1);
  return Math.min(full * PROP_KELLY_FRACTION * 100, PROP_KELLY_CAP);
}

// ── FETCH ─────────────────────────────────────────────────────────────────────

export async function fetchPlayerProps(apiKey, games) {
  if (!apiKey || !games?.length) return [];

  const now = new Date();
  // Only fetch props for games not yet started (pregame only)
  const upcoming = games.filter(g => g.commence_time && new Date(g.commence_time) > now);
  if (!upcoming.length) return [];

  const allPropGames = [];
  const marketsParam = PROP_MARKETS.join(",");

  for (const game of upcoming) {
    if (!game.id) continue;
    try {
      const url = `https://api.the-odds-api.com/v4/sports/basketball_nba/events/${game.id}/odds?apiKey=${apiKey}&regions=us,us2&markets=${marketsParam}&bookmakers=${PROP_BOOKS}&oddsFormat=american`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        console.warn(`[Props] HTTP ${res.status} for game ${game.id}`);
        continue;
      }
      const data = await res.json();
      if (data.message) { console.warn(`[Props] API error: ${data.message}`); continue; }
      allPropGames.push({ ...data, home_team: game.home_team, away_team: game.away_team });
      console.log(`[Props] Fetched ${game.away_team} @ ${game.home_team} — quota left: ${res.headers.get("x-requests-remaining")}`);
    } catch (e) {
      console.warn(`[Props] Fetch failed for ${game.id}: ${e.message}`);
    }
  }

  return allPropGames;
}

// ── EV EXTRACTION ─────────────────────────────────────────────────────────────

export function extractPropEV(propGames) {
  const bets = [];

  for (const game of propGames) {
    const gameLabel = `${game.away_team} @ ${game.home_team}`;
    const bookmakers = game.bookmakers || [];
    if (!bookmakers.length) continue;

    // Index all prop markets: { marketKey: { playerName: { "Over"/"Under": { bookKey: price } } } }
    const propIndex = {};

    for (const bk of bookmakers) {
      for (const mkt of (bk.markets || [])) {
        if (!propIndex[mkt.key]) propIndex[mkt.key] = {};
        for (const outcome of (mkt.outcomes || [])) {
          const player = outcome.description || outcome.name;
          const side = outcome.name; // "Over" or "Under"
          if (!player || !side) continue;
          if (!propIndex[mkt.key][player]) propIndex[mkt.key][player] = {};
          if (!propIndex[mkt.key][player][side]) propIndex[mkt.key][player][side] = {};
          propIndex[mkt.key][player][side][bk.key] = { price: outcome.price, point: outcome.point };
        }
      }
    }

    // For each market → player → side, find EV
    for (const [marketKey, players] of Object.entries(propIndex)) {
      const marketLabel = formatMarketLabel(marketKey);

      for (const [player, sides] of Object.entries(players)) {
        for (const side of ["Over", "Under"]) {
          const sideData = sides[side];
          const oppData = sides[side === "Over" ? "Under" : "Over"];
          if (!sideData || !oppData) continue;

          const books = Object.keys(sideData);
          if (books.length < MIN_BOOKS_FOR_EDGE) continue;

          // Get consensus line (median point value)
          const points = Object.values(sideData).map(v => v.point).filter(Boolean);
          const line = points.length ? points.sort((a,b) => a-b)[Math.floor(points.length/2)] : null;
          if (line === null) continue;

          // Devig: use Pinnacle if available, else consensus
          let trueProb = null;
          const pinnOver = sideData["pinnacle"]?.price;
          const pinnUnder = oppData["pinnacle"]?.price;

          if (pinnOver && pinnUnder) {
            const iO = americanToImplied(pinnOver);
            const iU = americanToImplied(pinnUnder);
            trueProb = iO / (iO + iU);
            if (side === "Under") trueProb = 1 - trueProb;
          } else {
            // Consensus devig across all books
            const impliedArr = Object.values(sideData).map(v => americanToImplied(v.price));
            const oppArr = Object.values(oppData).map(v => americanToImplied(v.price));
            if (!impliedArr.length || !oppArr.length) continue;
            const avgThis = impliedArr.reduce((s,v) => s+v, 0) / impliedArr.length;
            const avgOpp  = oppArr.reduce((s,v) => s+v, 0) / oppArr.length;
            trueProb = avgThis / (avgThis + avgOpp);
          }

          if (!trueProb || trueProb <= 0 || trueProb >= 1) continue;

          // Find best odds (excluding Pinnacle — they're the reference)
          let bestOdds = null, bestBook = null;
          const allLines = {};
          for (const [bk, val] of Object.entries(sideData)) {
            if (bk === "pinnacle") continue;
            allLines[bk] = { odds: val.price, point: val.point };
            if (bestOdds === null || val.price > bestOdds) {
              bestOdds = val.price;
              bestBook = bk;
            }
          }

          if (bestOdds === null) continue;

          const decOdds = americanToDecimal(bestOdds);
          const ev = trueProb * decOdds - 1;
          const edge = ev;

          if (edge < MIN_PROP_EDGE) continue;

          // Sanity: reject if bestOdds is huge outlier vs consensus
          const allOddsArr = Object.values(allLines).map(v => v.odds);
          if (allOddsArr.length >= 3) {
            const avg = allOddsArr.reduce((s,v) => s+v, 0) / allOddsArr.length;
            if (bestOdds - avg > 150) continue; // stale outlier
          }

          const kPct = kellyPct(edge, decOdds);
          if (kPct <= 0) continue;

          const id = `prop_${marketKey}_${player.replace(/\s+/g,"_")}_${side}_${line}`.toLowerCase();

          bets.push({
            id,
            game: gameLabel,
            gameTime: game.commence_time,
            player,
            market: marketKey,
            marketLabel,
            selection: `${player} ${side} ${line} ${marketLabel}`,
            side,
            line,
            bestOdds,
            bestBook,
            allLines,
            edge,
            ev: ev * 100,
            trueProb: trueProb * 100,
            kellyPct: kPct,
            type: "Player Prop",
            betType: "Player Prop",
            isProp: true,
            convictionScore: scorePropConviction({ player, side, line, marketKey, edge, trueProb, allLines }),
          });
        }
      }
    }
  }

  // Sort by edge descending
  return bets.sort((a, b) => b.edge - a.edge);
}

// ── CONVICTION SCORING ────────────────────────────────────────────────────────
// Stub scoring now — signals will be enriched with player stats in v2.
// Current signals: edge strength, line consensus, book count, odds format

function scorePropConviction({ edge, trueProb, allLines, side, line }) {
  let score = 0;

  // Signal 1: Edge strength (0–30 pts)
  const edgePct = edge * 100;
  score += Math.min(edgePct * 4, 30);

  // Signal 2: Book consensus — how many books have this line (0–20 pts)
  const bookCount = Object.keys(allLines).length;
  score += Math.min(bookCount * 5, 20);

  // Signal 3: True probability not too extreme (0–20 pts)
  // Props near 50/50 are more reliable than extreme favorites
  const probDist = Math.abs(trueProb - 0.5);
  score += Math.max(0, 20 - probDist * 40);

  // Signal 4: Positive odds (underdog) = more value (0–15 pts)
  // Slight bonus for plus-money props
  score += side && trueProb < 0.5 ? 10 : 0;

  // Signal 5: Round number line (0–15 pts)
  // Lines like 24.5, 8.5 are more common and more reliable than 27.5
  const roundness = line % 5 === 0.5 ? 15 : line % 2.5 === 0 ? 10 : 5;
  score += roundness;

  return Math.min(Math.round(score), 100);
}

function formatMarketLabel(key) {
  const labels = {
    player_points: "Points",
    player_rebounds: "Rebounds",
    player_assists: "Assists",
    player_threes: "3-Pointers",
    player_points_rebounds_assists: "PRA",
    player_points_rebounds: "Pts+Reb",
    player_points_assists: "Pts+Ast",
  };
  return labels[key] || key;
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

  // Only auto-bet props with conviction ≥ threshold AND positive EV
  const autoBetProps = evProps.filter(p =>
    p.convictionScore >= PROP_CONVICTION_THRESHOLD && p.edge >= MIN_PROP_EDGE
  );

  for (const prop of autoBetProps) {
    if (placedToday.has(prop.id)) continue;

    const wagerAmt = +(currentBankroll * (prop.kellyPct / 100)).toFixed(2);
    if (wagerAmt < 0.01) continue;

    const decOdds = americanToDecimal(prop.bestOdds);
    const payout = +(wagerAmt * (decOdds - 1)).toFixed(2);

    newEntries.push({
      id: `${prop.id}_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
      betId: prop.id,
      date: new Date().toISOString(),
      game: prop.game,
      selection: prop.selection,
      player: prop.player,
      market: prop.market,
      marketLabel: prop.marketLabel,
      line: prop.line,
      side: prop.side,
      type: "Player Prop",
      betType: "Player Prop",
      bestOdds: prop.bestOdds,
      bestBook: prop.bestBook,
      allLines: prop.allLines,
      kellyPct: prop.kellyPct,
      wagerAmt,
      potentialPayout: payout,
      ev: prop.ev,
      edge: prop.edge,
      trueProb: prop.trueProb,
      convictionScore: prop.convictionScore,
      gameTime: prop.gameTime,
      status: "pending",
      bankrollBefore: +currentBankroll.toFixed(2),
      bankrollAfter: +currentBankroll.toFixed(2),
      result: null,
      isProp: true,
      isConviction: false,
    });

    placedToday.add(prop.id);
  }

  return { newEntries };
}

// ── RESOLUTION ────────────────────────────────────────────────────────────────
// Prop resolution requires player box score data — ESPN API
// Fetches final stats and resolves over/under

export async function resolveProps(history) {
  const pendingProps = history.filter(h => h.isProp && h.status === "pending");
  if (!pendingProps.length) return { history, changed: false };

  // Fetch yesterday + today box scores from ESPN
  const boxScores = await fetchESPNBoxScores();
  if (!boxScores.length) return { history, changed: false };

  let changed = false;
  const updated = history.map(entry => {
    if (!entry.isProp || entry.status !== "pending") return entry;

    const gameAge = (Date.now() - new Date(entry.gameTime || entry.date)) / 3600000;
    if (gameAge < 3) return entry; // game probably not over yet

    // Find player stats in box scores
    const playerStats = findPlayerStats(boxScores, entry.player, entry.game);
    if (!playerStats) return entry;

    const actual = getStatValue(playerStats, entry.market);
    if (actual === null) return entry;

    const won = entry.side === "Over" ? actual > entry.line : actual < entry.line;
    // Push is possible if exact — treat as void (return stake)
    const isPush = actual === entry.line;

    const wagerAmt = entry.wagerAmt || 0;
    const decOdds = americanToDecimal(entry.bestOdds || -110);
    const payout = +(wagerAmt * (decOdds - 1)).toFixed(2);

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
  const dates = [0, 1].map(d => {
    const dt = new Date(Date.now() - d * 86400000);
    return dt.toISOString().slice(0, 10).replace(/-/g, "");
  });

  for (const date of dates) {
    try {
      const res = await fetch(
        `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${date}`,
        { cache: "no-store" }
      );
      if (!res.ok) continue;
      const data = await res.json();

      for (const event of (data.events || [])) {
        const comp = event.competitions?.[0];
        if (!comp?.status?.type?.completed) continue;

        const home = comp.competitors?.find(c => c.homeAway === "home");
        const away = comp.competitors?.find(c => c.homeAway === "away");
        if (!home || !away) continue;

        // Fetch box score for this event
        try {
          const bsRes = await fetch(
            `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${event.id}`,
            { cache: "no-store" }
          );
          if (!bsRes.ok) continue;
          const bsData = await bsRes.json();

          const players = [];
          for (const team of (bsData.boxscore?.players || [])) {
            for (const statsGroup of (team.statistics || [])) {
              for (const athlete of (statsGroup.athletes || [])) {
                const stats = {};
                statsGroup.names?.forEach((name, i) => {
                  stats[name] = parseFloat(athlete.stats?.[i]) || 0;
                });
                players.push({
                  name: athlete.athlete?.displayName || "",
                  teamName: team.team?.displayName || "",
                  stats,
                });
              }
            }
          }

          results.push({
            home: home.team.displayName,
            away: away.team.displayName,
            players,
          });
        } catch (e) { /* skip failed box score */ }
      }
    } catch (e) { /* skip failed date */ }
  }

  return results;
}

function findPlayerStats(boxScores, playerName, gameLabel) {
  const normName = playerName.toLowerCase().trim();
  for (const game of boxScores) {
    const gameStr = `${game.away} @ ${game.home}`.toLowerCase();
    const gameLabelNorm = gameLabel.toLowerCase();
    // Check if this box score is for the right game
    const homeWord = game.home.toLowerCase().split(" ").pop();
    const awayWord = game.away.toLowerCase().split(" ").pop();
    if (!gameLabelNorm.includes(homeWord) && !gameLabelNorm.includes(awayWord)) continue;

    const player = game.players.find(p => {
      const pn = p.name.toLowerCase();
      return pn === normName || pn.includes(normName.split(" ").pop()) ||
             normName.includes(pn.split(" ").pop());
    });
    if (player) return player.stats;
  }
  return null;
}

function getStatValue(stats, market) {
  // ESPN stat keys vary — map our market keys to ESPN column names
  const statMap = {
    player_points: ["PTS", "points"],
    player_rebounds: ["REB", "rebounds", "TREB"],
    player_assists: ["AST", "assists"],
    player_threes: ["3PM", "threePointFieldGoalsMade", "3FGM"],
    player_points_rebounds_assists: null, // computed
    player_points_rebounds: null,
    player_points_assists: null,
  };

  if (market === "player_points_rebounds_assists") {
    const pts = findStat(stats, ["PTS"]) || 0;
    const reb = findStat(stats, ["REB", "TREB"]) || 0;
    const ast = findStat(stats, ["AST"]) || 0;
    return pts + reb + ast > 0 ? pts + reb + ast : null;
  }
  if (market === "player_points_rebounds") {
    const pts = findStat(stats, ["PTS"]) || 0;
    const reb = findStat(stats, ["REB", "TREB"]) || 0;
    return pts + reb > 0 ? pts + reb : null;
  }
  if (market === "player_points_assists") {
    const pts = findStat(stats, ["PTS"]) || 0;
    const ast = findStat(stats, ["AST"]) || 0;
    return pts + ast > 0 ? pts + ast : null;
  }

  const keys = statMap[market];
  if (!keys) return null;
  return findStat(stats, keys);
}

function findStat(stats, keys) {
  for (const k of keys) {
    if (stats[k] !== undefined) return stats[k];
    // Case-insensitive fallback
    const match = Object.entries(stats).find(([key]) => key.toLowerCase() === k.toLowerCase());
    if (match) return match[1];
  }
  return null;
}
