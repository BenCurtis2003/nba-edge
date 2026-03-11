import { fetchLiveOdds, fetchScores, extractEVBets, buildConvictionPlays, placeBets } from "../../../lib/engine";
import { getHistory, getBankroll, getMLModel, saveCurrentBets, saveConvictionPlays, saveLastRun, appendHistory, saveBankroll } from "../../../lib/store";

export default async function handler(req, res) {
  if(process.env.NODE_ENV === "production" && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`)
    return res.status(401).json({ error: "Unauthorized" });

  const ODDS_KEY = process.env.ODDS_API_KEY;
  const start = Date.now();

  try {
    const games = ODDS_KEY ? await fetchLiveOdds(ODDS_KEY) : null;
    const evBets = games ? extractEVBets(games) : [];
    console.log(`[Engine] ${evBets.length} EV bets found`);

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
    if(mlWeights) console.log("[Engine] Using ML-learned weights");

    const convictionPlays = await buildConvictionPlays(espnGames, mlWeights);
    console.log(`[Engine] ${convictionPlays.length} conviction plays`);

    const [history, bankroll] = await Promise.all([getHistory(), getBankroll()]);
    const { newEntries } = placeBets(evBets, convictionPlays, bankroll, history);

    await Promise.all([
      saveCurrentBets(evBets),
      saveConvictionPlays(convictionPlays),
      newEntries.length > 0 ? appendHistory(newEntries) : Promise.resolve(),
      saveLastRun(new Date().toISOString()),
    ]);

    return res.status(200).json({ ok:true, elapsed:Date.now()-start, evBets:evBets.length, convictionPlays:convictionPlays.length, newBetsPlaced:newEntries.length, bankroll, usingMLWeights:!!mlWeights });
  } catch(e) {
    console.error("[Engine] error:", e);
    return res.status(500).json({ error: e.message });
  }
}
