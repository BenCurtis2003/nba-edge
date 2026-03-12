// pages/api/debug-resolve.js
import { fetchScores, resolveHistory } from "../../lib/engine";
import { getHistory, getBankroll } from "../../lib/store";

export default async function handler(req, res) {
  if(req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`)
    return res.status(401).json({ error: "Unauthorized" });

  try {
    const [scores, history, bankroll] = await Promise.all([
      fetchScores(process.env.ODDS_API_KEY),
      getHistory(),
      getBankroll(),
    ]);

    const pending = history.filter(h => h.status === "pending");

    // Try to match each pending bet to a score
    const matchResults = pending.map(bet => {
      const matched = scores.find(s => {
        const g = bet.game.toLowerCase();
        const hN = s.home_team.toLowerCase().split(" ").pop();
        const aN = s.away_team.toLowerCase().split(" ").pop();
        return g.includes(hN) && g.includes(aN);
      });
      return {
        bet: bet.selection,
        game: bet.game,
        gameTime: bet.gameTime || bet.date,
        gameAgeHours: +((Date.now() - new Date(bet.gameTime || bet.date)) / 3600000).toFixed(1),
        matchedScore: matched ? `${matched.away_team} @ ${matched.home_team} | completed=${matched.completed}` : "NO MATCH",
        scores: matched?.scores,
      };
    });

    // Run the actual resolver dry
    const { history: updated, bankroll: newBankroll, changed } = resolveHistory(history, scores);
    const resolved = updated.filter((h, i) => h.status !== "pending" && history[i]?.status === "pending");

    return res.status(200).json({
      scoresFound: scores.length,
      scores: scores.map(s => ({
        game: `${s.away_team} @ ${s.home_team}`,
        completed: s.completed,
        score: s.scores?.map(t => `${t.name}: ${t.score}`).join(" | "),
      })),
      pendingBets: pending.length,
      matchResults,
      wouldResolve: resolved.length,
      wouldResolveDetails: resolved.map(h => ({ selection: h.selection, status: h.status, estimated: h.estimatedResult })),
      changed,
      newBankroll,
    });
  } catch(e) {
    return res.status(500).json({ error: e.message, stack: e.stack });
  }
}
