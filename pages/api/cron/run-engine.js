import { fetchLiveOdds, extractEVBets, buildConvictionPlays, placeBets, fetchAndCacheTeamStats, fetchScores, resolveHistory } from "../../../lib/engine";
import { getHistory, getBankroll, getMLModel, getCachedStandings, saveCurrentBets, saveConvictionPlays, saveLastRun, appendHistory, saveStandings, saveHistory, saveBankroll, updateMLAfterResolution } from "../../../lib/store";

export default async function handler(req, res) {
  if(process.env.NODE_ENV === "production" && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`)
    return res.status(401).json({ error: "Unauthorized" });

  const ODDS_KEY = process.env.ODDS_API_KEY;
  const start = Date.now();

  try {
    const [games, cachedStats] = await Promise.all([
      ODDS_KEY ? fetchLiveOdds(ODDS_KEY) : Promise.resolve(null),
      getCachedStandings(),
    ]);

    let teamStats = null;
    if(cachedStats && Object.keys(cachedStats).length >= 20) {
      const nonZero = Object.values(cachedStats).filter(t => (t.wins||0) > 0).length;
      if(nonZero >= 15) teamStats = cachedStats;
    }
    if(!teamStats) teamStats = await fetchAndCacheTeamStats(saveStandings);

    const evBets = games ? extractEVBets(games) : [];

    let espnGames = games || [];
    if(!games) {
      const r = await fetch("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard");
      if(r.ok) {
        const d = await r.json();
        espnGames = (d.events||[]).map(e => ({
          away_team: e.competitions?.[0]?.competitors?.find(c=>c.homeAway==="away")?.team?.displayName||"",
          home_team: e.competitions?.[0]?.competitors?.find(c=>c.homeAway==="home")?.team?.displayName||"",
          commence_time: e.date, bookmakers:[],
        })).filter(g=>g.away_team&&g.home_team);
      }
    }

    const ml = await getMLModel();
    const mlWeights = ml?.learnedWeights || null;
    const convictionPlays = await buildConvictionPlays(espnGames, mlWeights, teamStats || {});

    // Auto-resolve finished games
    const [history, bankroll] = await Promise.all([getHistory(), getBankroll()]);
    let resolvedCount = 0, currentBankroll = bankroll;
    const pendingBets = history.filter(h => h.status === "pending");
    if(pendingBets.length > 0) {
      const scores = await fetchScores(ODDS_KEY);
      console.log(`[AutoResolve] ${scores.length} completed scores found, ${pendingBets.length} pending bets`);
      if(scores.length > 0) {
        const { history: updatedHistory, bankroll: newBankroll, changed } = resolveHistory(history, scores);
        if(changed) {
          const nowResolved = updatedHistory.filter(h =>
            pendingBets.some(p => p.id === h.id) && h.status !== "pending"
          );
          resolvedCount = nowResolved.length;
          currentBankroll = newBankroll;
          await Promise.all([saveHistory(updatedHistory), saveBankroll(newBankroll)]);
          if(nowResolved.length > 0) await updateMLAfterResolution(nowResolved);
          const wins = nowResolved.filter(b => b.status === "won").length;
          const losses = nowResolved.filter(b => b.status === "lost").length;
          console.log(`[AutoResolve] ${resolvedCount} settled (${wins}W/${losses}L) · $${newBankroll.toFixed(2)}`);
        }
      }
    }

    const freshHistory = resolvedCount > 0 ? await getHistory() : history;
    const { newEntries } = placeBets(evBets, convictionPlays, currentBankroll, freshHistory);

    await Promise.all([
      saveCurrentBets(evBets),
      saveConvictionPlays(convictionPlays),
      newEntries.length > 0 ? appendHistory(newEntries) : Promise.resolve(),
      saveLastRun(new Date().toISOString()),
    ]);

    return res.status(200).json({
      ok: true, elapsed: Date.now()-start,
      evBets: evBets.length, convictionPlays: convictionPlays.length,
      newBetsPlaced: newEntries.length, bankroll: currentBankroll,
      autoResolved: resolvedCount,
      usingMLWeights: !!mlWeights,
      gamesFromAPI: games?.length || 0,
      espnGames: espnGames.length,
      evBetsFound: evBets.length, convictionFound: convictionPlays.length,
      kalshiMarkets: (games||[]).reduce((n,g) => n + ((g.bookmakers||[]).some(b=>b.key==="kalshi") ? 1 : 0), 0),
      teamStatsLoaded: teamStats ? Object.keys(teamStats).length : 0,
      sampleRecord: convictionPlays[0] ? `${convictionPlays[0].selection}: ${convictionPlays[0].teamRecord}` : "none",
      sampleEV: evBets[0] ? `${evBets[0].selection} ${(evBets[0].edge*100).toFixed(1)}% edge` : "none",
    });
  } catch(e) {
    console.error("[Engine] error:", e);
    return res.status(500).json({ error: e.message });
  }
}
