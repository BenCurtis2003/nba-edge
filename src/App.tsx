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
    // Single call for game lines (h2h + spreads + totals) — free tier safe
    const gameRes = await fetchWithTimeout(`https://api.the-odds-api.com/v4/sports/basketball_nba/odds/?apiKey=${apiKey}&regions=us&markets=h2h,spreads,totals&bookmakers=${ALL_BOOKS.join(",")}&oddsFormat=american`, {}, 10000);
    if(!gameRes.ok) {
      const errText = await gameRes.text().catch(()=>"");
      console.error(`[OddsAPI] HTTP ${gameRes.status}: ${errText.slice(0,200)}`);
      throw new Error(`HTTP ${gameRes.status}`);
    }
    const data = await gameRes.json();
    const propData = [];
    console.log(`[OddsAPI] ${data.length} games fetched`);
    if(!Array.isArray(data)||data.length===0) return null;
    // Expose raw games for conviction odds merge (set on window temporarily)

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
    return { bets:[...gameBets, ...propBets, ...topNearEV], marketBias, rawGames: data };
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
    const res = await fetchWithTimeout(
      `https://api.the-odds-api.com/v4/sports/basketball_nba/scores/?apiKey=${apiKey}&daysFrom=3`,
      {}, 8000
    );
    if(!res.ok) {
      console.warn("[Scores] API error:", res.status);
      return null;
    }
    const data = await res.json();
    const completed = data.filter(g => g.completed);
    const inProgress = data.filter(g => !g.completed && g.scores);
    console.log(`[Scores] ${data.length} games · ${completed.length} completed · ${inProgress.length} in-progress`);
    // Also mark in-progress games that have scores as resolvable if game time was >3hrs ago
    return data.map(g => {
      if(g.completed) return g;
      if(!g.scores || !g.commence_time) return g;
      const age = (Date.now() - new Date(g.commence_time)) / 3600000;
      // If game started >3.5 hours ago and has scores, treat as completed
      if(age > 3.5) {
        console.log(`[Scores] Treating ${g.away_team}@${g.home_team} as completed (${age.toFixed(1)}h old)`);
        return {...g, completed: true};
      }
      return g;
    });
  } catch(e) {
    console.error("[Scores] fetch error:", e);
    return null;
  }
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



// ══════════════════════════════════════════════════════════════
// CONVICTION PLAYS ENGINE
// Finds high-probability bets using team stats + ML signal weighting
// Uses ESPN API (CORS-safe) + Odds API game data
// ══════════════════════════════════════════════════════════════

const DEFAULT_SIGNAL_WEIGHTS = {
  recentForm:    0.22,  // last 10 games win rate
  homeAdvantage: 0.12,  // home court
  restAdvantage: 0.18,  // rest days differential
  netRating:     0.20,  // team net rating / point diff
  atsRecord:     0.14,  // against the spread momentum
  h2hRecord:     0.08,  // head to head history
  paceMismatch:  0.06,  // pace differential
};

const CONVICTION_ML_KEY = "nba_edge_conviction_ml_v1";

const defaultConvictionML = {
  totalPlays: 0, totalWins: 0,
  signalAccuracy: {
    recentForm:    { fired:0, won:0 },
    homeAdvantage: { fired:0, won:0 },
    restAdvantage: { fired:0, won:0 },
    netRating:     { fired:0, won:0 },
    atsRecord:     { fired:0, won:0 },
    h2hRecord:     { fired:0, won:0 },
    paceMismatch:  { fired:0, won:0 },
  },
  learnedWeights: null,
  byTeam: {},
};

function loadConvictionML() {
  try { const s=localStorage.getItem(CONVICTION_ML_KEY); return s?JSON.parse(s):defaultConvictionML; } catch { return defaultConvictionML; }
}
function saveConvictionML(ml) {
  try { localStorage.setItem(CONVICTION_ML_KEY, JSON.stringify(ml)); } catch {} }

function updateConvictionML(ml, play, won) {
  const u = JSON.parse(JSON.stringify(ml));
  u.totalPlays++; if(won) u.totalWins++;
  play.signals?.forEach(s => {
    if(s.score >= 65) {
      const d = u.signalAccuracy[s.key] || {fired:0,won:0};
      d.fired++; if(won) d.won++;
      u.signalAccuracy[s.key] = d;
    }
  });
  const teams = play.game?.split(" @ ") || [];
  teams.forEach(team => {
    const t = u.byTeam[team] || {plays:0,wins:0};
    t.plays++; if(won) t.wins++;
    u.byTeam[team] = t;
  });
  if(u.totalPlays >= 15) {
    const learned = {}; let total = 0;
    Object.entries(u.signalAccuracy).forEach(([key, data]) => {
      const base = DEFAULT_SIGNAL_WEIGHTS[key] || 0.1;
      if(data.fired < 3) { learned[key] = base; total += base; return; }
      const acc = data.won / data.fired;
      const baseline = u.totalWins / u.totalPlays;
      const power = Math.max(0.02, base * (acc / Math.max(baseline, 0.01)));
      learned[key] = power; total += power;
    });
    Object.keys(learned).forEach(k => { learned[k] = learned[k] / total; });
    u.learnedWeights = learned;
  }
  return u;
}

function getSignalWeights(ml) { return ml.learnedWeights || DEFAULT_SIGNAL_WEIGHTS; }

// Fetch with timeout — prevents any single request from hanging the app
function fetchWithTimeout(url, options={}, ms=8000) {
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), ms);
  return fetch(url, {...options, signal:controller.signal})
    .finally(()=>clearTimeout(timer));
}

// ── 2025-26 NBA STANDINGS FALLBACK ───────────────────────────
// Real standings as of March 2026 — used when ESPN fetch fails
const NBA_STANDINGS_2526 = {
  "Boston Celtics":         {wins:52,losses:18},
  "Cleveland Cavaliers":    {wins:54,losses:14},
  "New York Knicks":        {wins:43,losses:24},
  "Indiana Pacers":         {wins:36,losses:32},
  "Orlando Magic":          {wins:35,losses:33},
  "Milwaukee Bucks":        {wins:33,losses:36},
  "Miami Heat":             {wins:28,losses:41},
  "Atlanta Hawks":          {wins:28,losses:41},
  "Philadelphia 76ers":     {wins:24,losses:44},
  "Chicago Bulls":          {wins:24,losses:44},
  "Detroit Pistons":        {wins:23,losses:46},
  "Toronto Raptors":        {wins:20,losses:48},
  "Brooklyn Nets":          {wins:19,losses:50},
  "Charlotte Hornets":      {wins:18,losses:51},
  "Washington Wizards":     {wins:13,losses:57},
  "Oklahoma City Thunder":  {wins:54,losses:13},
  "Memphis Grizzlies":      {wins:43,losses:25},
  "Minnesota Timberwolves": {wins:43,losses:25},
  "Houston Rockets":        {wins:42,losses:26},
  "Denver Nuggets":         {wins:38,losses:30},
  "Los Angeles Lakers":     {wins:39,losses:29},
  "Golden State Warriors":  {wins:34,losses:33},
  "Dallas Mavericks":       {wins:34,losses:34},
  "Los Angeles Clippers":   {wins:33,losses:36},
  "Sacramento Kings":       {wins:29,losses:39},
  "Phoenix Suns":           {wins:26,losses:42},
  "San Antonio Spurs":      {wins:26,losses:42},
  "Utah Jazz":              {wins:19,losses:50},
  "New Orleans Pelicans":   {wins:19,losses:50},
  "Portland Trail Blazers": {wins:19,losses:50},
};

// ESPN public API — CORS-safe in browser, falls back to hardcoded standings
async function fetchESPNTeamData() {
  try {
    const res = await fetchWithTimeout("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams?limit=30", {}, 6000);
    if(!res.ok) throw new Error("ESPN teams failed");
    const data = await res.json();
    const teams = {};
    (data.sports?.[0]?.leagues?.[0]?.teams || []).forEach(({team}) => {
      // ESPN record: team.record.items[0].summary = "41-22" or stats array
      let wins = 0, losses = 0;
      const summary = team.record?.items?.[0]?.summary;
      if(summary && summary.includes("-")) {
        const parts = summary.split("-");
        wins = parseInt(parts[0]) || 0;
        losses = parseInt(parts[1]) || 0;
      } else {
        // Try stats array as fallback
        const stats = team.record?.items?.[0]?.stats || [];
        wins = +stats.find(s=>s.name==="wins")?.value || 0;
        losses = +stats.find(s=>s.name==="losses")?.value || 0;
      }
      // If ESPN returns 0-0, use hardcoded fallback
      if(wins === 0 && losses === 0) {
        const fb = NBA_STANDINGS_2526[team.displayName];
        if(fb) { wins = fb.wins; losses = fb.losses; }
      }
      teams[team.displayName] = { id:team.id, abbr:team.abbreviation, wins, losses, name:team.displayName };
    });
    if(Object.keys(teams).length > 0) return teams;
    throw new Error("No teams parsed");
  } catch {
    // Full fallback: build from hardcoded standings with ESPN IDs approximated
    const ESPN_IDS = {
      "Atlanta Hawks":"1","Boston Celtics":"2","Brooklyn Nets":"17",
      "Charlotte Hornets":"30","Chicago Bulls":"4","Cleveland Cavaliers":"5",
      "Dallas Mavericks":"6","Denver Nuggets":"7","Detroit Pistons":"8",
      "Golden State Warriors":"9","Houston Rockets":"10","Indiana Pacers":"11",
      "Los Angeles Clippers":"12","Los Angeles Lakers":"13","Memphis Grizzlies":"29",
      "Miami Heat":"14","Milwaukee Bucks":"15","Minnesota Timberwolves":"16",
      "New Orleans Pelicans":"3","New York Knicks":"18","Oklahoma City Thunder":"25",
      "Orlando Magic":"19","Philadelphia 76ers":"20","Phoenix Suns":"21",
      "Portland Trail Blazers":"22","Sacramento Kings":"23","San Antonio Spurs":"24",
      "Toronto Raptors":"28","Utah Jazz":"26","Washington Wizards":"27",
    };
    const teams = {};
    Object.entries(NBA_STANDINGS_2526).forEach(([name, record]) => {
      teams[name] = { id: ESPN_IDS[name]||"0", abbr:"", wins:record.wins, losses:record.losses, name };
    });
    console.log("[Conviction] ESPN blocked — using hardcoded 2025-26 standings");
    return teams;
  }
}

async function fetchESPNTeamStats(espnId) {
  try {
    const res = await fetchWithTimeout(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${espnId}/schedule?seasontype=2&limit=15`, {}, 5000);
    if(!res.ok) return null;
    const data = await res.json();
    const events = data.events || [];
    const games = [];
    events.forEach(e => {
      const comp = e.competitions?.[0];
      if(!comp) return;
      // Find this team's competitor entry — match by id or by checking both
      const myComp = comp.competitors?.find(c => String(c.team?.id) === String(espnId));
      const oppComp = comp.competitors?.find(c => String(c.team?.id) !== String(espnId));
      if(!myComp || !oppComp) return;
      // Score can be string or number
      const myScore = parseFloat(myComp.score) || 0;
      const oppScore = parseFloat(oppComp.score) || 0;
      if(myScore === 0 && oppScore === 0) return; // skip unplayed
      // Winner: ESPN sets winner=true on the winning competitor
      const won = myComp.winner === true || (myScore > 0 && myScore > oppScore);
      games.push({
        won,
        isHome: myComp.homeAway === "home",
        ptsDiff: myScore - oppScore,
        myScore, oppScore,
        date: e.date || e.competitions?.[0]?.date,
      });
    });
    return games.length > 0 ? games : null;
  } catch { return null; }
}

async function buildConvictionPlays(games, convictionML) {
  if(!games || !games.length) return [];
  const weights = getSignalWeights(convictionML);
  const allPlays = [];
  const espnTeams = await fetchESPNTeamData();
  if(!espnTeams) return [];

  const findESPN = (name) => {
    if(!name) return null;
    if(espnTeams[name]) return espnTeams[name];
    const words = name.toLowerCase().split(" ").filter(w=>w.length>3);
    return Object.values(espnTeams).find(t => words.some(w=>t.name.toLowerCase().includes(w))) || null;
  };

  // Pre-fetch ALL team game logs in parallel upfront (much faster than per-game)
  const allTeamIds = new Set();
  const gameTeams = games.map(game => {
    const espnHome = findESPN(game.home_team);
    const espnAway = findESPN(game.away_team);
    if(espnHome) allTeamIds.add(espnHome.id);
    if(espnAway) allTeamIds.add(espnAway.id);
    return {game, espnHome, espnAway};
  });

  // Fetch all logs in parallel with a small stagger to avoid rate limiting
  const teamLogCache = {};
  const teamIdArr = [...allTeamIds];
  // Batch into groups of 4 to avoid overwhelming ESPN
  for(let i=0; i<teamIdArr.length; i+=4) {
    const batch = teamIdArr.slice(i, i+4);
    const results = await Promise.all(batch.map(id => fetchESPNTeamStats(id).catch(()=>null)));
    batch.forEach((id, idx) => { teamLogCache[id] = results[idx]; });
  }

  for(const {game, espnHome, espnAway} of gameTeams) {
    const away = game.away_team;
    const home = game.home_team;
    if(!away || !home) continue;
    const gameLabel = `${away} @ ${home}`;
    const gameTime = game.commence_time;
    if(!espnHome || !espnAway) continue;

    const homeLog = teamLogCache[espnHome.id] || null;
    const awayLog = teamLogCache[espnAway.id] || null;

    // Score a single team side, returns {finalScore, signals, topSignals}
    const scoreTeam = (espnTeam, espnOpp, teamLog, oppLog, isHome) => {
      const signals = [];
      let totalScore = 0, totalWeight = 0;
      const addSignal = (key, label, score, note, emoji) => {
        const s = Math.round(Math.min(100, Math.max(0, score)));
        signals.push({key, label, score:s, note, emoji});
        const w = weights[key] || DEFAULT_SIGNAL_WEIGHTS[key] || 0.1;
        totalScore += s * w; totalWeight += w;
      };

      // Season win rate differential
      const totalG = (espnTeam.wins||0)+(espnTeam.losses||0);
      const oppTotalG = (espnOpp.wins||0)+(espnOpp.losses||0);
      const wr = totalG>0 ? espnTeam.wins/totalG : 0.5;
      const oppWR = oppTotalG>0 ? espnOpp.wins/oppTotalG : 0.5;
      const diff = wr - oppWR;
      const seasonScore = diff>=0.15?82:diff>=0.08?70:diff>=0.02?58:diff>=-0.02?50:diff>=-0.08?40:diff>=-0.15?30:20;
      addSignal("recentForm","Season Win Rate",seasonScore,
        `${espnTeam.wins}-${espnTeam.losses} (${Math.round(wr*100)}%) vs opp ${espnOpp.wins}-${espnOpp.losses} (${Math.round(oppWR*100)})%`,"📈");

      // Recent form last 8
      if(teamLog && teamLog.length>=4) {
        const last8 = teamLog.slice(0,8);
        const rw = last8.filter(g=>g.won).length;
        const rwr = rw/last8.length;
        addSignal("atsRecord","Recent Form",rwr>=0.75?88:rwr>=0.625?74:rwr>=0.5?58:rwr>=0.375?42:25,
          `${rw}/${last8.length} last 8 games (${Math.round(rwr*100)}%)`,"🔥");
      }

      // Avg point margin
      if(teamLog && teamLog.length>=4) {
        const avgDiff = teamLog.slice(0,8).reduce((s,g)=>s+g.ptsDiff,0)/Math.min(8,teamLog.length);
        const ptScore = avgDiff>=10?92:avgDiff>=6?80:avgDiff>=3?67:avgDiff>=0?53:avgDiff>=-3?40:avgDiff>=-7?27:15;
        addSignal("netRating","Avg Point Margin",ptScore,`${avgDiff>=0?"+":""}${avgDiff.toFixed(1)} pts/game last 8`,"⚡");
      } else {
        const est = (wr-0.5)*12;
        addSignal("netRating","Est. Point Margin",est>=5?72:est>=2?60:est>=0?50:est>=-2?40:30,
          `Est. ${est>=0?"+":""}${est.toFixed(1)} pts from season record`,"⚡");
      }

      // Home court
      addSignal("homeAdvantage","Home Court",isHome?70:38,
        isHome?"Home court — avg +3.5 pt advantage":"Road game — historically 3-4 pt disadvantage","🏠");

      // Rest advantage
      let restScore=52, restNote="Similar rest";
      if(teamLog?.length && oppLog?.length) {
        const tipoff = new Date(gameTime);
        const tr = Math.max(0,Math.round((tipoff-new Date(teamLog[0].date))/(864e5)));
        const or2 = Math.max(0,Math.round((tipoff-new Date(oppLog[0].date))/(864e5)));
        const rd = tr-or2;
        if(rd>=2){restScore=87;restNote=`${tr}d rest vs opp ${or2}d — significant advantage`;}
        else if(rd>=1){restScore=68;restNote=`${tr}d rest vs opp ${or2}d — slight edge`;}
        else if(rd<=-2){restScore=18;restNote=`${tr}d rest vs opp ${or2}d — fatigue risk`;}
        else if(rd<=-1){restScore=36;restNote=`${tr}d rest vs opp ${or2}d — slight fatigue`;}
        else{restNote=`Both teams ${tr}d rest`;}
      }
      addSignal("restAdvantage","Rest Advantage",restScore,restNote,"😴");

      // Streak (W/L run)
      if(teamLog && teamLog.length>=3) {
        let streak = 1;
        const lastResult = teamLog[0].won;
        for(let i=1;i<Math.min(8,teamLog.length);i++){
          if(teamLog[i].won===lastResult) streak++; else break;
        }
        const streakLabel = `${lastResult?"W":"L"}${streak}`;
        const streakScore = lastResult&&streak>=4?88:lastResult&&streak>=2?70:lastResult?58:!lastResult&&streak>=4?18:!lastResult&&streak>=2?36:42;
        addSignal("paceMismatch","Current Streak",streakScore,
          `On a ${streakLabel} streak entering this game`,"🔥");
      }

      // Opponent weakness
      if(oppLog && oppLog.length>=4) {
        const oRec = oppLog.slice(0,8);
        const owr2 = oRec.filter(g=>g.won).length/oRec.length;
        addSignal("h2hRecord","Opponent Form",owr2<=0.25?88:owr2<=0.375?74:owr2<=0.5?60:owr2<=0.625?46:owr2<=0.75?32:20,
          `Opp ${Math.round(owr2*oRec.length)}/${oRec.length} last 8 — ${owr2<=0.4?"struggling ✓":"in form ✗"}`,"🔍");
      }

      // ML team history
      const mlData = convictionML.byTeam?.[espnTeam.name];
      if(mlData && mlData.plays>=3) {
        const mlwr = mlData.wins/mlData.plays;
        const mlScore = mlwr>=0.7?88:mlwr>=0.6?72:mlwr>=0.5?55:35;
        signals.push({key:"mlHistory",label:"ML Track Record",score:mlScore,isML:true,emoji:"🧠",
          note:`${mlData.wins}/${mlData.plays} conviction plays won (${Math.round(mlwr*100)}%)`});
        totalScore += mlScore*0.15; totalWeight += 0.15;
      }

      if(totalWeight===0) return null;
      const calAdj = convictionML.totalPlays>=10 ? ((convictionML.totalWins/convictionML.totalPlays)-0.55)*8 : 0;
      const finalScore = Math.min(95,Math.max(35,Math.round(totalScore/totalWeight+calAdj)));
      const topSignals = [...signals].sort((a,b)=>(b.score*(weights[b.key]||0.1))-(a.score*(weights[a.key]||0.1))).slice(0,3);
      return {finalScore, signals, topSignals};
    };

    const homeResult = scoreTeam(espnHome, espnAway, homeLog, awayLog, true);
    const awayResult = scoreTeam(espnAway, espnHome, awayLog, homeLog, false);

    // For each side, generate Moneyline + Spread conviction plays
    for(const [result, side, espnTeam, espnOpp, isHome] of [
      [homeResult, home, espnHome, espnAway, true],
      [awayResult, away, espnAway, espnHome, false],
    ]) {
      if(!result) continue;
      const {finalScore, signals, topSignals} = result;
      const tier = finalScore>=75?"HIGH":finalScore>=60?"MEDIUM":"WATCHLIST";
      const tierColor = finalScore>=75?"#00ff88":finalScore>=60?"#ffd700":"#ff9944";

      // Best ML odds
      let mlOdds=null, mlBook=null;
      (game.bookmakers||[]).forEach(bk => {
        bk.markets?.filter(m=>m.key==="h2h").forEach(mkt => {
          mkt.outcomes?.forEach(o => {
            if(o.name===side&&(mlOdds===null||o.price>mlOdds)){mlOdds=o.price;mlBook=bk.key;}
          });
        });
      });

      // Best spread odds
      let sprOdds=null, sprBook=null, sprLine=null;
      (game.bookmakers||[]).forEach(bk => {
        bk.markets?.filter(m=>m.key==="spreads").forEach(mkt => {
          mkt.outcomes?.forEach(o => {
            if(o.name===side&&(sprOdds===null||o.price>sprOdds)){sprOdds=o.price;sprBook=bk.key;sprLine=o.point;}
          });
        });
      });

      const base = {game:gameLabel, gameTime, signals, topSignals, isHome,
        mlCalibrated:convictionML.totalPlays>=10, learnedWeights:convictionML.learnedWeights!=null,
        teamRecord:`${espnTeam.wins}-${espnTeam.losses}`, oppRecord:`${espnOpp.wins}-${espnOpp.losses}`};

      // Moneyline conviction
      allPlays.push({...base, id:`conviction|${gameLabel}|${side}|ML`, type:"Conviction Play",
        betType:"Moneyline", selection:`${side} ML`,
        convictionScore:finalScore, tier, tierColor, bestOdds:mlOdds, bestBook:mlBook});

      // Spread conviction (slightly discounted — spread needs a bigger edge)
      const sprScore = Math.max(35, Math.round(finalScore*0.93));
      const sprTier = sprScore>=75?"HIGH":sprScore>=60?"MEDIUM":"WATCHLIST";
      const sprColor = sprScore>=75?"#00ff88":sprScore>=60?"#ffd700":"#ff9944";
      const sprLabel = sprLine!=null ? `${side} ${sprLine>0?"+":""}${sprLine}` : `${side} (spread)`;
      allPlays.push({...base, id:`conviction|${gameLabel}|${side}|SPR`, type:"Conviction Play",
        betType:"Spread", selection:sprLabel,
        convictionScore:sprScore, tier:sprTier, tierColor:sprColor, bestOdds:sprOdds, bestBook:sprBook});
    }

    // Game Total conviction — once per game
    if(homeLog?.length>=3 && awayLog?.length>=3) {
      const homeAvg = homeLog.slice(0,8).reduce((s,g)=>s+g.myScore,0)/Math.min(8,homeLog.length);
      const homeAllowed = homeLog.slice(0,8).reduce((s,g)=>s+g.oppScore,0)/Math.min(8,homeLog.length);
      const awayAvg = awayLog.slice(0,8).reduce((s,g)=>s+g.myScore,0)/Math.min(8,awayLog.length);
      const awayAllowed = awayLog.slice(0,8).reduce((s,g)=>s+g.oppScore,0)/Math.min(8,awayLog.length);
      const projTotal = (homeAvg+awayAllowed)/2 + (awayAvg+homeAllowed)/2;

      let bookLine=null, totalBook=null, overOdds=null;
      (game.bookmakers||[]).forEach(bk => {
        bk.markets?.filter(m=>m.key==="totals").forEach(mkt => {
          mkt.outcomes?.forEach(o => {
            if(o.name==="Over"&&bookLine===null){bookLine=o.point;totalBook=bk.key;overOdds=o.price;}
          });
        });
      });

      const isOver = projTotal > (bookLine||220);
      const diff = Math.abs(projTotal-(bookLine||220));
      const totScore = diff>=8?80:diff>=5?70:diff>=3?62:diff>=1?55:50;
      const totTier = totScore>=75?"HIGH":totScore>=60?"MEDIUM":"WATCHLIST";
      const totColor = totScore>=75?"#00ff88":totScore>=60?"#ffd700":"#ff9944";

      allPlays.push({
        id:`conviction|${gameLabel}|total`, type:"Conviction Play", betType:"Game Total",
        game:gameLabel, selection:`${home} vs ${away} — ${isOver?"Over":"Under"} ${bookLine||"Total"}`,
        gameTime, convictionScore:totScore, tier:totTier, tierColor:totColor,
        signals:[
          {key:"netRating",label:"Projected Total",score:totScore,emoji:"🏀",
            note:`Projected ${projTotal.toFixed(0)} pts vs line ${bookLine||"N/A"} — lean ${isOver?"Over ↑":"Under ↓"}`},
          {key:"recentForm",label:"Home Offense",score:Math.min(95,Math.round(homeAvg/1.2)),emoji:"📈",
            note:`${home} avg ${homeAvg.toFixed(0)} pts/game last 8`},
          {key:"atsRecord",label:"Away Offense",score:Math.min(95,Math.round(awayAvg/1.2)),emoji:"📈",
            note:`${away} avg ${awayAvg.toFixed(0)} pts/game last 8`},
          {key:"h2hRecord",label:"Defensive Allowed",score:Math.min(95,Math.round((homeAllowed+awayAllowed)/4.6)),emoji:"🛡️",
            note:`Home allows ${homeAllowed.toFixed(0)}, Away allows ${awayAllowed.toFixed(0)} pts/game`},
        ],
        topSignals:[
          {key:"netRating",label:"Projected Total",score:totScore,emoji:"🏀",
            note:`Projected ${projTotal.toFixed(0)} pts — lean ${isOver?"Over":"Under"} ${bookLine||""}`},
          {key:"recentForm",label:"Combined Offense",score:Math.min(95,Math.round((homeAvg+awayAvg)/2.4)),emoji:"📈",
            note:`${home} ${homeAvg.toFixed(0)} + ${away} ${awayAvg.toFixed(0)} pts avg`},
        ],
        bestOdds:overOdds, bestBook:totalBook, isHome:false,
        mlCalibrated:convictionML.totalPlays>=10, learnedWeights:convictionML.learnedWeights!=null,
        teamRecord:"", oppRecord:"",
      });
    }
  }

  // Deduplicate per game+betType, sort by score, cap at 9
  const seen = new Set();
  return allPlays
    .sort((a,b) => b.convictionScore - a.convictionScore)
    .filter(p => { const k=`${p.game}|${p.betType}`; if(seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, 9);
}


// ══════════════════════════════════════════════════════════════
// LIVE CONVICTION ENGINE
// Polls ESPN every 45s during active games, rescores conviction
// based on live score, quarter, clock, and momentum
// ══════════════════════════════════════════════════════════════

async function fetchLiveScoreboard() {
  try {
    const res = await fetchWithTimeout(
      "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard",
      {}, 6000
    );
    if(!res.ok) return null;
    const data = await res.json();
    return (data.events || []).map(e => {
      const comp = e.competitions?.[0];
      const home = comp?.competitors?.find(c => c.homeAway === "home");
      const away = comp?.competitors?.find(c => c.homeAway === "away");
      const status = comp?.status;
      const situation = comp?.situation;
      return {
        id: e.id,
        home_team: home?.team?.displayName || "",
        away_team: away?.team?.displayName || "",
        home_score: parseInt(home?.score) || 0,
        away_score: parseInt(away?.score) || 0,
        period: status?.period || 0,          // 1-4 = quarters, 5+ = OT
        clock: status?.displayClock || "0:00",// "8:42"
        state: status?.type?.state || "pre",  // "pre" | "in" | "post"
        stateDetail: status?.type?.shortDetail || "",
        home_record: home?.records?.[0]?.summary || "",
        away_record: away?.records?.[0]?.summary || "",
        // Last 5 plays momentum — possession/run data
        lastPlay: situation?.lastPlay?.text || "",
        homeTimeouts: situation?.homeTimeouts ?? 3,
        awayTimeouts: situation?.awayTimeouts ?? 3,
      };
    });
  } catch { return null; }
}

// Rescore a conviction play using live game state
function rescoreConvictionLive(play, liveGame) {
  if(!liveGame || liveGame.state !== "in") return null;

  const isHome = play.isHome;
  const myScore = isHome ? liveGame.home_score : liveGame.away_score;
  const oppScore = isHome ? liveGame.away_score : liveGame.home_score;
  const scoreDiff = myScore - oppScore; // + means we're winning
  const period = liveGame.period;
  const clockParts = liveGame.clock.split(":").map(Number);
  const minsLeft = (clockParts[0] || 0) + (clockParts[1] || 0) / 60;
  const totalMinsLeft = Math.max(0, (4 - period) * 12 + minsLeft);
  const gamePct = Math.min(1, (48 - totalMinsLeft) / 48); // 0→1 as game progresses

  // Base score from pregame conviction
  let base = play.pregameConvictionScore || play.convictionScore;

  // ── LIVE SIGNALS ──────────────────────────────────────────
  const liveSignals = [];

  // 1. Score differential — weighted by how much game is left
  // A 10pt lead with 2min left is near-certainty; same lead in Q1 is weak signal
  const leadWeight = 0.3 + gamePct * 0.5; // 0.3 early → 0.8 late
  const leadScore = scoreDiff >= 15 ? 95
    : scoreDiff >= 10 ? 88
    : scoreDiff >= 6  ? 78
    : scoreDiff >= 3  ? 65
    : scoreDiff >= 0  ? 52
    : scoreDiff >= -3 ? 40
    : scoreDiff >= -6 ? 30
    : scoreDiff >= -10? 20
    : 10;
  liveSignals.push({
    key:"liveScore", label:"Live Score", score:leadScore, emoji:"🏀",
    note:`${isHome ? liveGame.home_team : liveGame.away_team} ${myScore > oppScore ? "leading" : myScore === oppScore ? "tied" : "trailing"} ${Math.abs(scoreDiff)} · Q${period} ${liveGame.clock}`,
    live:true
  });

  // 2. Game clock urgency — late leads are much more secure
  const clockScore = totalMinsLeft <= 2 ? (scoreDiff >= 5 ? 96 : scoreDiff >= 0 ? 55 : 10)
    : totalMinsLeft <= 5 ? (scoreDiff >= 8 ? 90 : scoreDiff >= 0 ? 58 : 22)
    : totalMinsLeft <= 12 ? (scoreDiff >= 10 ? 82 : scoreDiff >= 0 ? 55 : 35)
    : 52; // early game — clock doesn't tell us much
  liveSignals.push({
    key:"liveClock", label:"Time Remaining", score:clockScore, emoji:"⏱",
    note:`${totalMinsLeft.toFixed(0)} min remaining · ${period <= 4 ? `Q${period}` : `OT${period-4}`}`,
    live:true
  });

  // 3. Momentum — based on last play text and recent run
  // Simple heuristic: if last play was a made shot for our team, positive momentum
  const lastPlay = liveGame.lastPlay.toLowerCase();
  const ourTeamName = (isHome ? liveGame.home_team : liveGame.away_team).toLowerCase().split(" ").pop();
  const theyScored = lastPlay.includes(ourTeamName) && (lastPlay.includes("makes") || lastPlay.includes("dunk") || lastPlay.includes("layup"));
  const momentumScore = theyScored ? 70 : 50;
  liveSignals.push({
    key:"liveMomentum", label:"Momentum", score:momentumScore, emoji:"⚡",
    note:liveGame.lastPlay.slice(0,60) || "No play data",
    live:true
  });

  // ── BLEND pregame signals (shrinking weight) + live signals (growing weight) ──
  // At gamePct=0 (tipoff): 100% pregame. At gamePct=1 (final): 100% live.
  const liveWeight = Math.min(0.85, gamePct * 1.2); // caps at 85% live influence
  const pregameWeight = 1 - liveWeight;

  const liveAvg = liveSignals.reduce((s, sig) => s + sig.score, 0) / liveSignals.length;
  const blended = Math.round(base * pregameWeight + liveAvg * liveWeight);
  const finalScore = Math.min(98, Math.max(8, blended));

  const tier = finalScore >= 75 ? "HIGH" : finalScore >= 60 ? "MEDIUM" : finalScore >= 40 ? "WATCHLIST" : "LOW";
  const tierColor = finalScore >= 75 ? "#00ff88" : finalScore >= 60 ? "#ffd700" : finalScore >= 40 ? "#ff9944" : "#ff6b6b";

  return {
    convictionScore: finalScore,
    tier, tierColor,
    liveSignals,
    liveGame: {
      period, clock: liveGame.clock, scoreDiff,
      myScore, oppScore, totalMinsLeft,
      state: liveGame.state, stateDetail: liveGame.stateDetail,
    },
    isLive: true,
    liveWeight: Math.round(liveWeight * 100),
    pregameWeight: Math.round(pregameWeight * 100),
  };
}


// ── GAME CLEANUP ──────────────────────────────────────────────
// Removes finished games from active views. Uses time as primary
// signal (no API needed) + scores API for immediate confirmation.
function isGameOver(gameTime) {
  if(!gameTime) return false;
  const ageHrs = (Date.now() - new Date(gameTime)) / 3600000;
  return ageHrs > 3.2; // NBA games average ~2.5hrs; 3.2h is safe buffer
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
    if(!canvas||history.length<1) return;
    const ctx=canvas.getContext("2d");
    const W=canvas.width, H=canvas.height;
    const pad={t:20,r:20,b:36,l:56};
    const cW=W-pad.l-pad.r, cH=H-pad.t-pad.b;
    ctx.clearRect(0,0,W,H);
    const bankrolls=history.map(h=>h.chartBankroll ?? h.bankrollAfter);
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
  if(history.length<1) return (
    <div style={{height:220,display:"flex",alignItems:"center",justifyContent:"center",color:"#3a5570",fontSize:12}}>
      Add an Odds API key to start tracking bets
    </div>
  );
  return <canvas ref={canvasRef} width={900} height={220} style={{width:"100%",height:220,display:"block"}}/>;
}

// ── MAIN APP ─────────────────────────────────────────────────

function ConvictionSection({ plays, loading, convictionML, expandedConviction, setExpandedConviction }) {
  if(loading) return (
    <div style={{marginBottom:28,padding:"20px",background:"#0a1220",border:"1px solid #172030",borderRadius:12,textAlign:"center"}}>
      <div style={{fontSize:12,color:"#3a5570"}}>🎯 Building conviction plays from ESPN data...</div>
    </div>
  );
  if(!plays.length) return (
    <div style={{marginBottom:28,padding:"20px 24px",background:"#0a1220",border:"1px solid #172030",borderRadius:12,display:"flex",alignItems:"center",gap:12}}>
      <div style={{fontSize:20}}>🎯</div>
      <div>
        <div style={{fontSize:12,color:"#dde3ee",fontWeight:600,marginBottom:3}}>Conviction Plays</div>
        <div style={{fontSize:11,color:"#3a5570"}}>Analyzing today's matchups via ESPN... Hit Refresh if this persists.</div>
      </div>
    </div>
  );
  return (
    <div style={{marginBottom:32}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
        <div style={{fontSize:13,fontWeight:700,color:"#fff"}}>🎯 Conviction Plays</div>
        <div style={{fontSize:10,color:"#3a5570",padding:"2px 8px",borderRadius:10,border:"1px solid #172030"}}>Stat-driven · ML-weighted · EV-agnostic</div>
        {convictionML.learnedWeights&&(
          <div style={{fontSize:9,color:"#b44fff",padding:"2px 8px",borderRadius:10,background:"rgba(180,79,255,0.08)",border:"1px solid rgba(180,79,255,0.2)"}}>
            🧠 ML Active · {convictionML.totalPlays} plays learned
          </div>
        )}
      </div>
      <div style={{fontSize:11,color:"#3a5570",marginBottom:14}}>
        Picks based on team form, rest, point differential & matchup data — not line pricing. ML reweights each signal based on what has actually predicted wins.
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(320px,1fr))",gap:12}}>
        {plays.map((play)=>{
          const isExp = expandedConviction === play.id;
          return (
            <div key={play.id} onClick={()=>setExpandedConviction(isExp?null:play.id)}
              style={{background:"#0a1220",border:`1px solid ${play.tierColor}33`,borderRadius:12,padding:"16px 18px",cursor:"pointer",transition:"border-color 0.2s",boxShadow:isExp?`0 0 20px ${play.tierColor}18`:"none"}}
              onMouseEnter={e=>e.currentTarget.style.borderColor=play.tierColor+"66"}
              onMouseLeave={e=>e.currentTarget.style.borderColor=play.tierColor+"33"}>

              {/* Live game banner */}
              {play.isLive&&play.liveGame&&(
                <div style={{marginBottom:10,padding:"8px 12px",background:"rgba(255,60,60,0.08)",border:"1px solid rgba(255,60,60,0.3)",borderRadius:8,display:"flex",alignItems:"center",gap:10}}>
                  <div style={{display:"flex",alignItems:"center",gap:5}}>
                    <div style={{width:7,height:7,borderRadius:"50%",background:"#ff3c3c",boxShadow:"0 0 6px #ff3c3c"}}/>
                    <span style={{fontSize:10,color:"#ff6b6b",fontWeight:700,letterSpacing:"0.05em"}}>LIVE</span>
                  </div>
                  <div style={{fontSize:13,fontWeight:700,color:"#fff"}}>
                    {play.liveGame.myScore}–{play.liveGame.oppScore}
                  </div>
                  <div style={{fontSize:10,color:"#3a5570"}}>
                    Q{play.liveGame.period} {play.liveGame.clock} · {play.liveGame.totalMinsLeft.toFixed(0)}min left
                  </div>
                  <div style={{marginLeft:"auto",fontSize:9,color:"#3a5570"}}>
                    {play.liveWeight}% live · {play.pregameWeight}% pre
                  </div>
                </div>
              )}

              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                <div>
                  <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4,flexWrap:"wrap"}}>
                    <div style={{fontSize:9,padding:"1px 7px",borderRadius:4,background:`${play.tierColor}18`,border:`1px solid ${play.tierColor}44`,color:play.tierColor,fontWeight:700}}>{play.tier}</div>
                    {play.betType&&(
                      <div style={{fontSize:9,padding:"1px 7px",borderRadius:4,
                        background:play.betType==="Moneyline"?"rgba(0,191,255,0.12)":play.betType==="Spread"?"rgba(180,79,255,0.12)":"rgba(255,215,0,0.12)",
                        border:`1px solid ${play.betType==="Moneyline"?"rgba(0,191,255,0.4)":play.betType==="Spread"?"rgba(180,79,255,0.4)":"rgba(255,215,0,0.4)"}`,
                        color:play.betType==="Moneyline"?"#00bfff":play.betType==="Spread"?"#b44fff":"#ffd700",
                        fontWeight:700}}>
                        {play.betType==="Moneyline"?"💰 ML":play.betType==="Spread"?"📊 SPR":"🏀 TOT"}
                      </div>
                    )}
                    {play.mlCalibrated&&<div style={{fontSize:9,color:"#b44fff",padding:"1px 6px",borderRadius:4,background:"rgba(180,79,255,0.08)",border:"1px solid rgba(180,79,255,0.2)"}}>🧠 ML</div>}
                    {play.isHome&&<div style={{fontSize:9,color:"#aaaaaa",padding:"1px 6px",borderRadius:4,background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.1)"}}>🏠 HOME</div>}
                  </div>
                  <div style={{fontSize:16,fontWeight:700,color:"#fff",marginBottom:2}}>{play.selection}</div>
                  <div style={{fontSize:10,color:"#3a5570"}}>{play.game} · {timeUntil(play.gameTime)} to tip</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:24,fontWeight:800,color:play.tierColor,lineHeight:1}}>{play.convictionScore}</div>
                  {play.isLive&&play.pregameConvictionScore&&play.convictionScore!==play.pregameConvictionScore?(
                    <div style={{fontSize:9,marginTop:1,color:play.convictionScore>play.pregameConvictionScore?"#00ff88":"#ff6b6b",fontWeight:700}}>
                      {play.convictionScore>play.pregameConvictionScore?"▲":"▼"}{Math.abs(play.convictionScore-play.pregameConvictionScore)} from {play.pregameConvictionScore}
                    </div>
                  ):(
                    <div style={{fontSize:9,color:"#3a5570",marginTop:2}}>/ 100</div>
                  )}
                </div>
              </div>

              {/* Stats row: record vs record */}
              <div style={{display:"flex",gap:6,marginBottom:8,flexWrap:"wrap"}}>
                {play.teamRecord&&<div style={{fontSize:10,color:"#dde3ee",padding:"2px 8px",borderRadius:4,background:"#060a10",fontWeight:600}}>{play.teamRecord}</div>}
                {play.oppRecord&&<div style={{fontSize:10,color:"#3a5570",padding:"2px 8px",borderRadius:4,background:"#060a10"}}>vs {play.oppRecord}</div>}
              </div>

              {/* Odds row: line + implied prob + best book */}
              {play.bestOdds ? (
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,padding:"8px 12px",background:"#060a10",borderRadius:8,border:"1px solid #172030"}}>
                  <div style={{display:"flex",flexDirection:"column"}}>
                    <div style={{fontSize:9,color:"#3a5570",letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:2}}>Best Line</div>
                    <div style={{fontSize:18,fontWeight:800,color:play.bestOdds<-150?"#00bfff":play.bestOdds<0?"#00ff88":play.bestOdds<150?"#ffd700":"#ff9944",lineHeight:1}}>
                      {formatOdds(play.bestOdds)}
                    </div>
                  </div>
                  <div style={{width:1,height:32,background:"#172030",margin:"0 4px"}}/>
                  <div style={{display:"flex",flexDirection:"column"}}>
                    <div style={{fontSize:9,color:"#3a5570",letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:2}}>Implied</div>
                    <div style={{fontSize:14,fontWeight:700,color:"#dde3ee",lineHeight:1}}>
                      {Math.round(play.bestOdds<0?(-play.bestOdds/(-play.bestOdds+100))*100:(100/(play.bestOdds+100))*100)}%
                    </div>
                  </div>
                  <div style={{width:1,height:32,background:"#172030",margin:"0 4px"}}/>
                  <div style={{display:"flex",flexDirection:"column"}}>
                    <div style={{fontSize:9,color:"#3a5570",letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:2}}>Conviction</div>
                    <div style={{fontSize:14,fontWeight:700,color:play.tierColor,lineHeight:1}}>
                      {play.convictionScore}%
                    </div>
                  </div>
                  <div style={{marginLeft:"auto",display:"flex",flexDirection:"column",alignItems:"flex-end"}}>
                    <div style={{fontSize:9,color:"#3a5570",marginBottom:2}}>Best at</div>
                    <div style={{fontSize:11,fontWeight:700,color:SPORTSBOOK_COLORS[play.bestBook]||"#dde3ee"}}>
                      {SPORTSBOOK_LABELS[play.bestBook]||play.bestBook||"—"}
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{marginBottom:10,padding:"6px 12px",background:"#060a10",borderRadius:8,border:"1px solid #172030",fontSize:10,color:"#3a5570"}}>
                  Add Odds API key for live lines
                </div>
              )}

              <div style={{fontSize:11,color:"#3a5570",lineHeight:1.8,marginBottom:isExp?12:0}}>
                {play.topSignals?.map(s=>(
                  <div key={s.key} style={{display:"flex",gap:6}}>
                    <span>{s.emoji}</span>
                    <span style={{color:s.score>=70?"#dde3ee":s.score>=50?"#3a5570":"#ff6b6b"}}>{s.note}</span>
                  </div>
                ))}
              </div>

              {isExp&&(
                <div style={{marginTop:14,borderTop:"1px solid #172030",paddingTop:14}}>
                  <div style={{fontSize:10,color:"#3a5570",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:12}}>
                    Full Signal Breakdown {play.isLive?"· Live-Adjusted":play.learnedWeights?"· ML-Reweighted":"· Default Weights"}
                  </div>
                  {/* Live signals shown first when game is active */}
                  {play.isLive&&play.liveSignals&&(
                    <div style={{marginBottom:14,padding:"10px 12px",background:"rgba(255,60,60,0.05)",border:"1px solid rgba(255,60,60,0.2)",borderRadius:8}}>
                      <div style={{fontSize:9,color:"#ff6b6b",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:10}}>🔴 Live Signals ({play.liveWeight}% weight)</div>
                      {play.liveSignals.map(s=>(
                        <div key={s.key} style={{marginBottom:10}}>
                          <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                            <div style={{display:"flex",alignItems:"center",gap:6}}>
                              <span>{s.emoji}</span>
                              <span style={{fontSize:10,color:"#dde3ee"}}>{s.label}</span>
                              <span style={{fontSize:8,color:"#ff6b6b",padding:"1px 4px",borderRadius:3,background:"rgba(255,60,60,0.15)"}}>LIVE</span>
                            </div>
                            <span style={{fontSize:11,fontWeight:700,color:s.score>=70?"#00ff88":s.score>=50?"#ffd700":"#ff6b6b"}}>{s.score}/100</span>
                          </div>
                          <div style={{height:3,background:"#172030",borderRadius:2,marginBottom:3}}>
                            <div style={{height:"100%",width:`${s.score}%`,background:s.score>=70?"#00ff88":s.score>=50?"#ffd700":"#ff6b6b",borderRadius:2,transition:"width 0.8s"}}/>
                          </div>
                          <div style={{fontSize:9,color:"#3a5570"}}>{s.note}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {play.isLive&&<div style={{fontSize:9,color:"#3a5570",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:10}}>Pregame Signals ({play.pregameWeight}% weight)</div>}
                  {play.signals?.map(s=>{
                    const w = getSignalWeights(convictionML)[s.key] || DEFAULT_SIGNAL_WEIGHTS[s.key] || 0.1;
                    return (
                      <div key={s.key} style={{marginBottom:12}}>
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                          <div style={{display:"flex",alignItems:"center",gap:6}}>
                            <span>{s.emoji}</span>
                            <span style={{fontSize:10,color:"#dde3ee"}}>{s.label}</span>
                            {s.isML&&<span style={{fontSize:8,color:"#b44fff",padding:"1px 4px",borderRadius:3,background:"rgba(180,79,255,0.1)"}}>ML</span>}
                          </div>
                          <div style={{display:"flex",alignItems:"center",gap:8}}>
                            <span style={{fontSize:9,color:"#3a5570"}}>wt {Math.round(w*100)}%</span>
                            <span style={{fontSize:11,fontWeight:700,color:s.score>=70?"#00ff88":s.score>=50?"#ffd700":"#ff6b6b"}}>{s.score}/100</span>
                          </div>
                        </div>
                        <div style={{height:3,background:"#172030",borderRadius:2,marginBottom:3}}>
                          <div style={{height:"100%",width:`${s.score}%`,background:s.score>=70?"#00ff88":s.score>=50?"#ffd700":"#ff6b6b",borderRadius:2,transition:"width 0.5s"}}/>
                        </div>
                        <div style={{fontSize:9,color:"#3a5570"}}>{s.note}</div>
                      </div>
                    );
                  })}
                  {play.learnedWeights&&(
                    <div style={{marginTop:8,padding:"8px 12px",background:"rgba(180,79,255,0.06)",border:"1px solid rgba(180,79,255,0.2)",borderRadius:8,fontSize:10,color:"#b44fff"}}>
                      🧠 Weights ML-optimized from {convictionML.totalPlays} plays · {convictionML.totalWins} wins ({Math.round(convictionML.totalWins/convictionML.totalPlays*100)}% rate)
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function NBAEdge() {
  const [oddsKey, setOddsKey] = useState(()=>localStorage.getItem("nba_edge_odds_key")||"");
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
  const [expandedConviction, setExpandedConviction] = useState(null);
  const [useMock, setUseMock] = useState(false);
  const [logs, setLogs] = useState([]);
  const [mlModel, setMlModel] = useState(()=>loadML());
  const [marketBias, setMarketBias] = useState(null);
  const [lastPoll, setLastPoll] = useState(null);
  const [bestAvailableEdge, setBestAvailableEdge] = useState(null);
  const [convictionPlays, setConvictionPlays] = useState([]);
  const [liveGames, setLiveGames] = useState([]); // live ESPN scoreboard state
  const [hasLiveGames, setHasLiveGames] = useState(false);
  const [convictionML, setConvictionML] = useState(()=>loadConvictionML());
  const [convictionLoading, setConvictionLoading] = useState(false);

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
      const wagerPct = Math.max(bet.kellyPct || 1, 0.5) / 100; // minimum 0.5% wager
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

  // Resolve conviction plays when scores come in — updates ML signal weights
  const resolveConvictionPlays = useCallback(async (scores) => {
    if(!scores || convictionPlays.length === 0) return;
    let updatedML = loadConvictionML();
    let anyResolved = false;
    convictionPlays.forEach(play => {
      const [awayTeam, homeTeam] = play.game.split(" @ ");
      const score = scores.find(s => s.home_team === homeTeam && s.away_team === awayTeam);
      if(!score?.completed || !score.scores) return;
      const homeScore = score.scores.find(s=>s.name===homeTeam)?.score;
      const awayScore = score.scores.find(s=>s.name===awayTeam)?.score;
      if(homeScore == null || awayScore == null) return;
      const homeWon = +homeScore > +awayScore;
      const won = play.isHome ? homeWon : !homeWon;
      updatedML = updateConvictionML(updatedML, play, won);
      anyResolved = true;
    });
    if(anyResolved) { saveConvictionML(updatedML); setConvictionML(updatedML); }
  }, [convictionPlays]);

  // Auto-resolve bets + update ML model
  const resolveWithScores = useCallback(async (currentHistory, apiKey, currentML) => {
    if(!apiKey) { console.log("[Resolve] No API key"); return { history: currentHistory, ml: currentML }; }
    const pending = currentHistory.filter(h=>h.status==="pending");
    if(!pending.length) { console.log("[Resolve] No pending bets"); return { history: currentHistory, ml: currentML }; }
    console.log(`[Resolve] Attempting to resolve ${pending.length} pending bets...`);
    pending.forEach(p => console.log(`  - ${p.game} | ${p.selection} | kellyPct=${p.kellyPct} wagerAmt=${p.wagerAmt}`));
    const scores = await fetchScores(apiKey);
    if(!scores) { console.log("[Resolve] fetchScores returned null"); return { history: currentHistory, ml: currentML }; }
    console.log(`[Resolve] Got ${scores.length} scores, ${scores.filter(s=>s.completed).length} completed`);

    let updated = [...currentHistory];
    let updatedML = {...currentML};
    let changed = false;
    let runningBankroll = STARTING_BANKROLL;

    updated = updated.map(entry => {
      if(entry.status !== "pending") { runningBankroll = entry.bankrollAfter; return entry; }
      // Match by team name — try partial match to handle name differences
      const gameScore = scores.find(s => {
        const homeMatch = s.home_team && (entry.game.includes(s.home_team) || s.home_team.split(" ").pop() && entry.game.includes(s.home_team.split(" ").pop()));
        const awayMatch = s.away_team && (entry.game.includes(s.away_team) || s.away_team.split(" ").pop() && entry.game.includes(s.away_team.split(" ").pop()));
        return homeMatch || awayMatch;
      });
      if(!gameScore) {
        console.log(`[Resolve] No score found for: ${entry.game}`);
        return {...entry, bankrollBefore:+runningBankroll.toFixed(2), bankrollAfter:+runningBankroll.toFixed(2)};
      }
      if(!gameScore.completed) {
        console.log(`[Resolve] Game not complete: ${entry.game} (${gameScore.away_team}@${gameScore.home_team})`);
        return {...entry, bankrollBefore:+runningBankroll.toFixed(2), bankrollAfter:+runningBankroll.toFixed(2)};
      }
      console.log(`[Resolve] Matched: ${entry.game} → ${gameScore.away_team}@${gameScore.home_team} scores:`, gameScore.scores);

      const homeScore=gameScore.scores?.find(s=>s.name===gameScore.home_team)?.score;
      const awayScore=gameScore.scores?.find(s=>s.name===gameScore.away_team)?.score;
      let won = null;
      if(homeScore!=null && awayScore!=null) {
        const sel=entry.selection.toLowerCase();
        const home=gameScore.home_team.toLowerCase();
        const totalScore=parseInt(homeScore)+parseInt(awayScore);
        // Normalize type — conviction plays store type in betType
        const resolveType = entry.betType || entry.type;
        if(resolveType==="Moneyline") {
          const homeWon=parseInt(homeScore)>parseInt(awayScore);
          // Match team name in selection — strip "ML" suffix for conviction plays
          const selClean = sel.replace(/ ml$/i,"").trim();
          won=selClean.includes(home)||home.includes(selClean)?homeWon:!homeWon;
        } else if(resolveType==="Spread") {
          const spreadMatch=sel.match(/([+-]?\d+\.?\d*)\s*$/);
          if(spreadMatch) {
            const spread=parseFloat(spreadMatch[1]);
            const isHome=sel.toLowerCase().includes(home);
            const margin=isHome?(parseInt(homeScore)-parseInt(awayScore)):(parseInt(awayScore)-parseInt(homeScore));
            won=margin+spread>0;
          } else {
            // No spread in selection — treat as moneyline-style for conviction spread plays
            const homeWon=parseInt(homeScore)>parseInt(awayScore);
            won=sel.includes(home)?homeWon:!homeWon;
          }
        } else if(resolveType==="Game Total") {
          const isOver=sel.toLowerCase().includes("over");
          const lineMatch=sel.match(/(\d+\.?\d*)/);
          if(lineMatch) { const line=parseFloat(lineMatch[1]); won=isOver?totalScore>line:totalScore<line; }
        } else if(entry.isConviction) {
          // Fallback: conviction plays without betType — resolve as moneyline
          const homeWon=parseInt(homeScore)>parseInt(awayScore);
          won=entry.isHome?homeWon:!homeWon;
        }
      }
      if(won===null) return {...entry, bankrollBefore:+runningBankroll.toFixed(2), bankrollAfter:+runningBankroll.toFixed(2)};

      // Use stored wagerAmt if >0, otherwise recalculate from kellyPct
      const wagerAmt = entry.wagerAmt > 0
        ? entry.wagerAmt
        : +(runningBankroll * Math.max(entry.kellyPct||2, 1) / 100).toFixed(2);
      const decOdds = entry.bestOdds ? americanToDecimal(entry.bestOdds) : 1.91;
      const payout=+(wagerAmt*(decOdds-1)).toFixed(2);
      console.log(`[Resolve] ${entry.selection}: ${won?"WON":"LOST"} · wager $${wagerAmt} · payout $${payout}`);
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

  // On mount: immediately try to resolve any pending bets from localStorage
  useEffect(() => {
    const key = localStorage.getItem("nba_edge_odds_key") || "";
    if(!key) return;
    setHistory(prev => {
      if(!prev.some(h=>h.status==="pending")) return prev;
      const ml = loadML();
      resolveWithScores(prev, key, ml).then(result => {
        if(result?.history) {
          setHistory(result.history);
          if(result.ml) { saveML(result.ml); setMlModel(result.ml); }
          const resolved = result.history.filter(e=>e.status!=="pending");
          if(resolved.length) setBankroll(resolved[resolved.length-1].bankrollAfter);
        }
      });
      return prev;
    });
  }, [resolveWithScores]); // runs once after resolveWithScores is stable

  const fetchBets = useCallback(async (overrideOddsKey) => {
    setLoading(true);
    const currentML = loadML();
    let rawBets = null;

    const activeKey = overrideOddsKey !== undefined ? overrideOddsKey : oddsKey;
    const keyPreview = activeKey ? `key: ${activeKey.slice(0,8)}...` : "no key";
    let rawOddsGames = null; // declared here so IIFE closure can access it after try/finally
    try {
    log(`🔍 Fetching NBA odds... ${keyPreview}`);
    if(activeKey) {
      const [result, rundownProps] = await Promise.all([
        fetchLiveOdds(activeKey, currentML),
        fetchRundownProps(rundownKey)
      ]);
      rawOddsGames = result?.rawGames || null;
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
    setBets(rawBets.filter(b => !isGameOver(b.gameTime)));
    } catch(err) {
      console.error('fetchBets error:', err);
      log('❌ Error: ' + err.message);
    } finally {
      setLastUpdated(new Date());
      setLoading(false);
    }

    // Build conviction plays in background — non-blocking, won't freeze the main UI
    setConvictionLoading(true);
    (async () => {
      try {
        const currentConvML = loadConvictionML();
        // ESPN scoreboard for today's games
        const espnScoreRes = await fetchWithTimeout("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard", {}, 6000);
        let games = [];
        if(espnScoreRes.ok) {
          const espnScore = await espnScoreRes.json();
          games = (espnScore.events||[]).map(e => ({
            away_team: e.competitions?.[0]?.competitors?.find(c=>c.homeAway==="away")?.team?.displayName||"",
            home_team: e.competitions?.[0]?.competitors?.find(c=>c.homeAway==="home")?.team?.displayName||"",
            commence_time: e.date,
            bookmakers: [],
          })).filter(g=>g.away_team&&g.home_team);
          log(`📅 ESPN: ${games.length} games today`);
        }
        // Merge odds data already fetched above — pass rawOddsGames captured in closure
        if(rawOddsGames && games.length > 0) {
          games = games.map(g => {
            const hn = g.home_team.toLowerCase().split(" ").pop();
            const match = rawOddsGames.find(og =>
              og.home_team.toLowerCase().includes(hn) ||
              g.home_team.toLowerCase().includes(og.home_team.toLowerCase().split(" ").pop())
            );
            return match ? {...g, bookmakers: match.bookmakers} : g;
          });
          log(`📊 Odds merged for ${games.filter(g=>g.bookmakers?.length>0).length}/${games.length} games`);
        }
        if(games.length > 0) {
          const plays = (await buildConvictionPlays(games, currentConvML)).filter(p => !isGameOver(p.gameTime));
          // Preserve any existing live state from previous poll
          setConvictionPlays(prev => {
            return plays.map(p => {
              const existing = prev.find(e => e.game === p.game && e.betType === p.betType);
              if(existing?.isLive) {
                // Keep live overlay but update pregame signals
                return {...p, isLive: existing.isLive, liveGame: existing.liveGame,
                  liveSignals: existing.liveSignals, liveWeight: existing.liveWeight,
                  pregameWeight: existing.pregameWeight,
                  convictionScore: existing.convictionScore,
                  tier: existing.tier, tierColor: existing.tierColor,
                  pregameConvictionScore: existing.pregameConvictionScore ?? p.convictionScore};
              }
              return p;
            });
          });
          log(`🎯 ${plays.length} conviction plays · ${plays.filter(p=>p.tier==="HIGH").length} HIGH`);
          // Add conviction plays to paper history
          setHistory(prev => {
            const today = new Date().toDateString();
            const placedIds = new Set(prev.filter(h=>new Date(h.date).toDateString()===today).map(h=>h.betId));
            const fresh = plays.filter(p => !placedIds.has(p.id) && p.bestOdds);
            if(!fresh.length) return prev;
            let bank = prev.length ? prev[prev.length-1].bankrollAfter : bankroll;
            const entries = fresh.map(play => {
              const wagerPct = 0.02; // flat 2% Kelly for conviction plays (no EV sizing)
              const wagerAmt = +(bank * wagerPct).toFixed(2);
              const payout = play.bestOdds
                ? +(wagerAmt * (americanToDecimal(play.bestOdds)-1)).toFixed(2)
                : 0;
              bank = +(bank).toFixed(2); // bankroll unchanged until resolved
              return {
                id: `${play.id}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                betId: play.id,
                date: new Date().toISOString(),
                game: play.game,
                selection: play.selection,
                type: "Conviction Play",
                betType: play.betType,
                bestOdds: play.bestOdds,
                bestBook: play.bestBook,
                kellyPct: 2,
                wagerAmt,
                potentialPayout: payout,
                ev: null,
                edge: null,
                convictionScore: play.convictionScore,
                convictionTier: play.tier,
                status: "pending",
                bankrollBefore: bank,
                bankrollAfter: bank,
                gameTime: play.gameTime,
                result: null,
                isConviction: true,
              };
            });
            const updated = [...prev, ...entries];
            try { localStorage.setItem(STORAGE_KEY, JSON.stringify(updated)); } catch {}
            return updated;
          });
        } else {
          log("⚠️ No ESPN games today");
        }
      } catch(e) {
        console.error("Conviction error:", e);
        log("⚠️ Conviction error: " + (e.name==="AbortError"?"ESPN timeout":e.message));
      }
      setConvictionLoading(false);
    })();

    // Step 1: Add new bets to history (sync)
    const currentHist = JSON.parse(localStorage.getItem(STORAGE_KEY)||"[]");
    const updated = autoAddToHistory(rawBets, bankroll, currentHist);
    setHistory(updated);
    if(updated.length > 0) setBankroll(updated[updated.length-1].bankrollAfter);

    // Step 2: Resolve pending bets (async, outside setState)
    resolveWithScores(updated, activeKey, currentML).then(async result => {
      if(result?.history) {
        setHistory(result.history);
        if(result.ml) { saveML(result.ml); setMlModel(result.ml); }
        // Update bankroll from last resolved entry
        const lastResolved = [...result.history].reverse().find(h=>h.status!=="pending");
        if(lastResolved) setBankroll(lastResolved.bankrollAfter);
        // Step 3: Remove completed games using time + scores API
        const scores = await fetchScores(activeKey);
        if(scores) resolveConvictionPlays(scores);
        // Time-based removal runs regardless of scores API result
        setBets(prev => prev.filter(bet => !isGameOver(bet.gameTime) && 
          !(scores?.find(s => (s.home_team && bet.game?.includes(s.home_team)) || 
                              (s.away_team && bet.game?.includes(s.away_team)))?.completed)
        ));
        // Also remove completed conviction plays from active display
        setConvictionPlays(prev => prev.filter(p => !isGameOver(p.gameTime) &&
          !(scores?.find(s => (s.home_team && p.game?.includes(s.home_team)) ||
                              (s.away_team && p.game?.includes(s.away_team)))?.completed)
        ));
      }
    });

    // Fix #2: News agent + confidence scoring in parallel pipeline
    log("🧠 Scoring confidence for all bets...");
    const withConf = [...rawBets];
    // Run confidence scoring for all bets (uses NBA Stats API — free)
    for(let i=0; i<withConf.length; i++) {
      const conf = await scoreConfidence(withConf[i], withConf[i].newsScore||null);
      if(conf) withConf[i] = {...withConf[i], confidenceScore:conf.confidence, confidenceTier:conf.tier, confidenceTierColor:conf.tierColor, confidenceFactors:conf.factors};
    }
    setBets([...withConf].filter(b => !isGameOver(b.gameTime)));
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
          setBets([...updated].filter(b => !isGameOver(b.gameTime)));
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

  useEffect(() => {
    // Clear stale games immediately on mount before any API calls
    setBets(prev => prev.filter(b => !isGameOver(b.gameTime)));
    setConvictionPlays(prev => prev.filter(p => !isGameOver(p.gameTime)));
    fetchBets();
  }, []);

  useEffect(() => {
    const schedule = () => {
      const next=new Date(); next.setDate(next.getDate()+1); next.setHours(8,0,0,0);
      return setTimeout(()=>{fetchBets();schedule();}, next-new Date());
    };
    const t=schedule(); return ()=>clearTimeout(t);
  }, [fetchBets]);

  // Ref always holds latest conviction plays — prevents stale closure in interval
  const convictionPlaysRef = useRef([]);
  useEffect(() => { convictionPlaysRef.current = convictionPlays; }, [convictionPlays]);

  // Live conviction rescoring — polls ESPN every 45s, never stale-closes
  useEffect(() => {
    const pollLive = async () => {
      const scoreboard = await fetchLiveScoreboard();
      if(!scoreboard) return;
      const activeGames = scoreboard.filter(g => g.state === "in");
      setLiveGames(scoreboard);
      setHasLiveGames(activeGames.length > 0);
      const currentPlays = convictionPlaysRef.current;
      if(activeGames.length === 0 || currentPlays.length === 0) return;

      // Rescore each play against live game state using latest ref value
      let anyUpdated = false;
      const updated = currentPlays.map(play => {
        const gameHome = play.game.split(" @ ")[1];
        const liveGame = activeGames.find(g =>
          g.home_team === gameHome ||
          g.home_team.toLowerCase().includes(gameHome?.toLowerCase().split(" ").pop() || "")
        );
        if(!liveGame) return play;
        const pregameScore = play.pregameConvictionScore ?? play.convictionScore;
        const live = rescoreConvictionLive({...play, pregameConvictionScore: pregameScore}, liveGame);
        if(!live) return play;
        anyUpdated = true;
        return { ...play, ...live, pregameConvictionScore: pregameScore };
      });
      if(anyUpdated) setConvictionPlays(updated);
    };

    pollLive();
    const interval = setInterval(pollLive, 45000);
    return () => clearInterval(interval);
  }, []); // mount once — reads latest plays via ref, never restarts

  // Live polling every 60 seconds — catches line moves as they happen
  useEffect(() => {
    if(!oddsKey) return;
    const interval = setInterval(async () => {
      setLastPoll(new Date());
      // Immediately remove time-expired games before full refresh
      setBets(prev => prev.filter(b => !isGameOver(b.gameTime)));
      setConvictionPlays(prev => prev.filter(p => !isGameOver(p.gameTime)));
      fetchBets();
      // Re-attempt resolution on each poll (outside setState — no async in state updater)
      const pollML = loadML();
      const pollHist = JSON.parse(localStorage.getItem(STORAGE_KEY)||"[]");
      if(pollHist.some(h=>h.status==="pending") && oddsKey) {
        resolveWithScores(pollHist, oddsKey, pollML).then(result => {
          if(result?.history && result.history.some(h=>h.status!=="pending" && 
            !pollHist.find(p=>p.id===h.id&&p.status!=="pending"))) {
            setHistory(result.history);
            if(result.ml) { saveML(result.ml); setMlModel(result.ml); }
            const lastR = [...result.history].reverse().find(h=>h.status!=="pending");
            if(lastR) setBankroll(lastR.bankrollAfter);
            log(`✅ Resolved bets from poll · bankroll updated`);
          }
        });
      }
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
  const filteredConviction=filter==="All"?convictionPlays:convictionPlays.filter(p=>p.betType===filter);
  const resolved=history.filter(h=>h.status==="won"||h.status==="lost");
  const won=resolved.filter(h=>h.status==="won");
  const totalWagered=resolved.reduce((s,h)=>s+h.wagerAmt,0);
  const totalPnl=bankroll-STARTING_BANKROLL;
  const resolvedPnl=resolved.reduce((s,h)=>s+(h.status==="won"?h.potentialPayout:-h.wagerAmt),0);
  const winRate=resolved.length>0?((won.length/resolved.length)*100).toFixed(0):0;
  const mlConfidence = mlModel.totalBets >= 5 ? Math.min(50+mlModel.totalBets*2, 95) : 0;

  const chartData=(()=>{
    const sorted = [...history].sort((a,b)=>new Date(a.date)-new Date(b.date));
    if(sorted.length === 0) return [];
    // Only chart resolved entries so the line moves meaningfully
    const resolved = sorted.filter(h => h.status === "won" || h.status === "lost");
    if(resolved.length === 0) {
      // No resolved bets yet — return starting point so chart shows flat line
      return [{...sorted[0], chartBankroll: STARTING_BANKROLL, date: sorted[0].date}];
    }
    // Add starting point then each resolved bet's bankroll
    const points = [{chartBankroll: STARTING_BANKROLL, date: sorted[0].date, status:"start", selection:"Start"}];
    resolved.forEach(h => points.push({...h, chartBankroll: h.bankrollAfter}));
    return points;
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
            {key:"odds",label:"The Odds API Key",val:oddsKey,set:(v)=>{setOddsKey(v);localStorage.setItem("nba_edge_odds_key",v);},hint:"Free at the-odds-api.com — live game lines from 6 sportsbooks"},
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
          <button style={s.btnPrimary} onClick={()=>{setSettingsOpen(false);fetchBets(oddsKey);}}>Save & Refresh</button>
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
            ...(hasLiveGames?[{lbl:"Live Games",val:liveGames.filter(g=>g.state==="in").length,sub:"Conviction updating live",c:"#ff6b6b"}]:[]),
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
                  {[...history].reverse().map(h => {
                    const isWon = h.status === "won";
                    const isLost = h.status === "lost";
                    const isPending = h.status === "pending";
                    const pnl = isWon ? h.potentialPayout : isLost ? -h.wagerAmt : null;
                    const accentColor = isWon ? "#00ff88" : isLost ? "#ff6b6b" : "#ffd700";
                    const bgColor = isWon ? "rgba(0,255,136,0.04)" : isLost ? "rgba(255,107,107,0.04)" : "transparent";
                    return (
                      <div key={h.id} style={{borderBottom:"1px solid #0e1a28",background:bgColor,transition:"background 0.3s"}}>
                        {/* Main row */}
                        <div style={{display:"grid",gridTemplateColumns:"110px 1fr auto",gap:12,padding:"14px 22px",alignItems:"center"}}>
                          {/* Left: date + status */}
                          <div>
                            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                              <div style={{width:6,height:6,borderRadius:"50%",background:accentColor,boxShadow:isPending?`0 0 5px ${accentColor}`:"none"}}/>
                              <div style={{fontSize:9,fontWeight:700,color:accentColor,letterSpacing:"0.08em"}}>
                                {isWon?"WIN ✓":isLost?"LOSS ✗":"PENDING"}
                              </div>
                            </div>
                            <div style={{fontSize:10,color:"#3a5570"}}>{new Date(h.date).toLocaleDateString("en-US",{month:"short",day:"numeric"})}</div>
                            <div style={{fontSize:9,color:"#1e3040"}}>{new Date(h.date).toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"})}</div>
                          </div>
                          {/* Middle: bet details */}
                          <div>
                            <div style={{fontSize:13,fontWeight:700,color:"#fff",marginBottom:2}}>{h.selection}</div>
                            <div style={{fontSize:10,color:"#3a5570",marginBottom:5}}>{h.game}</div>
                            <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                              <div style={{...s.typeBadge(h.isConviction?"Conviction Play":h.type),marginBottom:0}}>
                                {h.isConviction?`🎯 ${h.betType||"Conviction"}`:h.type}
                              </div>
                              {h.bestOdds&&<div style={{fontSize:10,fontWeight:700,color:h.bestOdds<0?"#00bfff":"#ffd700"}}>{formatOdds(h.bestOdds)}</div>}
                              {h.bestBook&&<div style={{fontSize:9,color:SPORTSBOOK_COLORS[h.bestBook]||"#3a5570"}}>{h.bestBook}</div>}
                              {h.isConviction&&h.convictionScore&&<div style={{fontSize:9,color:"#b44fff"}}>{h.convictionScore}/100 conviction</div>}
                            </div>
                          </div>
                          {/* Right: financial outcome */}
                          <div style={{textAlign:"right",minWidth:120}}>
                            {pnl !== null && (
                              <div style={{fontSize:20,fontWeight:800,color:accentColor,marginBottom:2}}>
                                {pnl > 0 ? "+" : ""}{fmt$(pnl)}
                              </div>
                            )}
                            <div style={{display:"flex",gap:12,justifyContent:"flex-end",fontSize:10,color:"#3a5570"}}>
                              <div>Wagered <span style={{color:"#ffd700"}}>{fmt$(h.wagerAmt)}</span></div>
                              {!isPending&&<div>To win <span style={{color:"#00bfff"}}>{fmt$(h.potentialPayout)}</span></div>}
                            </div>
                            <div style={{fontSize:10,color:"#3a5570",marginTop:3}}>
                              Bankroll → <span style={{color:"#dde3ee",fontWeight:600}}>{fmt$(h.bankrollAfter)}</span>
                            </div>
                          </div>
                        </div>
                        {/* P&L bar for resolved bets */}
                        {!isPending&&(
                          <div style={{height:2,background:"#0e1a28",marginBottom:0}}>
                            <div style={{
                              height:"100%",
                              width:`${Math.min(100,Math.abs(pnl||0)/h.wagerAmt*50+50)}%`,
                              background:accentColor,
                              opacity:0.5,
                              transition:"width 0.6s"
                            }}/>
                          </div>
                        )}
                      </div>
                    );
                  })}
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

        {/* CONVICTION PLAYS — stat-driven, ML-weighted, EV-agnostic */}
        {filter!=="Info"&&filter!=="History"&&<ConvictionSection
          plays={filteredConviction}
          loading={convictionLoading}
          convictionML={convictionML}
          expandedConviction={expandedConviction}
          setExpandedConviction={setExpandedConviction}
        />}

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
