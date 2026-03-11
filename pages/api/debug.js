import { fetchLiveOdds, extractEVBets } from "../../lib/engine";

export default async function handler(req, res) {
  const auth = req.headers.authorization;
  if(auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const ODDS_KEY = process.env.ODDS_API_KEY;
  if(!ODDS_KEY) return res.status(400).json({ error: "No ODDS_API_KEY set" });
  try {
    const games = await fetchLiveOdds(ODDS_KEY);
    if(!games) return res.status(500).json({ error: "Odds API returned null" });
    const evBets = extractEVBets(games);
    const gameSummary = games.map(g => ({
      game: `${g.away_team} @ ${g.home_team}`,
      books: (g.bookmakers||[]).map(b => b.key),
      hasPinnacle: (g.bookmakers||[]).some(b => b.key === "pinnacle"),
      markets: [...new Set((g.bookmakers||[]).flatMap(b => (b.markets||[]).map(m => m.key)))],
    }));
    return res.status(200).json({ totalGames: games.length, evBetsFound: evBets.length, evBets: evBets.slice(0,5), gameSummary });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
