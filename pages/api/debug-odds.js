// pages/api/debug-odds.js — test odds API key rotation directly
import { fetchOddsAPI, getAllKeyQuotas } from "../../lib/odds-keys";

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`)
    return res.status(401).json({ error: "Unauthorized" });

  const quotas = await getAllKeyQuotas();
  
  // Check env vars are loaded
  const keyCheck = {
    ODDS_API_KEY_1: process.env.ODDS_API_KEY_1 ? `...${process.env.ODDS_API_KEY_1.slice(-6)}` : "MISSING",
    ODDS_API_KEY_2: process.env.ODDS_API_KEY_2 ? `...${process.env.ODDS_API_KEY_2.slice(-6)}` : "MISSING",
    ODDS_API_KEY_3: process.env.ODDS_API_KEY_3 ? `...${process.env.ODDS_API_KEY_3.slice(-6)}` : "MISSING",
    ODDS_API_KEY:   process.env.ODDS_API_KEY   ? `...${process.env.ODDS_API_KEY.slice(-6)}`   : "MISSING",
  };

  // Try a minimal Odds API call
  let testResult = null;
  try {
    const start = Date.now();
    const { data, quotaRemaining } = await fetchOddsAPI(
      "https://api.the-odds-api.com/v4/sports/basketball_nba/odds/?regions=us&markets=h2h&oddsFormat=american"
    );
    testResult = {
      ok: true,
      elapsed: Date.now() - start,
      gamesReturned: Array.isArray(data) ? data.length : 0,
      quotaRemaining,
      sample: Array.isArray(data) && data[0] ? `${data[0].away_team} @ ${data[0].home_team}` : null,
    };
  } catch(e) {
    testResult = { ok: false, error: e.message };
  }

  return res.status(200).json({ keyCheck, quotas, testResult });
}
