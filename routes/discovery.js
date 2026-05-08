import express from "express";
import mongoose from "mongoose";
import OpenAI from "openai";
import dotenv from "dotenv";
import Trend from "../models/Trend.js";
import CompetitorReport from "../models/CompetitorReport.js";
import Roadmap from "../models/Roadmap.js";
import { protect } from "../middleware/auth.js";
import { searchPakistan } from "../utils/tavily.js";
import { coachingContextBlock } from "../utils/promptBlocks.js";

dotenv.config();

const discoveryRouter = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);
const userIdFrom = (req) => req.user?.id || req.user?._id || req.user?.userId;

// ─── Validators (kept local — same as server.js's globals) ───
const isInvalidText = (v) => {
  if (!v || typeof v !== "string") return true;
  const t = v.trim();
  if (t.length < 2) return true;
  if (t.length > 4 && !/[aeiouAEIOU]/.test(t)) return true;
  return false;
};
const isPureNumberOrAmount = (v) =>
  typeof v === "string" && /^(PKR\s*)?\d[\d,\.]*(\s*PKR|\s*Rs\.?|\s*\$|%)?$/i.test(v.trim());

// ════════════════════════════════════════════════════════════
// POST /api/trending-products
// Backward compatible: still returns { results: [...] } so the
// existing frontend works unchanged. ALSO returns:
//   { summary, items: [...structured...], _id, _cached }
// ════════════════════════════════════════════════════════════
discoveryRouter.post("/trending-products", protect, async (req, res) => {
  try {
    const userId = userIdFrom(req);
    if (!userId) return res.status(401).json({ error: "Login required" });

    const { keyword } = req.body || {};
    if (isInvalidText(keyword)) {
      return res.status(400).json({
        error: "Please enter a product keyword. Examples: 'skincare', 'phone accessories', 'baby products'.",
      });
    }
    if (isPureNumberOrAmount(keyword)) {
      return res.status(400).json({
        error: "Please enter a product keyword, not a number. Try 'clothing' or 'electronics'.",
      });
    }

    const cleanKeyword = keyword.trim();

    // Step 1 — Tavily advanced search via the wrapper.
    let tavilyData;
    try {
      tavilyData = await searchPakistan(`${cleanKeyword} trending products ecommerce`, {
        depth: "advanced",
        maxResults: 8,
        timeRange: "month", // recency matters for trends
        includeAnswer: true,
      });
    } catch (err) {
      return res.status(502).json({ error: "Search service is temporarily unavailable. Please try again." });
    }

    const rawResults = (tavilyData.results || []).slice(0, 10).map((r) => ({
      title: r.title || "",
      url: r.url || "",
      content: r.content || "",
    }));

    // Step 2 — AI extracts structured trend items from the search results.
    let summary = tavilyData.answer || "";
    let items = [];
    if (process.env.OPENAI_API_KEY && rawResults.length > 0) {
      try {
        const sysPrompt = `You extract trending e-commerce products from web search results for the Pakistani market.

Output ONLY valid JSON in this shape:
{
  "summary": "<2-3 sentences explaining what's hot right now in this category in Pakistan>",
  "items": [
    {
      "name": "<concrete product name, not a category>",
      "category": "<short category tag>",
      "priceRange": "<e.g. 'PKR 800-1500' or empty if unknown>",
      "whyTrending": "<one short sentence reason>",
      "source": "<domain like daraz.pk>",
      "sourceUrl": "<full url from results>"
    }
  ]
}

Rules:
- Pull ONLY from the search results provided. Do not invent products or URLs.
- Output 4-6 items max. Skip vague results.
- Each item must have a real source URL from the data.
- Skip listicle/SEO-spam looking results.
- Output JSON only.`;

        const userBlock =
          `Keyword: ${cleanKeyword}\n\nSearch results JSON:\n` +
          JSON.stringify(rawResults.map((r) => ({ title: r.title, url: r.url, content: (r.content || "").slice(0, 400) })));

        const aiResp = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: sysPrompt },
            { role: "user", content: userBlock },
          ],
        });
        const parsed = JSON.parse(aiResp.choices?.[0]?.message?.content || "{}");
        if (typeof parsed.summary === "string" && parsed.summary.trim()) {
          summary = parsed.summary.trim();
        }
        if (Array.isArray(parsed.items)) {
          items = parsed.items.slice(0, 6).map((i) => ({
            name: String(i.name || "").trim(),
            category: String(i.category || "").trim(),
            priceRange: String(i.priceRange || "").trim(),
            whyTrending: String(i.whyTrending || "").trim(),
            source: String(i.source || "").trim(),
            sourceUrl: String(i.sourceUrl || "").trim(),
          })).filter((i) => i.name && i.sourceUrl);
        }
      } catch (err) {
        console.error("[trending] AI structuring failed, falling back to raw:", err.message);
      }
    }

    // Step 3 — Persist (auto-save). User can prune later.
    const doc = await Trend.create({
      user: userId,
      query: cleanKeyword,
      normalizedQuery: cleanKeyword.toLowerCase(),
      summary,
      items,
      rawResults,
    });

    // Backward-compatible response:
    res.json({
      _id: doc._id,
      query: cleanKeyword,
      summary,
      items,
      results: rawResults, // <- old frontend expects this name
      _cached: !!tavilyData._cached,
    });
  } catch (err) {
    console.error("[trending] failed:", err);
    res.status(500).json({ error: "Failed to fetch trending products.", details: err.message });
  }
});

// GET /api/trends — list mine
discoveryRouter.get("/trends", protect, async (req, res) => {
  try {
    const userId = userIdFrom(req);
    if (!userId) return res.json({ trends: [] });
    const docs = await Trend.find({ user: userId })
      .sort({ pinned: -1, createdAt: -1 })
      .lean();
    res.json({ trends: docs });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch trends", details: err.message });
  }
});

// GET /api/trends/:id
discoveryRouter.get("/trends/:id", protect, async (req, res) => {
  try {
    const userId = userIdFrom(req);
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ error: "Invalid trend id" });
    const doc = await Trend.findOne({ _id: id, user: userId }).lean();
    if (!doc) return res.status(404).json({ error: "Trend not found" });
    res.json({ trend: doc });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch trend", details: err.message });
  }
});

// DELETE /api/trends/:id
discoveryRouter.delete("/trends/:id", protect, async (req, res) => {
  try {
    const userId = userIdFrom(req);
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ error: "Invalid trend id" });
    const r = await Trend.deleteOne({ _id: id, user: userId });
    if (!r.deletedCount) return res.status(404).json({ error: "Trend not found" });
    res.json({ message: "Trend deleted" });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete trend", details: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// POST /api/competitor
// Backward compatible: still returns { analysis, competitors[] }.
// Now also returns _id + structured fields per competitor.
// Accepts optional roadmapId to inherit context.
// ════════════════════════════════════════════════════════════
discoveryRouter.post("/competitor", protect, async (req, res) => {
  try {
    const userId = userIdFrom(req);
    if (!userId) return res.status(401).json({ error: "Login required" });

    const { product, roadmapId = null } = req.body || {};
    if (isInvalidText(product)) {
      return res.status(400).json({
        error: "Please enter a product name. Examples: 'wireless earbuds', 'women kurtis', 'phone cases'.",
      });
    }
    if (isPureNumberOrAmount(product)) {
      return res.status(400).json({
        error: "Please enter a product name, not a number. Example: 'bluetooth speaker' instead of '5000'.",
      });
    }

    const cleanProduct = product.trim();

    // Optional roadmap pull for context.
    let roadmapDoc = null;
    if (roadmapId && isValidId(roadmapId)) {
      roadmapDoc = await Roadmap.findOne({ _id: roadmapId, user: userId })
        .lean()
        .catch(() => null);
    }

    // Step 1 — Tavily search.
    let tavilyData;
    try {
      tavilyData = await searchPakistan(
        `${cleanProduct} online stores brands selling in Pakistan competitor pricing`,
        { depth: "advanced", maxResults: 8, includeAnswer: true }
      );
    } catch {
      return res.status(502).json({ error: "Search service unavailable. Please try again." });
    }

    const rawResults = (tavilyData.results || []).slice(0, 10).map((r) => ({
      title: r.title || "",
      url: r.url || "",
      content: r.content || "",
    }));
    const rawAnswer = tavilyData.answer || "";

    if (!rawAnswer && rawResults.length === 0) {
      return res.status(404).json({ error: "No competitor data found. Try a more specific product name." });
    }

    // Step 2 — JSON-mode AI structuring.
    const ctxBlock = roadmapDoc
      ? coachingContextBlock({
          platform: roadmapDoc.inputs?.platform,
          city: roadmapDoc.inputs?.city,
          experience: roadmapDoc.inputs?.experience,
        })
      : coachingContextBlock({});

    const sysPrompt = `You are the COMPETITOR ANALYSIS tool for an e-commerce coaching app focused on the Pakistani market.

${ctxBlock}

Your job: analyze the search results provided and return structured competitor data.

Output ONLY valid JSON in this shape:
{
  "analysis": "<2-3 sentence summary of the competitive landscape for this product in Pakistan>",
  "competitors": [
    {
      "name": "<real store/brand name>",
      "website": "<full https URL from data only>",
      "description": "<1-2 sentences on what they sell and how>",
      "priceRange": "<e.g. 'PKR 1500-3000' or empty>",
      "strengths": ["<short strength>", "<short>"],
      "weaknesses": ["<short>"],
      "audience": "<target buyer in one short phrase>"
    }
  ]
}

Rules:
- ONLY include competitors with real, verifiable URLs from the research data.
- Do NOT invent names, URLs, or stats.
- If no real competitors found, set competitors to [] and explain in analysis.
- If the product cannot be sold online, set analysis to: "This product is not applicable for e-commerce analysis." and return [].
- 3-6 competitors max.
- Output JSON only.`;

    const userBlock =
      `Product: "${cleanProduct}"\n\n` +
      `Tavily answer:\n${rawAnswer}\n\n` +
      `Tavily results:\n` +
      JSON.stringify(rawResults.map((r) => ({ title: r.title, url: r.url, content: (r.content || "").slice(0, 400) })));

    let parsed = { analysis: "", competitors: [] };
    if (process.env.OPENAI_API_KEY) {
      try {
        const aiResp = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: sysPrompt },
            { role: "user", content: userBlock },
          ],
        });
        parsed = JSON.parse(aiResp.choices?.[0]?.message?.content || "{}");
      } catch (err) {
        console.error("[competitor] AI failed:", err.message);
        parsed = { analysis: rawAnswer, competitors: [] };
      }
    } else {
      parsed = { analysis: rawAnswer, competitors: [] };
    }

    const competitors = Array.isArray(parsed.competitors)
      ? parsed.competitors.slice(0, 6).map((c) => ({
          name: String(c.name || "").trim(),
          website: String(c.website || "").trim(),
          description: String(c.description || "").trim(),
          priceRange: String(c.priceRange || "").trim(),
          strengths: Array.isArray(c.strengths) ? c.strengths.map(String).slice(0, 4) : [],
          weaknesses: Array.isArray(c.weaknesses) ? c.weaknesses.map(String).slice(0, 4) : [],
          audience: String(c.audience || "").trim(),
        })).filter((c) => c.name)
      : [];

    // Step 3 — Persist
    const doc = await CompetitorReport.create({
      user: userId,
      roadmap: roadmapDoc?._id || null,
      product: cleanProduct,
      analysis: String(parsed.analysis || "").trim(),
      competitors,
      rawResults,
    });

    // Backward-compatible response.
    res.json({
      _id: doc._id,
      analysis: doc.analysis,
      competitors,
      _cached: !!tavilyData._cached,
    });
  } catch (err) {
    console.error("[competitor] failed:", err);
    res.status(500).json({ error: "Failed to generate competitor analysis.", details: err.message });
  }
});

// GET /api/competitor-reports — list mine
discoveryRouter.get("/competitor-reports", protect, async (req, res) => {
  try {
    const userId = userIdFrom(req);
    if (!userId) return res.json({ reports: [] });
    const docs = await CompetitorReport.find({ user: userId })
      .sort({ createdAt: -1 })
      .populate("roadmap", "productType")
      .lean();
    res.json({ reports: docs });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch reports", details: err.message });
  }
});

// GET /api/competitor-reports/:id
discoveryRouter.get("/competitor-reports/:id", protect, async (req, res) => {
  try {
    const userId = userIdFrom(req);
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ error: "Invalid report id" });
    const doc = await CompetitorReport.findOne({ _id: id, user: userId })
      .populate("roadmap", "productType")
      .lean();
    if (!doc) return res.status(404).json({ error: "Report not found" });
    res.json({ report: doc });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch report", details: err.message });
  }
});

// DELETE /api/competitor-reports/:id
discoveryRouter.delete("/competitor-reports/:id", protect, async (req, res) => {
  try {
    const userId = userIdFrom(req);
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ error: "Invalid report id" });
    const r = await CompetitorReport.deleteOne({ _id: id, user: userId });
    if (!r.deletedCount) return res.status(404).json({ error: "Report not found" });
    res.json({ message: "Report deleted" });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete report", details: err.message });
  }
});

export default discoveryRouter;
