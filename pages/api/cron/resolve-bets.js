// pages/api/cron/resolve-bets.js
// Runs every 30 minutes via Vercel Cron.
// Fetches ESPN/Odds API scores and settles any pending bets.

import { fetchScores, resolveHistory } from "../../../lib/engine";
import {
  getHistory, getMLModel,
  saveHistory, saveBankroll, saveMLModel,
} from "../../../lib/store";

export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if(process.env.NODE_ENV === "production" &&
     authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const ODDS_KEY = process.env.ODDS_API_KEY;

  try {
    console.log("[Cron] resolve-bets starting...");

    const [history, scores] = await Promise.all([
      getHistory(),
      fetchScores(ODDS_KEY),
    ]);

    const pending = history.filter(h => h.status === "pending");
    if(!pending.length) {
      console.log("[Cron] No pending bets to resolve");
      return res.status(200).json({ ok: true, resolved: 0 });
    }

    console.log(`[Cron] Attempting to resolve ${pending.length} pending bets`);

    const { history: updated, bankroll, changed } = resolveHistory(history, scores || []);

    if(changed) {
      await Promise.all([
        saveHistory(updated),
        saveBankroll(bankroll),
      ]);
      const resolved = updated.filter(h => h.status !== "pending").length -
                       history.filter(h => h.status !== "pending").length;
      console.log(`[Cron] Resolved ${resolved} bets · bankroll now $${bankroll.toFixed(2)}`);
      return res.status(200).json({ ok: true, resolved, bankroll });
    }

    return res.status(200).json({ ok: true, resolved: 0, message: "No games completed yet" });
  } catch(e) {
    console.error("[Cron] resolve-bets error:", e);
    return res.status(500).json({ error: e.message });
  }
}
