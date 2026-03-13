// lib/odds-keys.js — Multi-key Odds API rotation with quota tracking
// Tracks x-requests-remaining per key in Vercel KV, auto-rotates when quota is low.

import { Redis } from "@upstash/redis";
const kv = new Redis({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });

const KEYS = [
  process.env.ODDS_API_KEY_1,
  process.env.ODDS_API_KEY_2,
  process.env.ODDS_API_KEY_3,
].filter(Boolean);

const KV_PREFIX = "nba_edge:odds_quota:";
const MIN_REMAINING = 1; // only skip keys that are truly exhausted

// ── PUBLIC: get the best available key ───────────────────────────────────────

export async function getBestOddsKey() {
  if (!KEYS.length) return null;
  if (KEYS.length === 1) return KEYS[0];

  // Load quota state for all keys in parallel
  const quotaEntries = await Promise.all(
    KEYS.map(async key => {
      const short = key.slice(-6);
      try {
        const stored = await kv.get(`${KV_PREFIX}${short}`);
        return {
          key,
          short,
          remaining: stored?.remaining ?? 999, // assume full if never used
          lastChecked: stored?.lastChecked ?? 0,
        };
      } catch(e) {
        return { key, short, remaining: 999, lastChecked: 0 };
      }
    })
  );

  // Sort: most remaining first, but treat stale reads (>2hr) as unknown (999)
  const now = Date.now();
  const ranked = quotaEntries
    .map(e => ({
      ...e,
      effectiveRemaining: (now - e.lastChecked) > 7200000 ? 999 : e.remaining,
    }))
    .sort((a, b) => b.effectiveRemaining - a.effectiveRemaining);

  const best = ranked[0];
  console.log(`[OddsKeys] Using key ...${best.short} (${best.effectiveRemaining} req remaining)`);
  ranked.forEach(e => {
    if (e.key !== best.key)
      console.log(`[OddsKeys] Backup key ...${e.short}: ${e.effectiveRemaining} remaining`);
  });

  return best.key;
}

// ── PUBLIC: update quota after a response ────────────────────────────────────

export async function updateKeyQuota(key, remainingHeader) {
  if (!key || remainingHeader === null || remainingHeader === undefined) return;
  const remaining = parseInt(remainingHeader, 10);
  if (isNaN(remaining)) return;
  const short = key.slice(-6);
  try {
    await kv.set(`${KV_PREFIX}${short}`, {
      remaining,
      lastChecked: Date.now(),
      keyHint: short,
    });
    if (remaining < 20) {
      console.warn(`[OddsKeys] ⚠️  Key ...${short} LOW QUOTA: ${remaining} requests left`);
    }
  } catch(e) { /* non-critical */ }
}

// ── PUBLIC: fetch with auto-rotation ─────────────────────────────────────────
// Drop-in replacement: fetchWithKeyRotation(url_without_apiKey, options)
// Appends the best available key, retries with next key on 401/429/quota exhausted.

export async function fetchOddsAPI(urlTemplate, options = {}) {
  if (!KEYS.length) throw new Error("No Odds API keys configured");

  // Load all quotas to build rotation order
  const quotaEntries = await Promise.all(
    KEYS.map(async key => {
      const short = key.slice(-6);
      try {
        const stored = await kv.get(`${KV_PREFIX}${short}`);
        const now = Date.now();
        const stale = (now - (stored?.lastChecked ?? 0)) > 7200000;
        return { key, short, remaining: stale ? 999 : (stored?.remaining ?? 999) };
      } catch(e) {
        return { key, short, remaining: 999 };
      }
    })
  );

  const rotation = [...quotaEntries]
    .sort((a, b) => b.remaining - a.remaining)
    .filter(e => e.remaining > 0);

  if (!rotation.length) {
    // All keys show 0 remaining — but quota resets monthly, try anyway
    console.warn("[OddsKeys] All keys show 0 quota — attempting with least-recently-used key");
    const fallback = quotaEntries.sort((a,b) => a.remaining - b.remaining)[0];
    if (fallback) rotation.push(fallback);
    else throw new Error("[OddsKeys] No API keys configured");
  }

  let lastError = null;
  for (const { key, short, remaining } of rotation) {
    if (remaining < MIN_REMAINING) {
      console.warn(`[OddsKeys] Skipping key ...${short} (only ${remaining} left)`);
      lastError = new Error(`Key ...${short} below MIN_REMAINING`);
      continue;
    }

    const url = urlTemplate.includes("apiKey=")
      ? urlTemplate.replace(/apiKey=[^&]+/, `apiKey=${key}`)
      : `${urlTemplate}${urlTemplate.includes("?") ? "&" : "?"}apiKey=${key}`;

    try {
      const res = await fetch(url, { cache: "no-store", ...options });
      const quotaRemaining = res.headers.get("x-requests-remaining");
      await updateKeyQuota(key, quotaRemaining);

      if (res.status === 401) {
        console.warn(`[OddsKeys] Key ...${short} returned 401 — rotating`);
        await updateKeyQuota(key, "0"); // mark as exhausted
        lastError = new Error(`401 on key ...${short}`);
        continue;
      }
      if (res.status === 429) {
        console.warn(`[OddsKeys] Key ...${short} rate-limited (429) — rotating`);
        await updateKeyQuota(key, "0");
        lastError = new Error(`429 on key ...${short}`);
        continue;
      }
      if (!res.ok) {
        lastError = new Error(`HTTP ${res.status} on key ...${short}`);
        continue;
      }

      const data = await res.json();
      if (data?.message?.toLowerCase().includes("quota")) {
        console.warn(`[OddsKeys] Key ...${short} quota message — rotating`);
        await updateKeyQuota(key, "0");
        lastError = new Error(`Quota exceeded on key ...${short}`);
        continue;
      }

      console.log(`[OddsKeys] ✓ Key ...${short} OK (${quotaRemaining ?? "?"} remaining)`);
      return { data, key, quotaRemaining };
    } catch(e) {
      lastError = e;
      console.warn(`[OddsKeys] Key ...${short} fetch error: ${e.message}`);
    }
  }

  throw lastError || new Error("[OddsKeys] All keys failed");
}

// ── PUBLIC: get quota status for all keys (for debug endpoint) ───────────────

export async function getAllKeyQuotas() {
  return Promise.all(
    KEYS.map(async key => {
      const short = key.slice(-6);
      try {
        const stored = await kv.get(`${KV_PREFIX}${short}`);
        return {
          keyHint: `...${short}`,
          remaining: stored?.remaining ?? "unknown",
          lastChecked: stored?.lastChecked
            ? new Date(stored.lastChecked).toISOString()
            : "never",
        };
      } catch(e) {
        return { keyHint: `...${short}`, remaining: "error", lastChecked: "error" };
      }
    })
  );
}
