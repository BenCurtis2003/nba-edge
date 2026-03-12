import { fetchLiveOdds, extractEVBets, buildConvictionPlays, placeBets, fetchAndCacheTeamStats, fetchScores, resolveHistory } from "../../../lib/engine";
import { fetchPlayerProps, extractPropEV, placePropBets, resolveProps, fetchPlayerStats, fetchTeamDefenseStats } from "../../../lib/props";
import { getHistory, getBankroll, getMLModel, getCachedStandings, saveCurrentBets, saveConvictionPlays, saveLastRun, appendHistory, saveStandings, saveHistory, saveBankroll, updateMLAfterResolution, getPropBets, savePropBets } from "../../../lib/store";

export default async function handler(req, res) {
  if(process.env.NODE_ENV === "production" && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`)
    return res.status(401).json({ error: "Unauthorized" });

  const ODDS_KEY = process.env.ODDS_API_KEY_1 || process.env.ODDS_API_KEY; // kept for backwards compat
  const start = Date.now();

  try {
    // 0. Check if there are any upcoming games worth fetching odds for.
    // Check today + tomorrow — Odds API opens next day lines by ~10 AM ET.
    let hasUpcomingGames = true;
    try {
      const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0,10).replace(/-/g,"");
      const [todayRes, tomorrowRes] = await Promise.all([
        fetch("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard", { cache:"no-store" }),
        fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${tomorrow}`, { cache:"no-store" }),
      ]);
      const now = new Date();
      let upcoming = [];
      if (todayRes.ok) {
        const d = await todayRes.json();
        upcoming = upcoming.concat((d.events||[]).filter(e => new Date(e.date) > now));
      }
      if (tomorrowRes.ok) {
        const d = await tomorrowRes.json();
        upcoming = upcoming.concat(d.events||[]);
      }
      hasUpcomingGames = upcoming.length > 0;
      if (!hasUpcomingGames) console.log("[Engine] No upcoming games found — skipping Odds API");
      else console.log(`[Engine] ${upcoming.length} upcoming games found`);
    } catch(e) { /* proceed normally if check fails */ }

    // 1. Fetch odds + cached standings in parallel (skip odds if no upcoming games)
    const [games, cachedStats] = await Promise.all([
      ODDS_KEY && hasUpcomingGames ? fetchLiveOdds(ODDS_KEY) : Promise.resolve(null),
      getCachedStandings(),
    ]);

    // 2. Get team stats — use KV cache only if it has real data (wins > 0 for most teams)
    let teamStats = null;
    if(cachedStats && Object.keys(cachedStats).length >= 20) {
      // Validate cache has real records (not all zeros)
      const nonZero = Object.values(cachedStats).filter(t => (t.wins||0) > 0).length;
      if(nonZero >= 15) {
        teamStats = cachedStats;
        console.log(`[Engine] Using cached team stats (${Object.keys(cachedStats).length} teams, ${nonZero} with records)`);
      } else {
        console.log(`[Engine] Cache has ${nonZero} non-zero records — forcing fresh fetch`);
      }
    }
    if(!teamStats) {
      console.log("[Engine] Fetching fresh team stats from ESPN...");
      teamStats = await fetchAndCacheTeamStats(saveStandings);
    }

    // 3. Extract EV bets
    const evBets = games ? extractEVBets(games) : [];

    // Fetch + extract player props with full conviction engine
    const propGames = games ? await fetchPlayerProps(ODDS_KEY, games) : [];
    const [playerStats, defenseStats] = propGames.length > 0
      ? await Promise.all([fetchPlayerStats(), fetchTeamDefenseStats()])
      : [{}, {}];
    const evProps = extractPropEV(propGames, playerStats, defenseStats);
    console.log(`[Props] ${evProps.length} EV props, ${Object.keys(playerStats).length} players loaded`);
    console.log(`[Engine] ${evBets.length} EV bets`);

    // 4. ESPN game list for conviction engine
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

    // 5. ML weights
    const ml = await getMLModel();
    const mlWeights = ml?.learnedWeights || null;

    // 6. Build conviction plays — pass teamStats directly so no module cache needed
    const convictionPlays = await buildConvictionPlays(espnGames, mlWeights, teamStats || {});
    console.log(`[Engine] ${convictionPlays.length} conviction plays · sample record: ${convictionPlays[0]?.teamRecord}`);

    // 7. Auto-resolve finished games before placing new bets
    const [history, bankroll] = await Promise.all([getHistory(), getBankroll()]);
    let resolvedCount = 0, currentBankroll = bankroll;
    const pendingBets = history.filter(h => h.status === "pending");
    if (pendingBets.length > 0) {
      const scores = await fetchScores(ODDS_KEY);
      if (scores.length > 0) {
        const { history: updatedHistory, bankroll: newBankroll, changed } = resolveHistory(history, scores);
        if (changed) {
          const nowResolved = updatedHistory.filter(h =>
            pendingBets.some(p => p.id === h.id) && h.status !== "pending"
          );
          resolvedCount = nowResolved.length;
          currentBankroll = newBankroll;
          await Promise.all([saveHistory(updatedHistory), saveBankroll(newBankroll)]);
          if (nowResolved.length > 0) await updateMLAfterResolution(nowResolved);
          const wins = nowResolved.filter(b => b.status === "won").length;
          const losses = nowResolved.filter(b => b.status === "lost").length;
          console.log(`[AutoResolve] ${resolvedCount} settled (${wins}W/${losses}L) · $${newBankroll.toFixed(2)}`);
        }
      }
    }

    // 8. Place new bets (use fresh history + bankroll after resolution)
    // Resolve pending prop bets via ESPN box scores
    const { history: histAfterPropResolve, changed: propsChanged } = await resolveProps(
      resolvedCount > 0 ? await getHistory() : history
    );
    if (propsChanged) {
      await saveHistory(histAfterPropResolve);
    }

    const freshHistory = propsChanged ? await getHistory() : (resolvedCount > 0 ? await getHistory() : history);
    const { newEntries } = placeBets(evBets, convictionPlays, currentBankroll, freshHistory);
    const { newEntries: newPropEntries } = placePropBets(evProps, currentBankroll, freshHistory);

    // 9. Save everything
    await Promise.all([
      saveCurrentBets(evBets),
      saveConvictionPlays(convictionPlays),
      savePropBets(evProps),
      newEntries.length > 0 ? appendHistory(newEntries) : Promise.resolve(),
      newPropEntries.length > 0 ? appendHistory(newPropEntries) : Promise.resolve(),
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
      kalshiMarkets: (games||[]).filter(g => (g.bookmakers||[]).some(b=>b.key==="kalshi")).length,
      teamStatsLoaded: teamStats ? Object.keys(teamStats).length : 0,
      sampleRecord: convictionPlays[0] ? `${convictionPlays[0].selection}: ${convictionPlays[0].teamRecord}` : "none",
      sampleEV: evBets[0] ? `${evBets[0].selection} ${(evBets[0].edge*100).toFixed(1)}% edge` : "none",
      hasUpcomingGames,
      propBetsFound: evProps.length,
      propBetsPlaced: newPropEntries.length,
    });
  } catch(e) {
    console.error("[Engine] error:", e);
    return res.status(500).json({ error: e.message });
  }
}
