// pages/api/debug-kalshi.js
// Diagnostic endpoint — shows raw Kalshi API response to debug team matching
import { fetchKalshiOdds } from "../../lib/engine";

export default async function handler(req, res) {
  if(req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`)
    return res.status(401).json({ error: "Unauthorized" });

  try {
    const markets = await fetchKalshiOdds();

    // Also fetch raw events to see what titles look like before parsing
    let rawEvents = [];
    try {
      const r = await fetch(
        "https://api.elections.kalshi.com/trade-api/v2/events?limit=200&with_nested_markets=true&status=open",
        { headers: { Accept: "application/json" }, cache: "no-store" }
      );
      if (r.ok) {
        const d = await r.json();
        // Pull out anything that looks NBA-related
        rawEvents = (d.events || [])
          .filter(e => {
            const t = (e.title || e.event_ticker || "").toLowerCase();
            return t.includes("nba") || t.includes("basketball") ||
              (e.event_ticker || "").toUpperCase().includes("NBA") ||
              (e.event_ticker || "").toUpperCase().startsWith("KX");
          })
          .map(e => ({
            event_ticker: e.event_ticker,
            title: e.title,
            markets: (e.markets || []).slice(0, 3).map(m => ({
              ticker: m.ticker,
              title: m.title,
              yes_bid: m.yes_bid,
              yes_ask: m.yes_ask,
              volume: m.volume,
            })),
          }));
      }
    } catch(e2) {
      rawEvents = [{ error: e2.message }];
    }

    return res.status(200).json({
      parsedMarkets: markets,
      parsedCount: markets.length,
      rawNBAEvents: rawEvents,
      rawNBAEventCount: rawEvents.length,
    });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
