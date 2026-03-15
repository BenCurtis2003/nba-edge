// lib/prizepicks.js — PrizePicks line comparison engine
// Fetches NBA projections from PrizePicks public API and compares
// against our true probability model to find edges.

const PP_API_URL = "https://api.prizepicks.com/projections?league_id=7&per_page=250&single_stat=true";

const PP_STAT_MAP = {
  "Points":                    "player_points",
  "Rebounds":                  "player_rebounds",
  "Assists":                   "player_assists",
  "3-Pointers Made":           "player_threes",
  "Pts+Rebs+Asts":             "player_points_rebounds_assists",
  "Pts+Rebs":                  "player_points_rebounds",
  "Pts+Asts":                  "player_points_assists",
  "Blocked Shots":             "player_blocks",
  "Steals":                    "player_steals",
  "Turnovers":                 "player_turnovers",
};

// PrizePicks implied probabilities by odds type
// Standard = -110 equiv, Demon = harder (-125 equiv), Goblin = easier (+110 equiv)
const PP_IMPLIED = { standard: 0.5238, demon: 0.5556, goblin: 0.4762 };

export async function fetchPrizePicksLines() {
  try {
    const res = await fetch(PP_API_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept": "application/json",
        "X-Device-ID": "nba-edge-v2",
        "Referer": "https://app.prizepicks.com/",
      },
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn(`[PrizePicks] HTTP ${res.status} — fetch blocked or unavailable`);
      return { lines: [], error: true };
    }
    const data = await res.json();
    const projections = data?.data || [];
    const included    = data?.included || [];

    // Build player lookup from included resources
    const playerMap = {};
    for (const item of included) {
      if (item.type === "new_player" || item.type === "player") {
        playerMap[item.id] = item.attributes;
      }
    }

    const lines = [];
    for (const proj of projections) {
      const attrs    = proj.attributes || {};
      const marketKey = PP_STAT_MAP[attrs.stat_type];
      if (!marketKey) continue; // unsupported stat type

      const oddsType   = attrs.odds_type || "standard";
      // Resolve player name: try direct attributes first, then included lookup
      const includedPlayer = playerMap[proj.relationships?.new_player?.data?.id] || {};
      const playerName =
        attrs.player_display_name ||
        attrs.name ||
        includedPlayer.name ||
        includedPlayer.display_name ||
        "Unknown";

      lines.push({
        id:          proj.id,
        player:      playerName,
        team:        attrs.team || includedPlayer.team || "",
        market:      marketKey,
        marketLabel: attrs.stat_type,
        line:        parseFloat(attrs.line_score) || 0,
        flashLine:   attrs.flash_sale_line_score ? parseFloat(attrs.flash_sale_line_score) : null,
        oddsType,
        isDemon:     oddsType === "demon",
        isGoblin:    oddsType === "goblin",
        isPromo:     attrs.is_promo || false,
        source:      "prizepicks",
      });
    }
    console.log(`[PrizePicks] Fetched ${lines.length} projections`);
    return { lines, error: false };
  } catch(e) {
    console.warn("[PrizePicks] Fetch failed:", e.message);
    return { lines: [], error: true };
  }
}

// Normalize player names for fuzzy matching: lowercase, strip accents + punctuation
function normName(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function comparePrizePicksToModel(ppLines, evProps) {
  const valueBets = [];
  const unmatched = [];
  let matchedCount = 0;

  for (const ppLine of ppLines) {
    const ppNorm = normName(ppLine.player);

    // Try exact name + market first, then last-name suffix + market
    const matched =
      evProps.find(p => normName(p.player) === ppNorm && p.market === ppLine.market) ||
      evProps.find(p =>
        (normName(p.player).includes(ppNorm.slice(-6)) ||
         ppNorm.includes(normName(p.player).slice(-6))) &&
        p.market === ppLine.market
      );

    if (!matched) {
      unmatched.push({ ...ppLine, matched: false });
      continue;
    }

    matchedCount++;
    const ppImplied  = PP_IMPLIED[ppLine.oddsType] || PP_IMPLIED.standard;
    const trueProb   = (matched.trueProb || 50) / 100; // evProps store 0-100
    const ppEdgePct  = +((trueProb - ppImplied) * 100).toFixed(2);
    const recommendation = trueProb > ppImplied ? "OVER" : "UNDER";
    const ourLine    = matched.line ?? null;
    const lineDiff   = ourLine != null ? +(ppLine.line - ourLine).toFixed(1) : null;
    const isValueBet = ppEdgePct >= 3.5;

    const result = {
      ...ppLine,
      matched:         true,
      trueProb:        +(trueProb * 100).toFixed(1),
      ppImplied:       +(ppImplied * 100).toFixed(1),
      ppEdgePct,
      recommendation,
      ourLine,
      lineDiff,
      isValueBet,
      convictionScore: matched.convictionScore ?? null,
      edge:            matched.edge ?? null,
      playerSeasonAvg: matched.playerSeasonAvg ?? null,
      playerL5Avg:     matched.playerL5Avg ?? null,
    };

    if (isValueBet) valueBets.push(result);
  }

  // Sort value bets by absolute edge descending
  valueBets.sort((a, b) => Math.abs(b.ppEdgePct) - Math.abs(a.ppEdgePct));

  return {
    valueBets,
    unmatched,
    total:   ppLines.length,
    matched: matchedCount,
  };
}
