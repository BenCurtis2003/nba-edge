// pages/api/live-games.js
export const config = { maxDuration: 25 };

import { getConvictionPlays, getCurrentBets, getAllProps } from "../../lib/store";

const BDL_BASE = "https://api.balldontlie.io/v1";

async function bdlFetch(path) {
  const key = process.env.BALLDONTLIE_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`${BDL_BASE}${path}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

function norm(s) {
  return (s || "").toLowerCase().replace(/[^a-z]/g, " ").replace(/\s+/g, " ").trim();
}

function impliedProb(odds) {
  if (!odds) return 0.5;
  return odds < 0 ? (-odds) / (-odds + 100) : 100 / (odds + 100);
}

function probToML(prob) {
  if (prob >= 50) return Math.round(-(prob / (100 - prob)) * 100);
  return Math.round(((100 - prob) / prob) * 100);
}

function probToSpread(homeProb) {
  return +(-(homeProb - 50) * 0.4).toFixed(1);
}

async function fetchScoreboard() {
  const res = await fetch(
    "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard",
    { cache: "no-store" }
  );
  if (!res.ok) return [];
  const d = await res.json();
  return (d.events || []).map(ev => {
    const comp = ev.competitions?.[0];
    const away = comp?.competitors?.find(c => c.homeAway === "away");
    const home = comp?.competitors?.find(c => c.homeAway === "home");
    const st = comp?.status?.type;
    return {
      id: ev.id,
      away: {
        abbr: away?.team?.abbreviation || "",
        name: away?.team?.displayName || "",
        score: away?.score ?? null,
        record: away?.records?.[0]?.summary || "",
        logo: away?.team?.logo || "",
      },
      home: {
        abbr: home?.team?.abbreviation || "",
        name: home?.team?.displayName || "",
        score: home?.score ?? null,
        record: home?.records?.[0]?.summary || "",
        logo: home?.team?.logo || "",
      },
      status: {
        state: st?.state || "pre",
        live: st?.state === "in",
        final: st?.completed || false,
        period: comp?.status?.period || 0,
        displayClock: comp?.status?.displayClock || "",
      },
      date: ev.date,
    };
  });
}

async function fetchBoxScore(eventId) {
  try {
    const res = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${eventId}`,
      { cache: "no-store" }
    );
    if (!res.ok) return [];
    const d = await res.json();
    const players = [];
    for (const teamEntry of (d.boxscore?.players || [])) {
      const teamAbbr = teamEntry.team?.abbreviation || "";
      for (const athlete of (teamEntry.statistics?.[0]?.athletes || [])) {
        const stats = athlete.statistics || [];
        // ESPN order: MIN FG 3PT FT OREB DREB REB AST STL BLK TO PF PTS
        const [min, , threes, , , , reb, ast, , , , , pts] = stats;
        const parseMin = (m) => {
          if (!m || m === "--" || m === "0:00") return 0;
          const parts = m.split(":");
          return parseInt(parts[0], 10) + (parseInt(parts[1], 10) || 0) / 60;
        };
        const tpmMade = threes ? parseInt((threes || "0").split("-")[0], 10) : 0;
        players.push({
          espnId: athlete.athlete?.id || null,
          name: athlete.athlete?.displayName || "",
          teamAbbr,
          live: {
            pts: parseInt(pts, 10) || 0,
            reb: parseInt(reb, 10) || 0,
            ast: parseInt(ast, 10) || 0,
            tpm: tpmMade,
            min: parseMin(min),
          },
        });
      }
    }
    return players;
  } catch { return []; }
}

async function buildAlgoMap() {
  const [convPlays, evBets] = await Promise.all([
    getConvictionPlays(),
    getCurrentBets(),
  ]);

  const algoMap = {};

  for (const play of (convPlays || [])) {
    const teamName = (play.selection || "").replace(/ ML$/i, "").trim();
    const key = norm(teamName);
    if (!algoMap[key]) algoMap[key] = {};
    algoMap[key].homeWinProb = play.ourProbability;
    algoMap[key].allLines = play.allLines || {};
  }

  for (const bet of (evBets || [])) {
    if (bet.betType === "Game Total") {
      const match = (bet.selection || "").match(/(\d+\.?\d*)/);
      if (match) {
        const total = parseFloat(match[1]);
        const algoTotal = +(total + (bet.edge || 0) * 100).toFixed(1);
        algoMap[`total:${total}`] = { algoTotal, allTotalLines: bet.allLines };
      }
    }
    if (bet.betType === "Spread") {
      const teamName = (bet.selection || "").replace(/\s+[-+]\d.*$/, "").trim();
      const key = norm(teamName);
      const match = (bet.selection || "").match(/([-+]?\d+\.?\d*)\s*$/);
      if (match) {
        if (!algoMap[key]) algoMap[key] = {};
        algoMap[key].algoSpread = parseFloat(match[1]);
      }
    }
  }

  return algoMap;
}

const ESPN_TO_BDL_ABBR = {
  GS: "GSW", NO: "NOP", UTAH: "UTA", SA: "SAS", NY: "NYK", WSH: "WAS",
};

async function fetchSeasonAvgsForPlayers(espnPlayers) {
  if (!espnPlayers.length || !process.env.BALLDONTLIE_API_KEY) return {};

  const abbrs = [...new Set(espnPlayers.map(p => p.teamAbbr))];
  const bdlTeamsRes = await bdlFetch("/teams?per_page=30");
  if (!bdlTeamsRes?.data) return {};

  const byAbbr = {};
  for (const t of bdlTeamsRes.data) {
    if (t.abbreviation) byAbbr[t.abbreviation.toLowerCase()] = t.id;
  }

  const bdlTeamIds = abbrs
    .map(a => byAbbr[(ESPN_TO_BDL_ABBR[a] || a).toLowerCase()])
    .filter(Boolean);

  const bdlPlayersByName = {};
  for (const tid of bdlTeamIds) {
    const r = await bdlFetch(`/players?team_ids[]=${tid}&per_page=100`);
    for (const p of (r?.data || [])) {
      bdlPlayersByName[norm(`${p.first_name} ${p.last_name}`)] = p.id;
    }
  }

  const bdlIds = [];
  const espnToBdlId = {};
  for (const ep of espnPlayers) {
    const bdlId = bdlPlayersByName[norm(ep.name)];
    if (bdlId) { bdlIds.push(bdlId); espnToBdlId[ep.name] = bdlId; }
  }

  if (!bdlIds.length) return {};

  const season = new Date().getMonth() >= 9
    ? new Date().getFullYear() : new Date().getFullYear() - 1;
  const seasonAvg = {};
  const BATCH = 8;
  for (let i = 0; i < bdlIds.length; i += BATCH) {
    const batch = bdlIds.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(id => bdlFetch(`/season_averages?season=${season}&player_ids[]=${id}`))
    );
    for (const r of results) {
      for (const a of (r?.data || [])) seasonAvg[a.player_id] = a;
    }
  }

  const avgByName = {};
  for (const ep of espnPlayers) {
    const bdlId = espnToBdlId[ep.name];
    if (bdlId && seasonAvg[bdlId]) {
      const a = seasonAvg[bdlId];
      avgByName[ep.name] = {
        pts: parseFloat(a.pts) || 0,
        reb: parseFloat(a.reb) || 0,
        ast: parseFloat(a.ast) || 0,
        tpm: parseFloat(a.fg3m) || 0,
        min: parseFloat(a.min) || 0,
      };
    }
  }
  return avgByName;
}

function computeProjection(currentStat, seasonAvg, seasonMin, period, displayClock) {
  if (!seasonMin || seasonMin < 5) return null;
  const clockParts = (displayClock || "0:00").split(":");
  const clockMinutes = parseInt(clockParts[0], 10) + (parseInt(clockParts[1], 10) || 0) / 60;
  const elapsed = (period - 1) * 12 + (12 - clockMinutes);
  const remaining = Math.max(0, 48 - elapsed);
  const rate = seasonAvg / seasonMin;
  return +(currentStat + rate * remaining).toFixed(1);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=25, stale-while-revalidate=30");

  try {
    const [games, algoMap, allPropsKv] = await Promise.all([
      fetchScoreboard(),
      buildAlgoMap(),
      getAllProps(),
    ]);

    // Build prop lines lookup: normName → statKey → { line, side }
    const MARKET_TO_STAT = {
      player_points: "pts", player_rebounds: "reb", player_assists: "ast",
      player_threes: "tpm", player_points_rebounds_assists: "pra",
    };
    const propLinesMap = {};
    for (const prop of (allPropsKv || [])) {
      const k = norm(prop.player || "");
      if (!propLinesMap[k]) propLinesMap[k] = {};
      const statKey = MARKET_TO_STAT[prop.market];
      if (statKey && prop.line != null) {
        // prefer Over side; don't overwrite if same stat already stored
        if (!propLinesMap[k][statKey] || prop.side === "Over") {
          propLinesMap[k][statKey] = { line: prop.line, side: prop.side };
        }
      }
    }

    if (!games.length) {
      return res.status(200).json({ games: [], books: [], lastUpdated: new Date().toISOString() });
    }

    const boxScoreMap = {};
    await Promise.all(
      games.filter(g => g.status.live).map(async g => {
        boxScoreMap[g.id] = await fetchBoxScore(g.id);
      })
    );

    const allLivePlayers = Object.values(boxScoreMap).flat();
    const seasonAvgByName = allLivePlayers.length > 0
      ? await fetchSeasonAvgsForPlayers(allLivePlayers)
      : {};

    const bookSet = new Set();
    const result = games.map(game => {
      const homeKey = norm(game.home.name);
      const awayKey = norm(game.away.name);
      const homeAlgo = algoMap[homeKey] || {};
      const awayAlgo = algoMap[awayKey] || {};
      const isHomeAlgo = Object.keys(homeAlgo).length > 0;
      const algoData = isHomeAlgo ? homeAlgo : awayAlgo;

      const lines = {};
      for (const [bk, line] of Object.entries(algoData.allLines || {})) {
        bookSet.add(bk);
        if (!lines[bk]) lines[bk] = {};
        if (line.odds != null) lines[bk].ml = line.odds;
        if (line.point != null) lines[bk].spread = line.point;
      }

      // Pull spread/total from EV bets if available
      for (const [bk, line] of Object.entries((algoMap[homeKey]?.allLines || algoMap[awayKey]?.allLines || {}))) {
        if (!lines[bk]) lines[bk] = {};
        if (line.point != null && lines[bk].spread == null) lines[bk].spread = line.point;
      }

      const rawProb = algoData.homeWinProb;
      const homeWinProb = rawProb != null
        ? (isHomeAlgo ? rawProb : 100 - rawProb)
        : null;

      let algoTotal = null;
      for (const [k, v] of Object.entries(algoMap)) {
        if (k.startsWith("total:") && v.algoTotal) {
          algoTotal = v.algoTotal;
          // also add total lines to lines map
          for (const [bk, tl] of Object.entries(v.allTotalLines || {})) {
            bookSet.add(bk);
            if (!lines[bk]) lines[bk] = {};
            if (tl.point != null) lines[bk].total = tl.point;
          }
          break;
        }
      }

      const algo = homeWinProb != null ? {
        homeWinProb,
        predictedHomeML: probToML(homeWinProb),
        predictedAwayML: probToML(100 - homeWinProb),
        predictedSpread: probToSpread(homeWinProb),
        predictedTotal: algoTotal,
      } : null;

      let edge = null;
      const firstBook = Object.keys(lines)[0];
      if (algo && firstBook && lines[firstBook]?.ml) {
        const bookML = lines[firstBook].ml;
        const bookProb = impliedProb(bookML);
        const mlEdgePct = +((homeWinProb / 100 - bookProb) * 100).toFixed(1);
        edge = {
          ml: {
            pct: mlEdgePct,
            lean: mlEdgePct > 0 ? "home" : mlEdgePct < 0 ? "away" : null,
            label: mlEdgePct > 2 ? `${game.home.abbr} EDGE`
                 : mlEdgePct < -2 ? `${game.away.abbr} EDGE`
                 : "NEUTRAL",
          },
          spread: algo.predictedSpread != null ? {
            pts: algo.predictedSpread,
            label: algo.predictedSpread < -1 ? "HOME COVER"
                 : algo.predictedSpread > 1 ? "AWAY COVER"
                 : "PUSH",
          } : null,
          total: algo.predictedTotal ? { pts: null, direction: null } : null,
        };
      }

      const livePlayers = boxScoreMap[game.id] || [];
      const players = livePlayers
        .map(ep => {
          const avg = seasonAvgByName[ep.name];
          const proj = avg && game.status.live ? {
            pts: computeProjection(ep.live.pts, avg.pts, avg.min, game.status.period, game.status.displayClock),
            reb: computeProjection(ep.live.reb, avg.reb, avg.min, game.status.period, game.status.displayClock),
            ast: computeProjection(ep.live.ast, avg.ast, avg.min, game.status.period, game.status.displayClock),
            tpm: computeProjection(ep.live.tpm, avg.tpm, avg.min, game.status.period, game.status.displayClock),
          } : null;
          const pra = proj
            ? +((proj.pts || 0) + (proj.reb || 0) + (proj.ast || 0)).toFixed(1)
            : null;
          const propLines = propLinesMap[norm(ep.name)] || {};
          return {
            name: ep.name,
            espnId: ep.espnId,
            teamAbbr: ep.teamAbbr,
            live: ep.live,
            season: avg || null,
            proj: proj ? { ...proj, pra } : null,
            propLines,
          };
        })
        .filter(p => p.live.min > 0 || p.live.pts > 0)
        .sort((a, b) => (b.proj?.pra ?? b.live.pts) - (a.proj?.pra ?? a.live.pts));

      return { ...game, lines, algo, edge, players };
    });

    return res.status(200).json({
      games: result,
      books: [...bookSet],
      lastUpdated: new Date().toISOString(),
    });
  } catch (e) {
    console.error("[LiveGames]", e);
    return res.status(500).json({ error: e.message, games: [] });
  }
}
