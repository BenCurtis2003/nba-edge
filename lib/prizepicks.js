// lib/prizepicks.js
// PrizePicks line comparison engine.
// Fetches public PP projections and compares them to our true probability model.
// PrizePicks is DFS pick'em — flat payouts, no American odds.

const PP_API_URL = "https://api.prizepicks.com/projections?league_id=7&per_page=250&single_stat=true";
const PP_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept": "application/json",
  "X-Device-ID": "nba-edge-v2",
};

// Maps PrizePicks stat_type labels → our Odds API market keys
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

// Implied probabilities per PP odds_type:
// standard → -110 each way (0.5238), demon → -125 (0.5556), goblin → +110 (0.4762)
const PP_IMPLIED = {
  standard: 0.5238,
  demon:    0.5556,
  goblin:   0.4762,
};

// ── Fetch ─────────────────────────────────────────────────────────────────────

export async function fetchPrizePicksLines() {
  try {
    const res = await fetch(PP_API_URL, { headers: PP_HEADERS, cache: "no-store" });
    if (!res.ok) {
      console.warn(`[PrizePicks] Lines unavailable — fetch blocked (${res.status})`);
      return [];
    }
    const json = await res.json();

    // PP API shape: { data: [...projections], included: [...players/teams] }
    const projections = json.data || [];
    const included    = json.included || [];

    // Build player lookup from included: id → { name, team }
    const playerMap = {};
    for (const item of included) {
      if (item.type === "new_player") {
        playerMap[item.id] = {
          name: item.attributes?.name || "",
          team: item.attributes?.team || item.attributes?.team_name || "",
        };
      }
    }

    const lines = [];
    for (const proj of projections) {
      const attr = proj.attributes || {};
      const statType = attr.stat_type || "";
      const market = PP_STAT_MAP[statType];
      if (!market) continue; // skip unmapped stats

      // Resolve player from relationships
      const playerRel = proj.relationships?.new_player?.data;
      const playerInfo = playerRel ? (playerMap[playerRel.id] || {}) : {};

      const oddsType = (attr.odds_type || "standard").toLowerCase();

      lines.push({
        id:          proj.id,
        player:      playerInfo.name  || attr.description || "",
        team:        playerInfo.team  || "",
        market,
        marketLabel: statType,
        line:        +(attr.line_score || 0),
        oddsType,
        isDemon:     oddsType === "demon",
        isGoblin:    oddsType === "goblin",
        source:      "prizepicks",
      });
    }

    console.log(`[PrizePicks] ${lines.length} projections loaded`);
    return lines;
  } catch (e) {
    console.warn("[PrizePicks] Lines unavailable — fetch blocked:", e.message);
    return [];
  }
}

// ── Compare ───────────────────────────────────────────────────────────────────

// Normalize player names for fuzzy matching: lowercase, strip accents, collapse spaces
function normName(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

export function comparePrizePicksToModel(ppLines, evProps) {
  const results = [];

  for (const ppLine of ppLines) {
    const ppNorm   = normName(ppLine.player);
    const ppImplied = PP_IMPLIED[ppLine.oddsType] || PP_IMPLIED.standard;

    // Find matching evProp by player name + market key
    const match = evProps.find(p =>
      normName(p.player) === ppNorm && p.market === ppLine.market
    );

    if (!match) {
      results.push({ ...ppLine, matched: false });
      continue;
    }

    const trueProb    = (match.trueProb || 50) / 100; // evProps store as 0-100
    const ppEdgePct   = +((trueProb - ppImplied) * 100).toFixed(2);
    const recommendation = trueProb > ppImplied ? "OVER" : "UNDER";
    const ourLine     = match.line ?? null;
    const lineDiff    = ourLine != null ? +(ppLine.line - ourLine).toFixed(1) : null;
    const isValueBet  = ppEdgePct >= 3.5;

    results.push({
      ...ppLine,
      matched:         true,
      trueProb:        +(trueProb * 100).toFixed(1),  // back to 0-100 for display
      ppImplied:       +(ppImplied * 100).toFixed(1),
      ppEdgePct,
      recommendation,
      ourLine,
      lineDiff,
      isValueBet,
      convictionScore: match.convictionScore ?? null,
    });
  }

  return results;
}
