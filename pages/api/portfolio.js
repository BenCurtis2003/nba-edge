// pages/api/portfolio.js
// Public endpoint — returns the shared portfolio for all visitors.
// No authentication required — this is the live track record.

import { getPortfolioSnapshot } from "../../lib/store";
import { getPropBets } from "../../lib/store";

export default async function handler(req, res) {
  // Cache for 30 seconds — fresh enough for live feel, avoids KV hammering
  res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");

  try {
    const snapshot = await getPortfolioSnapshot();
    const { history, bankroll, ml, bets, conviction, lastRun } = snapshot;

    // Compute stats
    const resolved = history.filter(h => h.status === "won" || h.status === "lost");
    const won = resolved.filter(h => h.status === "won");
    const winRate = resolved.length > 0 ? +((won.length / resolved.length) * 100).toFixed(1) : 0;
    const totalPnl = +(bankroll - 100).toFixed(2);
    const roi = resolved.length > 0
      ? +(resolved.reduce((s,h) => s + (h.status==="won" ? h.potentialPayout : -h.wagerAmt), 0) /
          resolved.reduce((s,h) => s + h.wagerAmt, 0) * 100).toFixed(1)
      : 0;

    return res.status(200).json({
      bankroll,
      totalPnl,
      winRate,
      roi,
      record: { wins: won.length, losses: resolved.length - won.length },
      history: history.slice(-200), // last 200 bets
      currentBets: bets,
      convictionPlays: conviction,
      lastRun,
      mlStatus: ml.totalBets >= 15 ? "Active" : "Learning",
      mlBets: ml.totalBets || 0,
      propBets: await getPropBets(),
    });
  } catch(e) {
    console.error("[API] portfolio error:", e);
    return res.status(500).json({ error: "Failed to load portfolio" });
  }
}
