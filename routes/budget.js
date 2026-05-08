import express from "express";
import mongoose from "mongoose";
import OpenAI from "openai";
import dotenv from "dotenv";
import Budget from "../models/Budget.js";
import Roadmap from "../models/Roadmap.js";
import { protect } from "../middleware/auth.js";
import { coachingContextBlock } from "../utils/promptBlocks.js";

dotenv.config();

const budgetRouter = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);
const userIdFrom = (req) => req.user?.id || req.user?._id || req.user?.userId;

const isInvalidAmount = (v) => {
  const n = Number(v);
  return !Number.isFinite(n) || n <= 0;
};
const isExcessiveAmount = (v) => Number(v) > 100_000_000;

// Decide tier from amount — keeps frontend + backend in sync.
function tierFor(amount) {
  const n = Number(amount);
  if (n < 5000) return "Micro";
  if (n < 25000) return "Small";
  if (n < 100000) return "Medium";
  return "Large";
}

// ─── AI: generate a structured budget as JSON ───────────────
async function generateBudget({ totalBudget, productType, inputs }) {
  const tier = tierFor(totalBudget);

  const ctxBlock = coachingContextBlock({
    platform: inputs?.platform,
    city: inputs?.city,
    experience: inputs?.experience,
  });

  const system = `You are the BUDGET PLANNER for an e-commerce coaching app focused on the Pakistani market.

${ctxBlock}

Output ONLY valid JSON in this exact shape:
{
  "tier": "${tier}",
  "totalBudget": ${totalBudget},
  "allocations": [
    { "category": "Stock", "amount": <PKR>, "percent": <0-100>, "tip": "<one Pakistan-specific sentence using THIS platform's terms>" },
    { "category": "Packaging", ... },
    { "category": "Platform fees", ... },
    { "category": "Logistics", ... },
    { "category": "Marketing", ... },
    { "category": "Contingency", ... }
  ],
  "estimatedRevenue": { "low": <PKR>, "high": <PKR> },
  "tips": [ "<short PK-specific money-saving tip>", "<another>", "<another>" ]
}

RULES:
- Always include the SIX allocation categories exactly as named above, in that order.
- Sum of allocation amounts MUST equal totalBudget; sum of percent MUST equal 100.
- All amounts are integer PKR (round to nearest 100).
- "Platform fees" allocation must reflect the chosen platform's actual fee structure from the fact sheet:
  * Daraz: per-sale commission (5–15%) and PKR 0–60 service fee
  * Shopify: monthly subscription (~PKR 8,500/mo) + payment gateway fees
  * Instagram / Facebook / WhatsApp: usually small (free platform; budget reserved for ads if any)
  * TikTok Shop: 1–8% commission
  * If no platform chosen, allocate a moderate Marketing+fees buffer.
- "Marketing" allocation must use THIS platform's marketing levers from the fact sheet (Sponsored Products, Meta Ads, Reels, Live commerce, etc.) — do NOT mix platforms.
- Tips must reference Pakistani realities: COD vs JazzCash/EasyPaisa fees, local wholesale markets named in the city block, courier services (PostEx, BlueEx, TCS).
- estimatedRevenue should reflect THIS budget tier and product on a realistic 30-day window.

Output JSON only — no markdown, no commentary.`;

  const userBlock = `Total budget: PKR ${totalBudget}
Product / business type: ${productType || "(unspecified)"}

Generate the budget allocations using the platform lock and city/experience blocks from the system message above.`;

  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: userBlock },
    ],
  });

  const raw = resp.choices?.[0]?.message?.content || "{}";
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { parsed = null; }

  return { parsed, raw, tier };
}

// ════════════════════════════════════════════════════════════
// POST /api/budget — generate + persist
// Body: { budget, productType?, roadmapId?, city?, platform?, experience? }
// ════════════════════════════════════════════════════════════
budgetRouter.post("/budget", protect, async (req, res) => {
  try {
    const userId = userIdFrom(req);
    if (!userId) return res.status(401).json({ error: "Login required" });

    const {
      budget,
      productType = "",
      roadmapId = null,
      city = "",
      platform = "",
      experience = "",
    } = req.body || {};

    if (isInvalidAmount(budget)) {
      return res.status(400).json({
        error: "Please enter a valid budget amount in PKR (e.g., 10000, 25000, 50000).",
      });
    }
    if (isExcessiveAmount(budget)) {
      return res.status(400).json({
        error: "That amount seems too high. Please enter a realistic starting budget (up to PKR 1,00,00,000).",
      });
    }
    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({ error: "AI service is not configured. Please contact support." });
    }

    // If roadmapId is supplied, look it up so we can auto-fill missing context
    // and validate the user actually owns the roadmap.
    let roadmapRef = null;
    let mergedInputs = { city: city.trim(), platform: platform.trim(), experience: experience.trim() };
    let mergedProduct = productType.trim();

    if (roadmapId && isValidId(roadmapId)) {
      const rm = await Roadmap.findOne({ _id: roadmapId, user: userId }).lean();
      if (rm) {
        roadmapRef = rm._id;
        if (!mergedProduct) mergedProduct = rm.productType || "";
        if (!mergedInputs.city) mergedInputs.city = rm.inputs?.city || "";
        if (!mergedInputs.platform) mergedInputs.platform = rm.inputs?.platform || "";
        if (!mergedInputs.experience) mergedInputs.experience = rm.inputs?.experience || "";
      }
    }

    const totalBudget = Math.round(Number(budget));
    const { parsed, raw, tier } = await generateBudget({
      totalBudget,
      productType: mergedProduct,
      inputs: mergedInputs,
    });

    if (!parsed || !Array.isArray(parsed.allocations) || !parsed.allocations.length) {
      return res.status(502).json({ error: "AI did not return a valid budget. Please try again." });
    }

    // Normalize allocations — defensive against the AI dropping fields
    const allocations = parsed.allocations.slice(0, 8).map((a) => ({
      category: String(a.category || "").trim() || "Other",
      amount: Math.max(0, Math.round(Number(a.amount) || 0)),
      percent: Math.max(0, Math.min(100, Math.round(Number(a.percent) || 0))),
      tip: String(a.tip || "").trim(),
      expenses: [],
    }));

    // If the AI's amounts don't sum to totalBudget (within 1%), fix the
    // last category to absorb the rounding diff so we never show a
    // misleading total.
    const sum = allocations.reduce((s, a) => s + a.amount, 0);
    const diff = totalBudget - sum;
    if (Math.abs(diff) > 0 && allocations.length > 0) {
      allocations[allocations.length - 1].amount += diff;
      // Recompute percents from amounts so they always tally to 100
      allocations.forEach((a) => {
        a.percent = Math.round((a.amount / totalBudget) * 100);
      });
    }

    const doc = await Budget.create({
      user: userId,
      roadmap: roadmapRef,
      productType: mergedProduct,
      inputs: mergedInputs,
      totalBudget,
      tier: parsed.tier || tier,
      allocations,
      estimatedRevenue: {
        low: Math.max(0, Math.round(Number(parsed?.estimatedRevenue?.low) || 0)),
        high: Math.max(0, Math.round(Number(parsed?.estimatedRevenue?.high) || 0)),
      },
      tips: Array.isArray(parsed.tips) ? parsed.tips.map(String).slice(0, 6) : [],
      status: "active",
      rawOutput: raw.slice(0, 12000),
    });

    res.status(201).json({ budget: doc });
  } catch (err) {
    console.error("[/api/budget] generate error:", err);
    res.status(500).json({ error: "Failed to generate budget.", details: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// GET /api/budgets — list mine
// ════════════════════════════════════════════════════════════
budgetRouter.get("/budgets", protect, async (req, res) => {
  try {
    const userId = userIdFrom(req);
    if (!userId) return res.json({ budgets: [] });
    const docs = await Budget.find({ user: userId })
      .sort({ createdAt: -1 })
      .populate("roadmap", "productType")
      .lean({ virtuals: true });
    res.json({ budgets: docs });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch budgets", details: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// GET /api/budgets/active — most recent active for /home widget
// (declared BEFORE /:id so the static path wins)
// ════════════════════════════════════════════════════════════
budgetRouter.get("/budgets/active", protect, async (req, res) => {
  try {
    const userId = userIdFrom(req);
    if (!userId) return res.json({ budget: null });
    const doc = await Budget.findOne({ user: userId, status: "active" })
      .sort({ updatedAt: -1 })
      .populate("roadmap", "productType")
      .lean({ virtuals: true });
    res.json({ budget: doc || null });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch active budget", details: err.message });
  }
});

// GET /api/budgets/by-roadmap/:roadmapId — find budget linked to a roadmap
budgetRouter.get("/budgets/by-roadmap/:roadmapId", protect, async (req, res) => {
  try {
    const userId = userIdFrom(req);
    const { roadmapId } = req.params;
    if (!isValidId(roadmapId)) return res.status(400).json({ error: "Invalid roadmap id" });
    const doc = await Budget.findOne({ user: userId, roadmap: roadmapId })
      .sort({ createdAt: -1 })
      .lean({ virtuals: true });
    res.json({ budget: doc || null });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch budget", details: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// GET /api/budgets/:id
// ════════════════════════════════════════════════════════════
budgetRouter.get("/budgets/:id", protect, async (req, res) => {
  try {
    const userId = userIdFrom(req);
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ error: "Invalid budget id" });
    const doc = await Budget.findOne({ _id: id, user: userId })
      .populate("roadmap", "productType")
      .lean({ virtuals: true });
    if (!doc) return res.status(404).json({ error: "Budget not found" });
    res.json({ budget: doc });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch budget", details: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// PATCH /api/budgets/:id — update status
// ════════════════════════════════════════════════════════════
budgetRouter.patch("/budgets/:id", protect, async (req, res) => {
  try {
    const userId = userIdFrom(req);
    const { id } = req.params;
    const { status } = req.body || {};
    if (!isValidId(id)) return res.status(400).json({ error: "Invalid budget id" });
    if (!["active", "archived", "completed"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }
    const doc = await Budget.findOneAndUpdate(
      { _id: id, user: userId },
      { $set: { status } },
      { new: true }
    ).lean({ virtuals: true });
    if (!doc) return res.status(404).json({ error: "Budget not found" });
    res.json({ budget: doc });
  } catch (err) {
    res.status(500).json({ error: "Failed to update budget", details: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// DELETE /api/budgets/:id
// ════════════════════════════════════════════════════════════
budgetRouter.delete("/budgets/:id", protect, async (req, res) => {
  try {
    const userId = userIdFrom(req);
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ error: "Invalid budget id" });
    const r = await Budget.deleteOne({ _id: id, user: userId });
    if (!r.deletedCount) return res.status(404).json({ error: "Budget not found" });
    res.json({ message: "Budget deleted" });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete budget", details: err.message });
  }
});

export default budgetRouter;
