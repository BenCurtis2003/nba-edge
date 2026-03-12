import { fetchLiveOdds, extractEVBets, buildConvictionPlays, placeBets, fetchAndCacheTeamStats } from "../../../lib/engine";
import { getHistory, getBankroll, getMLModel, getCachedStandings, saveCurrentBets, saveConvictionPlays, saveLastRun, appendHistory, saveStandings } from "../../../lib/store";

export default async function handler(req, res) {
  if(process.env.NODE_ENV === "production" && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`)
    return res.status(401).json({ error: "Unauthorized" });

  const ODDS_KEY = process.env.ODDS_API_KEY;
  const start = Date.now();

  try {
    // 1. Fetch odds + cached standings in parallel
    const [games, cachedStats] = await Promise.all([
      ODDS_KEY ? fetchLiveOdds(ODDS_KEY) : Promise.resolve(null),
      getCachedStandings(),
    ]);

    // 2. Get team stats — use KV cache if fresh, else re-fetch from ESPN
    let teamStats = (cachedStats && Object.keys(cachedStats).length >= 20) ? cachedStats : null;
    if(!teamStats) {
      console.log("[Engine] Fetching fresh team stats from ESPN...");
      teamStats = await fetchAndCacheTeamStats(saveStandings);
    } else {
      console.log(`[Engine] Using cached team stats (${Object.keys(teamStats).length} teams)`);
    }

    // 3. Extract EV bets
    const evBets = games ? extractEVBets(games) : [];
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

    // 7. Place bets
    const [history, bankroll] = await Promise.all([getHistory(), getBankroll()]);
    const { newEntries } = placeBets(evBets, convictionPlays, bankroll, history);

    // 8. Save everything
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
      sampleRecord: convictionPlays[0] ? `${convictionPlays[0].selection}: ${convictionPlays[0].teamRecord}` : "none",
    });
  } catch(e) {
    console.error("[Engine] error:", e);
    return res.status(500).json({ error: e.message });
  }
}
