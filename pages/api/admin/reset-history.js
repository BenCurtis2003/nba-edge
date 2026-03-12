// pages/api/admin/reset-history.js
import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  if(req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`)
    return res.status(401).json({ error: "Unauthorized" });
  try {
    await kv.set("nba_edge:history", []);
    await kv.set("nba_edge:bankroll", 100);
    await kv.del("nba_edge:ml_model");
    await kv.del("nba_edge:current_bets");
    return res.status(200).json({ ok: true, message: "History cleared, bankroll reset to $100" });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
