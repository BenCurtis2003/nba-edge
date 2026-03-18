// lib/store.js
// Shared portfolio state using Vercel KV (Redis).
// All visitors read the same portfolio — updated by cron jobs.

import { Redis } from "@upstash/redis";
const kv = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });

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
    // Signal keys match engine signal keys exactly (9-signal model)
    signalAccuracy: {
      winRate:   { correct: 0, total: 0, label: "Season Win Rate" },
      netRating: { correct: 0, total: 0, label: "Record vs Opponent" },
      recentForm:{ correct: 0, total: 0, label: "Recent Form (L10)" },
      ats:       { correct: 0, total: 0, label: "ATS Tendency" },
      homeAway:  { correct: 0, total: 0, label: "Home/Away Record" },
      oppForm:   { correct: 0, total: 0, label: "Opponent Form (L10)" },
      market:    { correct: 0, total: 0, label: "Market Implied Prob" },
      rest:      { correct: 0, total: 0, label: "Rest Advantage" },
      injury:    { correct: 0, total: 0, label: "Injury Report" },
    },
    learnedWeights: null,
    minBetsForML: 30, // raised from 15 — need more data for reliable signal accuracy
    status: "Learning",
    bdlDataUsed: false, // tracks whether BallDontLie enrichment is active
    // ML Upgrade 2 — CLV tracking
    clvSum: 0, clvCount: 0, positiveCLVCount: 0,
    avgCLV: 0, positiveCLVRate: 0,
    // ML Upgrade 6 — signal threshold calibration
    signalScoreDistribution: {}, // { signalKey: { buckets: {50:n,60:n,70:n,80:n}, correctByBucket: {...} } }
    signalThresholds: {},        // { signalKey: calibratedThreshold } — updated after 30+ bets
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
          // Use calibrated threshold if available, else default to 60
          const threshold = ml.signalThresholds?.[sig.key] ?? 60;
          const signalPredictedWin = sig.score >= threshold;
          if(signalPredictedWin === won) ml.signalAccuracy[sig.key].correct++;

          // ML Upgrade 6 — track score distribution by bucket for threshold calibration
          if(!ml.signalScoreDistribution) ml.signalScoreDistribution = {};
          if(!ml.signalScoreDistribution[sig.key]) {
            ml.signalScoreDistribution[sig.key] = { buckets: {}, correctByBucket: {} };
          }
          const dist = ml.signalScoreDistribution[sig.key];
          const bucket = Math.floor(sig.score / 10) * 10; // 0,10,20,...,90
          dist.buckets[bucket] = (dist.buckets[bucket] || 0) + 1;
          if(won) dist.correctByBucket[bucket] = (dist.correctByBucket[bucket] || 0) + 1;
        }
      }

      // ML Upgrade 2 — CLV tracking
      if(bet.clv != null) {
        ml.clvSum    = (ml.clvSum    || 0) + bet.clv;
        ml.clvCount  = (ml.clvCount  || 0) + 1;
        ml.avgCLV    = +(ml.clvSum / ml.clvCount).toFixed(2);
        if(bet.clv > 0) ml.positiveCLVCount = (ml.positiveCLVCount || 0) + 1;
        ml.positiveCLVRate = ml.clvCount > 0
          ? +((ml.positiveCLVCount / ml.clvCount) * 100).toFixed(1)
          : 0;
      }
    }

    // Reweight signals after 30+ conviction bets (need sufficient data)
    const convictionBets = ml.totalBets;
    if(convictionBets >= (ml.minBetsForML || 30)) {
      // ML Upgrade 6 — calibrate signal thresholds from score distribution
      if(ml.signalScoreDistribution) {
        if(!ml.signalThresholds) ml.signalThresholds = {};
        for(const [key, dist] of Object.entries(ml.signalScoreDistribution)) {
          // Find bucket with highest win rate (min 3 samples)
          let bestThreshold = 60, bestWinRate = 0;
          for(const [bucketStr, count] of Object.entries(dist.buckets || {})) {
            if(count < 3) continue;
            const correct = dist.correctByBucket?.[bucketStr] || 0;
            const winRate = correct / count;
            if(winRate > bestWinRate) { bestWinRate = winRate; bestThreshold = +bucketStr; }
          }
          ml.signalThresholds[key] = bestThreshold;
        }
      }

      // 9-signal normalized baseWeights (sum = 1.0)
      const baseWeights = {
        winRate:0.1887, netRating:0.1698, recentForm:0.1509, ats:0.1132,
        homeAway:0.0943, oppForm:0.0660, market:0.0472,
        rest:0.0943, injury:0.0755,
      };
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

    ml.status = convictionBets >= (ml.minBetsForML || 30) ? "Active" : `Learning (${convictionBets}/${ml.minBetsForML || 30})`;
    await saveMLModel(ml);
    console.log(`[ML] Updated — ${ml.totalBets} bets, ${ml.wins}W/${ml.losses}L, ROI: ${ml.roi}%`);
  } catch(e) {
    console.error("[ML] Update failed:", e);
  }
}

// ── PROPS ─────────────────────────────────────────────────────────────────────
export async function getPropBets() {
  try { return (await kv.get("nba_edge:prop_bets")) || []; } catch { return []; }
}
export async function savePropBets(props) {
  try { await kv.set("nba_edge:prop_bets", props); } catch(e) { console.error("[Store] savePropBets:", e); }
}
export async function getAllProps() {
  try { return (await kv.get("nba_edge:all_props")) || []; } catch { return []; }
}
export async function saveAllProps(props) {
  try { await kv.set("nba_edge:all_props", props); } catch(e) { console.error("[Store] saveAllProps:", e); }
}

// ── PRIZEPICKS ────────────────────────────────────────────────────────────────
export async function getPrizePicksBets() {
  try { return (await kv.get("nba_edge:prizepicks_bets")) || []; } catch { return []; }
}
export async function savePrizePicksBets(bets) {
  try { await kv.set("nba_edge:prizepicks_bets", bets, { ex: 86400 }); } catch(e) { console.error("[Store] savePrizePicksBets:", e); }
}
