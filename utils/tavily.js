import { tavily } from "@tavily/core";
import dotenv from "dotenv";
dotenv.config();

const tvly = tavily({ apiKey: process.env.TAVILY_KEY });

// ════════════════════════════════════════════════════════════
// In-memory cache. Keyed by stringified options. 24h TTL.
// At ~$0.005 per advanced search this saves real money on
// repeat queries (e.g. "skincare trends Pakistan").
// For production, swap to Redis with the same get/set shape.
// ════════════════════════════════════════════════════════════
const CACHE = new Map();
const TTL_MS = 24 * 60 * 60 * 1000;

const cacheKey = (query, opts) =>
  JSON.stringify({ q: query.toLowerCase().trim(), o: opts || {} });

const fromCache = (key) => {
  const hit = CACHE.get(key);
  if (!hit) return null;
  if (Date.now() - hit.savedAt > TTL_MS) {
    CACHE.delete(key);
    return null;
  }
  return hit.value;
};

const toCache = (key, value) => {
  CACHE.set(key, { savedAt: Date.now(), value });
  // Soft cap so the in-memory map can't bloat indefinitely.
  if (CACHE.size > 500) {
    const oldest = [...CACHE.entries()].sort((a, b) => a[1].savedAt - b[1].savedAt)[0];
    if (oldest) CACHE.delete(oldest[0]);
  }
};

// Pakistan-leaning bias. Tavily's include_domains is a soft hint, not a hard filter.
const PK_DOMAINS = [
  "daraz.pk",
  "olx.com.pk",
  "shopify.com",
  "tribune.com.pk",
  "propakistani.pk",
  "hamariweb.com",
  "dawn.com",
  "geo.tv",
  "facebook.com",
  "instagram.com",
];

const NOISE_DOMAINS = ["pinterest.com", "quora.com", "reddit.com"];

// Returns the current year as a string — kills the hardcoded "2024" issue.
const currentYear = () => new Date().getFullYear().toString();

/**
 * High-quality, Pakistan-biased search.
 *
 * @param {string} query — base query (we will append year + "Pakistan" if absent)
 * @param {object} options
 * @param {"basic"|"advanced"} options.depth      default "advanced"
 * @param {number} options.maxResults             default 8
 * @param {"day"|"week"|"month"|"year"|null} options.timeRange
 * @param {boolean} options.includeAnswer         default true
 * @param {string[]} options.extraIncludeDomains
 */
export async function searchPakistan(query, options = {}) {
  if (!query || typeof query !== "string") {
    throw new Error("searchPakistan requires a non-empty string query");
  }

  const {
    depth = "advanced",
    maxResults = 8,
    timeRange = null,
    includeAnswer = true,
    extraIncludeDomains = [],
  } = options;

  // Augment the query with year and country if the user didn't already.
  const trimmed = query.trim();
  const hasYear = /\b20\d{2}\b/.test(trimmed);
  const hasPK = /\bpakistan|pk\b/i.test(trimmed);
  const fullQuery = [
    trimmed,
    hasPK ? "" : "Pakistan",
    hasYear ? "" : currentYear(),
  ]
    .filter(Boolean)
    .join(" ");

  const tavilyOpts = {
    search_depth: depth,
    max_results: maxResults,
    include_domains: [...new Set([...PK_DOMAINS, ...extraIncludeDomains])],
    exclude_domains: NOISE_DOMAINS,
    include_answer: includeAnswer,
    include_raw_content: false,
  };
  if (timeRange) tavilyOpts.time_range = timeRange;

  const key = cacheKey(fullQuery, tavilyOpts);
  const cached = fromCache(key);
  if (cached) {
    return { ...cached, _cached: true };
  }

  try {
    const response = await tvly.search(fullQuery, tavilyOpts);
    const value = {
      query: fullQuery,
      answer: response?.answer || "",
      results: Array.isArray(response?.results) ? response.results : [],
      _cached: false,
    };
    toCache(key, value);
    return value;
  } catch (err) {
    console.error("[tavily] search failed:", err?.message || err);
    throw err;
  }
}

/**
 * Diagnostic — shows current cache size and approximate memory.
 */
export function tavilyCacheStats() {
  return {
    entries: CACHE.size,
    ttlMs: TTL_MS,
  };
}

export default { searchPakistan, tavilyCacheStats };
