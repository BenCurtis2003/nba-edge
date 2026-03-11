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

// ── ML MODEL ───────────────────────────────────────────────────────────────────

function defaultML() {
  return {
    totalBets: 0, wins: 0, losses: 0,
    signalAccuracy: {}, learnedWeights: null,
    status: "Learning",
  };
}
