// lib/store-supabase.js
// Drop-in Supabase adapter — same interface as store.js
// Switch by setting STORE_BACKEND=supabase in Vercel env vars
// Until then, store.js (Redis) continues to work unchanged.

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // service role for server-side writes
);

const STARTING_BANKROLL = 100;

// ── HISTORY ──────────────────────────────────────────────────────────────────

export async function getHistory() {
  const { data, error } = await supabase
    .from("bet_history")
    .select("*")
    .order("date", { ascending: false })
    .limit(500);
  if (error) { console.error("[Supabase] getHistory:", error); return []; }
  return data.map(dbRowToBet);
}

export async function appendHistory(newEntries) {
  if (!newEntries?.length) return;
  const rows = newEntries.map(betToDbRow);
  const { error } = await supabase.from("bet_history").upsert(rows, { onConflict: "id" });
  if (error) console.error("[Supabase] appendHistory:", error);
}

export async function saveHistory(history) {
  // Full replace — used by admin endpoints
  const rows = history.map(betToDbRow);
  const { error } = await supabase.from("bet_history").upsert(rows, { onConflict: "id" });
  if (error) console.error("[Supabase] saveHistory:", error);
}

// ── BANKROLL ─────────────────────────────────────────────────────────────────

export async function getBankroll() {
  const { data } = await supabase
    .from("bankroll_history")
    .select("bankroll")
    .order("recorded_at", { ascending: false })
    .limit(1)
    .single();
  return data?.bankroll ?? STARTING_BANKROLL;
}

export async function saveBankroll(bankroll) {
  await supabase.from("bankroll_history").insert({ bankroll });
}

// ── ML MODEL ─────────────────────────────────────────────────────────────────

export async function getMLModel() {
  const { data } = await supabase
    .from("ml_model")
    .select("*")
    .eq("id", 1)
    .single();
  if (!data) return defaultML();
  return {
    totalBets: data.total_bets,
    wins: data.wins,
    losses: data.losses,
    roi: data.roi,
    totalWagered: data.total_wagered,
    totalReturned: data.total_returned,
    signalAccuracy: data.signal_accuracy,
    learnedWeights: data.learned_weights,
    minBetsForML: data.min_bets_for_ml,
    status: data.status,
    bdlDataUsed: data.bdl_data_used,
  };
}

export async function saveMLModel(ml) {
  await supabase.from("ml_model").upsert({
    id: 1,
    total_bets: ml.totalBets,
    wins: ml.wins,
    losses: ml.losses,
    roi: ml.roi,
    total_wagered: ml.totalWagered,
    total_returned: ml.totalReturned,
    signal_accuracy: ml.signalAccuracy,
    learned_weights: ml.learnedWeights,
    min_bets_for_ml: ml.minBetsForML,
    status: ml.status,
    bdl_data_used: ml.bdlDataUsed,
  }, { onConflict: "id" });
}

// ── CURRENT BETS / CONVICTION / PROPS ────────────────────────────────────────
// These are still stored in Redis (fast ephemeral state)
// Migrate to Supabase views later if needed

export { getCurrentBets, saveCurrentBets,
         getConvictionPlays, saveConvictionPlays,
         getPropBets, savePropBets,
         getLastRun, saveLastRun,
         getCachedStandings, saveStandings,
         getPortfolioSnapshot } from "./store";

// ── ROW MAPPERS ──────────────────────────────────────────────────────────────

function betToDbRow(bet) {
  return {
    id:               bet.id,
    bet_id:           bet.betId,
    date:             bet.date,
    game:             bet.game,
    selection:        bet.selection,
    type:             bet.type,
    bet_type:         bet.betType,
    best_odds:        bet.bestOdds,
    best_book:        bet.bestBook,
    kelly_pct:        bet.kellyPct,
    wager_amt:        bet.wagerAmt,
    potential_payout: bet.potentialPayout,
    ev:               bet.ev,
    edge:             bet.edge,
    our_probability:  bet.ourProbability,
    conviction_score: bet.convictionScore,
    get_at_or_better: bet.getAtOrBetter,
    game_time:        bet.gameTime,
    status:           bet.status || "pending",
    result:           bet.result,
    bankroll_before:  bet.bankrollBefore,
    bankroll_after:   bet.bankrollAfter,
    is_conviction:    bet.isConviction || false,
    is_prop:          bet.isProp || false,
    odds_estimated:   bet.oddsEstimated || false,
    estimated_result: bet.estimatedResult || false,
    signals:          bet.signals || null,
    all_lines:        bet.allLines || null,
    player:           bet.player || null,
    market:           bet.market || null,
    market_label:     bet.marketLabel || null,
    line:             bet.line || null,
    side:             bet.side || null,
  };
}

function dbRowToBet(row) {
  return {
    id:              row.id,
    betId:           row.bet_id,
    date:            row.date,
    game:            row.game,
    selection:       row.selection,
    type:            row.type,
    betType:         row.bet_type,
    bestOdds:        row.best_odds,
    bestBook:        row.best_book,
    kellyPct:        row.kelly_pct,
    wagerAmt:        row.wager_amt,
    potentialPayout: row.potential_payout,
    ev:              row.ev,
    edge:            row.edge,
    ourProbability:  row.our_probability,
    convictionScore: row.conviction_score,
    getAtOrBetter:   row.get_at_or_better,
    gameTime:        row.game_time,
    status:          row.status,
    result:          row.result,
    bankrollBefore:  row.bankroll_before,
    bankrollAfter:   row.bankroll_after,
    isConviction:    row.is_conviction,
    isProp:          row.is_prop,
    oddsEstimated:   row.odds_estimated,
    estimatedResult: row.estimated_result,
    signals:         row.signals,
    allLines:        row.all_lines,
    player:          row.player,
    market:          row.market,
    marketLabel:     row.market_label,
    line:            row.line,
    side:            row.side,
  };
}

function defaultML() {
  return {
    totalBets: 0, wins: 0, losses: 0,
    roi: 0, totalWagered: 0, totalReturned: 0,
    signalAccuracy: {},
    learnedWeights: null,
    minBetsForML: 30,
    status: "Learning",
    bdlDataUsed: false,
  };
}
