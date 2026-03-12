// pages/api/debug-kalshi.js — v2: probe correct NBA game market endpoints
export default async function handler(req, res) {
  if(req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`)
    return res.status(401).json({ error: "Unauthorized" });

  const BASE = "https://api.elections.kalshi.com/trade-api/v2";
  const headers = { Accept: "application/json", "User-Agent": "nba-edge/1.0" };
  const results = {};

  // Probe every likely path for NBA game markets
  const probes = [
    // Their sports product may use series_ticker
    `${BASE}/events?limit=50&status=open&series_ticker=KXPROBBALL`,
    `${BASE}/events?limit=50&status=open&series_ticker=KXNBAGAME`,
    `${BASE}/events?limit=50&status=open&series_ticker=KXSPORTS`,
    `${BASE}/events?limit=50&status=open&series_ticker=KXBALL`,
    // Category filter
    `${BASE}/events?limit=100&status=open&category=sports`,
    `${BASE}/events?limit=100&status=open&category=basketball`,
    // Markets endpoint (flat list, different from events)
    `${BASE}/markets?limit=100&status=open&series_ticker=KXPROBBALL`,
    `${BASE}/markets?limit=100&status=open`,
    // Try with_nested=false which sometimes returns more events
    `${BASE}/events?limit=200&status=open&with_nested_markets=false`,
  ];

  for (const url of probes) {
    const key = url.split("v2/")[1].slice(0, 60);
    try {
      const r = await fetch(url, { headers, cache: "no-store" });
      const text = await r.text();
      if (!r.ok) { results[key] = `HTTP ${r.status}: ${text.slice(0,100)}`; continue; }
      const d = JSON.parse(text);
      const list = d.events || d.markets || [];
      // Filter for anything sports/basketball related
      const sports = list.filter(e => {
        const t = (e.title || e.event_ticker || e.ticker || "").toLowerCase();
        return t.includes("minnesota") || t.includes("orlando") || t.includes("lakers") ||
               t.includes("basketball") || t.includes("nba") || t.includes("clippers") ||
               t.includes("phoenix") || t.includes("indiana") || t.includes("celtics") ||
               t.includes("washington") || (e.series_ticker||"").includes("SPORT") ||
               (e.series_ticker||"").includes("BALL") || (e.series_ticker||"").includes("NBA");
      });
      results[key] = {
        total: list.length,
        sportsMatches: sports.length,
        // Show series tickers to find the right one
        seriesTickers: [...new Set(list.map(e => e.series_ticker || e.ticker?.split("-")[0]).filter(Boolean))].slice(0, 20),
        sportsItems: sports.slice(0, 3).map(e => ({
          ticker: e.ticker || e.event_ticker,
          series: e.series_ticker,
          title: e.title,
        })),
      };
    } catch(e) {
      results[key] = `Error: ${e.message}`;
    }
  }

  return res.status(200).json(results);
}
