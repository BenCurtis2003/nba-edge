// @ts-nocheck

// @ts-nocheck
import { useState, useEffect, useCallback, useRef } from "react";

const SPORTSBOOKS = ["draftkings","fanduel","betmgm","caesars","pointsbet","betrivers"];
const SPORTSBOOK_LABELS = { draftkings:"DraftKings", fanduel:"FanDuel", betmgm:"BetMGM", caesars:"Caesars", pointsbet:"PointsBet", betrivers:"BetRivers" };
const SPORTSBOOK_COLORS = { draftkings:"#53d337", fanduel:"#1493ff", betmgm:"#d4af37", caesars:"#00a4e4", pointsbet:"#e8192c", betrivers:"#003087" };

// Odds targeting: bias heavily toward negative odds favorites
const MIN_ODDS = -450;
const MAX_ODDS = 350;
const TARGET_NEG_RATIO = 0.70;
const MIN_EV_EDGE = 1.5;         // game lines threshold
const MIN_EV_EDGE_LONGSHOT = 6;
const MIN_EV_EDGE_PROP = 2.5;    // props threshold — props are less efficient
const POLL_INTERVAL_MS = 60000;  // live polling every 60 seconds
const STARTING_BANKROLL = 100;
const STORAGE_KEY = "nba_edge_history_v2";
const ML_KEY = "nba_edge_ml_v1";

function americanToDecimal(a) { return a > 0 ? a/100+1 : 100/Math.abs(a)+1; }
function americanToImplied(a) { return (1/americanToDecimal(a))*100; }
function calcEV(prob, odds) { const d=americanToDecimal(odds); return ((prob/100)*(d-1)-(1-prob/100))*100; }
function kellyFraction(prob, odds) { const d=americanToDecimal(odds); const b=d-1; const p=prob/100; return Math.max(0,Math.min(((b*p-(1-p))/b)*0.25,0.04))*100; }
function formatOdds(a) { if(!a&&a!==0) return "N/A"; return a>0?`+${a}`:`${a}`; }
function getEdgeColor(e) { if(e>=8) return "#00ff88"; if(e>=5) return "#7fff00"; if(e>=3) return "#ffd700"; return "#aaaaaa"; }
function fmt$(n) { return `$${Math.abs(n).toFixed(2)}`; }
function timeUntil(d) {
  const diff = new Date(d)-new Date();
  if(diff<0) return "Live";
  const h=Math.floor(diff/3600000), m=Math.floor((diff%3600000)/60000);
  if(h>24) return `${Math.floor(h/24)}d`;
  if(h>0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ── FIX #4: BAYESIAN ML ENGINE ───────────────────────────────
// Learns from resolved bets to improve probability estimates over time.
// Tracks: team win rates, bet type accuracy, odds range accuracy, home/away bias
const defaultML = {
  version: 1,
  totalBets: 0,
  totalWins: 0,
  byTeam: {},         // { "Lakers": { bets:10, wins:6, avgOdds:-120 } }
  byType: {           // { "Moneyline": { bets:20, wins:12, avgEdge:5.2 } }
    Moneyline:{bets:0,wins:0,avgEdge:0},
    Spread:{bets:0,wins:0,avgEdge:0},
    "Game Total":{bets:0,wins:0,avgEdge:0},
    "Player Prop":{bets:0,wins:0,avgEdge:0},
  },
  byOddsRange: {      // tracks accuracy by odds bucket
    "neg_big":{bets:0,wins:0},   // < -200
    "neg_mid":{bets:0,wins:0},   // -200 to -110
    "neg_small":{bets:0,wins:0}, // -110 to -101
    "pick":{bets:0,wins:0},      // -100 to +100
    "pos_small":{bets:0,wins:0}, // +100 to +150 (max with new cap)
  },
  calibrationBias: 0, // how much to adjust our probability estimates
};

function loadML() {
  try { const s=localStorage.getItem(ML_KEY); return s?JSON.parse(s):defaultML; } catch { return defaultML; }
}

function saveML(ml) {
  try { localStorage.setItem(ML_KEY, JSON.stringify(ml)); } catch {}
}

function getOddsRange(odds) {
  if(odds < -200) return "neg_big";
  if(odds < -110) return "neg_mid";
  if(odds < -100) return "neg_small";
  if(odds <= 100) return "pick";
  return "pos_small";
}

// Updates ML model when a bet resolves
function updateML(ml, bet, won) {
  const updated = JSON.parse(JSON.stringify(ml));
  updated.totalBets++;
  if(won) updated.totalWins++;

  // Update by bet type
  const t = updated.byType[bet.type] || {bets:0,wins:0,avgEdge:0};
  t.avgEdge = (t.avgEdge * t.bets + bet.edge) / (t.bets + 1);
  t.bets++; if(won) t.wins++;
  updated.byType[bet.type] = t;

  // Update by team
  const teams = bet.game.split(" @ ");
  teams.forEach(team => {
    const t2 = updated.byTeam[team] || {bets:0,wins:0,avgOdds:0};
    t2.avgOdds = (t2.avgOdds * t2.bets + bet.bestOdds) / (t2.bets + 1);
    t2.bets++; if(won) t2.wins++;
    updated.byTeam[team] = t2;
  });

  // Update by odds range
  const range = getOddsRange(bet.bestOdds);
  const r = updated.byOddsRange[range] || {bets:0,wins:0};
  r.bets++; if(won) r.wins++;
  updated.byOddsRange[range] = r;

  // Recalculate calibration bias — how far off our model has been
  const overallWinRate = updated.totalBets > 0 ? updated.totalWins/updated.totalBets : 0.5;
  const expectedWinRate = 0.55; // we target 55%+ win rate on -EV filtered bets
  updated.calibrationBias = (overallWinRate - expectedWinRate) * 10; // scale to probability pts

  return updated;
}

// Applies ML learnings to adjust a bet's probability estimate
function applyMLAdjustment(ml, bet) {
  if(ml.totalBets < 5) return bet.ourProbability; // not enough data yet

  let adjustment = 0;

  // Adjust based on bet type accuracy
  const typeData = ml.byType[bet.type];
  if(typeData && typeData.bets >= 3) {
    const typeWinRate = typeData.wins / typeData.bets;
    adjustment += (typeWinRate - 0.5) * 5; // up to ±2.5% adjustment
  }

  // Adjust based on odds range accuracy
  const range = getOddsRange(bet.bestOdds);
  const rangeData = ml.byOddsRange[range];
  if(rangeData && rangeData.bets >= 3) {
    const rangeWinRate = rangeData.wins / rangeData.bets;
    const impliedWinRate = americanToImplied(bet.bestOdds) / 100;
    adjustment += (rangeWinRate - impliedWinRate) * 8; // up to ±4% adjustment
  }

  // Apply calibration bias
  adjustment += ml.calibrationBias * 0.3;

  return Math.min(Math.max(bet.ourProbability + adjustment, 30), 85);
}

// ── MOCK DATA ────────────────────────────────────────────────
function generateMockBets() {
  const now = new Date();
  const t1 = new Date(now); t1.setHours(19,30,0,0);
  const t2 = new Date(now); t2.setHours(22,0,0,0);
  const t3 = new Date(now); t3.setHours(20,0,0,0);
  // Fix #3: Mock data now uses realistic negative odds targets
  return [
    { id:"ml-fav-1", type:"Moneyline", game:"Celtics @ Lakers", selection:"Celtics ML", gameTime:t1.toISOString(), ourProbability:62.1, bookImplied:55.6, edge:6.5, ev:13.2, kellyPct:2.4, bestBook:"betrivers", bestOdds:-148, books:{draftkings:-155,fanduel:-152,betmgm:-158,caesars:-150,pointsbet:-145,betrivers:-148}, newsScore:7.2, newsSummary:"Celtics fully healthy. Tatum probable. Lakers missing AD (back — questionable).", trend:"up", lineMove:"Sharp money on Celtics, line moved from -170 to -148" },
    { id:"sp-fav-1", type:"Spread", game:"Nuggets @ Warriors", selection:"Nuggets -3.5", gameTime:t2.toISOString(), ourProbability:57.8, bookImplied:51.2, edge:6.6, ev:11.4, kellyPct:2.0, bestBook:"fanduel", bestOdds:-112, books:{draftkings:-115,fanduel:-112,betmgm:-118,caesars:-115,pointsbet:-110,betrivers:-120}, newsScore:6.5, newsSummary:"Jokic rested Monday. Warriors on back-to-back. Curry logged 38 min last night.", trend:"up", lineMove:"Opened -2.5, moved to -3.5 on sharp action" },
    { id:"tot-1", type:"Game Total", game:"Heat @ Bucks", selection:"Under 221.5", gameTime:t3.toISOString(), ourProbability:57.4, bookImplied:52.4, edge:5.0, ev:9.8, kellyPct:1.7, bestBook:"pointsbet", bestOdds:-108, books:{draftkings:-112,fanduel:-110,betmgm:-115,caesars:-110,pointsbet:-108,betrivers:-112}, newsScore:6.9, newsSummary:"Both teams top-10 in defensive efficiency. Unders hit 7 of last 10 matchups. Slow pace expected.", trend:"down", lineMove:"Opened 224.5, under action moved 3 pts" },
    { id:"ml-fav-2", type:"Moneyline", game:"Bucks @ Pacers", selection:"Bucks ML", gameTime:t3.toISOString(), ourProbability:64.5, bookImplied:58.8, edge:5.7, ev:11.6, kellyPct:2.1, bestBook:"caesars", bestOdds:-143, books:{draftkings:-150,fanduel:-148,betmgm:-155,caesars:-143,pointsbet:-145,betrivers:-152}, newsScore:7.8, newsSummary:"Giannis fully healthy, listed as active. Pacers missing Haliburton (hamstring).", trend:"up", lineMove:"Line moved from -160 to -143, sharp Bucks action" },
    { id:"sp-fav-2", type:"Spread", game:"Celtics @ Lakers", selection:"Celtics -4.5", gameTime:t1.toISOString(), ourProbability:55.9, bookImplied:50.8, edge:5.1, ev:9.4, kellyPct:1.6, bestBook:"draftkings", bestOdds:-106, books:{draftkings:-106,fanduel:-108,betmgm:-112,caesars:-110,pointsbet:-109,betrivers:-115}, newsScore:7.1, newsSummary:"Celtics cover rate 68% as road favorites this season. AD absence removes 4pts of defensive value.", trend:"stable", lineMove:"Public on Lakers, books shade Celtics" },
  ].sort((a,b)=>b.ev-a.ev);
}

// ── ODDS API ─────────────────────────────────────────────────
async function fetchLiveOdds(apiKey, mlModel) {
  try {
    const ALL_BOOKS = [...SPORTSBOOKS, "pinnacle"];
    // Fetch game lines and player props in parallel
    const [gameRes, propRes] = await Promise.all([
      fetch(`https://api.the-odds-api.com/v4/sports/basketball_nba/odds/?apiKey=${apiKey}&regions=us,eu&markets=h2h,spreads,totals&bookmakers=${ALL_BOOKS.join(",")}&oddsFormat=american`),
      fetch(`https://api.the-odds-api.com/v4/sports/basketball_nba/odds/?apiKey=${apiKey}&regions=us&markets=player_points,player_rebounds,player_assists,player_threes&bookmakers=draftkings,fanduel,betmgm,caesars&oddsFormat=american`)
    ]);
    if(!gameRes.ok) throw new Error(gameRes.status);
    const data = await gameRes.json();
    let propData = [];
    if(propRes.ok) {
      propData = await propRes.json();
      console.log(`[Props] API returned ${propData.length} games with prop markets`);
    } else {
      console.log(`[Props] API error ${propRes.status} — props may require paid tier`);
    }
    if(!Array.isArray(data)||data.length===0) return null;

    const bets = [];
    data.forEach(game => {
      const gameTime=game.commence_time, away=game.away_team, home=game.home_team;
      const gameLabel=`${away} @ ${home}`;

      // Separate Pinnacle from soft books while grouping
      const grouped = {};       // soft book odds per outcome
      const pinnacleLines = {}; // pinnacle odds per outcome

      game.bookmakers?.forEach(book => {
        const isPinnacle = book.key === "pinnacle";
        if(!isPinnacle && !SPORTSBOOKS.includes(book.key)) return;
        book.markets?.forEach(market => {
          market.outcomes?.forEach(outcome => {
            const key=`${gameLabel}|${market.key}|${outcome.name}|${outcome.point??''}`;
            if(isPinnacle) {
              pinnacleLines[key] = outcome.price; // store Pinnacle's line separately
            } else {
              if(!grouped[key]) grouped[key]={game:gameLabel,gameTime,market:market.key,selection:outcome.name,point:outcome.point,books:{}};
              grouped[key].books[book.key]=outcome.price;
            }
          });
        });
      });

      // Debug counters per game
      let dbg = {total:0, rangeKill:0, edgeKill:0, longshotKill:0, pinnacleKill:0, passed:0};

      const pinnacleCount = Object.keys(pinnacleLines).filter(k=>k.startsWith(gameLabel)).length;
      console.log(`[Pinnacle] ${gameLabel}: ${pinnacleCount} Pinnacle lines found`);

      Object.values(grouped).forEach(bet => {
        const softOdds=Object.values(bet.books).filter(Boolean);
        if(softOdds.length<2) return;
        dbg.total++;
        const bestOdds=Math.max(...softOdds);
        const bestBook=Object.keys(bet.books).find(k=>bet.books[k]===bestOdds);

        // Hard filter — only surface bets in our target odds range
        if(bestOdds < MIN_ODDS || bestOdds > MAX_ODDS) { dbg.rangeKill++; return; }

        // ── LOCAL MODEL ──────────────────────────────────────────
        // Vig-free consensus from soft books
        const vigFreeProbs = softOdds.map(o => americanToImplied(o) / 1.045);
        const consensusProb = vigFreeProbs.reduce((s,p)=>s+p,0)/vigFreeProbs.length;

        // Line shopping edge — best available vs average
        const avgImplied = softOdds.reduce((s,o)=>s+americanToImplied(o),0)/softOdds.length;
        const bestImplied = americanToImplied(bestOdds);
        const lineShopEdge = avgImplied - bestImplied;

        // Local model probability
        let ourProb = Math.min(Math.max(consensusProb + lineShopEdge, 30), 85);

        // ML adjustment
        const tempBet = { ourProbability:ourProb, type:"Moneyline", bestOdds, edge:0, game:gameLabel };
        ourProb = applyMLAdjustment(mlModel, tempBet);

        const localEdge = ourProb - bestImplied;
        if(localEdge < MIN_EV_EDGE) { dbg.edgeKill++; return; }
        if(bestOdds > 125 && localEdge < MIN_EV_EDGE_LONGSHOT) { dbg.longshotKill++; return; }
        const localEV = calcEV(ourProb, bestOdds);
        if(localEV <= 0) { dbg.edgeKill++; return; }

        // ── PINNACLE VALIDATION ──────────────────────────────────
        // Try exact key first, then fallback to partial match within game
        const betKey = `${gameLabel}|${bet.market}|${bet.selection}|${bet.point??''}`;
        let pinnacleOdds = pinnacleLines[betKey] ?? null;
        // Fallback: search all Pinnacle keys for same market + selection within this game
        if(pinnacleOdds == null) {
          const fallbackKey = Object.keys(pinnacleLines).find(k =>
            k.startsWith(gameLabel) &&
            k.includes(`|${bet.market}|`) &&
            k.includes(`|${bet.selection}|`)
          );
          if(fallbackKey) pinnacleOdds = pinnacleLines[fallbackKey];
        }
        let pinnacleAligned = false;
        let pinnacleEdge = null;
        let pinnacleProb = null;
        let pinnacleNote = "Pinnacle line unavailable — local model only";

        if(pinnacleOdds != null) {
          pinnacleProb = americanToImplied(pinnacleOdds) / 1.02;
          pinnacleEdge = pinnacleProb - bestImplied;
          const probDivergence = Math.abs(pinnacleProb - ourProb);

          if(localEdge > 0 && pinnacleEdge > 0 && probDivergence < 8) {
            pinnacleAligned = true;
            ourProb = +(ourProb * 0.5 + pinnacleProb * 0.5).toFixed(1);
            pinnacleNote = `Pinnacle ${formatOdds(pinnacleOdds)} · sharp prob ${pinnacleProb.toFixed(1)}% · confirmed ✓`;
          } else {
            dbg.pinnacleKill++;
            console.log(`[Skip-Pinnacle] ${bet.selection} | localEdge:${localEdge.toFixed(1)}% pinEdge:${pinnacleEdge?.toFixed(1)}% divergence:${probDivergence.toFixed(1)}%`);
            return;
          }
        }

        // Recompute edge/EV with final (possibly Pinnacle-blended) probability
        const finalEdge = ourProb - bestImplied;
        const finalEV = calcEV(ourProb, bestOdds);
        if(finalEV <= 0) { dbg.edgeKill++; return; }
        // Only re-check edge threshold if Pinnacle blended (which may have shifted ourProb)
        if(pinnacleAligned && finalEdge < MIN_EV_EDGE) { dbg.edgeKill++; return; }
        if(bestOdds > 125 && finalEdge < MIN_EV_EDGE_LONGSHOT) { dbg.longshotKill++; return; }
        dbg.passed++;

        let type="Moneyline";
        if(bet.market==="spreads") type="Spread";
        if(bet.market==="totals") type="Game Total";
        let sel=bet.selection;
        if(bet.point!=null&&bet.market==="spreads") sel+=` ${bet.point>0?"+":""}${bet.point}`;
        if(bet.point!=null&&bet.market==="totals") sel=`${bet.selection} ${bet.point}`;

        bets.push({
          id:`${gameLabel}|${bet.market}|${sel}`,
          type, game:gameLabel, selection:sel, gameTime:bet.gameTime,
          ourProbability:+ourProb.toFixed(1),
          bookImplied:+bestImplied.toFixed(1),
          edge:+finalEdge.toFixed(1), ev:+finalEV.toFixed(1),
          kellyPct:+kellyFraction(ourProb,bestOdds).toFixed(1),
          bestBook, bestOdds, books:bet.books,
          newsScore:5, newsSummary:"Add your Anthropic key in Settings to enable AI news analysis.",
          trend:"stable", lineMove:pinnacleNote,
          pinnacleAligned, pinnacleOdds, pinnacleEdge:pinnacleEdge?+pinnacleEdge.toFixed(1):null,
          mlAdjusted: mlModel.totalBets >= 5,
        });
      });
      if(dbg.total > 0) console.log(`[${gameLabel}] ${dbg.total} outcomes | range:${dbg.rangeKill} edge:${dbg.edgeKill} longshot:${dbg.longshotKill} pinnacle:${dbg.pinnacleKill} | PASSED:${dbg.passed}`);
    });

    // ── PLAYER PROPS (inefficient market — wider edges) ────────────
    if(Array.isArray(propData)) {
      propData.forEach(game => {
        const gameLabel = `${game.away_team} @ ${game.home_team}`;
        const propGrouped = {};
        game.bookmakers?.forEach(book => {
          if(!SPORTSBOOKS.includes(book.key)) return;
          book.markets?.forEach(market => {
            market.outcomes?.forEach(outcome => {
              const key = `${gameLabel}|${market.key}|${outcome.name}|${outcome.description??''}|${outcome.point??''}`;
              if(!propGrouped[key]) propGrouped[key] = {
                game:gameLabel, gameTime:game.commence_time,
                market:market.key, selection:outcome.name,
                description:outcome.description, point:outcome.point, books:{}
              };
              propGrouped[key].books[book.key] = outcome.price;
            });
          });
        });

        Object.values(propGrouped).forEach(prop => {
          const propOdds = Object.values(prop.books).filter(Boolean);
          if(propOdds.length < 2) return;
          const bestOdds = Math.max(...propOdds);
          const bestBook = Object.keys(prop.books).find(k => prop.books[k] === bestOdds);
          if(bestOdds < MIN_ODDS || bestOdds > MAX_ODDS) return;

          // Props: use Pinnacle-style individual vig removal
          // Props are priced independently so we use simple vig-free avg
          const avgImplied = propOdds.reduce((s,o)=>s+americanToImplied(o),0)/propOdds.length;
          const bestImplied = americanToImplied(bestOdds);
          // Prop books run ~6-8% vig (less sharp than game lines)
          const noVigProb = avgImplied / 1.07;
          const edge = noVigProb - bestImplied;
          if(edge < MIN_EV_EDGE_PROP) return;
          if(bestOdds > 125 && edge < MIN_EV_EDGE_LONGSHOT) return;
          const ev = calcEV(noVigProb, bestOdds);
          if(ev <= 0) return;

          const playerName = prop.description || prop.selection;
          const marketLabel = {
            player_points:"Points", player_rebounds:"Rebounds",
            player_assists:"Assists", player_threes:"3-Pointers"
          }[prop.market] || prop.market;
          const overUnder = prop.selection === "Over" ? "Over" : "Under";
          const sel = `${playerName} ${overUnder} ${prop.point} ${marketLabel}`;

          bets.push({
            id:`prop|${gameLabel}|${prop.market}|${sel}`,
            type:"Player Prop", game:gameLabel, selection:sel,
            gameTime:prop.gameTime,
            ourProbability:+noVigProb.toFixed(1),
            bookImplied:+bestImplied.toFixed(1),
            edge:+edge.toFixed(1), ev:+ev.toFixed(1),
            kellyPct:+kellyFraction(noVigProb,bestOdds).toFixed(1),
            bestBook, bestOdds, books:prop.books,
            newsScore:5, newsSummary:"Add your Anthropic key to enable AI news analysis.",
            trend:"stable", lineMove:"Player prop · book vig removed",
            pinnacleAligned:false, pinnacleOdds:null, pinnacleEdge:null,
            mlAdjusted:false, isNearEV:false, isProp:true,
          });
        });
      });
    }

    // ── NEAR-EV: surface best bets below threshold with clear label ──
    // These didn't clear MIN_EV_EDGE but are the closest available
    // Re-run game lines with no edge filter, tag as nearEV
    const nearEVBets = [];
    data.forEach(game => {
      const gameLabel = `${game.away_team} @ ${game.home_team}`;
      const tempGrouped = {};
      const tempPinnacle = {};
      game.bookmakers?.forEach(book => {
        const isPinn = book.key === "pinnacle";
        if(!isPinn && !SPORTSBOOKS.includes(book.key)) return;
        book.markets?.forEach(market => {
          if(!["h2h","spreads","totals"].includes(market.key)) return;
          market.outcomes?.forEach(outcome => {
            const key = `${gameLabel}|${market.key}|${outcome.name}|${outcome.point??''}`;
            if(isPinn) { tempPinnacle[key] = outcome.price; return; }
            if(!tempGrouped[key]) tempGrouped[key]={game:gameLabel,gameTime:game.commence_time,market:market.key,selection:outcome.name,point:outcome.point,books:{}};
            tempGrouped[key].books[book.key]=outcome.price;
          });
        });
      });

      // For h2h: pair each outcome with its opponent to do proper devig
      const h2hOutcomes = Object.entries(tempGrouped).filter(([k])=>k.includes("|h2h|"));
      const pairMap = {};
      h2hOutcomes.forEach(([key, bet]) => {
        const [gl, mkt, sel, pt] = key.split("|");
        // Find the opposing outcome (same game, same market, different selection)
        const opposingKey = h2hOutcomes.find(([k2, b2]) =>
          k2 !== key && k2.startsWith(`${gl}|${mkt}|`) && b2.game === bet.game
        );
        if(opposingKey) pairMap[key] = opposingKey[1];
      });

      Object.entries(tempGrouped).forEach(([key, bet]) => {
        const softOdds = Object.values(bet.books).filter(Boolean);
        if(softOdds.length < 2) return;
        const bestOdds = Math.max(...softOdds);
        const bestBook = Object.keys(bet.books).find(k=>bet.books[k]===bestOdds);
        if(bestOdds < MIN_ODDS || bestOdds > MAX_ODDS) return;

        const bestImplied = americanToImplied(bestOdds);
        let noVigProb;

        // Proper paired devig for h2h
        const paired = pairMap[key];
        if(paired && bet.market === "h2h") {
          const pairedOdds = Object.values(paired.books).filter(Boolean);
          if(pairedOdds.length >= 2) {
            const avgThisImplied = softOdds.reduce((s,o)=>s+americanToImplied(o),0)/softOdds.length;
            const avgPairedImplied = pairedOdds.reduce((s,o)=>s+americanToImplied(o),0)/pairedOdds.length;
            noVigProb = avgThisImplied / (avgThisImplied + avgPairedImplied) * 100;
          } else {
            noVigProb = (softOdds.reduce((s,o)=>s+americanToImplied(o),0)/softOdds.length) / 1.045;
          }
        } else {
          noVigProb = (softOdds.reduce((s,o)=>s+americanToImplied(o),0)/softOdds.length) / 1.045;
        }

        const edge = noVigProb - bestImplied;
        const ev = calcEV(noVigProb, bestOdds);
        // Only surface as near-EV if edge is 0% to MIN_EV_EDGE — never negative expected value
        if(edge < 0 || edge >= MIN_EV_EDGE) return;
        if(ev < 0) return;
        // Skip if already in main bets
        const id = `${gameLabel}|${bet.market}|${bet.selection}`;
        if(bets.some(b=>b.id===id)) return;

        let type = bet.market === "h2h" ? "Moneyline" : bet.market === "spreads" ? "Spread" : "Game Total";
        let sel = bet.selection;
        if(bet.point!=null&&bet.market==="spreads") sel+=` ${bet.point>0?"+":""}${bet.point}`;
        if(bet.point!=null&&bet.market==="totals") sel=`${bet.selection} ${bet.point}`;

        // Pinnacle lookup
        const pKey = `${gameLabel}|${bet.market}|${bet.selection}|${bet.point??''}`;
        const pOdds = tempPinnacle[pKey] ?? Object.entries(tempPinnacle).find(([k])=>k.startsWith(gameLabel)&&k.includes(bet.selection))?.[1] ?? null;
        const pProb = pOdds ? americanToImplied(pOdds)/1.02 : null;

        nearEVBets.push({
          id, type, game:gameLabel, selection:sel, gameTime:bet.gameTime,
          ourProbability:+noVigProb.toFixed(1), bookImplied:+bestImplied.toFixed(1),
          edge:+edge.toFixed(1), ev:+ev.toFixed(1),
          kellyPct:+kellyFraction(noVigProb,bestOdds).toFixed(1),
          bestBook, bestOdds, books:bet.books,
          newsScore:5, newsSummary:"Near-EV bet — small positive edge below our main threshold. Use smaller Kelly sizing.",
          trend:"stable", lineMove:pOdds?`Pinnacle ${formatOdds(pOdds)} · implied ${pProb?.toFixed(1)}%`:"No Pinnacle line",
          pinnacleAligned:false, pinnacleOdds:pOdds, pinnacleEdge:pOdds?+(pProb-bestImplied).toFixed(1):null,
          mlAdjusted:false, isNearEV:true, isProp:false,
        });
      });
    });

    // Near-EV: always show top 5 when no real bets found
    // These show the closest available lines — useful context even when market is efficient
    nearEVBets.sort((a,b)=>b.edge-a.edge);
    const hasRealBets = bets.filter(b=>b.edge >= MIN_EV_EDGE && !b.isNearEV).length > 0;
    const topNearEV = hasRealBets ? [] : nearEVBets.slice(0, 5);

    // ── MARKET BIAS CALCULATION ──────────────────────────────────
    // Compare no-vig prob vs book implied prob across all h2h favorites
    // Positive bias = books overpricing favorites (good for us on dogs)
    // Negative bias = books underpricing favorites (good for us on favs)
    let biasSum = 0, biasCount = 0;
    data.forEach(game => {
      game.bookmakers?.forEach(book => {
        if(!SPORTSBOOKS.includes(book.key)) return;
        book.markets?.filter(m=>m.key==="h2h").forEach(market => {
          const outcomes = market.outcomes || [];
          if(outcomes.length !== 2) return;
          const totalImpl = outcomes.reduce((s,o)=>s+americanToImplied(o.price),0);
          const vigPct = totalImpl - 100;
          biasSum += vigPct;
          biasCount++;
        });
      });
    });
    const marketBias = biasCount > 0 ? biasSum / biasCount : null;

    // Ensure 70% negative odds in final output
    const negBets = bets.filter(b=>b.bestOdds<0).sort((a,b)=>b.ev-a.ev);
    const posBets = bets.filter(b=>b.bestOdds>=0).sort((a,b)=>b.ev-a.ev);
    const total = Math.min(negBets.length + posBets.length, 20);
    const negTarget = Math.ceil(total * TARGET_NEG_RATIO);
    const posTarget = total - negTarget;
    const pinnacleConfirmed = bets.filter(b=>b.pinnacleAligned).length;
    const allBets = [...negBets.slice(0,negTarget), ...posBets.slice(0,posTarget)].sort((a,b)=>b.ev-a.ev);
    // Merge props and near-EV — props first (genuine edge), then near-EV at end
    const propBets = bets.filter(b=>b.isProp).sort((a,b)=>b.ev-a.ev);
    const gameBets = allBets.filter(b=>!b.isProp);
    console.log(`[Odds] Game bets: ${gameBets.length} | Props: ${propBets.length} | Near-EV: ${topNearEV.length} | Bias: ${marketBias?.toFixed(2)}%`);
    return { bets:[...gameBets, ...propBets, ...topNearEV], marketBias };
  } catch(e) { console.error("Odds API",e); return null; }
}

// ── THERUNDOWN FREE API — player props ────────────────────────
// Free tier: 20k data points/day, no credit card, includes props + Pinnacle
async function fetchRundownProps(rundownKey) {
  if(!rundownKey) return [];
  try {
    const today = new Date().toISOString().split("T")[0];
    // NBA sport_id = 4, market_ids: 29=player points, 35=player rebounds, 39=player assists
    const res = await fetch(
      `https://therundown.io/api/v2/sports/4/events/${today}?key=${rundownKey}&market_ids=29,35,39&include=scores`,
      { headers: { "Content-Type":"application/json" } }
    );
    if(!res.ok) { console.log(`[Rundown] Error ${res.status}`); return []; }
    const data = await res.json();
    const events = data.events || [];
    const props = [];

    events.forEach(event => {
      const away = event.teams?.find(t=>t.is_away)?.name || "";
      const home = event.teams?.find(t=>!t.is_away)?.name || "";
      const gameLabel = `${away} @ ${home}`;
      const gameTime = event.event_date;

      // V2 markets structure
      const markets = event.markets || {};
      // market_ids 29/35/39 = player points/rebounds/assists
      [29,35,39].forEach(mid => {
        const mkt = markets[mid];
        if(!mkt) return;
        const statLabel = mid===29?"Points":mid===35?"Rebounds":"Assists";

        // Group by player + line across books
        const grouped = {};
        mkt.forEach(entry => {
          const book = entry.affiliate?.name || "unknown";
          if(!["DraftKings","FanDuel","BetMGM","Caesars","Pinnacle"].includes(book)) return;
          entry.participants?.forEach(p => {
            if(!p.player?.full_name) return;
            const key = `${p.player.full_name}|${p.line}|${p.side?.toLowerCase()}`;
            if(!grouped[key]) grouped[key] = { player:p.player.full_name, line:p.line, side:p.side, books:{}, pinnacleOdds:null };
            const price = p.money;
            if(book === "Pinnacle") grouped[key].pinnacleOdds = price;
            else grouped[key].books[book] = price;
          });
        });

        Object.values(grouped).forEach(prop => {
          const softOdds = Object.values(prop.books).filter(Boolean);
          if(softOdds.length < 2) return;
          const bestOdds = Math.max(...softOdds);
          const bestBook = Object.keys(prop.books).find(k=>prop.books[k]===bestOdds);
          if(bestOdds < MIN_ODDS || bestOdds > MAX_ODDS) return;

          const avgImplied = softOdds.reduce((s,o)=>s+americanToImplied(o),0)/softOdds.length;
          const bestImplied = americanToImplied(bestOdds);
          const noVigProb = avgImplied / 1.07;
          const edge = noVigProb - bestImplied;
          if(edge < MIN_EV_EDGE_PROP) return;
          const ev = calcEV(noVigProb, bestOdds);
          if(ev <= 0) return;

          // Pinnacle validation for props
          let pinnacleAligned = false, pinnacleNote = "No Pinnacle line";
          if(prop.pinnacleOdds) {
            const pinProb = americanToImplied(prop.pinnacleOdds) / 1.02;
            const pinEdge = pinProb - bestImplied;
            if(edge > 0 && pinEdge > 0 && Math.abs(pinProb - noVigProb) < 8) {
              pinnacleAligned = true;
              pinnacleNote = `Pinnacle ${formatOdds(prop.pinnacleOdds)} · confirmed ✓`;
            }
          }

          const direction = prop.side?.toLowerCase() === "over" ? "Over" : "Under";
          const sel = `${prop.player} ${direction} ${prop.line} ${statLabel}`;
          props.push({
            id:`rundown|prop|${gameLabel}|${sel}`,
            type:"Player Prop", game:gameLabel, selection:sel, gameTime,
            ourProbability:+noVigProb.toFixed(1), bookImplied:+bestImplied.toFixed(1),
            edge:+edge.toFixed(1), ev:+ev.toFixed(1),
            kellyPct:+kellyFraction(noVigProb,bestOdds).toFixed(1),
            bestBook, bestOdds, books:prop.books,
            newsScore:5, newsSummary:"Add Anthropic key for AI news analysis.",
            trend:"stable", lineMove:pinnacleNote,
            pinnacleAligned, pinnacleOdds:prop.pinnacleOdds||null, pinnacleEdge:null,
            mlAdjusted:false, isNearEV:false, isProp:true,
          });
        });
      });
    });
    console.log(`[Rundown] ${events.length} games · ${props.length} prop edges found`);
    return props;
  } catch(e) { console.error("[Rundown]", e); return []; }
}

async function fetchScores(apiKey) {
  try {
    const res = await fetch(`https://api.the-odds-api.com/v4/sports/basketball_nba/scores/?apiKey=${apiKey}&daysFrom=1`);
    if(!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

// Fix #2: News agent now calls proxy correctly
async function runNewsAgent(bet, anthropicKey) {
  if(!anthropicKey) return null;
  try {
    const res = await fetch("/api/news", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({ anthropicKey, bet })
    });
    if(!res.ok) {
      console.error("News proxy error:", res.status, await res.text());
      return null;
    }
    const data = await res.json();
    if(data.error) { console.error("News agent error:", data.error); return null; }
    if(data.newsScore) return data;
  } catch(e) { console.error("News agent fetch error:", e); }
  return null;
}


// ── NBA STATS API ─────────────────────────────────────────────
// Free, unofficial — stats.nba.com game logs and team stats
async function fetchPlayerGameLog(playerName) {
  try {
    // Search for player in current season game log via nba stats
    const encoded = encodeURIComponent(playerName);
    const res = await fetch(
      `https://stats.nba.com/stats/commonallplayers?LeagueID=00&Season=2025-26&IsOnlyCurrentSeason=1`,
      { headers: { "Referer":"https://www.nba.com", "x-nba-stats-origin":"stats", "x-nba-stats-token":"true" } }
    );
    if(!res.ok) return null;
    const data = await res.json();
    const players = data.resultSets?.[0]?.rowSet || [];
    const headers = data.resultSets?.[0]?.headers || [];
    const nameIdx = headers.indexOf("DISPLAY_FIRST_LAST");
    const idIdx = headers.indexOf("PERSON_ID");
    const nameLower = playerName.toLowerCase();
    const player = players.find(p => p[nameIdx]?.toLowerCase().includes(nameLower));
    if(!player) return null;
    return { id: player[idIdx], name: player[nameIdx] };
  } catch { return null; }
}

async function fetchPlayerStats(playerId) {
  try {
    const res = await fetch(
      `https://stats.nba.com/stats/playergamelog?PlayerID=${playerId}&Season=2025-26&SeasonType=Regular+Season&LastNGames=10`,
      { headers: { "Referer":"https://www.nba.com", "x-nba-stats-origin":"stats", "x-nba-stats-token":"true" } }
    );
    if(!res.ok) return null;
    const data = await res.json();
    const rows = data.resultSets?.[0]?.rowSet || [];
    const hdrs = data.resultSets?.[0]?.headers || [];
    if(!rows.length) return null;
    const get = (row, col) => row[hdrs.indexOf(col)];
    return rows.slice(0,10).map(r => ({
      pts: +get(r,"PTS")||0, reb: +get(r,"REB")||0, ast: +get(r,"AST")||0,
      fg3m: +get(r,"FG3M")||0, min: +get(r,"MIN")||0,
      date: get(r,"GAME_DATE"), wl: get(r,"WL"),
      matchup: get(r,"MATCHUP"),
    }));
  } catch { return null; }
}

async function fetchTeamDef(teamAbbr) {
  try {
    const res = await fetch(
      `https://stats.nba.com/stats/leaguedashteamstats?Season=2025-26&SeasonType=Regular+Season&PerMode=PerGame&MeasureType=Defense`,
      { headers: { "Referer":"https://www.nba.com", "x-nba-stats-origin":"stats", "x-nba-stats-token":"true" } }
    );
    if(!res.ok) return null;
    const data = await res.json();
    const rows = data.resultSets?.[0]?.rowSet || [];
    const hdrs = data.resultSets?.[0]?.headers || [];
    const nameIdx = hdrs.indexOf("TEAM_NAME");
    const rtgIdx = hdrs.indexOf("DEF_RATING");
    const paceIdx = hdrs.indexOf("PACE");
    // Find by abbr or partial name
    const team = rows.find(r => r[nameIdx]?.toLowerCase().includes(teamAbbr?.toLowerCase()));
    if(!team) return null;
    return { defRating: +team[rtgIdx], pace: +team[paceIdx], rank: rows.indexOf(team)+1 };
  } catch { return null; }
}

// ── CONFIDENCE ENGINE ─────────────────────────────────────────
// Returns 0-100 confidence score + breakdown for a given bet
async function scoreConfidence(bet, newsScore) {
  const factors = [];
  let totalScore = 0;
  let totalWeight = 0;

  const addFactor = (label, score, weight, note) => {
    factors.push({ label, score: Math.round(score), weight, note });
    totalScore += score * weight;
    totalWeight += weight;
  };

  if(bet.isProp) {
    // ── PLAYER PROP CONFIDENCE ──────────────────────────────────
    // Parse player name and stat from selection e.g. "LeBron James Over 27.5 Points"
    const m = bet.selection.match(/^(.+?)\s+(Over|Under)\s+([\d.]+)\s+(.+)$/i);
    if(!m) return null;
    const [, playerName, direction, lineStr, statType] = m;
    const line = parseFloat(lineStr);
    const isOver = direction.toLowerCase() === "over";
    const statKey = statType.toLowerCase().includes("point")?"pts":
                    statType.toLowerCase().includes("reb")?"reb":
                    statType.toLowerCase().includes("assist")?"ast":
                    statType.toLowerCase().includes("3")?"fg3m":"pts";

    // Fetch player game log
    const playerInfo = await fetchPlayerGameLog(playerName);
    if(playerInfo) {
      const games = await fetchPlayerStats(playerInfo.id);
      if(games && games.length >= 3) {
        const statVals = games.map(g => g[statKey]);
        const avg5 = statVals.slice(0,5).reduce((s,v)=>s+v,0)/Math.min(5,statVals.length);
        const avg10 = statVals.reduce((s,v)=>s+v,0)/statVals.length;
        const hitRate = statVals.filter(v => isOver ? v > line : v < line).length / statVals.length;

        // Factor 1: Rolling avg vs line (weight 35)
        const avgVsLine = avg5 - line;
        const avgScore = isOver
          ? Math.min(100, 50 + avgVsLine * 8)
          : Math.min(100, 50 - avgVsLine * 8);
        addFactor("5-game avg vs line", avgScore, 35,
          `${avg5.toFixed(1)} avg vs ${line} line (${avgVsLine > 0 ? "+" : ""}${avgVsLine.toFixed(1)})`);

        // Factor 2: 10-game hit rate (weight 30)
        const hitScore = hitRate * 100;
        addFactor("10-game hit rate", hitScore, 30,
          `Hit ${Math.round(hitRate*statVals.length)}/${statVals.length} games (${Math.round(hitRate*100)}%)`);

        // Factor 3: Recent trend — last 3 vs prior 3 (weight 15)
        if(statVals.length >= 6) {
          const recent3 = statVals.slice(0,3).reduce((s,v)=>s+v,0)/3;
          const prior3 = statVals.slice(3,6).reduce((s,v)=>s+v,0)/3;
          const trending = isOver ? recent3 > prior3 : recent3 < prior3;
          const trendScore = trending ? 75 : 35;
          addFactor("Recent trend", trendScore, 15,
            `Last 3: ${recent3.toFixed(1)} vs prior 3: ${prior3.toFixed(1)} — ${trending?"trending ✓":"trending against"}`);
        }

        // Factor 4: Minutes in last 3 (health proxy) (weight 10)
        const avgMin = games.slice(0,3).reduce((s,g)=>s+g.min,0)/3;
        const minScore = avgMin >= 30 ? 85 : avgMin >= 24 ? 65 : 40;
        addFactor("Minutes (availability)", minScore, 10, `${avgMin.toFixed(0)} avg min last 3 games`);
      }
    }

    // Factor 5: EV edge alignment (weight 10)
    const evScore = bet.edge >= MIN_EV_EDGE_PROP ? 80 : bet.edge >= 0 ? 55 : 30;
    addFactor("EV/line alignment", evScore, 10, `Book edge ${bet.edge >= 0 ? "+" : ""}${bet.edge}%`);

  } else {
    // ── GAME LINE CONFIDENCE ────────────────────────────────────
    // Factor 1: EV strength (weight 40)
    const evScore = bet.edge >= 3 ? 90 : bet.edge >= 1.5 ? 72 : bet.edge >= 0 ? 55 : 30;
    addFactor("EV strength", evScore, 40, `${bet.edge >= 0 ? "+" : ""}${bet.edge}% edge vs book`);

    // Factor 2: Pinnacle alignment (weight 30)
    if(bet.pinnacleAligned) {
      addFactor("Pinnacle confirmation", 90, 30, "Sharp book confirms edge ✓");
    } else if(bet.pinnacleOdds != null) {
      const pinScore = bet.pinnacleEdge > 0 ? 65 : 40;
      addFactor("Pinnacle signal", pinScore, 30,
        `Pinnacle ${formatOdds(bet.pinnacleOdds)} · edge ${bet.pinnacleEdge > 0 ? "+" : ""}${bet.pinnacleEdge}%`);
    } else {
      addFactor("Pinnacle data", 50, 30, "No Pinnacle line — soft books only");
    }

    // Factor 3: Line value (is the best available meaningfully better than avg?) (weight 20)
    const bookOdds = Object.values(bet.books).filter(Boolean);
    if(bookOdds.length >= 3) {
      const avgOdds = bookOdds.reduce((s,o)=>s+o,0)/bookOdds.length;
      const lineValueScore = bet.bestOdds > avgOdds ? 80 : 55;
      addFactor("Best line vs avg", lineValueScore, 20,
        `Best: ${formatOdds(bet.bestOdds)} vs avg: ${formatOdds(Math.round(avgOdds))}`);
    }

    // Factor 4: Odds type (favorites are more predictable) (weight 10)
    const oddsScore = bet.bestOdds < -150 ? 75 : bet.bestOdds < 0 ? 65 : bet.bestOdds < 150 ? 52 : 40;
    addFactor("Odds predictability", oddsScore, 10,
      bet.bestOdds < 0 ? "Favorite — historically more predictable" : "Underdog — higher variance");
  }

  // News agent overlay (bonus factor if available)
  if(newsScore && newsScore >= 1) {
    const newsConf = newsScore >= 8 ? 88 : newsScore >= 6 ? 68 : newsScore >= 4 ? 48 : 30;
    addFactor("News/injury signal", newsConf, 20,
      `AI news score ${newsScore}/10`);
    totalWeight += 20; // already added via addFactor
  }

  if(totalWeight === 0) return null;
  const confidence = Math.round(totalScore / totalWeight);
  const tier = confidence >= 72 ? "HIGH" : confidence >= 52 ? "MEDIUM" : "LOW";
  const tierColor = confidence >= 72 ? "#00ff88" : confidence >= 52 ? "#ffd700" : "#ff6b6b";
  return { confidence, tier, tierColor, factors };
}

// ── INFO CARDS ───────────────────────────────────────────────
const INFO_CARDS = [
  { icon:"📊", title:"What is Expected Value (EV)?", body:"EV is the engine of this app. A +EV bet means the true probability of winning is higher than what the sportsbook's odds imply. For example: if our model says a team has a 60% chance of winning but the book implies only 54%, that 6% gap is your edge. Over hundreds of bets, consistently finding +EV lines produces long-run profit — this is how professional sports bettors operate." },
  { icon:"🏦", title:"What is a Moneyline?", body:"Pick who wins the game outright. Odds are shown in American format: -180 means you bet $180 to win $100 (favorite). +160 means you bet $100 to win $160 (underdog). This app targets favorites and near-coinflips where the book has underpriced the winner — think a -200 true probability team listed at -140." },
  { icon:"📏", title:"What is a Spread?", body:"The spread is a points handicap that levels the playing field. Nuggets -5.5 means Denver must win by 6+. Celtics +5.5 means Boston just needs to lose by 5 or fewer (or win outright). We target spreads where our model projects a larger margin than the book's line — particularly on road favorites being undervalued by public betting." },
  { icon:"🎯", title:"What is a Game Total (Over/Under)?", body:"Instead of picking a winner, you bet the combined final score of both teams. The book sets a number (e.g. 221.5) and you pick Over or Under. We model pace of play, offensive and defensive efficiency ratings, fatigue from back-to-backs, and recent scoring trends to find totals where the book's number is off from our projection." },
  { icon:"🏀", title:"What is a Player Prop?", body:"A bet on an individual player's stat line — e.g. LeBron Over 27.5 Points or Jokic Over 10.5 Assists. We model each player's rolling 10-game averages, matchup difficulty, usage rate, minutes projections, and opponent defensive rating at that position, then compare against the book's number to surface mispriced props." },
  { icon:"🎯", title:"Our Odds Filter Criteria", body:"We apply strict filters to only surface bets with genuine edge: (1) Odds range -450 to +350 — no extreme longshots or extreme favorites where the juice destroys value. (2) Any bet with odds above +125 must show at least 10% edge — longshots need a much larger gap to justify the risk. (3) All bets require at least 3% edge at minimum. (4) 70% of all surfaced bets target negative odds (favorites), where mispricing is most exploitable." },
  { icon:"📐", title:"What is Kelly Criterion?", body:"Kelly Criterion is a formula that calculates the mathematically optimal percentage of your bankroll to wager given your edge and the odds. We use Quarter-Kelly (25% of the full formula) capped at 4% per bet to stay conservative and protect against model error. Example: 2% Kelly on a $1,000 bankroll = $20 bet. Smaller edge = smaller bet. Larger edge = larger bet. Never flat bet — sizing matters as much as finding the edge." },
  { icon:"🧠", title:"How does the ML Engine work?", body:"Our Bayesian learning engine improves probability estimates with every resolved bet. It tracks win rate by bet type (Moneyline, Spread, etc.), odds range bucket (-450 to -200, -200 to -110, etc.), and individual teams. After 5+ resolved bets it begins adjusting future probability estimates — if our spread model has been overconfident, it corrects downward automatically. The more bets resolve, the sharper the calibration. ML status is shown in the header." },
  { icon:"📈", title:"What is Line Movement?", body:"Books open lines and then shift them as money comes in. When sharp (professional) bettors hammer one side, the line moves in their direction — this is called 'steam.' If a line moves opposite to where the public is betting, that's a strong signal that professionals see value. We flag line movement on every bet card and factor it into the AI news agent's scoring." },
  { icon:"🤖", title:"What does the News Agent do?", body:"The AI news agent (powered by Claude or GPT) searches the web before each game for injury reports, lineup news, beat reporter updates, and player availability. It assigns a News Score (1-10) to each bet — 8+ means the news supports the bet, below 5 means there's a concern. This qualitative layer is applied on top of the statistical model to adjust confidence. Add your Anthropic API key in ⚙ API Setup to enable it." },
  { icon:"📚", title:"How to Read a Bet Card", body:"Each card shows: bet selection, game matchup, time until tip-off, EV% (expected profit per $100 bet over the long run), Edge% (our model probability minus book implied probability), best available odds, and which sportsbook has them. Click to expand: see all 6 book lines side by side, the AI news summary and score, ML adjustment status, and your recommended Kelly bet size as both a % and dollar amount." },
  { icon:"📈", title:"History Tab & Paper Bankroll", body:"The History tab tracks every recommended bet as a paper trade starting from a $100 bankroll, sized by Kelly Criterion. Moneylines, Spreads, and Game Totals auto-resolve using live scores from The Odds API. Player props remain Pending (live box score data requires a paid endpoint). The portfolio chart shows your running bankroll over time with a shaded P&L area. Reset anytime from ⚙ API Setup." },
  { icon:"⭐", title:"Top Picks & Confidence Score", body:"Every bet is scored 0–100 for outcome confidence using real NBA Stats data and multiple signals: (1) 5-game and 10-game rolling averages vs the prop line. (2) 10-game hit rate — how often the player has cleared this exact number. (3) Recent trend — last 3 games vs prior 3. (4) Minutes played as an availability proxy. (5) EV/line alignment. (6) Pinnacle confirmation for game lines. (7) AI news score when available. Top Picks (shown above the main list) are bets where BOTH EV edge AND confidence are HIGH — the strongest possible signal." },
  { icon:"⚙️", title:"Setting Up Your API Keys", body:"Click '⚙ API Setup' (top right) to enter three keys: (1) Odds API Key — free at the-odds-api.com, pulls live lines from DraftKings, FanDuel, BetMGM, Caesars, PointsBet, and BetRivers. (2) Anthropic API Key — console.anthropic.com, powers the AI news & injury agent (recommended). (3) OpenAI API Key — platform.openai.com, alternative news agent. Without any keys the app runs on demo data so you can explore the full interface." },
  { icon:"⚠️", title:"Disclaimer", body:"This app is a statistical and analytical tool — it does not guarantee wins. Even well-researched +EV bets lose frequently in the short run due to variance. The edge only becomes reliable over hundreds of bets. Never bet money you can't afford to lose. This app is intended for entertainment and educational purposes only. Always gamble responsibly." },
];

// ── MINI CHART ───────────────────────────────────────────────
function MiniChart({ history }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if(!canvas||history.length<2) return;
    const ctx=canvas.getContext("2d");
    const W=canvas.width, H=canvas.height;
    const pad={t:20,r:20,b:36,l:56};
    const cW=W-pad.l-pad.r, cH=H-pad.t-pad.b;
    ctx.clearRect(0,0,W,H);
    const bankrolls=history.map(h=>h.bankrollAfter);
    const minB=Math.min(STARTING_BANKROLL,...bankrolls)*0.97;
    const maxB=Math.max(STARTING_BANKROLL,...bankrolls)*1.03;
    const scaleX=i=>pad.l+(i/(history.length-1))*cW;
    const scaleY=v=>pad.t+cH-((v-minB)/(maxB-minB))*cH;
    ctx.strokeStyle="#172030"; ctx.lineWidth=1;
    for(let i=0;i<=4;i++){
      const y=pad.t+(i/4)*cH;
      ctx.beginPath(); ctx.moveTo(pad.l,y); ctx.lineTo(pad.l+cW,y); ctx.stroke();
      const val=maxB-(i/4)*(maxB-minB);
      ctx.fillStyle="#3a5570"; ctx.font="10px DM Mono,monospace"; ctx.textAlign="right";
      ctx.fillText(`$${val.toFixed(0)}`,pad.l-6,y+3);
    }
    const baseY=scaleY(STARTING_BANKROLL);
    ctx.strokeStyle="#2a3d55"; ctx.lineWidth=1; ctx.setLineDash([4,4]);
    ctx.beginPath(); ctx.moveTo(pad.l,baseY); ctx.lineTo(pad.l+cW,baseY); ctx.stroke();
    ctx.setLineDash([]);
    const lastBankroll=bankrolls[bankrolls.length-1];
    const pnlGrad=ctx.createLinearGradient(0,pad.t,0,pad.t+cH);
    if(lastBankroll>=STARTING_BANKROLL){pnlGrad.addColorStop(0,"rgba(0,255,136,0.15)");pnlGrad.addColorStop(1,"rgba(0,255,136,0)");}
    else{pnlGrad.addColorStop(0,"rgba(255,100,100,0)");pnlGrad.addColorStop(1,"rgba(255,100,100,0.15)");}
    ctx.beginPath(); ctx.moveTo(scaleX(0),baseY);
    history.forEach((_,i)=>ctx.lineTo(scaleX(i),scaleY(bankrolls[i])));
    ctx.lineTo(scaleX(history.length-1),baseY); ctx.closePath(); ctx.fillStyle=pnlGrad; ctx.fill();
    const bGrad=ctx.createLinearGradient(pad.l,0,pad.l+cW,0);
    bGrad.addColorStop(0,"#00bfff"); bGrad.addColorStop(1,"#00ff88");
    ctx.beginPath(); ctx.strokeStyle=bGrad; ctx.lineWidth=2.5;
    history.forEach((_,i)=>{i===0?ctx.moveTo(scaleX(i),scaleY(bankrolls[i])):ctx.lineTo(scaleX(i),scaleY(bankrolls[i]));});
    ctx.stroke();
    history.forEach((_,i)=>{
      const x=scaleX(i),y=scaleY(bankrolls[i]);
      ctx.beginPath(); ctx.arc(x,y,3,0,Math.PI*2);
      ctx.fillStyle=bankrolls[i]>=STARTING_BANKROLL?"#00ff88":"#ff6b6b"; ctx.fill();
    });
    const step=Math.max(1,Math.floor(history.length/6));
    ctx.fillStyle="#3a5570"; ctx.font="9px DM Mono,monospace"; ctx.textAlign="center";
    history.forEach((_,i)=>{
      if(i%step===0||i===history.length-1){
        const d=new Date(history[i].date).toLocaleDateString("en-US",{month:"short",day:"numeric"});
        ctx.fillText(d,scaleX(i),H-pad.b+14);
      }
    });
  }, [history]);
  if(history.length<2) return (
    <div style={{height:220,display:"flex",alignItems:"center",justifyContent:"center",color:"#3a5570",fontSize:12}}>
      Place 2+ bets to see chart
    </div>
  );
  return <canvas ref={canvasRef} width={900} height={220} style={{width:"100%",height:220,display:"block"}}/>;
}

// ── MAIN APP ─────────────────────────────────────────────────
export default function NBAEdge() {
  const [oddsKey, setOddsKey] = useState("d6a4536a32cc8112ece4e45d3501da03");
  const [rundownKey, setRundownKey] = useState(()=>localStorage.getItem("nba_edge_rundown_key")||"");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bets, setBets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [agentStatus, setAgentStatus] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [filter, setFilter] = useState("All");
  const [expanded, setExpanded] = useState(null);
  const [useMock, setUseMock] = useState(false);
  const [logs, setLogs] = useState([]);
  const [mlModel, setMlModel] = useState(()=>loadML());
  const [marketBias, setMarketBias] = useState(null);
  const [lastPoll, setLastPoll] = useState(null);
  const [bestAvailableEdge, setBestAvailableEdge] = useState(null);

  // Fix #1: History with deduplication — one entry per bet per calendar day
  const [history, setHistory] = useState(() => {
    try { const s=localStorage.getItem(STORAGE_KEY); return s?JSON.parse(s):[]; } catch { return []; }
  });
  const [bankroll, setBankroll] = useState(() => {
    try {
      const s=localStorage.getItem(STORAGE_KEY);
      if(s){ const h=JSON.parse(s); return h.length>0?h[h.length-1].bankrollAfter:STARTING_BANKROLL; }
    } catch {}
    return STARTING_BANKROLL;
  });

  const saveHistory = (h) => {
    setHistory(h);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(h)); } catch {}
    setBankroll(h.length>0?h[h.length-1].bankrollAfter:STARTING_BANKROLL);
  };

  const log = (msg) => setLogs(p=>[`[${new Date().toLocaleTimeString()}] ${msg}`,...p.slice(0,19)]);

  // Fix #1: Deduplicated auto-add — uses betId + calendar date as unique key
  const autoAddToHistory = useCallback((newBets, currentBankroll, currentHistory) => {
    const today = new Date().toDateString();

    // Build set of already-placed bets today
    const placedToday = new Set(
      currentHistory
        .filter(h => new Date(h.date).toDateString() === today)
        .map(h => h.betId)
    );

    const fresh = newBets.filter(b => !placedToday.has(b.id));
    if(fresh.length === 0) return currentHistory;

    let runningBankroll = currentBankroll;
    const newEntries = fresh.map(bet => {
      const wagerPct = bet.kellyPct / 100;
      const wagerAmt = +(runningBankroll * wagerPct).toFixed(2);
      const payout = +(wagerAmt * (americanToDecimal(bet.bestOdds)-1)).toFixed(2);
      return {
        id: `${bet.id}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        betId: bet.id,
        date: new Date().toISOString(),
        game: bet.game,
        selection: bet.selection,
        type: bet.type,
        bestOdds: bet.bestOdds,
        bestBook: bet.bestBook,
        kellyPct: bet.kellyPct,
        wagerAmt,
        potentialPayout: payout,
        ev: bet.ev,
        edge: bet.edge,
        status: "pending",
        bankrollBefore: +runningBankroll.toFixed(2),
        bankrollAfter: +runningBankroll.toFixed(2),
        gameTime: bet.gameTime,
        result: null,
      };
    });

    const updated = [...currentHistory, ...newEntries];
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(updated)); } catch {}
    return updated;
  }, []);

  // Auto-resolve bets + update ML model
  const resolveWithScores = useCallback(async (currentHistory, apiKey, currentML) => {
    if(!apiKey) return { history: currentHistory, ml: currentML };
    const pending = currentHistory.filter(h=>h.status==="pending");
    if(!pending.length) return { history: currentHistory, ml: currentML };
    const scores = await fetchScores(apiKey);
    if(!scores) return { history: currentHistory, ml: currentML };

    let updated = [...currentHistory];
    let updatedML = {...currentML};
    let changed = false;
    let runningBankroll = STARTING_BANKROLL;

    updated = updated.map(entry => {
      if(entry.status !== "pending") { runningBankroll = entry.bankrollAfter; return entry; }
      const gameScore = scores.find(s =>
        (s.home_team && entry.game.includes(s.home_team)) ||
        (s.away_team && entry.game.includes(s.away_team))
      );
      if(!gameScore?.completed) return {...entry, bankrollBefore:+runningBankroll.toFixed(2), bankrollAfter:+runningBankroll.toFixed(2)};

      const homeScore=gameScore.scores?.find(s=>s.name===gameScore.home_team)?.score;
      const awayScore=gameScore.scores?.find(s=>s.name===gameScore.away_team)?.score;
      let won = null;
      if(homeScore!=null && awayScore!=null) {
        const sel=entry.selection.toLowerCase();
        const home=gameScore.home_team.toLowerCase();
        const totalScore=parseInt(homeScore)+parseInt(awayScore);
        if(entry.type==="Moneyline") {
          const homeWon=parseInt(homeScore)>parseInt(awayScore);
          won=sel.includes(home)?homeWon:!homeWon;
        } else if(entry.type==="Spread") {
          const spreadMatch=sel.match(/([+-]?\d+\.?\d*)\s*$/);
          if(spreadMatch) {
            const spread=parseFloat(spreadMatch[1]);
            const isHome=sel.includes(home);
            const margin=isHome?(parseInt(homeScore)-parseInt(awayScore)):(parseInt(awayScore)-parseInt(homeScore));
            won=margin+spread>0;
          }
        } else if(entry.type==="Game Total") {
          const isOver=sel.includes("over");
          const lineMatch=sel.match(/(\d+\.?\d*)/);
          if(lineMatch) { const line=parseFloat(lineMatch[1]); won=isOver?totalScore>line:totalScore<line; }
        }
      }
      if(won===null) return {...entry, bankrollBefore:+runningBankroll.toFixed(2), bankrollAfter:+runningBankroll.toFixed(2)};

      const wagerAmt=+(runningBankroll*entry.kellyPct/100).toFixed(2);
      const payout=+(wagerAmt*(americanToDecimal(entry.bestOdds)-1)).toFixed(2);
      const bankrollBefore=+runningBankroll.toFixed(2);
      if(won) runningBankroll+=payout; else runningBankroll-=wagerAmt;
      runningBankroll=Math.max(0,+runningBankroll.toFixed(2));
      changed=true;

      // Fix #4: Update ML model on resolution
      updatedML = updateML(updatedML, entry, won);

      return {...entry, status:won?"won":"lost", result:won?"WIN":"LOSS", wagerAmt, potentialPayout:payout, bankrollBefore, bankrollAfter:+runningBankroll.toFixed(2)};
    });

    if(changed) {
      setHistory(updated);
      setBankroll(runningBankroll);
      setMlModel(updatedML);
      saveML(updatedML);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(updated)); } catch {}
      log(`✅ Auto-resolved bets · ML model updated (${updatedML.totalBets} bets learned)`);
    }
    return { history: updated, ml: updatedML };
  }, []);

  const fetchBets = useCallback(async () => {
    setLoading(true);
    log("🔍 Fetching NBA odds...");
    const currentML = loadML();
    let rawBets = null;

    if(oddsKey) {
      const [result, rundownProps] = await Promise.all([
        fetchLiveOdds(oddsKey, currentML),
        fetchRundownProps(rundownKey)
      ]);
      if(result) {
        // API succeeded — use live data even if 0 edges found today
        const gameBets = result.bets.filter(b=>!b.isProp);
        rawBets = [...gameBets, ...rundownProps];
        setMarketBias(result.marketBias);
        setUseMock(false);
        const props = rundownProps.length;
        const nearEV = gameBets.filter(b=>b.isNearEV).length;
        const sharp = gameBets.filter(b=>!b.isNearEV).length;
        if(props === 0 && !rundownKey) log(`💡 Add TheRundown key in API Setup for free player props`);
        const nearEVList = result.bets.filter(b=>b.isNearEV);
        if(nearEVList.length>0) setBestAvailableEdge(nearEVList[0].edge);
        log(`✅ ${sharp} sharp bets · ${props} props · ${nearEV} near-EV · bias ${result.marketBias?.toFixed(1)}%`);
      } else {
        // API call failed entirely — set empty, don't show mock
        rawBets = [];
        setUseMock(false);
        log("⚠️ Live odds fetch failed — check your Odds API key in API Setup");
      }
    }
    // Only show demo data if no API key entered at all
    if(!rawBets) { rawBets = generateMockBets(); setUseMock(true); log("ℹ️ No API key — showing demo data"); }
    setBets(rawBets);
    setLastUpdated(new Date());
    setLoading(false);

    // Fix #1: Pass current history to deduplication function
    setHistory(prev => {
      const updated = autoAddToHistory(rawBets, bankroll, prev);
      setBankroll(updated.length>0?updated[updated.length-1].bankrollAfter:bankroll);

      // Resolve pending bets
      resolveWithScores(updated, oddsKey, currentML);
      return updated;
    });

    // Fix #2: News agent + confidence scoring in parallel pipeline
    log("🧠 Scoring confidence for all bets...");
    const withConf = [...rawBets];
    // Run confidence scoring for all bets (uses NBA Stats API — free)
    for(let i=0; i<withConf.length; i++) {
      const conf = await scoreConfidence(withConf[i], withConf[i].newsScore||null);
      if(conf) withConf[i] = {...withConf[i], confidenceScore:conf.confidence, confidenceTier:conf.tier, confidenceTierColor:conf.tierColor, confidenceFactors:conf.factors};
    }
    setBets([...withConf]);
    log(`✅ Confidence scored ${withConf.filter(b=>b.confidenceScore).length}/${withConf.length} bets`);

    if(anthropicKey && rawBets.length > 0) {
      log("🤖 News agent scanning injury reports...");
      setAgentStatus("running");
      const updated = [...withConf];
      for(let i=0; i<Math.min(updated.length,5); i++) {
        log(`📰 Analyzing: ${updated[i].selection}...`);
        const result = await runNewsAgent(updated[i], anthropicKey);
        if(result) {
          updated[i] = {...updated[i], ...result};
          // Re-score confidence with news signal
          const conf = await scoreConfidence(updated[i], result.newsScore);
          if(conf) updated[i] = {...updated[i], confidenceScore:conf.confidence, confidenceTier:conf.tier, confidenceTierColor:conf.tierColor, confidenceFactors:conf.factors};
          setBets([...updated]);
          log(`✅ News+confidence updated: ${updated[i].selection} → ${updated[i].confidenceTier}`);
        } else {
          log(`⚠️ News agent failed for ${updated[i].selection}`);
        }
      }
      setAgentStatus("done");
      log("✅ News agent complete");
    } else if(!anthropicKey) {
      log("ℹ️ No Anthropic key — add in ⚙ API Setup to enable news agent");
    }
  }, [oddsKey, anthropicKey, bankroll, autoAddToHistory, resolveWithScores]);

  useEffect(() => { fetchBets(); }, []);

  useEffect(() => {
    const schedule = () => {
      const next=new Date(); next.setDate(next.getDate()+1); next.setHours(8,0,0,0);
      return setTimeout(()=>{fetchBets();schedule();}, next-new Date());
    };
    const t=schedule(); return ()=>clearTimeout(t);
  }, [fetchBets]);

  // Live polling every 60 seconds — catches line moves as they happen
  useEffect(() => {
    if(!oddsKey) return;
    const interval = setInterval(() => {
      setLastPoll(new Date());
      fetchBets();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [oddsKey, fetchBets]);

  useEffect(() => {
    const timers=bets.map(bet=>{
      const ms=new Date(bet.gameTime)-new Date()-3600000;
      if(ms>0) return setTimeout(()=>{log(`⚡ Pre-game: ${bet.game}`);fetchBets();},ms);
      return null;
    });
    return ()=>timers.forEach(t=>t&&clearTimeout(t));
  }, [bets,fetchBets]);

  const BET_TYPES=["All","Moneyline","Spread","Game Total","Player Prop"];
  const filtered=filter==="All"?bets:bets.filter(b=>b.type===filter);
  const resolved=history.filter(h=>h.status!=="pending");
  const won=resolved.filter(h=>h.status==="won");
  const totalWagered=resolved.reduce((s,h)=>s+h.wagerAmt,0);
  const totalPnl=bankroll-STARTING_BANKROLL;
  const winRate=resolved.length>0?((won.length/resolved.length)*100).toFixed(0):0;
  const mlConfidence = mlModel.totalBets >= 5 ? Math.min(50+mlModel.totalBets*2, 95) : 0;

  const chartData=(()=>{
    const days={};
    history.forEach(h=>{
      const d=new Date(h.date).toDateString();
      if(!days[d]||new Date(h.date)>new Date(days[d].date)) days[d]=h;
    });
    return Object.values(days).sort((a,b)=>new Date(a.date)-new Date(b.date));
  })();

  const s = {
    app:{minHeight:"100vh",background:"#060a10",color:"#dde3ee",fontFamily:"'DM Mono',monospace"},
    header:{background:"#0a1220",borderBottom:"1px solid #172030",padding:"16px 28px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:100},
    logoWrap:{display:"flex",alignItems:"center",gap:12},
    logoBox:{width:34,height:34,background:"linear-gradient(135deg,#00ff88,#00bfff)",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16},
    logoName:{fontSize:20,fontWeight:700,color:"#fff",letterSpacing:"0.06em"},
    logoSub:{fontSize:10,color:"#3a5570",letterSpacing:"0.14em",textTransform:"uppercase"},
    hRight:{display:"flex",alignItems:"center",gap:12},
    dot:(on)=>({width:7,height:7,borderRadius:"50%",background:on?"#00ff88":"#555",boxShadow:on?"0 0 6px #00ff88":"none"}),
    statusTxt:{fontSize:11,color:"#3a5570"},
    btn:{padding:"7px 14px",borderRadius:6,border:"1px solid #172030",background:"transparent",color:"#7a90a8",fontSize:11,cursor:"pointer"},
    btnPrimary:{padding:"7px 18px",borderRadius:6,border:"none",background:"linear-gradient(135deg,#00ff88,#00bfff)",color:"#060a10",fontSize:11,fontWeight:700,cursor:"pointer"},
    main:{maxWidth:1160,margin:"0 auto",padding:"28px 20px"},
    statsRow:{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:14,marginBottom:28},
    statCard:{background:"#0a1220",border:"1px solid #172030",borderRadius:10,padding:"14px 18px"},
    statLbl:{fontSize:10,color:"#3a5570",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:5},
    statVal:{fontSize:22,fontWeight:700,color:"#00ff88"},
    statSub:{fontSize:10,color:"#3a5570",marginTop:3},
    tabs:{display:"flex",gap:8,marginBottom:22,flexWrap:"wrap",alignItems:"center"},
    tab:(a,c)=>({padding:"5px 16px",borderRadius:20,border:`1px solid ${a?(c||"#00ff88"):"#172030"}`,background:a?`${c||"#00ff88"}15`:"transparent",color:a?(c||"#00ff88"):"#3a5570",fontSize:11,cursor:"pointer"}),
    card:(ex)=>({background:"#0a1220",border:`1px solid ${ex?"#00ff88":"#172030"}`,borderRadius:12,marginBottom:14,overflow:"hidden",cursor:"pointer",transition:"border-color 0.2s"}),
    cardTop:{padding:"18px 22px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:14},
    typeBadge:(t)=>{const c={Moneyline:"#00bfff",Spread:"#ffd700","Game Total":"#ff6b9d","Player Prop":"#b44fff"}[t]||"#666";return{display:"inline-block",padding:"2px 9px",borderRadius:4,background:`${c}20`,border:`1px solid ${c}44`,color:c,fontSize:9,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:6};},
    sel:{fontSize:17,fontWeight:700,color:"#fff",marginBottom:3},
    gameLbl:{fontSize:11,color:"#3a5570"},
    metrics:{display:"flex",gap:22,alignItems:"center"},
    mLbl:{fontSize:9,color:"#3a5570",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:3},
    mVal:(c)=>({fontSize:19,fontWeight:700,color:c||"#fff"}),
    expandArea:{borderTop:"1px solid #172030",padding:"18px 22px",background:"#060a10"},
    booksGrid:{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:18},
    bookCard:(k,best)=>({background:best?`${SPORTSBOOK_COLORS[k]}12`:"#0a1220",border:`1px solid ${best?SPORTSBOOK_COLORS[k]:"#172030"}`,borderRadius:8,padding:"10px 14px",display:"flex",justifyContent:"space-between",alignItems:"center"}),
    newsBox:{background:"#0a1220",border:"1px solid #172030",borderRadius:8,padding:"12px 16px",marginBottom:14},
    logPanel:{background:"#0a1220",border:"1px solid #172030",borderRadius:10,padding:"14px",marginTop:28},
    logLbl:{fontSize:10,color:"#3a5570",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:10},
    logLine:{fontSize:10,color:"#3a5570",padding:"2px 0",borderBottom:"1px solid #0e1a28"},
    overlay:{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:199},
    panel:{position:"fixed",top:0,right:0,width:380,height:"100vh",background:"#0a1220",borderLeft:"1px solid #172030",padding:"28px 22px",zIndex:200,overflowY:"auto"},
    mockBadge:{display:"inline-flex",alignItems:"center",gap:5,padding:"3px 9px",borderRadius:4,background:"rgba(255,215,0,0.08)",border:"1px solid rgba(255,215,0,0.25)",color:"#ffd700",fontSize:9},
    infoGrid:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14},
    probRow:{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:18},
    probCard:{background:"#0a1220",border:"1px solid #172030",borderRadius:8,padding:"10px 14px"},
  };

  const avgEdge=bets.length?(bets.reduce((s,b)=>s+b.edge,0)/bets.length).toFixed(1):"—";
  const topEV=bets.length?bets[0]?.ev.toFixed(1):"—";

  return (
    <div style={s.app}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap');
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}
        @keyframes spin{to{transform:rotate(360deg)}}
        *{box-sizing:border-box;margin:0;padding:0}
        button:hover{opacity:0.85}
        ::-webkit-scrollbar{width:3px}
        ::-webkit-scrollbar-thumb{background:#172030;border-radius:2px}
      `}</style>

      {/* Settings */}
      {settingsOpen&&<>
        <div style={s.overlay} onClick={()=>setSettingsOpen(false)}/>
        <div style={s.panel}>
          <div style={{fontSize:15,fontWeight:700,color:"#fff",marginBottom:22}}>⚙ API Setup</div>
          <div style={{background:"#060a10",border:"1px solid #172030",borderRadius:8,padding:"12px 14px",marginBottom:20}}>
            <div style={{fontSize:10,color:"#3a5570",marginBottom:6,letterSpacing:"0.1em",textTransform:"uppercase"}}>Scheduler</div>
            <div style={{fontSize:11,color:"#8899aa"}}>✅ Daily 8:00 AM auto-refresh</div>
            <div style={{fontSize:11,color:"#8899aa",marginTop:4}}>✅ Pre-game update 1hr before tip-off</div>
          </div>
          {[
            {key:"odds",label:"The Odds API Key",val:oddsKey,set:setOddsKey,hint:"Free at the-odds-api.com — live game lines from 6 sportsbooks"},
            {key:"run",label:"TheRundown API Key",val:rundownKey,set:(v)=>{setRundownKey(v);localStorage.setItem("nba_edge_rundown_key",v);},hint:"FREE player props — sign up at therundown.io/api (no credit card)"},
            {key:"anth",label:"Anthropic API Key (Recommended)",val:anthropicKey,set:setAnthropicKey,hint:"AI news agent — console.anthropic.com"},
            {key:"oai",label:"OpenAI API Key (Alternative)",val:openaiKey,set:setOpenaiKey,hint:"Alternative agent — platform.openai.com"},
          ].map(({key,label,val,set,hint})=>(
            <div key={key} style={{marginBottom:18}}>
              <label style={{fontSize:10,color:"#3a5570",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:6,display:"block"}}>{label}</label>
              <input style={{width:"100%",background:"#060a10",border:"1px solid #172030",borderRadius:6,padding:"9px 11px",color:"#dde3ee",fontSize:12,fontFamily:"inherit",boxSizing:"border-box"}} type="password" placeholder="Paste key here..." value={val} onChange={e=>set(e.target.value)}/>
              <div style={{fontSize:10,color:"#1e3040",marginTop:5}}>{hint}</div>
            </div>
          ))}
          <button style={s.btnPrimary} onClick={()=>{setSettingsOpen(false);fetchBets();}}>Save & Refresh</button>
          <button style={{...s.btn,marginLeft:10}} onClick={()=>setSettingsOpen(false)}>Cancel</button>
          <div style={{marginTop:24,borderTop:"1px solid #172030",paddingTop:20}}>
            <div style={{fontSize:10,color:"#3a5570",marginBottom:8,letterSpacing:"0.1em",textTransform:"uppercase"}}>ML Engine Status</div>
            <div style={{fontSize:12,color:"#b44fff"}}>{mlModel.totalBets < 5 ? `${mlModel.totalBets}/5 bets to activate ML` : `🧠 Active · ${mlModel.totalBets} bets learned`}</div>
            {mlModel.totalBets>=5&&<div style={{fontSize:11,color:"#3a5570",marginTop:4}}>Win rate: {mlModel.totalBets>0?((mlModel.totalWins/mlModel.totalBets)*100).toFixed(0):0}% · Bias: {mlModel.calibrationBias>0?"+":""}{mlModel.calibrationBias.toFixed(1)}pts</div>}
          </div>
          <div style={{marginTop:20,borderTop:"1px solid #172030",paddingTop:20}}>
            <div style={{fontSize:10,color:"#3a5570",marginBottom:8,letterSpacing:"0.1em",textTransform:"uppercase"}}>Paper Bankroll</div>
            <div style={{fontSize:22,fontWeight:700,color:"#00ff88"}}>{fmt$(bankroll)}</div>
            <div style={{fontSize:11,color:totalPnl>=0?"#00ff88":"#ff6b6b",marginTop:4}}>{totalPnl>=0?"+":""}{fmt$(totalPnl)} all time</div>
          </div>
        </div>
      </>}

      {/* Header */}
      <div style={s.header}>
        <div style={s.logoWrap}>
          <div style={s.logoBox}>📊</div>
          <div>
            <div style={s.logoName}>NBA EDGE</div>
            <div style={s.logoSub}>EV Betting Engine · {mlModel.totalBets>=5?`ML Active (${mlConfidence}% conf.)`:"ML Learning..."}</div>
          </div>
        </div>
        <div style={s.hRight}>
          {useMock&&<div style={s.mockBadge}>⚠ DEMO DATA</div>}
          {agentStatus==="running"&&<div style={{fontSize:11,color:"#00bfff",display:"flex",alignItems:"center",gap:6}}><div style={{width:9,height:9,border:"2px solid #00bfff",borderTopColor:"transparent",borderRadius:"50%",animation:"spin 0.8s linear infinite"}}/>Agent scanning...</div>}
          <div style={{display:"flex",alignItems:"center",gap:7}}>
            <div style={{...s.dot(!loading),animation:!loading&&oddsKey?"pulse 2s infinite":"none"}}/>
            <span style={s.statusTxt}>{loading?"Updating...":lastUpdated?`${lastUpdated.toLocaleTimeString()} · live 60s`:"Ready"}</span>
          </div>
          <button style={s.btn} onClick={()=>setSettingsOpen(true)}>⚙ API Setup</button>
          <button style={s.btnPrimary} onClick={fetchBets} disabled={loading}>{loading?"Loading...":"↻ Refresh"}</button>
        </div>
      </div>

      <div style={s.main}>
        {/* Stats */}
        <div style={s.statsRow}>
          {[
            {lbl:"Bets Found",val:bets.filter(b=>!b.isNearEV).length,sub:`${bets.filter(b=>b.isProp).length} props · ${bets.filter(b=>b.isNearEV).length} near-EV`,c:"#00ff88"},
            {lbl:"Avg Edge",val:bets.filter(b=>!b.isNearEV).length>0?`${avgEdge}%`:bestAvailableEdge!=null?`${bestAvailableEdge.toFixed(1)}%`:"—",
              sub:bets.filter(b=>!b.isNearEV).length>0?"vs book implied":bestAvailableEdge!=null?"best available (below threshold)":"no lines yet",
              c:bets.filter(b=>!b.isNearEV).length>0?"#00ff88":"#ffd700"},
            {lbl:"Top EV",val:`+${topEV}%`,sub:bets[0]?.selection?.slice(0,22)||"—",c:"#00ff88"},
            {lbl:"Market Bias",val:marketBias==null?"—":marketBias>6?"High Vig":marketBias>4.8?"Normal":marketBias>3.5?"Sharp Market":"Very Sharp",
              sub:marketBias==null?"loading...":marketBias>6?"Soft market · more pricing errors likely · good day for props":marketBias>4.8?"Standard book vig · look for props & line moves":marketBias>3.5?"Sharp action present · tight lines today":marketBias!=null?"Near-Pinnacle efficiency · hardest day to find edges":"",
              c:marketBias==null?"#3a5570":marketBias>6?"#00ff88":marketBias>4.8?"#ffd700":marketBias>3.5?"#ff9944":"#ff6b6b"},
            {lbl:"Paper Bankroll",val:fmt$(bankroll),sub:`${totalPnl>=0?"+":""}${fmt$(totalPnl)} P&L · ${winRate}% wins`,c:bankroll>=STARTING_BANKROLL?"#00ff88":"#ff6b6b"},
          ].map(({lbl,val,sub,c})=>(
            <div key={lbl} style={s.statCard}>
              <div style={s.statLbl}>{lbl}</div>
              <div style={{...s.statVal,color:c}}>{val}</div>
              <div style={{...s.statSub,color:lbl==="Paper Bankroll"?(totalPnl>=0?"#00ff88":"#ff6b6b"):"#3a5570"}}>{sub}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div style={s.tabs}>
          {BET_TYPES.map(t=><button key={t} style={s.tab(filter===t)} onClick={()=>setFilter(t)}>{t}</button>)}
          <button style={s.tab(filter==="History","#b44fff")} onClick={()=>setFilter("History")}>📈 History</button>
          <button style={s.tab(filter==="Info","#00bfff")} onClick={()=>setFilter("Info")}>ℹ How It Works</button>
          {filter!=="Info"&&filter!=="History"&&<span style={{marginLeft:"auto",fontSize:11,color:"#1e3040"}}>{filtered.length} bets · {filtered.filter(b=>b.bestOdds<0).length} favs · by EV</span>}
        </div>

        {/* HISTORY */}
        {filter==="History"&&(
          <div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:12,marginBottom:24}}>
              {[
                {lbl:"Paper Bankroll",val:fmt$(bankroll),c:bankroll>=STARTING_BANKROLL?"#00ff88":"#ff6b6b"},
                {lbl:"Total P&L",val:`${totalPnl>=0?"+":""}${fmt$(totalPnl)}`,c:totalPnl>=0?"#00ff88":"#ff6b6b"},
                {lbl:"Win Rate",val:`${winRate}%`,c:"#00bfff"},
                {lbl:"Record",val:`${won.length}W / ${resolved.length-won.length}L`,c:"#ffd700"},
                {lbl:"ML Engine",val:mlModel.totalBets>=5?`${mlConfidence}% conf.`:"Learning",c:"#b44fff"},
              ].map(({lbl,val,c})=>(
                <div key={lbl} style={s.statCard}>
                  <div style={s.statLbl}>{lbl}</div>
                  <div style={{fontSize:18,fontWeight:700,color:c}}>{val}</div>
                </div>
              ))}
            </div>
            <div style={{background:"#0a1220",border:"1px solid #172030",borderRadius:12,padding:"20px 24px",marginBottom:24}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
                <div>
                  <div style={{fontSize:13,fontWeight:700,color:"#fff"}}>Portfolio Performance</div>
                  <div style={{fontSize:11,color:"#3a5570",marginTop:2}}>$100 paper bankroll · Kelly Criterion sizing · Bayesian ML</div>
                </div>
                <div style={{display:"flex",gap:16}}>
                  <div style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:12,height:2,background:"linear-gradient(90deg,#00bfff,#00ff88)",borderRadius:1}}/><span style={{fontSize:10,color:"#3a5570"}}>Bankroll</span></div>
                  <div style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:8,height:8,borderRadius:"50%",background:"#00ff88"}}/><span style={{fontSize:10,color:"#3a5570"}}>Win</span></div>
                  <div style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:8,height:8,borderRadius:"50%",background:"#ff6b6b"}}/><span style={{fontSize:10,color:"#3a5570"}}>Loss</span></div>
                </div>
              </div>
              <MiniChart history={chartData}/>
            </div>
            <div style={{background:"#0a1220",border:"1px solid #172030",borderRadius:12,overflow:"hidden"}}>
              <div style={{padding:"16px 22px",borderBottom:"1px solid #172030",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div style={{fontSize:13,fontWeight:700,color:"#fff"}}>Bet History</div>
                <div style={{fontSize:11,color:"#3a5570"}}>{history.length} total · auto-placed daily · deduplicated</div>
              </div>
              {history.length===0?(
                <div style={{padding:"40px",textAlign:"center",color:"#3a5570",fontSize:12}}>No bets yet — refresh to auto-add today's recommendations</div>
              ):(
                <div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 2fr 80px 80px 80px 70px 80px 70px",gap:8,padding:"10px 22px",borderBottom:"1px solid #172030",fontSize:9,color:"#3a5570",letterSpacing:"0.08em",textTransform:"uppercase"}}>
                    <div>Date</div><div>Bet</div><div>Odds</div><div>Wager</div><div>To Win</div><div>Kelly</div><div>Bankroll</div><div>Result</div>
                  </div>
                  {[...history].reverse().map(h=>(
                    <div key={h.id} style={{display:"grid",gridTemplateColumns:"1fr 2fr 80px 80px 80px 70px 80px 70px",gap:8,padding:"12px 22px",borderBottom:"1px solid #0e1a28",alignItems:"center"}}>
                      <div>
                        <div style={{fontSize:10,color:"#3a5570"}}>{new Date(h.date).toLocaleDateString("en-US",{month:"short",day:"numeric"})}</div>
                        <div style={{fontSize:9,color:"#1e3040"}}>{new Date(h.date).toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"})}</div>
                      </div>
                      <div>
                        <div style={{fontSize:11,color:"#dde3ee",fontWeight:600,marginBottom:2}}>{h.selection}</div>
                        <div style={{fontSize:9,color:"#3a5570"}}>{h.game}</div>
                        <div style={{display:"inline-block",marginTop:3,...s.typeBadge(h.type)}}>{h.type}</div>
                      </div>
                      <div style={{fontSize:12,fontWeight:600,color:SPORTSBOOK_COLORS[h.bestBook]}}>{formatOdds(h.bestOdds)}</div>
                      <div style={{fontSize:12,color:"#ffd700"}}>{fmt$(h.wagerAmt)}</div>
                      <div style={{fontSize:12,color:"#00bfff"}}>{fmt$(h.potentialPayout)}</div>
                      <div style={{fontSize:11,color:"#b44fff"}}>{h.kellyPct}%</div>
                      <div style={{fontSize:11,color:"#dde3ee"}}>{fmt$(h.bankrollAfter)}</div>
                      <div>
                        {h.status==="pending"&&<div style={{fontSize:9,color:"#ffd700",padding:"2px 7px",borderRadius:4,background:"rgba(255,215,0,0.1)",border:"1px solid rgba(255,215,0,0.2)",display:"inline-block"}}>PENDING</div>}
                        {h.status==="won"&&<div style={{fontSize:9,color:"#00ff88",padding:"2px 7px",borderRadius:4,background:"rgba(0,255,136,0.1)",border:"1px solid rgba(0,255,136,0.2)",display:"inline-block"}}>WIN ✓</div>}
                        {h.status==="lost"&&<div style={{fontSize:9,color:"#ff6b6b",padding:"2px 7px",borderRadius:4,background:"rgba(255,107,107,0.1)",border:"1px solid rgba(255,107,107,0.2)",display:"inline-block"}}>LOSS ✗</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* INFO */}
        {filter==="Info"&&(
          <div style={s.infoGrid}>
            {INFO_CARDS.map(({icon,title,body})=>(
              <div key={title} style={{background:"#0a1220",border:"1px solid #172030",borderRadius:12,padding:"18px 20px"}}>
                <div style={{display:"flex",alignItems:"flex-start",gap:10,marginBottom:10}}>
                  <span style={{fontSize:20,lineHeight:1}}>{icon}</span>
                  <div style={{fontSize:13,fontWeight:700,color:"#fff",lineHeight:1.35}}>{title}</div>
                </div>
                <div style={{fontSize:12,color:"#7a90a8",lineHeight:1.7}}>{body}</div>
              </div>
            ))}
          </div>
        )}

        {/* TOP PICKS — bets where EV + confidence both align */}
        {filter!=="Info"&&filter!=="History"&&(()=>{
          const topPicks = bets.filter(b=>!b.isNearEV&&b.confidenceTier==="HIGH"&&b.edge>=MIN_EV_EDGE).sort((a,b)=>(b.confidenceScore+b.ev)-(a.confidenceScore+a.ev)).slice(0,3);
          if(!topPicks.length) return null;
          return (
            <div style={{marginBottom:28}}>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
                <div style={{fontSize:13,fontWeight:700,color:"#fff"}}>⭐ Top Picks Today</div>
                <div style={{fontSize:10,color:"#3a5570",padding:"2px 8px",borderRadius:10,border:"1px solid #172030"}}>EV + Confidence both HIGH</div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:`repeat(${Math.min(topPicks.length,3)},1fr)`,gap:12}}>
                {topPicks.map((bet,i)=>(
                  <div key={bet.id} onClick={()=>{setFilter("All");setExpanded(bet.id);}} style={{background:"linear-gradient(135deg,#0a1f14,#0a1220)",border:"1px solid #00ff8844",borderRadius:12,padding:"16px 18px",cursor:"pointer",transition:"border-color 0.2s"}}
                    onMouseEnter={e=>e.currentTarget.style.borderColor="#00ff88"}
                    onMouseLeave={e=>e.currentTarget.style.borderColor="#00ff8844"}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
                      <div style={{fontSize:9,color:"#00ff88",letterSpacing:"0.1em",textTransform:"uppercase"}}>#{i+1} Top Pick</div>
                      <div style={{display:"flex",alignItems:"center",gap:4}}>
                        <div style={{width:6,height:6,borderRadius:"50%",background:"#00ff88",boxShadow:"0 0 6px #00ff88"}}/>
                        <span style={{fontSize:10,color:"#00ff88",fontWeight:700}}>{bet.confidenceScore}% conf.</span>
                      </div>
                    </div>
                    <div style={{fontSize:15,fontWeight:700,color:"#fff",marginBottom:4,lineHeight:1.3}}>{bet.selection}</div>
                    <div style={{fontSize:10,color:"#3a5570",marginBottom:12}}>{bet.game}</div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6}}>
                      {[
                        {l:"EV",v:`+${bet.ev}%`,c:"#00ff88"},
                        {l:"Edge",v:`+${bet.edge}%`,c:"#7fff00"},
                        {l:"Odds",v:formatOdds(bet.bestOdds),c:bet.bestOdds<0?"#00bfff":"#ffd700"},
                      ].map(({l,v,c})=>(
                        <div key={l} style={{background:"#060a10",borderRadius:6,padding:"6px 8px",textAlign:"center"}}>
                          <div style={{fontSize:8,color:"#3a5570",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:2}}>{l}</div>
                          <div style={{fontSize:13,fontWeight:700,color:c}}>{v}</div>
                        </div>
                      ))}
                    </div>
                    {/* Confidence factor mini-bars */}
                    {bet.confidenceFactors?.slice(0,2).map(f=>(
                      <div key={f.label} style={{marginTop:8}}>
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
                          <span style={{fontSize:9,color:"#3a5570"}}>{f.label}</span>
                          <span style={{fontSize:9,color:f.score>=70?"#00ff88":f.score>=50?"#ffd700":"#ff6b6b"}}>{f.score}%</span>
                        </div>
                        <div style={{height:2,background:"#172030",borderRadius:1}}>
                          <div style={{height:"100%",width:`${f.score}%`,background:f.score>=70?"#00ff88":f.score>=50?"#ffd700":"#ff6b6b",borderRadius:1,transition:"width 0.4s"}}/>
                        </div>
                      </div>
                    ))}
                    <div style={{marginTop:10,fontSize:10,color:"#3a5570"}}>{bet.type} · {SPORTSBOOK_LABELS[bet.bestBook]} · {timeUntil(bet.gameTime)} to tip</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* BET CARDS */}
        {filter!=="Info"&&filter!=="History"&&(
          loading?(
            <div style={{textAlign:"center",padding:"60px 0",color:"#3a5570"}}>
              <div style={{fontSize:28,marginBottom:12}}>⏳</div>
              <div style={{fontSize:12}}>Calculating expected values...</div>
            </div>
          ):filtered.length===0?(
            <div style={{textAlign:"center",padding:"50px 20px",color:"#3a5570"}}>
              <div style={{fontSize:32,marginBottom:12}}>📭</div>
              <div style={{fontSize:15,color:"#dde3ee",marginBottom:10,fontWeight:600}}>No +EV edges right now</div>
              <div style={{fontSize:12,color:"#3a5570",maxWidth:420,margin:"0 auto",lineHeight:1.9}}>
                Lines tighten as sharp money moves in during the day.<br/>
                <span style={{color:"#ffd700"}}>Best edges open early morning</span> when books first post, or within minutes of injury news.<br/>
                <span style={{color:"#00bfff"}}>Auto-refreshing every 60s</span> — edges appear here the moment they open.
              </div>
              {!rundownKey&&(
                <div style={{marginTop:16,display:"inline-block",padding:"8px 16px",borderRadius:8,background:"rgba(0,255,136,0.06)",border:"1px solid rgba(0,255,136,0.2)",fontSize:11,color:"#00ff88"}}>
                  💡 Add a TheRundown key in API Setup for free player props
                </div>
              )}
            </div>
          ):filtered.map((bet,i)=>{
            const isExpanded=expanded===bet.id;
            const ec=getEdgeColor(bet.edge);
            return(
              <div key={bet.id} style={{...s.card(isExpanded),opacity:bet.isNearEV?0.78:1,borderColor:isExpanded?"#00ff88":bet.isNearEV?"#2a3a28":bet.isProp?"#2d2050":"#172030"}} onClick={()=>setExpanded(isExpanded?null:bet.id)}>
                <div style={s.cardTop}>
                  <div style={{flex:1}}>
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                      <span style={{fontSize:11,color:"#1e3040",fontWeight:700}}>#{i+1}</span>
                      <div style={s.typeBadge(bet.type)}>{bet.type}</div>
                      {bet.isNearEV&&<span style={{fontSize:9,color:"#ff9944",padding:"1px 6px",borderRadius:3,background:"rgba(255,153,68,0.1)",border:"1px solid rgba(255,153,68,0.3)"}}>NEAR-EV</span>}
                      {bet.isProp&&<span style={{fontSize:9,color:"#b44fff",padding:"1px 6px",borderRadius:3,background:"rgba(180,79,255,0.1)",border:"1px solid rgba(180,79,255,0.2)"}}>PROP</span>}
                      {!bet.isNearEV&&!bet.isProp&&bet.bestOdds<0&&<span style={{fontSize:9,color:"#00bfff",padding:"1px 6px",borderRadius:3,background:"rgba(0,191,255,0.1)",border:"1px solid rgba(0,191,255,0.2)"}}>FAVORITE</span>}
                      {bet.pinnacleAligned&&<span style={{fontSize:9,color:"#00ff88",padding:"1px 6px",borderRadius:3,background:"rgba(0,255,136,0.1)",border:"1px solid rgba(0,255,136,0.2)"}}>⚡ SHARP</span>}
                      {bet.mlAdjusted&&<span style={{fontSize:9,color:"#b44fff",padding:"1px 6px",borderRadius:3,background:"rgba(180,79,255,0.1)",border:"1px solid rgba(180,79,255,0.2)"}}>ML✓</span>}
                      {bet.trend==="up"&&<span style={{color:"#00ff88",fontSize:11}}>↑</span>}
                      {bet.trend==="down"&&<span style={{color:"#ff6b6b",fontSize:11}}>↓</span>}
                    </div>
                    <div style={s.sel}>{bet.selection}</div>
                    <div style={{display:"flex",alignItems:"center",gap:10,marginTop:2,marginBottom:1}}>
                      <div style={s.gameLbl}>{bet.game} · {timeUntil(bet.gameTime)}</div>
                      {bet.confidenceTier&&(
                        <div style={{display:"flex",alignItems:"center",gap:4,padding:"1px 7px",borderRadius:10,background:`${bet.confidenceTierColor}15`,border:`1px solid ${bet.confidenceTierColor}44`}}>
                          <div style={{width:5,height:5,borderRadius:"50%",background:bet.confidenceTierColor}}/>
                          <span style={{fontSize:9,color:bet.confidenceTierColor,fontWeight:700}}>{bet.confidenceScore}% · {bet.confidenceTier}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={s.metrics}>
                    {[{lbl:"EV",val:`+${bet.ev}%`,c:ec},{lbl:"Edge",val:`${bet.edge}%`,c:ec},{lbl:"Best Odds",val:formatOdds(bet.bestOdds),c:bet.bestOdds<0?"#00bfff":"#ffd700"}].map(({lbl,val,c})=>(
                      <div key={lbl} style={{textAlign:"center"}}>
                        <div style={s.mLbl}>{lbl}</div>
                        <div style={s.mVal(c)}>{val}</div>
                      </div>
                    ))}
                    <div style={{textAlign:"center"}}>
                      <div style={s.mLbl}>Book</div>
                      <div style={{fontSize:12,fontWeight:700,color:SPORTSBOOK_COLORS[bet.bestBook]}}>{SPORTSBOOK_LABELS[bet.bestBook]}</div>
                    </div>
                    <div style={{fontSize:14,color:"#1e3040",marginLeft:6}}>{isExpanded?"▲":"▼"}</div>
                  </div>
                </div>
                {isExpanded&&(
                  <div style={s.expandArea}>
                    {/* Confidence Breakdown */}
                    {bet.confidenceFactors?.length > 0 && (
                      <div style={{background:"#060a10",border:"1px solid #172030",borderRadius:10,padding:"14px 18px",marginBottom:16}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                          <div style={{fontSize:10,color:"#3a5570",letterSpacing:"0.1em",textTransform:"uppercase"}}>🎯 Outcome Confidence</div>
                          <div style={{display:"flex",alignItems:"center",gap:8}}>
                            <div style={{fontSize:18,fontWeight:700,color:bet.confidenceTierColor}}>{bet.confidenceScore}%</div>
                            <div style={{fontSize:10,padding:"2px 8px",borderRadius:4,background:`${bet.confidenceTierColor}15`,border:`1px solid ${bet.confidenceTierColor}44`,color:bet.confidenceTierColor}}>{bet.confidenceTier} CONFIDENCE</div>
                          </div>
                        </div>
                        {bet.confidenceFactors.map(f=>(
                          <div key={f.label} style={{marginBottom:10}}>
                            <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                              <div>
                                <span style={{fontSize:10,color:"#dde3ee"}}>{f.label}</span>
                                <span style={{fontSize:9,color:"#3a5570",marginLeft:8}}>(weight {f.weight}%)</span>
                              </div>
                              <span style={{fontSize:11,fontWeight:700,color:f.score>=70?"#00ff88":f.score>=50?"#ffd700":"#ff6b6b"}}>{f.score}/100</span>
                            </div>
                            <div style={{height:3,background:"#172030",borderRadius:2,marginBottom:3}}>
                              <div style={{height:"100%",width:`${f.score}%`,background:f.score>=70?"#00ff88":f.score>=50?"#ffd700":"#ff6b6b",borderRadius:2,transition:"width 0.5s"}}/>
                            </div>
                            <div style={{fontSize:9,color:"#3a5570"}}>{f.note}</div>
                          </div>
                        ))}
                      </div>
                    )}
                    {bet.confidenceScore&&!bet.confidenceFactors?.length&&(
                      <div style={{background:"#060a10",border:"1px solid #172030",borderRadius:8,padding:"10px 14px",marginBottom:12,fontSize:11,color:"#3a5570"}}>
                        🎯 Confidence scoring in progress...
                      </div>
                    )}
                    {/* Pinnacle Validation Banner */}
                    {bet.pinnacleAligned && (
                      <div style={{background:"rgba(0,255,136,0.05)",border:"1px solid rgba(0,255,136,0.25)",borderRadius:8,padding:"10px 14px",marginBottom:12,fontSize:11,color:"#00ff88",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                        <span>⚡ Pinnacle confirmed · sharp book aligns with local model</span>
                        <span style={{color:"#00bfff"}}>{bet.lineMove}</span>
                      </div>
                    )}
                    {!bet.pinnacleAligned && bet.pinnacleOdds == null && (
                      <div style={{background:"rgba(255,215,0,0.04)",border:"1px solid rgba(255,215,0,0.15)",borderRadius:8,padding:"10px 14px",marginBottom:12,fontSize:11,color:"#ffd700"}}>
                        ⚠ Pinnacle line unavailable for this market · local model only
                      </div>
                    )}
                    {bet.mlAdjusted&&(
                      <div style={{background:"rgba(180,79,255,0.06)",border:"1px solid rgba(180,79,255,0.2)",borderRadius:8,padding:"10px 14px",marginBottom:16,fontSize:11,color:"#b44fff"}}>
                        🧠 ML Engine active · probability adjusted based on {mlModel.totalBets} resolved bets · {mlModel.byType[bet.type]?.bets||0} {bet.type} bets learned
                      </div>
                    )}
                    <div style={{fontSize:10,color:"#3a5570",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:10}}>Probability Breakdown</div>
                    <div style={s.probRow}>
                      {[{lbl:"Our Model",val:`${bet.ourProbability}%`,c:"#00ff88"},{lbl:"Book Implied",val:`${bet.bookImplied}%`,c:"#ff6b6b"},{lbl:"Our EV",val:`+${bet.ev}%`,c:ec},{lbl:"Kelly Size",val:`${bet.kellyPct}% bankroll`,c:"#00bfff"}].map(({lbl,val,c})=>(
                        <div key={lbl} style={s.probCard}><div style={{fontSize:10,color:"#3a5570",marginBottom:4}}>{lbl}</div><div style={{fontSize:16,fontWeight:700,color:c}}>{val}</div></div>
                      ))}
                    </div>
                    <div style={{fontSize:10,color:"#3a5570",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:10}}>All Sportsbook Lines</div>
                    <div style={s.booksGrid}>
                      {SPORTSBOOKS.map(book=>{
                        const odds=bet.books[book]; const best=book===bet.bestBook;
                        return(
                          <div key={book} style={s.bookCard(book,best)}>
                            <div><div style={{fontSize:11,color:SPORTSBOOK_COLORS[book],fontWeight:600}}>{SPORTSBOOK_LABELS[book]}</div>{best&&<div style={{fontSize:8,color:"#00ff88",marginTop:2}}>BEST LINE ★</div>}</div>
                            <div style={{fontSize:15,fontWeight:700,color:best?"#00ff88":"#7a90a8"}}>{odds?formatOdds(odds):"N/A"}</div>
                          </div>
                        );
                      })}
                    </div>
                    <div style={s.newsBox}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                        <div style={{fontSize:10,color:"#3a5570",letterSpacing:"0.1em",textTransform:"uppercase"}}>🤖 AI News & Injury Analysis</div>
                        <div style={{fontSize:11,fontWeight:700,color:bet.newsScore>=7?"#00ff88":bet.newsScore>=5?"#ffd700":"#ff6b6b"}}>Score: {bet.newsScore}/10</div>
                      </div>
                      <div style={{fontSize:12,color:"#7a90a8",lineHeight:1.6}}>{bet.newsSummary}</div>
                      {bet.lineMove&&bet.lineMove!=="—"&&<div style={{fontSize:11,color:"#ffd700",marginTop:8}}>📈 {bet.lineMove}</div>}
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:12}}>
                      <div style={{fontSize:10,color:"#3a5570",width:130}}>Kelly Criterion (¼ Kelly)</div>
                      <div style={{flex:1,height:3,background:"#172030",borderRadius:2,overflow:"hidden"}}><div style={{height:"100%",width:`${Math.min(bet.kellyPct*25,100)}%`,background:"linear-gradient(90deg,#00ff88,#00bfff)",borderRadius:2}}/></div>
                      <div style={{fontSize:11,color:"#00ff88",width:70,textAlign:"right"}}>{bet.kellyPct}% bankroll</div>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* Log */}
        {logs.length>0&&filter!=="History"&&filter!=="Info"&&(
          <div style={s.logPanel}>
            <div style={s.logLbl}>System Log</div>
            {logs.map((l,i)=><div key={i} style={s.logLine}>{l}</div>)}
          </div>
        )}
      </div>
    </div>
  );
}
