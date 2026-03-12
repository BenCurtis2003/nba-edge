// pages/api/debug-espn.js — temporary debug endpoint to see raw ESPN response
export default async function handler(req, res) {
  if(req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`)
    return res.status(401).json({ error: "Unauthorized" });

  try {
    // Try multiple ESPN endpoints to find which one has records
    const [teamsRes, standingsRes] = await Promise.all([
      fetch("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams", { cache:"no-store" }),
      fetch("https://site.web.api.espn.com/apis/v2/sports/basketball/nba/standings?season=2025", { cache:"no-store" }),
    ]);

    const teamsData = teamsRes.ok ? await teamsRes.json() : { error: teamsRes.status };
    const standingsData = standingsRes.ok ? await standingsRes.json() : { error: standingsRes.status };

    // Sample first team from each
    const firstTeam = teamsData?.sports?.[0]?.leagues?.[0]?.teams?.[0]?.team;
    const firstEntry = standingsData?.children?.[0]?.standings?.entries?.[0];

    return res.status(200).json({
      teamsEndpoint: {
        status: teamsRes.status,
        teamName: firstTeam?.displayName,
        recordKeys: Object.keys(firstTeam?.record || {}),
        recordItems: firstTeam?.record?.items?.slice(0,3),
        rawRecord: firstTeam?.record,
      },
      standingsEndpoint: {
        status: standingsRes.status,
        entryKeys: firstEntry ? Object.keys(firstEntry) : [],
        teamName: firstEntry?.team?.displayName,
        stats: firstEntry?.stats?.slice(0,6),
      },
    });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
