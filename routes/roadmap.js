import express from "express";
import mongoose from "mongoose";
import OpenAI from "openai";
import dotenv from "dotenv";
import Roadmap from "../models/Roadmap.js";
import { protect } from "../middleware/auth.js";
import { coachingContextBlock } from "../utils/promptBlocks.js";
import { resolvePlatform } from "../utils/platforms.js";

dotenv.config();

const roadmapRouter = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);
const userIdFrom = (req) => req.user?.id || req.user?._id || req.user?.userId;

// ─── Reused validators (same intent as the old endpoint) ─────
function isInvalidText(value) {
  if (!value || typeof value !== "string") return true;
  const t = value.trim();
  if (t.length < 2) return true;
  if (t.length > 4 && !/[aeiouAEIOU]/.test(t)) return true;
  return false;
}
function isPureNumberOrAmount(value) {
  if (!value || typeof value !== "string") return false;
  return /^(PKR\s*)?\d[\d,\.]*(\s*PKR|\s*Rs\.?|\s*\$|%)?$/i.test(value.trim());
}

// ─── AI: generate a structured roadmap as JSON ───────────────
async function generateRoadmap({ productType, inputs }) {
  const platformKey = resolvePlatform(inputs?.platform);
  const ctxBlock = coachingContextBlock({
    platform: inputs?.platform,
    city: inputs?.city,
    experience: inputs?.experience,
  });

  const system = `You are the ROADMAP GENERATOR for an e-commerce coaching app focused on the Pakistani market.

${ctxBlock}

OUTPUT FORMAT — return ONLY valid JSON in this shape:
{
  "overview": "<2-3 sentence summary of this business in Pakistan, mentioning the chosen platform if any>",
  "estimatedBudget": { "min": <PKR number>, "max": <PKR number> },
  "estimatedDays": <integer total days to launch>,
  "phases": [
    {
      "title": "Setup",
      "weeks": "Week 1-2",
      "summary": "<1 sentence>",
      "tasks": [
        {
          "title": "<short imperative task — under 10 words>",
          "helpText": "<one helpful sentence using THIS platform's terminology>",
          "linkTo": "<optional: a path like /match, /budget, /profit, /platformAdvice, /guide, /vendors, or empty string>",
          "linkLabel": "<short button label or empty string>"
        }
      ]
    }
  ]
}

PHASES — produce exactly 4 phases in this order:
1) "Setup" (Week 1-2) — registration, accounts, basic admin SPECIFIC TO THE CHOSEN PLATFORM (or platform-agnostic if none chosen)
2) "Sourcing" (Week 2-3) — where to source THIS specific product in Pakistan (use the city's wholesale markets if city is given)
3) "Launch" (Week 3-4) — listing, pricing, promotion using THIS PLATFORM's specific tools and terminology
4) "Growth" (Month 2-6) — milestones at 1, 3, and 6 months — using marketing levers available on THIS PLATFORM

TASK RULES:
- 4 to 6 tasks per phase
- Each task is a concrete action the user can DO (not a topic to read about)
- Use the EXACT terminology from the platform fact sheet above (e.g. "Daraz Smart Station", "Shopify Admin", "Reels", "Live shopping" — whichever applies)
- Use linkTo to route to the right tool when relevant:
  * "/match" — Find vendors / suppliers
  * "/budget" — Plan PKR spending
  * "/profit" — Calculate margin / pricing
  * "/platformAdvice" — Compare selling platforms (only useful if platform NOT chosen)
  * "/guide" — Get platform-specific launch checklist
  * "/competitor" — Analyse competitors
  * "/trending-products" — Check current demand
- Use linkLabel for the button text, e.g. "Find vendors", "Plan budget"

VALIDATION — if the input is a person name, a number, a greeting, or something not sellable online, respond with:
{ "error": "<one clear sentence telling the user what to enter instead>" }

Output JSON only — no markdown, no code blocks, no commentary.`;

  const userBlock =
    `Product / business type: "${productType}"\n` +
    `Budget: ${inputs?.budget || "not specified"} PKR\n` +
    `Hours per week available: ${inputs?.hoursPerWeek || "not specified"}\n` +
    `Resolved platform key: ${platformKey || "(none — be platform-agnostic per the lock block above)"}\n\n` +
    `Generate the roadmap using the rules and platform lock block from the system message above.`;

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
  catch { parsed = { error: "AI returned an invalid response. Please try again." }; }
  return { parsed, raw };
}

// ════════════════════════════════════════════════════════════
// POST /api/roadmap — generate + persist
// ════════════════════════════════════════════════════════════
roadmapRouter.post("/roadmap", protect, async (req, res) => {
  try {
    const userId = userIdFrom(req);
    if (!userId) return res.status(401).json({ error: "Login required" });

    const { type, inputs = {} } = req.body || {};

    // Layer 1 — gibberish text
    if (isInvalidText(type)) {
      return res.status(400).json({
        error: "Please enter a product name or business type. Examples: 'women clothing', 'mobile accessories', 'skincare products'.",
      });
    }
    // Layer 2 — accidentally typed an amount
    if (isPureNumberOrAmount(type)) {
      return res.status(400).json({
        error: "This field needs a product or business type, not a money amount. Use the Budget Planner for PKR amounts.",
      });
    }

    // Sanitize inputs to known shape
    const cleanInputs = {
      budget: Number(inputs.budget) > 0 ? Math.round(Number(inputs.budget)) : 0,
      city: typeof inputs.city === "string" ? inputs.city.trim() : "",
      experience: ["first_time", "sold_before", "brand_owner"].includes(inputs.experience) ? inputs.experience : "",
      platform: typeof inputs.platform === "string" ? inputs.platform.trim() : "",
      hoursPerWeek: Number(inputs.hoursPerWeek) > 0 ? Math.round(Number(inputs.hoursPerWeek)) : 0,
    };

    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({ error: "AI service is not configured. Please contact support." });
    }

    const { parsed, raw } = await generateRoadmap({
      productType: type.trim(),
      inputs: cleanInputs,
    });

    if (parsed?.error) {
      return res.status(400).json({ error: parsed.error });
    }
    if (!Array.isArray(parsed?.phases) || !parsed.phases.length) {
      return res.status(502).json({ error: "AI did not return a valid roadmap. Please try again." });
    }

    // Build clean phase array — drop fields the model didn't promise.
    const phases = parsed.phases.slice(0, 4).map((ph) => ({
      title: String(ph.title || "Phase").trim(),
      weeks: String(ph.weeks || "").trim(),
      summary: String(ph.summary || "").trim(),
      tasks: (Array.isArray(ph.tasks) ? ph.tasks : []).slice(0, 8).map((t) => ({
        title: String(t.title || "").trim(),
        helpText: String(t.helpText || "").trim(),
        linkTo: String(t.linkTo || "").trim(),
        linkLabel: String(t.linkLabel || "").trim(),
        done: false,
        completedAt: null,
      })).filter((t) => t.title.length > 0),
    }));

    const doc = await Roadmap.create({
      user: userId,
      productType: type.trim(),
      inputs: cleanInputs,
      overview: String(parsed.overview || "").trim(),
      phases,
      estimatedBudget: {
        min: Number(parsed?.estimatedBudget?.min) || 0,
        max: Number(parsed?.estimatedBudget?.max) || 0,
      },
      estimatedDays: Number(parsed.estimatedDays) || 0,
      status: "active",
      rawOutput: raw.slice(0, 12000), // cap so a runaway response can't bloat the doc
    });

    res.status(201).json({ roadmap: doc });
  } catch (error) {
    console.error("[/api/roadmap] generate error:", error);
    res.status(500).json({ error: "Failed to generate roadmap.", details: error.message });
  }
});

// ════════════════════════════════════════════════════════════
// GET /api/roadmaps — list mine
// ════════════════════════════════════════════════════════════
roadmapRouter.get("/roadmaps", protect, async (req, res) => {
  try {
    const userId = userIdFrom(req);
    if (!userId) return res.json({ roadmaps: [] });
    const docs = await Roadmap.find({ user: userId }).sort({ createdAt: -1 }).lean({ virtuals: true });
    res.json({ roadmaps: docs });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch roadmaps", details: error.message });
  }
});

// ════════════════════════════════════════════════════════════
// GET /api/roadmaps/active — most recent active one for /home widget
// (must come BEFORE the /:id route below)
// ════════════════════════════════════════════════════════════
roadmapRouter.get("/roadmaps/active", protect, async (req, res) => {
  try {
    const userId = userIdFrom(req);
    if (!userId) return res.json({ roadmap: null });
    const doc = await Roadmap.findOne({ user: userId, status: "active" })
      .sort({ updatedAt: -1 })
      .lean({ virtuals: true });
    res.json({ roadmap: doc || null });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch active roadmap", details: error.message });
  }
});

// ════════════════════════════════════════════════════════════
// GET /api/roadmaps/:id
// ════════════════════════════════════════════════════════════
roadmapRouter.get("/roadmaps/:id", protect, async (req, res) => {
  try {
    const userId = userIdFrom(req);
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ error: "Invalid roadmap id" });
    const doc = await Roadmap.findOne({ _id: id, user: userId }).lean({ virtuals: true });
    if (!doc) return res.status(404).json({ error: "Roadmap not found" });
    res.json({ roadmap: doc });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch roadmap", details: error.message });
  }
});

// ════════════════════════════════════════════════════════════
// PATCH /api/roadmaps/:id/task — toggle a single task's done flag
// Body: { phaseId, taskId, done: boolean }
// ════════════════════════════════════════════════════════════
roadmapRouter.patch("/roadmaps/:id/task", protect, async (req, res) => {
  try {
    const userId = userIdFrom(req);
    const { id } = req.params;
    const { phaseId, taskId, done } = req.body || {};
    if (!isValidId(id)) return res.status(400).json({ error: "Invalid roadmap id" });
    if (!isValidId(phaseId) || !isValidId(taskId)) {
      return res.status(400).json({ error: "Invalid phase or task id" });
    }
    if (typeof done !== "boolean") {
      return res.status(400).json({ error: "`done` must be true or false" });
    }

    const doc = await Roadmap.findOne({ _id: id, user: userId });
    if (!doc) return res.status(404).json({ error: "Roadmap not found" });

    const phase = doc.phases.id(phaseId);
    if (!phase) return res.status(404).json({ error: "Phase not found" });
    const task = phase.tasks.id(taskId);
    if (!task) return res.status(404).json({ error: "Task not found" });

    task.done = done;
    task.completedAt = done ? new Date() : null;

    // Auto-promote: if all tasks are done, mark roadmap completed
    const allTasks = doc.phases.flatMap((p) => p.tasks);
    const allDone = allTasks.length > 0 && allTasks.every((t) => t.done);
    if (allDone) doc.status = "completed";
    else if (doc.status === "completed") doc.status = "active";

    await doc.save();
    res.json({ roadmap: doc.toObject({ virtuals: true }) });
  } catch (error) {
    res.status(500).json({ error: "Failed to update task", details: error.message });
  }
});

// ════════════════════════════════════════════════════════════
// PATCH /api/roadmaps/:id — update status (active|archived)
// ════════════════════════════════════════════════════════════
roadmapRouter.patch("/roadmaps/:id", protect, async (req, res) => {
  try {
    const userId = userIdFrom(req);
    const { id } = req.params;
    const { status } = req.body || {};
    if (!isValidId(id)) return res.status(400).json({ error: "Invalid roadmap id" });
    if (!["active", "archived", "completed", "draft"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }
    const doc = await Roadmap.findOneAndUpdate(
      { _id: id, user: userId },
      { $set: { status } },
      { new: true }
    ).lean({ virtuals: true });
    if (!doc) return res.status(404).json({ error: "Roadmap not found" });
    res.json({ roadmap: doc });
  } catch (error) {
    res.status(500).json({ error: "Failed to update roadmap", details: error.message });
  }
});

// ════════════════════════════════════════════════════════════
// DELETE /api/roadmaps/:id
// ════════════════════════════════════════════════════════════
roadmapRouter.delete("/roadmaps/:id", protect, async (req, res) => {
  try {
    const userId = userIdFrom(req);
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ error: "Invalid roadmap id" });
    const result = await Roadmap.deleteOne({ _id: id, user: userId });
    if (!result.deletedCount) return res.status(404).json({ error: "Roadmap not found" });
    res.json({ message: "Roadmap deleted" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete roadmap", details: error.message });
  }
});

export default roadmapRouter;
