// pages/api/debug-quota.js — Check remaining quota on all Odds API keys
import { getAllKeyQuotas } from "../../../lib/odds-keys";

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`)
    return res.status(401).json({ error: "Unauthorized" });

  const quotas = await getAllKeyQuotas();
  return res.status(200).json({ ok: true, keys: quotas });
}
