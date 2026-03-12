// pages/api/debug-kv.js — inspect what's actually in KV
import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  if(req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`)
    return res.status(401).json({ error: "Unauthorized" });

  try {
    const standings = await kv.get("nba_edge:standings");
    const keys = Object.keys(standings || {});
    const sample = {};
    // Show first 5 teams with their records
    keys.slice(0, 5).forEach(k => { sample[k] = standings[k]; });
    
    // Check non-zero
    const nonZero = keys.filter(k => (standings[k]?.wins || 0) > 0);
    
    return res.status(200).json({
      totalTeams: keys.length,
      nonZeroRecords: nonZero.length,
      nonZeroTeams: nonZero,
      sample,
    });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
