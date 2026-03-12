// pages/api/admin/reset-history.js
// Wipes bet history and resets bankroll to $100, keeping conviction/EV data intact
import { getKV, setKV } from "../../../lib/store";

export default async function handler(req, res) {
  if(req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`)
    return res.status(401).json({ error: "Unauthorized" });

  try {
    await setKV("bet_history", []);
    await setKV("bankroll", 100);
    await setKV("ml_weights", null);
    return res.status(200).json({ ok: true, message: "History cleared, bankroll reset to $100" });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
