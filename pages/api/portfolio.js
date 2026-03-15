// pages/api/portfolio.js
// Public endpoint — returns the shared portfolio for all visitors.
// No authentication required — this is the live track record.

import { getPortfolioSnapshot, getPropBets, getPrizePicksBets } from "../../lib/store";


async function checkUpcomingGames() {
  try {
    const res = await fetch("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard", { cache:"no-store" });
    if (!res.ok) return true;
    const data = await res.json();
    const now = new Date();
    return (data.events||[]).some(e => new Date(e.date) > now);
  } catch(e) { return true; }
}

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

    const [propBets, ppBets, hasUpcomingGames] = await Promise.all([
      getPropBets(),
      getPrizePicksBets(),
      checkUpcomingGames(),
    ]);
    const prizePicksMap = {};
    for (const bet of ppBets) {
      const key = `${(bet.player || "").toLowerCase()}:${bet.market}`;
      prizePicksMap[key] = bet;
    }

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
      propBets,
      prizePicksBets: ppBets,
      prizePicksMap,
      hasUpcomingGames,
    });
  } catch(e) {
    console.error("[API] portfolio error:", e);
    return res.status(500).json({ error: "Failed to load portfolio" });
  }
}
