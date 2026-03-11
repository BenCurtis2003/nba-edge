// pages/api/cron/run-engine.js
// Runs every 8 minutes via Vercel Cron.
// Fetches live odds, builds conviction plays, places bets into shared portfolio.

import {
  fetchLiveOdds, fetchScores,
  extractEVBets, buildConvictionPlays, placeBets,
} from "../../../lib/engine";
import {
  getHistory, getBankroll, getMLModel,
  saveCurrentBets, saveConvictionPlays, saveLastRun,
  appendHistory, saveBankroll,
} from "../../../lib/store";

export default async function handler(req, res) {
  // Verify request is from Vercel Cron (or allow manual trigger with secret)
  const authHeader = req.headers.authorization;
  if(process.env.NODE_ENV === "production" &&
     authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const ODDS_KEY = process.env.ODDS_API_KEY;
  const startTime = Date.now();

  try {
    console.log("[Cron] run-engine starting...");

    // 1. Fetch live odds from The Odds API
    const games = ODDS_KEY ? await fetchLiveOdds(ODDS_KEY) : null;

    // 2. Extract EV bets from live lines
    const evBets = games ? extractEVBets(games) : [];
    console.log(`[Cron] ${evBets.length} EV bets found`);

    // 3. Fetch ESPN games for conviction engine (always free)
    let espnGames = games || [];
    if(!games) {
      // No Odds API key — fetch games from ESPN scoreboard
      const espnRes = await fetch(
        "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard"
      );
      if(espnRes.ok) {
        const espnData = await espnRes.json();
        espnGames = (espnData.events || []).map(e => ({
          away_team: e.competitions?.[0]?.competitors?.find(c=>c.homeAway==="away")?.team?.displayName || "",
          home_team: e.competitions?.[0]?.competitors?.find(c=>c.homeAway==="home")?.team?.displayName || "",
          commence_time: e.date,
          bookmakers: [],
        })).filter(g => g.away_team && g.home_team);
      }
    }

    // 4. Build conviction plays (ESPN stats, free)
    const convictionPlays = await buildConvictionPlays(espnGames);
    console.log(`[Cron] ${convictionPlays.length} conviction plays built`);

    // 5. Load current portfolio state
    const [history, bankroll] = await Promise.all([getHistory(), getBankroll()]);

    // 6. Place qualifying bets into portfolio
    const { newEntries } = placeBets(evBets, convictionPlays, bankroll, history);
    console.log(`[Cron] ${newEntries.length} new bets placed`);

    // 7. Persist everything
    await Promise.all([
      saveCurrentBets(evBets),
      saveConvictionPlays(convictionPlays),
      newEntries.length > 0 ? appendHistory(newEntries) : Promise.resolve(),
      saveLastRun(new Date().toISOString()),
    ]);

    const elapsed = Date.now() - startTime;
    console.log(`[Cron] run-engine complete in ${elapsed}ms`);

    return res.status(200).json({
      ok: true,
      elapsed,
      evBets: evBets.length,
      convictionPlays: convictionPlays.length,
      newBetsPlaced: newEntries.length,
      bankroll,
    });
  } catch(e) {
    console.error("[Cron] run-engine error:", e);
    return res.status(500).json({ error: e.message });
  }
}
