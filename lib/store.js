// lib/store.js
// Shared portfolio state using Vercel KV (Redis).
// All visitors read the same portfolio — updated by cron jobs.

import { kv } from "@vercel/kv";

const HISTORY_KEY   = "nba_edge:history";
const BANKROLL_KEY  = "nba_edge:bankroll";
const ML_KEY        = "nba_edge:ml_model";
const CONV_ML_KEY   = "nba_edge:conviction_ml";
const LAST_RUN_KEY  = "nba_edge:last_run";
const BETS_KEY      = "nba_edge:current_bets";        // today's active EV bets
const CONVICTION_KEY= "nba_edge:conviction_plays";    // today's conviction plays
const STARTING_BANKROLL = 100;

// ── READ ───────────────────────────────────────────────────────────────────────

export async function getHistory() {
  try { return (await kv.get(HISTORY_KEY)) || []; }
  catch(e) { console.error("[KV] getHistory:", e); return []; }
}

export async function getBankroll() {
  try {
    const b = await kv.get(BANKROLL_KEY);
    return b != null ? Number(b) : STARTING_BANKROLL;
  } catch(e) { return STARTING_BANKROLL; }
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

export async function getPortfolioSnapshot() {
  const [history, bankroll, ml, bets, conviction, lastRun] = await Promise.all([
    getHistory(), getBankroll(), getMLModel(),
    getCurrentBets(), getConvictionPlays(), getLastRun(),
  ]);
  return { history, bankroll, ml, bets, conviction, lastRun };
}

// ── WRITE ──────────────────────────────────────────────────────────────────────

export async function saveHistory(history) {
  await kv.set(HISTORY_KEY, history);
}

export async function saveBankroll(bankroll) {
  await kv.set(BANKROLL_KEY, bankroll);
}

export async function saveMLModel(ml) {
  await kv.set(ML_KEY, ml);
}

export async function saveCurrentBets(bets) {
  await kv.set(BETS_KEY, bets, { ex: 86400 }); // expire after 24h
}

export async function saveConvictionPlays(plays) {
  await kv.set(CONVICTION_KEY, plays, { ex: 86400 });
}

export async function saveLastRun(timestamp) {
  await kv.set(LAST_RUN_KEY, timestamp);
}

export async function appendHistory(newEntries) {
  const existing = await getHistory();
  const updated = [...existing, ...newEntries];
  await saveHistory(updated);
  return updated;
}

// ── STANDINGS CACHE ──────────────────────────────────────────────────────────

const STANDINGS_KEY = "nba_edge:standings";
const STANDINGS_TTL = 1 * 3600; // refresh every 1 hour

export async function getCachedStandings() {
  try { return await kv.get(STANDINGS_KEY); }
  catch(e) { return null; }
}

export async function saveStandings(standings) {
  try { await kv.set(STANDINGS_KEY, standings, { ex: STANDINGS_TTL }); }
  catch(e) { console.error("[KV] saveStandings:", e); }
}

// ── ML MODEL ───────────────────────────────────────────────────────────────────

function defaultML() {
  return {
    totalBets: 0, wins: 0, losses: 0,
    roi: 0, totalWagered: 0, totalReturned: 0,
    signalAccuracy: {
      winRate: { correct: 0, total: 0 },
      netRating: { correct: 0, total: 0 },
      rest: { correct: 0, total: 0 },
      ats: { correct: 0, total: 0 },
      home: { correct: 0, total: 0 },
      h2h: { correct: 0, total: 0 },
      pace: { correct: 0, total: 0 },
    },
    learnedWeights: null,
    status: "Learning",
  };
}

// Update ML model after a bet resolves
export async function updateMLAfterResolution(resolvedBets) {
  if(!resolvedBets.length) return;
  try {
    const ml = await getMLModel();

    for(const bet of resolvedBets) {
      const won = bet.status === "won";
      ml.totalBets = (ml.totalBets || 0) + 1;
      if(won) ml.wins = (ml.wins || 0) + 1;
      else ml.losses = (ml.losses || 0) + 1;

      // Track ROI
      ml.totalWagered = (ml.totalWagered || 0) + (bet.wagerAmt || 0);
      ml.totalReturned = (ml.totalReturned || 0) + (won ? (bet.wagerAmt + bet.potentialPayout) : 0);
      ml.roi = ml.totalWagered > 0
        ? +((ml.totalReturned - ml.totalWagered) / ml.totalWagered * 100).toFixed(2)
        : 0;

      // Update signal accuracy for conviction bets
      if(bet.isConviction && bet.signals) {
        for(const sig of bet.signals) {
          if(!ml.signalAccuracy[sig.key]) ml.signalAccuracy[sig.key] = { correct: 0, total: 0 };
          ml.signalAccuracy[sig.key].total++;
          // Signal predicted win if score >= 60
          const signalPredictedWin = sig.score >= 60;
          if(signalPredictedWin === won) ml.signalAccuracy[sig.key].correct++;
        }
      }
    }

    // Reweight signals after 15+ conviction bets
    const convictionBets = ml.totalBets;
    if(convictionBets >= 15) {
      const baseWeights = { winRate:0.22, netRating:0.20, rest:0.18, ats:0.14, home:0.12, h2h:0.08, pace:0.06 };
      const accuracies = {};
      let avgAccuracy = 0, count = 0;
      for(const [key, data] of Object.entries(ml.signalAccuracy)) {
        if(data.total >= 5) {
          accuracies[key] = data.correct / data.total;
          avgAccuracy += accuracies[key];
          count++;
        }
      }
      if(count > 0) {
        avgAccuracy /= count;
        const newWeights = {};
        let totalWeight = 0;
        for(const [key, base] of Object.entries(baseWeights)) {
          const acc = accuracies[key] || avgAccuracy;
          newWeights[key] = base * (acc / avgAccuracy);
          totalWeight += newWeights[key];
        }
        // Normalize weights to sum to 1
        for(const key of Object.keys(newWeights)) newWeights[key] = +(newWeights[key] / totalWeight).toFixed(4);
        ml.learnedWeights = newWeights;
        ml.status = "Active";
      }
    }

    ml.status = convictionBets >= 15 ? "Active" : `Learning (${convictionBets}/15)`;
    await saveMLModel(ml);
    console.log(`[ML] Updated — ${ml.totalBets} bets, ${ml.wins}W/${ml.losses}L, ROI: ${ml.roi}%`);
  } catch(e) {
    console.error("[ML] Update failed:", e);
  }
}
