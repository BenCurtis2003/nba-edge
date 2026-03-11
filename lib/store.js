// lib/store.js
import { kv } from "@vercel/kv";

const HISTORY_KEY    = "nba_edge:history";
const BANKROLL_KEY   = "nba_edge:bankroll";
const ML_KEY         = "nba_edge:ml_model";
const LAST_RUN_KEY   = "nba_edge:last_run";
const BETS_KEY       = "nba_edge:current_bets";
const CONVICTION_KEY = "nba_edge:conviction_plays";
const STANDINGS_KEY  = "nba_edge:standings";
const STARTING_BANKROLL = 100;

export async function getHistory() {
  try { return (await kv.get(HISTORY_KEY)) || []; }
  catch(e) { return []; }
}
export async function getBankroll() {
  try { const b = await kv.get(BANKROLL_KEY); return b != null ? Number(b) : STARTING_BANKROLL; }
  catch(e) { return STARTING_BANKROLL; }
}
export async function getMLModel() {
  try { return (await kv.get(ML_KEY)) || defaultML(); }
  catch(e) { return defaultML(); }
}
export async function getCurrentBets() {
  try { return (await kv.get(BETS_KEY)) || []; }
  catch(e) { return []; }
}
export async function getConvictionPlays() {
  try { return (await kv.get(CONVICTION_KEY)) || []; }
  catch(e) { return []; }
}
export async function getLastRun() {
  try { return await kv.get(LAST_RUN_KEY); }
  catch(e) { return null; }
}
export async function getCachedStandings() {
  try { return await kv.get(STANDINGS_KEY); }
  catch(e) { return null; }
}
export async function getPortfolioSnapshot() {
  const [history, bankroll, ml, bets, conviction, lastRun] = await Promise.all([
    getHistory(), getBankroll(), getMLModel(),
    getCurrentBets(), getConvictionPlays(), getLastRun(),
  ]);
  return { history, bankroll, ml, bets, conviction, lastRun };
}
export async function saveHistory(history) { await kv.set(HISTORY_KEY, history); }
export async function saveBankroll(bankroll) { await kv.set(BANKROLL_KEY, bankroll); }
export async function saveMLModel(ml) { await kv.set(ML_KEY, ml); }
export async function saveCurrentBets(bets) { await kv.set(BETS_KEY, bets, { ex: 86400 }); }
export async function saveConvictionPlays(plays) { await kv.set(CONVICTION_KEY, plays, { ex: 86400 }); }
export async function saveLastRun(ts) { await kv.set(LAST_RUN_KEY, ts); }
export async function saveStandings(standings) {
  try { await kv.set(STANDINGS_KEY, standings, { ex: 21600 }); }
  catch(e) { console.error("[KV] saveStandings:", e); }
}
export async function appendHistory(newEntries) {
  const existing = await getHistory();
  const updated = [...existing, ...newEntries];
  await saveHistory(updated);
  return updated;
}

function defaultML() {
  return {
    totalBets: 0, wins: 0, losses: 0,
    roi: 0, totalWagered: 0, totalReturned: 0,
    signalAccuracy: {
      winRate:   { correct:0, total:0 },
      netRating: { correct:0, total:0 },
      rest:      { correct:0, total:0 },
      ats:       { correct:0, total:0 },
      home:      { correct:0, total:0 },
      h2h:       { correct:0, total:0 },
      pace:      { correct:0, total:0 },
    },
    learnedWeights: null,
    status: "Learning",
  };
}

export async function updateMLAfterResolution(resolvedBets) {
  if(!resolvedBets.length) return;
  try {
    const ml = await getMLModel();
    for(const bet of resolvedBets) {
      const won = bet.status === "won";
      ml.totalBets = (ml.totalBets||0) + 1;
      if(won) ml.wins = (ml.wins||0) + 1;
      else ml.losses = (ml.losses||0) + 1;
      ml.totalWagered = (ml.totalWagered||0) + (bet.wagerAmt||0);
      ml.totalReturned = (ml.totalReturned||0) + (won ? (bet.wagerAmt + bet.potentialPayout) : 0);
      ml.roi = ml.totalWagered > 0 ? +((ml.totalReturned - ml.totalWagered) / ml.totalWagered * 100).toFixed(2) : 0;
      if(bet.isConviction && bet.signals) {
        for(const sig of bet.signals) {
          if(!ml.signalAccuracy[sig.key]) ml.signalAccuracy[sig.key] = { correct:0, total:0 };
          ml.signalAccuracy[sig.key].total++;
          if((sig.score >= 60) === won) ml.signalAccuracy[sig.key].correct++;
        }
      }
    }
    if(ml.totalBets >= 15) {
      const base = { winRate:0.22, netRating:0.20, rest:0.18, ats:0.14, home:0.12, h2h:0.08, pace:0.06 };
      const accs = {}; let avg = 0, n = 0;
      for(const [k, d] of Object.entries(ml.signalAccuracy)) {
        if(d.total >= 5) { accs[k] = d.correct/d.total; avg += accs[k]; n++; }
      }
      if(n > 0) {
        avg /= n;
        const nw = {}; let tot = 0;
        for(const [k, b] of Object.entries(base)) { nw[k] = b * ((accs[k]||avg)/avg); tot += nw[k]; }
        for(const k of Object.keys(nw)) nw[k] = +(nw[k]/tot).toFixed(4);
        ml.learnedWeights = nw;
      }
    }
    ml.status = ml.totalBets >= 15 ? "Active" : `Learning (${ml.totalBets}/15)`;
    await saveMLModel(ml);
    console.log(`[ML] ${ml.totalBets} bets · ${ml.wins}W/${ml.losses}L · ROI ${ml.roi}%`);
  } catch(e) { console.error("[ML] update failed:", e); }
}
