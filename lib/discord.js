// lib/discord.js — Discord webhook notifications for auto-placed bets

const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

function formatOdds(o) {
  if (!o) return "—";
  return o > 0 ? `+${o}` : `${o}`;
}

function bookEmoji(book) {
  const map = { draftkings:"🟢", fanduel:"🔵", betmgm:"🟡", betrivers:"🔴",
    pinnacle:"⚡", caesars:"🎰", kalshi:"🔮", estimated:"📊" };
  return map[book] || "📖";
}

export async function notifyBetsPlaced(newEntries) {
  if (!WEBHOOK_URL || !newEntries?.length) return;

  for (const bet of newEntries) {
    try {
      const isConviction = bet.isConviction;
      const isProp = bet.isProp;

      // Build embed color + type label
      const color = isProp ? 0xb44fff : isConviction ? 0xffd700 : 0x00ff88;
      const typeLabel = isProp ? "🏀 Player Prop" : isConviction ? "🎯 Conviction" : "⚡ +EV";
      const convScore = bet.convictionScore ? `  •  Conviction: **${bet.convictionScore}/100**` : "";

      const embed = {
        title: `${typeLabel} — ${bet.selection}`,
        color,
        fields: [
          {
            name: "Game",
            value: bet.game || "—",
            inline: true,
          },
          {
            name: "Odds",
            value: `${bookEmoji(bet.bestBook)} **${formatOdds(bet.bestOdds)}** @ ${bet.bestBook || "—"}`,
            inline: true,
          },
          {
            name: "Wager",
            value: `$${bet.wagerAmt?.toFixed(2) || "—"} → win $${bet.potentialPayout?.toFixed(2) || "—"}`,
            inline: true,
          },
          {
            name: "Edge / EV",
            value: bet.edge != null
              ? `+${(bet.edge * 100).toFixed(1)}% edge${convScore}`
              : `Conviction score: ${bet.convictionScore || "—"}${convScore}`,
            inline: false,
          },
          {
            name: "Bankroll",
            value: `$${bet.bankrollBefore?.toFixed(2) || "—"} → $${bet.bankrollBefore?.toFixed(2) || "—"} (after wager)`,
            inline: false,
          },
        ],
        footer: {
          text: `NBA Edge • ${new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles", month:"short", day:"numeric", hour:"numeric", minute:"2-digit", timeZoneName:"short" })}`,
        },
        timestamp: new Date().toISOString(),
      };

      await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ embeds: [embed] }),
      });

      // Small delay between messages to avoid rate limiting
      if (newEntries.length > 1) await new Promise(r => setTimeout(r, 500));
    } catch(e) {
      console.warn("[Discord] Failed to send notification:", e.message);
    }
  }
}

export async function notifyBetsResolved(resolvedEntries) {
  if (!WEBHOOK_URL || !resolvedEntries?.length) return;

  // Group into wins and losses
  const wins = resolvedEntries.filter(e => e.status === "won");
  const losses = resolvedEntries.filter(e => e.status === "lost");
  if (!wins.length && !losses.length) return;

  const lines = [];
  for (const bet of wins) {
    lines.push(`✅ **WIN** — ${bet.selection} (${formatOdds(bet.bestOdds)}) +$${bet.potentialPayout?.toFixed(2)}`);
  }
  for (const bet of losses) {
    lines.push(`❌ **LOSS** — ${bet.selection} (${formatOdds(bet.bestOdds)}) -$${bet.wagerAmt?.toFixed(2)}`);
  }

  const pnl = wins.reduce((s,b) => s + (b.potentialPayout||0), 0)
             - losses.reduce((s,b) => s + (b.wagerAmt||0), 0);

  try {
    await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        embeds: [{
          title: `📊 Results — ${wins.length}W / ${losses.length}L`,
          color: pnl >= 0 ? 0x00ff88 : 0xff4444,
          description: lines.join("\n"),
          fields: [{
            name: "Session P&L",
            value: `${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}`,
            inline: true,
          }],
          footer: { text: "NBA Edge Auto-Resolve" },
          timestamp: new Date().toISOString(),
        }],
      }),
    });
  } catch(e) {
    console.warn("[Discord] Failed to send resolve notification:", e.message);
  }
}
