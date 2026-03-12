import { fetchLiveOdds, extractEVBets, buildConvictionPlays, placeBets, fetchAndCacheTeamStats, setTeamStatsCache } from "../../../lib/engine";
import { getHistory, getBankroll, getMLModel, getCachedStandings, saveCurrentBets, saveConvictionPlays, saveLastRun, appendHistory, saveStandings } from "../../../lib/store";

export default async function handler(req, res) {
  if(process.env.NODE_ENV === "production" && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`)
    return res.status(401).json({ error: "Unauthorized" });

  const ODDS_KEY = process.env.ODDS_API_KEY;
  const start = Date.now();

  try {
    // 1. Fetch live odds + team stats in parallel (both needed before conviction scoring)
    const [gamesResult, cachedStats] = await Promise.all([
      ODDS_KEY ? fetchLiveOdds(ODDS_KEY) : Promise.resolve(null),
      getCachedStandings(),
    ]);
    const games = gamesResult;

    // 2. Get fresh team stats — use cache if < 6hrs old, otherwise re-fetch
    let teamStats = cachedStats && Object.keys(cachedStats).length > 5 ? cachedStats : null;
    if(!teamStats) {
      teamStats = await fetchAndCacheTeamStats(saveStandings);
    }
    // Inject into engine module cache so fetchTeamData() uses real records
    if(teamStats) setTeamStatsCache(teamStats);

    // 3. Extract EV bets from odds
    const evBets = games ? extractEVBets(games) : [];
    console.log(`[Engine] ${evBets.length} EV bets found`);

    // 4. Build game list for conviction engine
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

    // 5. Load ML weights
    const ml = await getMLModel();
    const mlWeights = ml?.learnedWeights || null;
    if(mlWeights) console.log("[Engine] Using ML-learned weights");

    // 6. Build conviction plays (now has real team stats from setTeamStatsCache)
    const convictionPlays = await buildConvictionPlays(espnGames, mlWeights);
    console.log(`[Engine] ${convictionPlays.length} conviction plays, teamStats: ${teamStats ? Object.keys(teamStats).length : 0} teams`);

    // 7. Place bets
    const [history, bankroll] = await Promise.all([getHistory(), getBankroll()]);
    const { newEntries } = placeBets(evBets, convictionPlays, bankroll, history);

    // 8. Persist
    await Promise.all([
      saveCurrentBets(evBets),
      saveConvictionPlays(convictionPlays),
      newEntries.length > 0 ? appendHistory(newEntries) : Promise.resolve(),
      saveLastRun(new Date().toISOString()),
    ]);

    return res.status(200).json({
      ok: true, elapsed: Date.now()-start,
      evBets: evBets.length, convictionPlays: convictionPlays.length,
      newBetsPlaced: newEntries.length, bankroll,
      usingMLWeights: !!mlWeights,
      teamStatsLoaded: teamStats ? Object.keys(teamStats).length : 0,
    });
  } catch(e) {
    console.error("[Engine] error:", e);
    return res.status(500).json({ error: e.message });
  }
}
