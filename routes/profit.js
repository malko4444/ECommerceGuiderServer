import express from "express";
import mongoose from "mongoose";
import OpenAI from "openai";
import dotenv from "dotenv";
import ProfitCalc from "../models/ProfitCalc.js";
import Roadmap from "../models/Roadmap.js";
import Budget from "../models/Budget.js";
import { protect } from "../middleware/auth.js";
import { coachingContextBlock } from "../utils/promptBlocks.js";

dotenv.config();

const profitRouter = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);
const userIdFrom = (req) => req.user?.id || req.user?._id || req.user?.userId;

const isInvalidAmount = (v) => {
  const n = Number(v);
  return !Number.isFinite(n) || n < 0;
};
const isExcessiveAmount = (v) => Number(v) > 100_000_000;

// ─── Deterministic math (always same answer for same inputs) ───
function computeMetrics({ cost, adBudget, sellingPrice, units }) {
  const c = Number(cost) || 0;
  const a = Number(adBudget) || 0;
  const s = Number(sellingPrice) || 0;
  const u = Number(units) > 0 ? Number(units) : 0;

  const grossProfit = +(s - c).toFixed(2);                        // per unit
  const margin = s > 0 ? +(((s - c) / s) * 100).toFixed(1) : 0;   // % of selling price
  // ROI compares gross margin against (cost + ad spread) per unit.
  const adPerUnit = u > 0 ? a / u : 0;
  const netProfit = +(grossProfit - adPerUnit).toFixed(2);
  const denom = c + adPerUnit;
  const roi = denom > 0 ? +(((s - c - adPerUnit) / denom) * 100).toFixed(1) : 0;
  // Break-even = ad-spend ÷ gross-profit-per-unit (rounded up).
  const breakEven = grossProfit > 0 ? Math.ceil(a / grossProfit) : 0;

  return { grossProfit, netProfit, margin, roi, breakEven };
}

function decideVerdict(margin, roi) {
  if (margin >= 30 && roi >= 50) return "profitable";
  if (margin <= 0 || roi < 0) return "loss";
  if (margin < 15 || roi < 15) return "marginal";
  return "profitable";
}

// ─── AI: generate verdict reason + 3 recommendations as JSON ───
async function generateAdvice({ productType, ctxBlock, metrics, inputs }) {
  if (!process.env.OPENAI_API_KEY) {
    return { verdictReason: "", recommendations: [] };
  }

  const sys = `You are the PROFIT ADVISOR for an e-commerce coaching app focused on the Pakistani market.

${ctxBlock}

You receive: product type, the user's cost/ad/selling/units inputs, and the deterministic metrics.

Output ONLY valid JSON in this shape:
{
  "verdictReason": "<one short sentence (under 30 words) explaining why these numbers are profitable / marginal / loss-making>",
  "recommendations": ["<short actionable tip 1>", "<short actionable tip 2>", "<short actionable tip 3>"]
}

Rules:
- Recommendations must be concrete actions the seller can take this week, not advice to "research more".
- Use the platform from the lock block (e.g. mention Daraz commission tiers, Shopify subscription cost, Meta Ads — whichever applies).
- Mention Pakistan-specific levers when relevant (PostEx for COD savings, JazzCash discounts, Akbari Mandi sourcing, etc.).
- Keep tips under 25 words each.
- Output JSON only.`;

  const userBlock = `Product: ${productType || "(unspecified)"}
Inputs:
- Product cost: PKR ${inputs.cost}
- Ad budget: PKR ${inputs.adBudget}
- Selling price: PKR ${inputs.sellingPrice}
- Planned units: ${inputs.units || "not specified"}

Computed metrics (already correct, do NOT recompute):
- Gross profit per unit: PKR ${metrics.grossProfit}
- Net profit per unit: PKR ${metrics.netProfit}
- Margin: ${metrics.margin}%
- ROI: ${metrics.roi}%
- Break-even units to recover ad spend: ${metrics.breakEven}

Generate the verdictReason + 3 recommendations.`;

  try {
    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sys },
        { role: "user", content: userBlock },
      ],
    });
    const parsed = JSON.parse(resp.choices?.[0]?.message?.content || "{}");
    return {
      verdictReason: typeof parsed.verdictReason === "string" ? parsed.verdictReason.trim() : "",
      recommendations: Array.isArray(parsed.recommendations)
        ? parsed.recommendations.map(String).slice(0, 5)
        : [],
    };
  } catch (err) {
    console.error("[profit] AI advice failed:", err.message);
    return { verdictReason: "", recommendations: [] };
  }
}

// ════════════════════════════════════════════════════════════
// POST /api/profit — calculate + persist
// Body:
//   { cost, adBudget, sellingPrice, units?, productType?, label?,
//     roadmapId?, budgetId? }
// ════════════════════════════════════════════════════════════
profitRouter.post("/profit", protect, async (req, res) => {
  try {
    const userId = userIdFrom(req);
    if (!userId) return res.status(401).json({ error: "Login required" });

    let {
      cost, adBudget, sellingPrice,
      units = 0, productType = "", label = "",
      roadmapId = null, budgetId = null,
    } = req.body || {};

    // Validate
    if (isInvalidAmount(cost) || Number(cost) <= 0) {
      return res.status(400).json({ error: "Please enter a valid product cost greater than PKR 0." });
    }
    if (isInvalidAmount(adBudget)) {
      return res.status(400).json({ error: "Please enter a valid ad budget in PKR (use 0 if no ads)." });
    }
    if (isInvalidAmount(sellingPrice) || Number(sellingPrice) <= 0) {
      return res.status(400).json({ error: "Please enter a valid selling price greater than PKR 0." });
    }
    if (Number(sellingPrice) <= Number(cost)) {
      return res.status(400).json({
        error: `Your selling price (PKR ${sellingPrice}) is at or below cost (PKR ${cost}) — that's a loss. Try raising the selling price.`,
      });
    }
    if (isExcessiveAmount(cost) || isExcessiveAmount(sellingPrice)) {
      return res.status(400).json({ error: "One of your values seems too high. Please enter realistic PKR amounts." });
    }

    // Resolve roadmap / budget if provided — also auto-fill missing context
    let roadmapDoc = null;
    let budgetDoc = null;
    if (roadmapId && isValidId(roadmapId)) {
      roadmapDoc = await Roadmap.findOne({ _id: roadmapId, user: userId }).lean().catch(() => null);
      if (roadmapDoc && !productType) productType = roadmapDoc.productType || "";
    }
    if (budgetId && isValidId(budgetId)) {
      budgetDoc = await Budget.findOne({ _id: budgetId, user: userId }).lean().catch(() => null);
      if (budgetDoc) {
        if (!productType) productType = budgetDoc.productType || "";
        if (!roadmapDoc && budgetDoc.roadmap) {
          roadmapDoc = await Roadmap.findOne({ _id: budgetDoc.roadmap, user: userId }).lean().catch(() => null);
        }
      }
    }

    // Coerce numbers
    cost = Math.round(Number(cost));
    adBudget = Math.round(Number(adBudget));
    sellingPrice = Math.round(Number(sellingPrice));
    units = Math.max(0, Math.round(Number(units) || 0));

    // 1) Deterministic metrics
    const metrics = computeMetrics({ cost, adBudget, sellingPrice, units });
    const verdict = decideVerdict(metrics.margin, metrics.roi);

    // 2) AI advice (uses platform lock)
    const ctxBlock = coachingContextBlock({
      platform: roadmapDoc?.inputs?.platform || budgetDoc?.inputs?.platform,
      city: roadmapDoc?.inputs?.city || budgetDoc?.inputs?.city,
      experience: roadmapDoc?.inputs?.experience || budgetDoc?.inputs?.experience,
    });
    const { verdictReason, recommendations } = await generateAdvice({
      productType,
      ctxBlock,
      metrics,
      inputs: { cost, adBudget, sellingPrice, units },
    });

    // 3) Persist
    const doc = await ProfitCalc.create({
      user: userId,
      roadmap: roadmapDoc?._id || null,
      budget: budgetDoc?._id || null,
      productType: productType || "",
      label: typeof label === "string" ? label.trim() : "",
      cost, adBudget, sellingPrice, units,
      ...metrics,
      verdict,
      verdictReason,
      recommendations,
      status: "active",
    });

    res.status(201).json({ profit: doc });
  } catch (err) {
    console.error("[/api/profit] failed:", err);
    res.status(500).json({ error: "Failed to calculate profit", details: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// GET /api/profits — list mine
// ════════════════════════════════════════════════════════════
profitRouter.get("/profits", protect, async (req, res) => {
  try {
    const userId = userIdFrom(req);
    if (!userId) return res.json({ profits: [] });
    const docs = await ProfitCalc.find({ user: userId })
      .sort({ createdAt: -1 })
      .populate("roadmap", "productType")
      .populate("budget", "totalBudget tier")
      .lean();
    res.json({ profits: docs });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch profits", details: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// GET /api/profits/by-roadmap/:roadmapId
// ════════════════════════════════════════════════════════════
profitRouter.get("/profits/by-roadmap/:roadmapId", protect, async (req, res) => {
  try {
    const userId = userIdFrom(req);
    const { roadmapId } = req.params;
    if (!isValidId(roadmapId)) return res.status(400).json({ error: "Invalid roadmap id" });
    const docs = await ProfitCalc.find({ user: userId, roadmap: roadmapId })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ profits: docs });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch profits", details: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// GET /api/profits/:id
// ════════════════════════════════════════════════════════════
profitRouter.get("/profits/:id", protect, async (req, res) => {
  try {
    const userId = userIdFrom(req);
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ error: "Invalid id" });
    const doc = await ProfitCalc.findOne({ _id: id, user: userId })
      .populate("roadmap", "productType")
      .populate("budget", "totalBudget tier")
      .lean();
    if (!doc) return res.status(404).json({ error: "Scenario not found" });
    res.json({ profit: doc });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch scenario", details: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// PATCH /api/profits/:id — update label or status
// ════════════════════════════════════════════════════════════
profitRouter.patch("/profits/:id", protect, async (req, res) => {
  try {
    const userId = userIdFrom(req);
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ error: "Invalid id" });
    const update = {};
    if (typeof req.body?.label === "string") update.label = req.body.label.trim().slice(0, 80);
    if (["active", "archived"].includes(req.body?.status)) update.status = req.body.status;
    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: "Nothing to update (send `label` or `status`)." });
    }
    const doc = await ProfitCalc.findOneAndUpdate(
      { _id: id, user: userId },
      { $set: update },
      { new: true }
    ).lean();
    if (!doc) return res.status(404).json({ error: "Scenario not found" });
    res.json({ profit: doc });
  } catch (err) {
    res.status(500).json({ error: "Failed to update", details: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// DELETE /api/profits/:id
// ════════════════════════════════════════════════════════════
profitRouter.delete("/profits/:id", protect, async (req, res) => {
  try {
    const userId = userIdFrom(req);
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ error: "Invalid id" });
    const r = await ProfitCalc.deleteOne({ _id: id, user: userId });
    if (!r.deletedCount) return res.status(404).json({ error: "Scenario not found" });
    res.json({ message: "Scenario deleted" });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete", details: err.message });
  }
});

export default profitRouter;
