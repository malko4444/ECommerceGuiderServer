import express from "express";
import mongoose from "mongoose";
import OpenAI from "openai";
import dotenv from "dotenv";
import Tutorial from "../models/Tutorial.js";
import Roadmap from "../models/Roadmap.js";
import { protect } from "../middleware/auth.js";
import { TUTORIAL_CATALOG, TUTORIAL_CATEGORIES, CATALOG_BY_SLUG, slugify } from "../utils/tutorialCatalog.js";
import { coachingContextBlock } from "../utils/promptBlocks.js";

dotenv.config();

const tutorialsRouter = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);
const userIdFrom = (req) => req.user?.id || req.user?._id || req.user?.userId;

const isInvalidText = (v) => {
  if (!v || typeof v !== "string") return true;
  const t = v.trim();
  if (t.length < 2) return true;
  if (t.length > 4 && !/[aeiouAEIOU]/.test(t)) return true;
  return false;
};

// ─── AI: produce structured tutorial JSON ────────────────────
async function generateTutorial({ topic, category, ctxBlock, isCatalog }) {
  // Catalog topics are pre-vetted — never let the AI reject them.
  // Free-text topics get a permissive check (only refuse clearly-unrelated stuff).
  const validationRule = isCatalog
    ? `- This topic is from the curated catalog. Always generate the tutorial — DO NOT return an error.`
    : `- Only refuse if the topic is CLEARLY unrelated to selling / business / marketing / operations / customer service / e-commerce / online stores. Examples to refuse: "how to cook biryani", "cricket rules", "play games", "tell me a joke". Anything that could plausibly help an online seller is FINE — accept it.
- If you must refuse, return: { "error": "This tutorial section covers e-commerce topics only. Try Facebook Ads, product photography, packaging, or Daraz SEO." }`;

  const sys = `You are the LEARNING TUTORIALS tool for an e-commerce coaching app focused on the Pakistani market.

${ctxBlock}

Output ONLY valid JSON in this exact shape:
{
  "whatIsIt": "<1-2 sentence definition in simple language>",
  "whyItMatters": "<concrete impact on sales, costs, or customer trust for a Pakistani seller>",
  "steps": ["<step 1 — concrete action>", "<step 2>", "<step 3>", "..."],
  "tips": ["<Pakistan-specific tip 1>", "<tip 2>", "<tip 3>"],
  "mistakes": ["<common beginner mistake 1>", "<mistake 2>", "<mistake 3>"],
  "resources": ["<real working YouTube channel, free tool, or website name 1>", "<resource 2>", "<resource 3>"]
}

Rules:
- 5-8 steps, each is a concrete action (not "research more").
- 3 tips, 3 mistakes, 3 resources.
- Tips reference Pakistani realities: COD vs JazzCash/EasyPaisa, courier services (PostEx/TCS/Leopards), local markets, Daraz Seller Centre, Shopify apps, etc.
- Resources must be REAL — do not invent YouTube channels or websites.
${validationRule}
- Output JSON only, no markdown.`;

  const userBlock = `Topic: "${topic}"
${category ? `Category: ${category}` : ""}

Generate a beginner-friendly tutorial.`;

  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: sys },
      { role: "user", content: userBlock },
    ],
  });
  const raw = resp.choices?.[0]?.message?.content || "{}";
  try { return JSON.parse(raw); }
  catch { return null; }
}

// ════════════════════════════════════════════════════════════
// GET /api/tutorials/catalog — public-ish catalog of curated topics
// ════════════════════════════════════════════════════════════
tutorialsRouter.get("/tutorials/catalog", protect, async (req, res) => {
  try {
    res.json({
      categories: TUTORIAL_CATEGORIES,
      tutorials: TUTORIAL_CATALOG,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch catalog", details: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// POST /api/tutorials — generate (or return cached) a tutorial
// Body: { slug? , topic? , roadmapId? }
// If `slug` matches a catalog entry, the topic is canonicalized.
// If user already has the same slug, the existing doc is returned.
// ════════════════════════════════════════════════════════════
tutorialsRouter.post("/tutorials", protect, async (req, res) => {
  try {
    const userId = userIdFrom(req);
    if (!userId) return res.status(401).json({ error: "Login required" });

    let { slug = "", topic = "", roadmapId = null } = req.body || {};
    slug = String(slug || "").trim().toLowerCase();
    topic = String(topic || "").trim();

    // Resolve topic + slug from catalog if applicable.
    let category = "";
    let isCatalog = false;
    if (slug && CATALOG_BY_SLUG[slug]) {
      const entry = CATALOG_BY_SLUG[slug];
      topic = entry.topic;
      category = entry.category;
      isCatalog = true;
    } else if (topic) {
      // Free-form — derive slug
      slug = slugify(topic);
      if (!slug) return res.status(400).json({ error: "Topic too short or invalid." });
      // Check if this slug actually matches a catalog entry (user might have typed the topic name)
      if (CATALOG_BY_SLUG[slug]) {
        const entry = CATALOG_BY_SLUG[slug];
        topic = entry.topic;
        category = entry.category;
        isCatalog = true;
      }
    } else {
      return res.status(400).json({ error: "Provide either `slug` or `topic`." });
    }

    if (isInvalidText(topic)) {
      return res.status(400).json({
        error: "Please enter a topic. Examples: 'Facebook Ads', 'product photography', 'Daraz SEO'.",
      });
    }

    // 1) Already saved? Return existing doc — saves AI tokens.
    let doc = await Tutorial.findOne({ user: userId, slug });
    if (doc) {
      return res.json({ tutorial: doc, _cached: true });
    }

    // 2) Generate fresh
    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({ error: "AI service is not configured. Please contact support." });
    }

    let roadmapDoc = null;
    if (roadmapId && isValidId(roadmapId)) {
      roadmapDoc = await Roadmap.findOne({ _id: roadmapId, user: userId }).lean().catch(() => null);
    }
    const ctxBlock = coachingContextBlock({
      platform: roadmapDoc?.inputs?.platform,
      city: roadmapDoc?.inputs?.city,
      experience: roadmapDoc?.inputs?.experience,
    });

    const parsed = await generateTutorial({ topic, category, ctxBlock, isCatalog });
    if (!parsed) return res.status(502).json({ error: "AI returned an invalid response. Please try again." });
    if (parsed.error) {
      console.warn(`[/api/tutorials] AI refused topic="${topic}" slug="${slug}" (catalog=${isCatalog})`);
      return res.status(400).json({ error: parsed.error, topic, slug });
    }

    const arrayOf = (v, max = 8) =>
      Array.isArray(v) ? v.map(String).map((s) => s.trim()).filter(Boolean).slice(0, max) : [];

    const content = {
      whatIsIt:    String(parsed.whatIsIt || "").trim(),
      whyItMatters:String(parsed.whyItMatters || "").trim(),
      steps:       arrayOf(parsed.steps, 10),
      tips:        arrayOf(parsed.tips, 6),
      mistakes:    arrayOf(parsed.mistakes, 6),
      resources:   arrayOf(parsed.resources, 6),
    };

    if (!content.steps.length) {
      return res.status(502).json({ error: "AI returned an empty tutorial. Please try again." });
    }

    doc = await Tutorial.create({
      user: userId,
      slug,
      topic,
      category,
      isCatalog,
      content,
      bookmarked: false,
    });

    res.status(201).json({ tutorial: doc, _cached: false });
  } catch (err) {
    if (err?.code === 11000) {
      // Race — another request created it first
      const existing = await Tutorial.findOne({ user: userIdFrom(req), slug: req.body?.slug });
      if (existing) return res.json({ tutorial: existing, _cached: true });
    }
    console.error("[/api/tutorials] failed:", err);
    res.status(500).json({ error: "Failed to generate tutorial", details: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// GET /api/tutorials — list mine
// ════════════════════════════════════════════════════════════
tutorialsRouter.get("/tutorials", protect, async (req, res) => {
  try {
    const userId = userIdFrom(req);
    if (!userId) return res.json({ tutorials: [] });
    const onlyBookmarked = req.query.bookmarked === "true";
    const filter = { user: userId };
    if (onlyBookmarked) filter.bookmarked = true;
    const docs = await Tutorial.find(filter).sort({ updatedAt: -1 }).lean();
    res.json({ tutorials: docs });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch tutorials", details: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// GET /api/tutorials/:id
// ════════════════════════════════════════════════════════════
tutorialsRouter.get("/tutorials/:id", protect, async (req, res) => {
  try {
    const userId = userIdFrom(req);
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ error: "Invalid id" });
    const doc = await Tutorial.findOne({ _id: id, user: userId }).lean();
    if (!doc) return res.status(404).json({ error: "Tutorial not found" });
    res.json({ tutorial: doc });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch tutorial", details: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// POST /api/tutorials/:id/bookmark — toggle bookmark
// ════════════════════════════════════════════════════════════
tutorialsRouter.post("/tutorials/:id/bookmark", protect, async (req, res) => {
  try {
    const userId = userIdFrom(req);
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ error: "Invalid id" });
    const doc = await Tutorial.findOne({ _id: id, user: userId });
    if (!doc) return res.status(404).json({ error: "Tutorial not found" });
    doc.bookmarked = !doc.bookmarked;
    await doc.save();
    res.json({ bookmarked: doc.bookmarked });
  } catch (err) {
    res.status(500).json({ error: "Failed to toggle bookmark", details: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// DELETE /api/tutorials/:id
// ════════════════════════════════════════════════════════════
tutorialsRouter.delete("/tutorials/:id", protect, async (req, res) => {
  try {
    const userId = userIdFrom(req);
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ error: "Invalid id" });
    const r = await Tutorial.deleteOne({ _id: id, user: userId });
    if (!r.deletedCount) return res.status(404).json({ error: "Tutorial not found" });
    res.json({ message: "Tutorial deleted" });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete", details: err.message });
  }
});

export default tutorialsRouter;
