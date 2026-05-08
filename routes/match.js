import express from "express";
import OpenAI from "openai";
import dotenv from "dotenv";
import Vendor from "../models/Vendor.js";
import { protect } from "../middleware/auth.js";

dotenv.config();

const matchRouter = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// The 8 categories your Vendor schema enforces — sent to the AI so it
// only returns one of these (or null) for the category field.
const CATEGORIES = [
  "Home Decor", "Electronics", "IT Services", "Clothing",
  "Food Supplier", "Construction", "Marketing", "Other",
];

// ─── Stage 1: NL request → structured criteria ──────────────
// Uses JSON-mode so we always get parseable output.
async function extractCriteria(query) {
  const sys = `You are a sourcing assistant for Pakistani e-commerce sellers.
Given a buyer's free-text request, extract structured search criteria.

You MUST output JSON with this exact shape:
{
  "category": <one of: ${CATEGORIES.map((c) => `"${c}"`).join(", ")} or null>,
  "city": <Pakistani city name like "Karachi", "Lahore", "Islamabad" or null>,
  "services": <array of 0-6 short service/product keywords, lowercase>,
  "keywords": <array of 0-6 broader topical keywords, lowercase>,
  "budget": <free-text budget the user mentioned, or empty string>,
  "intent": <one short sentence describing what the buyer wants>
}

Rules:
- If unsure about category, return null instead of guessing.
- "services" should be specific tags like ["bulk-orders","wholesale","eco-packaging"].
- Never invent cities — only use what was actually mentioned.
- Output JSON only. No prose.`;

  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: sys },
      { role: "user", content: query },
    ],
  });

  const raw = resp.choices?.[0]?.message?.content || "{}";
  try {
    const parsed = JSON.parse(raw);
    return {
      category: typeof parsed.category === "string" && CATEGORIES.includes(parsed.category) ? parsed.category : null,
      city: typeof parsed.city === "string" ? parsed.city.trim() : null,
      services: Array.isArray(parsed.services) ? parsed.services.map(String).slice(0, 6) : [],
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords.map(String).slice(0, 6) : [],
      budget: typeof parsed.budget === "string" ? parsed.budget : "",
      intent: typeof parsed.intent === "string" ? parsed.intent : "",
    };
  } catch {
    return { category: null, city: null, services: [], keywords: [], budget: "", intent: "" };
  }
}

// ─── Stage 2: Mongo candidate lookup ────────────────────────
async function findCandidates(criteria) {
  const filter = {};
  if (criteria.category) filter.category = criteria.category;
  if (criteria.city) filter.city = new RegExp(`^${escapeRegex(criteria.city)}$`, "i");

  // Build a soft "OR" across services + keywords if we have any.
  const tokens = [...(criteria.services || []), ...(criteria.keywords || [])]
    .map((s) => String(s).trim().toLowerCase())
    .filter(Boolean);

  if (tokens.length) {
    const tokenRegex = tokens.map((t) => new RegExp(escapeRegex(t), "i"));
    filter.$or = [
      { services: { $in: tokenRegex } },
      { description: { $in: tokenRegex } },
      { vendorName: { $in: tokenRegex } },
    ];
  }

  // Always cap candidates to keep AI ranking cheap.
  let candidates = await Vendor.find(filter)
    .sort({ verified: -1, createdAt: -1 })
    .limit(15)
    .lean();

  // If we got 0 hits with all filters, relax progressively
  if (candidates.length === 0 && criteria.category) {
    candidates = await Vendor.find({ category: criteria.category })
      .sort({ verified: -1, createdAt: -1 })
      .limit(15)
      .lean();
  }
  if (candidates.length === 0) {
    candidates = await Vendor.find({})
      .sort({ verified: -1, createdAt: -1 })
      .limit(15)
      .lean();
  }
  return candidates;
}

// ─── Stage 3: AI ranks + explains + drafts outreach ─────────
async function rankAndDraft(query, criteria, candidates) {
  if (!candidates.length) {
    return { rankedIds: [], reasons: {}, draftMessage: "" };
  }

  // Compact candidate summaries — keep token usage low
  const candidateSummaries = candidates.map((v) => ({
    id: String(v._id),
    name: v.vendorName,
    category: v.category,
    city: v.city || "",
    description: (v.description || "").slice(0, 280),
    services: (v.services || []).slice(0, 8),
    verified: !!v.verified,
    yearsInBusiness: v.yearsInBusiness || 0,
  }));

  const sys = `You are a vendor-matching assistant for Pakistani e-commerce sellers.
You will receive: (1) a buyer's free-text request, (2) the extracted criteria, (3) a list of candidate vendors.

Pick up to 5 best matches and write one short reason (≤25 words) why each fits. Verified vendors and city/category matches should rank higher when relevant.

Also write a single short outreach message (under 90 words) the buyer can copy-paste to message any chosen vendor on WhatsApp/email. Use professional polite English suitable for Pakistan. Do NOT include placeholders like [Your Name]; instead use natural openings like "Hi, I am looking for..."

You MUST output JSON in this shape:
{
  "matches": [
    { "id": "<candidate id>", "score": <1-100>, "reason": "<short reason>" }
  ],
  "draftMessage": "<the outreach message>"
}
Output JSON only.`;

  const userBlock =
    `Buyer request: ${query}\n\n` +
    `Extracted criteria: ${JSON.stringify(criteria)}\n\n` +
    `Candidates:\n${JSON.stringify(candidateSummaries, null, 2)}`;

  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: sys },
      { role: "user", content: userBlock },
    ],
  });

  const raw = resp.choices?.[0]?.message?.content || "{}";
  let parsed;
  try { parsed = JSON.parse(raw); } catch { parsed = {}; }

  const idSet = new Set(candidates.map((v) => String(v._id)));
  const matches = Array.isArray(parsed.matches) ? parsed.matches : [];
  const cleaned = matches
    .filter((m) => m && idSet.has(String(m.id)))
    .slice(0, 5)
    .map((m) => ({
      id: String(m.id),
      score: typeof m.score === "number" ? Math.round(m.score) : 70,
      reason: typeof m.reason === "string" ? m.reason : "",
    }));

  return {
    rankedIds: cleaned.map((m) => m.id),
    reasons: Object.fromEntries(cleaned.map((m) => [m.id, { score: m.score, reason: m.reason }])),
    draftMessage: typeof parsed.draftMessage === "string" ? parsed.draftMessage.trim() : "",
  };
}

// Mongo regex escape — never let user input become a literal regex.
function escapeRegex(s = "") {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─── ROUTE ──────────────────────────────────────────────────
matchRouter.post("/match", protect, async (req, res) => {
  try {
    const { query } = req.body || {};
    if (!query || typeof query !== "string" || query.trim().length < 8) {
      return res.status(400).json({
        error: "Please describe what you need (at least 8 characters).",
      });
    }
    if (query.length > 1000) {
      return res.status(400).json({ error: "Query too long (max 1000 chars)." });
    }

    // Step 1: extract structured criteria — graceful fallback if OpenAI key is missing
    let criteria = { category: null, city: null, services: [], keywords: [], budget: "", intent: "" };
    let extractionFailed = false;
    if (process.env.OPENAI_API_KEY) {
      try {
        criteria = await extractCriteria(query);
      } catch (err) {
        console.error("[match] extractCriteria failed:", err.message);
        extractionFailed = true;
      }
    } else {
      extractionFailed = true;
    }

    // Step 2: candidate lookup (always runs — works even if AI was offline)
    const candidates = await findCandidates(criteria);

    // Step 3: rank — only if extraction succeeded
    let rankedIds = [];
    let reasons = {};
    let draftMessage = "";
    if (!extractionFailed && process.env.OPENAI_API_KEY) {
      try {
        const ranking = await rankAndDraft(query, criteria, candidates);
        rankedIds = ranking.rankedIds;
        reasons = ranking.reasons;
        draftMessage = ranking.draftMessage;
      } catch (err) {
        console.error("[match] rankAndDraft failed:", err.message);
      }
    }

    // Build the final ordered match list, attaching reason
    const byId = new Map(candidates.map((v) => [String(v._id), v]));
    let matches;
    if (rankedIds.length) {
      matches = rankedIds
        .map((id) => byId.get(id))
        .filter(Boolean)
        .map((v) => ({
          vendor: v,
          score: reasons[String(v._id)]?.score ?? 70,
          reason: reasons[String(v._id)]?.reason ?? "",
        }));
    } else {
      // Fallback ordering: verified first, then top 5 candidates
      matches = candidates.slice(0, 5).map((v) => ({
        vendor: v,
        score: v.verified ? 75 : 60,
        reason: "Best available match for your search criteria.",
      }));
    }

    res.json({
      query,
      criteria,
      matches,
      draftMessage,
      aiPowered: !extractionFailed,
      candidateCount: candidates.length,
    });
  } catch (err) {
    console.error("[match] failed:", err);
    res.status(500).json({ error: "Match failed", details: err.message });
  }
});

export default matchRouter;
