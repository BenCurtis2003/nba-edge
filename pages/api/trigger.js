// pages/api/trigger.js
// Optional manual trigger — POST with { secret: CRON_SECRET } to run engine immediately.
// Useful for testing and seeding initial data after deployment.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { secret } = req.body || {};
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Invalid secret" });
  }

  try {
    // Call both crons sequentially
    const base = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000";

    const cronHeaders = {
      Authorization: `Bearer ${process.env.CRON_SECRET}`,
      "Content-Type": "application/json",
    };

    const [engineRes, resolveRes] = await Promise.all([
      fetch(`${base}/api/cron/run-engine`, { headers: cronHeaders }),
      fetch(`${base}/api/cron/resolve-bets`, { headers: cronHeaders }),
    ]);

    const [engineData, resolveData] = await Promise.all([
      engineRes.json(),
      resolveRes.json(),
    ]);

    return res.status(200).json({
      ok: true,
      engine: engineData,
      resolve: resolveData,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
