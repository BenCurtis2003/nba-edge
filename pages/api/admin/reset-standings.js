import { Redis } from "@upstash/redis";
const kv = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });

export default async function handler(req, res) {
  if(req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`)
    return res.status(401).json({ error: "Unauthorized" });

  try {
    // Inspect current conviction plays before deleting
    const convictions = await kv.get("nba_edge:conviction_plays") || [];
    const sample = convictions.slice(0, 3).map(p => ({
      selection: p.selection,
      teamRecord: p.teamRecord,
      oppRecord: p.oppRecord,
      score: p.convictionScore,
    }));

    if(req.method === "POST") {
      // POST = actually clear and re-run
      await Promise.all([
        kv.del("nba_edge:standings"),
        kv.del("nba_edge:conviction_plays"),
      ]);
      const origin = `https://${req.headers.host}`;
      const engineRes = await fetch(`${origin}/api/cron/run-engine`, {
        headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
      });
      const engineData = await engineRes.json();
      return res.status(200).json({ ok: true, cleared: true, engineRun: engineData });
    }

    // GET = just inspect
    return res.status(200).json({
      convictionCount: convictions.length,
      sampleRecords: sample,
    });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
