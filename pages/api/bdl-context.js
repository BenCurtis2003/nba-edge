// pages/api/bdl-context.js
// Returns BDL statistical context for a play — called client-side on row expand.

const BDL_BASE = "https://api.balldontlie.io/v1";

async function bdlFetch(path) {
  const res = await fetch(`${BDL_BASE}${path}`, {
    headers: { Authorization: `Bearer ${process.env.BALLDONTLIE_API_KEY}` },
  });
  if (!res.ok) throw new Error(`BDL ${path} → HTTP ${res.status}`);
  return res.json();
}

// Infer stat key and prop line from selection string
// e.g. "LeBron James Over 27.5 Points" → { stat: "pts", line: 27.5 }
function parseSelection(selection) {
  const s = selection || "";
  let stat = "pts";
  if (/rebounds|reb/i.test(s)) stat = "reb";
  else if (/assists|ast/i.test(s)) stat = "ast";
  else if (/three|3pm|threes/i.test(s)) stat = "fg3m";

  const lineMatch = s.match(/(\d+\.?\d*)/);
  const line = lineMatch ? parseFloat(lineMatch[1]) : null;

  // Player name: everything before "Over" or "Under"
  const nameMatch = s.match(/^(.+?)\s+(over|under)/i);
  const playerName = nameMatch ? nameMatch[1].trim() : s.split(" ").slice(0, 2).join(" ");

  return { stat, line, playerName };
}

// Current NBA season year (start year of season)
function currentSeason() {
  const now = new Date();
  return now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1;
}

// Days between two ISO date strings
function daysBetween(dateA, dateB) {
  return Math.round(
    Math.abs(new Date(dateA) - new Date(dateB)) / (1000 * 60 * 60 * 24)
  );
}

async function fetchPropsContext(selection, targetDate) {
  const { stat, line, playerName } = parseSelection(selection);

  // 1. Find player
  const playerRes = await bdlFetch(`/players?search=${encodeURIComponent(playerName)}&per_page=5`);
  const player = playerRes.data?.[0];
  if (!player) return { error: "not_found" };

  const playerId = player.id;
  const teamId = player.team?.id;

  // 2. Season averages
  const avgRes = await bdlFetch(`/season_averages?season=${currentSeason()}&player_ids[]=${playerId}`);
  const avgData = avgRes.data?.[0] || {};
  const seasonAvg = avgData[stat] ?? null;

  // 3. Last 6 completed games for the team (we'll take 5 with scores)
  const gamesRes = await bdlFetch(
    `/games?team_ids[]=${teamId}&per_page=6&postseason=false`
  );
  const completedGames = (gamesRes.data || [])
    .filter(g => g.status === "Final")
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 5);

  if (!completedGames.length) return { error: "not_found" };

  // 4. Player stat for each game (sequential to respect rate limits).
  // Note: all API/network errors are collapsed into { error: "unavailable" } at the
  // handler level — rate limits (429) and auth errors (401) are intentionally treated
  // the same per spec scope.
  const last5 = [];
  for (const g of completedGames) {
    try {
      const statRes = await bdlFetch(`/stats?game_ids[]=${g.id}&player_ids[]=${playerId}&per_page=1`);
      const statLine = statRes.data?.[0];
      const value = statLine?.[stat] ?? null;
      if (value !== null) {
        const hitsLine = line !== null ? value > line : null;
        last5.push({ date: g.date, value, hitsLine });
      }
    } catch (_) {
      // skip game if stat fetch fails
    }
  }

  const hitsCount = last5.filter(g => g.hitsLine).length;
  const hitRate = last5.length > 0 ? hitsCount / last5.length : null;

  // Rest calculation: days since most recent completed game
  const mostRecentGame = completedGames[0];
  const restDays = mostRecentGame ? daysBetween(targetDate, mostRecentGame.date) : null;
  const isBackToBack = restDays !== null && restDays <= 1;

  return {
    type: "player",
    playerName,
    stat,
    propLine: line,
    last5,
    hitRate,
    seasonAvg,
    restDays,
    isBackToBack,
    opponentContext: null,
  };
}

async function fetchTeamContext(betType, selection, game, targetDate) {
  // Parse team name: for ML/SPR the selection IS the team name
  // e.g. "Los Angeles Lakers" or "Lakers -5.5"
  const teamName = selection.replace(/[+-]?\d+\.?\d*$/, "").trim();

  // 1. Find team
  const teamRes = await bdlFetch(`/teams?search=${encodeURIComponent(teamName)}`);
  const team = teamRes.data?.[0];
  if (!team) return { error: "not_found" };

  const teamId = team.id;

  // 2. Last 6 completed games
  const gamesRes = await bdlFetch(
    `/games?team_ids[]=${teamId}&per_page=6&postseason=false`
  );
  const completedGames = (gamesRes.data || [])
    .filter(g => g.status === "Final")
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 5);

  if (!completedGames.length) return { error: "not_found" };

  // Build last5 based on betType
  const last5 = completedGames.map(g => {
    const isHome = g.home_team?.id === teamId;
    const teamScore = isHome ? g.home_team_score : g.visitor_team_score;
    const oppScore = isHome ? g.visitor_team_score : g.home_team_score;
    const margin = teamScore - oppScore;
    const total = teamScore + oppScore;

    let value, hitsLine;
    if (betType === "Game Total") {
      // Parse line from selection: "Over 224.5" or "Under 224.5"
      const lineMatch = selection.match(/(\d+\.?\d*)/);
      const line = lineMatch ? parseFloat(lineMatch[1]) : null;
      const isOver = /over/i.test(selection);
      value = total;
      hitsLine = line !== null ? (isOver ? total > line : total < line) : null;
    } else {
      // ML or Spread — value is margin
      value = margin;
      if (betType === "Spread") {
        const lineMatch = selection.match(/([+-]?\d+\.?\d*)$/);
        const spread = lineMatch ? parseFloat(lineMatch[1]) : null;
        hitsLine = spread !== null ? margin + spread > 0 : null;
      } else {
        hitsLine = margin > 0; // ML: did they win?
      }
    }
    return { date: g.date, value, hitsLine };
  });

  const hitsCount = last5.filter(g => g.hitsLine).length;
  const hitRate = last5.length > 0 ? hitsCount / last5.length : null;

  const mostRecentGame = completedGames[0];
  const restDays = mostRecentGame ? daysBetween(targetDate, mostRecentGame.date) : null;
  const isBackToBack = restDays !== null && restDays <= 1;

  return {
    type: "team",
    teamName: team.full_name,
    stat: betType === "Game Total" ? "total" : "margin",
    propLine: null,
    last5,
    hitRate,
    seasonAvg: null,
    restDays,
    isBackToBack,
    opponentContext: null,
  };
}

export default async function handler(req, res) {
  const { betType = "Moneyline", selection = "", game = "", gameDate } = req.query;
  const targetDate = gameDate || new Date().toISOString().slice(0, 10);

  try {
    if (betType === "Props") {
      const ctx = await fetchPropsContext(selection, targetDate);
      return res.status(200).json(ctx);
    } else {
      const ctx = await fetchTeamContext(betType, selection, game, targetDate);
      return res.status(200).json(ctx);
    }
  } catch (e) {
    console.error("bdl-context error:", e.message);
    return res.status(200).json({ error: "unavailable" });
  }
}
