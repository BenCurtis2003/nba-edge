export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { anthropicKey, bet } = req.body;
  if (!anthropicKey || !bet) return res.status(400).json({ error: "Missing key or bet" });

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 400,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages: [{
          role: "user",
          content: `You are an NBA betting analyst. Search for the latest injury reports, lineup news, and player health updates for this bet: "${bet.selection}" in game "${bet.game}". Respond ONLY with valid JSON (no markdown, no backticks): {"newsScore":7,"newsSummary":"2-3 sentence summary of key findings","lineMove":"any line movement info","trend":"up"}`
        }]
      })
    });

    const data = await response.json();
    const text = data.content?.find(b => b.type === "text")?.text;
    if (!text) return res.status(200).json({ newsScore: 5, newsSummary: "No analysis available.", lineMove: "", trend: "stable" });

    try {
      const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
      return res.status(200).json(parsed);
    } catch {
      return res.status(200).json({ newsScore: 5, newsSummary: text.slice(0, 200), lineMove: "", trend: "stable" });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
