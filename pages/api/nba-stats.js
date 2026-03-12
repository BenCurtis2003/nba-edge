// pages/api/nba-stats.js
// Fetches rich NBA team stats from ESPN — called by run-engine
// Returns standings, home/away splits, last10, injuries for all 30 teams

export default async function handler(req, res) {
  if(req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`)
    return res.status(401).json({ error: "Unauthorized" });

  try {
    const stats = await fetchRichTeamStats();
    return res.status(200).json({ ok: true, teams: Object.keys(stats).length, stats });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}

export async function fetchRichTeamStats() {
  const stats = {};

  // Single ESPN teams call — includes record, home/away splits, last10
  const res = await fetch(
    "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams",
    { cache: "no-store" }
  );
  if(!res.ok) throw new Error(`ESPN teams HTTP ${res.status}`);
  const data = await res.json();

  for(const t of (data.sports?.[0]?.leagues?.[0]?.teams || [])) {
    const team = t.team;
    const name = team.displayName;
    const items = team.record?.items || [];

    const getRecord = (type) => {
      const item = items.find(i => i.type === type);
      if(!item) return { wins: 0, losses: 0 };
      const [w, l] = (item.summary || "0-0").split("-").map(Number);
      return { wins: w || 0, losses: l || 0 };
    };

    const overall = getRecord("total");
    const home    = getRecord("home");
    const away    = getRecord("road");
    const last10  = getRecord("lastTen");
    const streak  = items.find(i => i.type === "streak")?.summary || "0";

    stats[name] = {
      wins: overall.wins, losses: overall.losses,
      homeWins: home.wins, homeLosses: home.losses,
      awayWins: away.wins, awayLosses: away.losses,
      last10Wins: last10.wins, last10Losses: last10.losses,
      streak,
      abbrev: team.abbreviation,
      id: team.id,
    };
  }

  return stats;
}
