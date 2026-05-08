import express from "express";
import mongoose from "mongoose";
import OpenAI from "openai";
import dotenv from "dotenv";
import PlatformPick from "../models/PlatformPick.js";
import LaunchGuide from "../models/LaunchGuide.js";
import Roadmap from "../models/Roadmap.js";
import { protect } from "../middleware/auth.js";
import { PLATFORMS, resolvePlatform, platformSummary } from "../utils/platforms.js";
import { coachingContextBlock, platformLockBlock } from "../utils/promptBlocks.js";

dotenv.config();

const platformRouter = express.Router();
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

// All platform fact sheets summarized — the AI picks from these only.
function allPlatformsBlock() {
  return Object.keys(PLATFORMS)
    .map((k) => `### ${PLATFORMS[k].name} (key: ${k})\n${platformSummary(k)}`)
    .join("\n\n");
}

// ════════════════════════════════════════════════════════════
// POST /api/platform — recommend best platform(s) for goal
// ════════════════════════════════════════════════════════════
platformRouter.post("/platform", protect, async (req, res) => {
  try {
    const userId = userIdFrom(req);
    if (!userId) return res.status(401).json({ error: "Login required" });

    const { goal, roadmapId = null } = req.body || {};
    if (isInvalidText(goal)) {
      return res.status(400).json({
        error: "Please describe what you want to sell. Examples: 'sell handmade jewelry', 'launch a clothing brand'.",
      });
    }
    if (goal.length > 500) {
      return res.status(400).json({ error: "Goal too long (max 500 chars)." });
    }

    // Roadmap context (optional)
    let roadmapDoc = null;
    if (roadmapId && isValidId(roadmapId)) {
      roadmapDoc = await Roadmap.findOne({ _id: roadmapId, user: userId }).lean().catch(() => null);
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({ error: "AI service is not configured. Please contact support." });
    }

    const ctxBlock = coachingContextBlock({
      // Don't lock platform for the advisor itself — the advisor's job is to pick.
      platform: null,
      city: roadmapDoc?.inputs?.city,
      experience: roadmapDoc?.inputs?.experience,
    });

    const sys = `You are the PLATFORM ADVISOR for an e-commerce coaching app focused on the Pakistani market.

${ctxBlock}

Reference fact sheets for the platforms you may recommend:

${allPlatformsBlock()}

Output ONLY valid JSON in this exact shape:
{
  "summary": "<2-3 sentences explaining the overall recommendation>",
  "top": {
    "platform": "<one of: ${Object.keys(PLATFORMS).join(", ")}>",
    "name": "<display name>",
    "score": <70-99 integer>,
    "reason": "<1 sentence why it fits the user's goal>",
    "setupEase": "<Easy|Medium|Hard>",
    "fees": "<short fee summary specific to this platform>",
    "bestFor": "<who it suits best>",
    "firstStep": "<one concrete action the user can take TODAY on this platform>"
  },
  "alternatives": [
    { same shape as top — 1 to 2 entries, lower scores }
  ]
}

Rules:
- Use ONLY platform keys from the fact sheets above.
- "fees" must reference real numbers from the fact sheet (Daraz commission %, Shopify subscription, etc.).
- "firstStep" must be specific to that platform's actual UI (e.g. "Open Daraz Seller Centre and verify CNIC", "Pick a Shopify theme via Shopify admin > Online Store > Themes").
- Output JSON only — no markdown, no commentary.`;

    const userBlock = `User goal: "${goal}"
${roadmapDoc ? `Linked roadmap product: ${roadmapDoc.productType}` : ""}`;

    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sys },
        { role: "user", content: userBlock },
      ],
    });

    let parsed;
    try { parsed = JSON.parse(resp.choices?.[0]?.message?.content || "{}"); }
    catch { parsed = null; }

    if (!parsed?.top?.platform) {
      return res.status(502).json({ error: "AI did not return a valid recommendation. Please try again." });
    }

    // Sanitize: enforce known platform keys
    const sanitize = (opt) => {
      if (!opt || typeof opt !== "object") return null;
      const key = resolvePlatform(opt.platform) || resolvePlatform(opt.name);
      if (!key) return null;
      return {
        platform: key,
        name: PLATFORMS[key].name,
        score: Math.max(0, Math.min(100, Math.round(Number(opt.score) || 70))),
        reason: String(opt.reason || "").trim(),
        setupEase: String(opt.setupEase || "").trim(),
        fees: String(opt.fees || "").trim(),
        bestFor: String(opt.bestFor || "").trim(),
        firstStep: String(opt.firstStep || "").trim(),
      };
    };

    const top = sanitize(parsed.top);
    const alternatives = (Array.isArray(parsed.alternatives) ? parsed.alternatives : [])
      .slice(0, 3)
      .map(sanitize)
      .filter(Boolean)
      .filter((a) => a.platform !== top?.platform);

    if (!top) return res.status(502).json({ error: "AI returned an unknown platform. Please try again." });

    const doc = await PlatformPick.create({
      user: userId,
      roadmap: roadmapDoc?._id || null,
      goal: goal.trim(),
      summary: String(parsed.summary || "").trim(),
      top,
      alternatives,
    });

    res.status(201).json({ pick: doc });
  } catch (err) {
    console.error("[/api/platform] failed:", err);
    res.status(500).json({ error: "Failed to generate platform advice", details: err.message });
  }
});

// GET /api/platform-picks
platformRouter.get("/platform-picks", protect, async (req, res) => {
  try {
    const userId = userIdFrom(req);
    if (!userId) return res.json({ picks: [] });
    const docs = await PlatformPick.find({ user: userId }).sort({ createdAt: -1 }).lean();
    res.json({ picks: docs });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch picks", details: err.message });
  }
});

// GET /api/platform-picks/:id
platformRouter.get("/platform-picks/:id", protect, async (req, res) => {
  try {
    const userId = userIdFrom(req);
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ error: "Invalid id" });
    const doc = await PlatformPick.findOne({ _id: id, user: userId }).lean();
    if (!doc) return res.status(404).json({ error: "Pick not found" });
    res.json({ pick: doc });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch pick", details: err.message });
  }
});

// POST /api/platform-picks/:id/apply — push the chosen platform onto a roadmap
platformRouter.post("/platform-picks/:id/apply", protect, async (req, res) => {
  try {
    const userId = userIdFrom(req);
    const { id } = req.params;
    const { platform, roadmapId } = req.body || {};
    if (!isValidId(id)) return res.status(400).json({ error: "Invalid pick id" });
    if (!isValidId(roadmapId)) return res.status(400).json({ error: "roadmapId required" });
    const key = resolvePlatform(platform);
    if (!key) return res.status(400).json({ error: "Unknown platform" });

    const updated = await Roadmap.findOneAndUpdate(
      { _id: roadmapId, user: userId },
      { $set: { "inputs.platform": PLATFORMS[key].name } },
      { new: true }
    ).lean();
    if (!updated) return res.status(404).json({ error: "Roadmap not found" });

    res.json({ message: `Roadmap now using ${PLATFORMS[key].name}.`, roadmap: updated });
  } catch (err) {
    res.status(500).json({ error: "Failed to apply", details: err.message });
  }
});

// DELETE /api/platform-picks/:id
platformRouter.delete("/platform-picks/:id", protect, async (req, res) => {
  try {
    const userId = userIdFrom(req);
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ error: "Invalid id" });
    const r = await PlatformPick.deleteOne({ _id: id, user: userId });
    if (!r.deletedCount) return res.status(404).json({ error: "Pick not found" });
    res.json({ message: "Pick deleted" });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete", details: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// POST /api/guide — generate a structured launch guide
// Body: { platform, roadmapId? }
// Returns the saved LaunchGuide document.
// ════════════════════════════════════════════════════════════
platformRouter.post("/guide", protect, async (req, res) => {
  try {
    const userId = userIdFrom(req);
    if (!userId) return res.status(401).json({ error: "Login required" });

    const { platform, roadmapId = null } = req.body || {};
    if (isInvalidText(platform)) {
      return res.status(400).json({
        error: "Please enter a platform name. Examples: 'Daraz', 'Shopify', 'Instagram', 'TikTok'.",
      });
    }
    const key = resolvePlatform(platform);
    if (!key) {
      return res.status(400).json({
        error: `Unknown platform "${platform}". Try: ${Object.values(PLATFORMS).map((p) => p.name).join(", ")}.`,
      });
    }

    let roadmapDoc = null;
    if (roadmapId && isValidId(roadmapId)) {
      roadmapDoc = await Roadmap.findOne({ _id: roadmapId, user: userId }).lean().catch(() => null);
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({ error: "AI service is not configured. Please contact support." });
    }

    // Lock to the chosen platform — the prompt block does this.
    const lockBlock = platformLockBlock(key);
    const sys = `You are the LAUNCH GUIDE generator for an e-commerce coaching app focused on the Pakistani market.

${lockBlock}

Output ONLY valid JSON in this exact shape:
{
  "overview": "<2-3 sentences welcoming the user to launching on ${PLATFORMS[key].name}>",
  "phases": [
    {
      "title": "Account Setup",
      "summary": "<1 sentence>",
      "tasks": [
        { "title": "<short imperative task>", "helpText": "<one helpful sentence specific to ${PLATFORMS[key].name}>" }
      ]
    }
  ]
}

PHASES — exactly 5, in this order:
1) "Account Setup" — registration, identity verification, CNIC/NTN, bank account on ${PLATFORMS[key].name}
2) "Product Listing" — photos, titles, descriptions, categories, pricing on ${PLATFORMS[key].name}
3) "Payment & Delivery" — COD / EasyPaisa / JazzCash / courier integration on ${PLATFORMS[key].name}
4) "Launch" — going live, first promotion, initial traffic via ${PLATFORMS[key].name}'s marketing levers
5) "Optimization" — reviews, analytics, conversion improvements on ${PLATFORMS[key].name}

TASK RULES:
- 4 to 6 tasks per phase
- Use the EXACT terminology from the platform fact sheet (Smart Station, Shopify Admin, Reels, Live, etc.)
- Each task is a concrete action — not advice to "research more"
- Output JSON only.`;

    const userBlock = `Platform: ${PLATFORMS[key].name}
${roadmapDoc ? `Linked roadmap product: ${roadmapDoc.productType}` : ""}

Generate the 5-phase launch guide.`;

    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sys },
        { role: "user", content: userBlock },
      ],
    });
    let parsed;
    try { parsed = JSON.parse(resp.choices?.[0]?.message?.content || "{}"); }
    catch { parsed = null; }

    if (!Array.isArray(parsed?.phases) || !parsed.phases.length) {
      return res.status(502).json({ error: "AI did not return a valid guide. Please try again." });
    }

    const phases = parsed.phases.slice(0, 5).map((ph) => ({
      title: String(ph.title || "Phase").trim(),
      summary: String(ph.summary || "").trim(),
      tasks: (Array.isArray(ph.tasks) ? ph.tasks : []).slice(0, 8).map((t) => ({
        title: String(t.title || "").trim(),
        helpText: String(t.helpText || "").trim(),
        done: false,
        completedAt: null,
      })).filter((t) => t.title.length > 0),
    }));

    const doc = await LaunchGuide.create({
      user: userId,
      roadmap: roadmapDoc?._id || null,
      platform: key,
      platformName: PLATFORMS[key].name,
      overview: String(parsed.overview || "").trim(),
      phases,
      status: "active",
    });

    res.status(201).json({ guide: doc });
  } catch (err) {
    console.error("[/api/guide] failed:", err);
    res.status(500).json({ error: "Failed to generate launch guide", details: err.message });
  }
});

// GET /api/guides
platformRouter.get("/guides", protect, async (req, res) => {
  try {
    const userId = userIdFrom(req);
    if (!userId) return res.json({ guides: [] });
    const docs = await LaunchGuide.find({ user: userId })
      .sort({ createdAt: -1 })
      .populate("roadmap", "productType")
      .lean({ virtuals: true });
    res.json({ guides: docs });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch guides", details: err.message });
  }
});

// GET /api/guides/:id
platformRouter.get("/guides/:id", protect, async (req, res) => {
  try {
    const userId = userIdFrom(req);
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ error: "Invalid id" });
    const doc = await LaunchGuide.findOne({ _id: id, user: userId })
      .populate("roadmap", "productType")
      .lean({ virtuals: true });
    if (!doc) return res.status(404).json({ error: "Guide not found" });
    res.json({ guide: doc });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch guide", details: err.message });
  }
});

// PATCH /api/guides/:id/task — toggle task done
// Body: { phaseId, taskId, done }
platformRouter.patch("/guides/:id/task", protect, async (req, res) => {
  try {
    const userId = userIdFrom(req);
    const { id } = req.params;
    const { phaseId, taskId, done } = req.body || {};
    if (!isValidId(id) || !isValidId(phaseId) || !isValidId(taskId)) {
      return res.status(400).json({ error: "Invalid ids" });
    }
    if (typeof done !== "boolean") return res.status(400).json({ error: "`done` must be boolean" });

    const doc = await LaunchGuide.findOne({ _id: id, user: userId });
    if (!doc) return res.status(404).json({ error: "Guide not found" });
    const phase = doc.phases.id(phaseId);
    if (!phase) return res.status(404).json({ error: "Phase not found" });
    const task = phase.tasks.id(taskId);
    if (!task) return res.status(404).json({ error: "Task not found" });

    task.done = done;
    task.completedAt = done ? new Date() : null;

    const all = doc.phases.flatMap((p) => p.tasks);
    const allDone = all.length > 0 && all.every((t) => t.done);
    if (allDone) doc.status = "completed";
    else if (doc.status === "completed") doc.status = "active";

    await doc.save();
    res.json({ guide: doc.toObject({ virtuals: true }) });
  } catch (err) {
    res.status(500).json({ error: "Failed to update task", details: err.message });
  }
});

// PATCH /api/guides/:id — change status
platformRouter.patch("/guides/:id", protect, async (req, res) => {
  try {
    const userId = userIdFrom(req);
    const { id } = req.params;
    const { status } = req.body || {};
    if (!isValidId(id)) return res.status(400).json({ error: "Invalid id" });
    if (!["active", "completed", "archived"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }
    const doc = await LaunchGuide.findOneAndUpdate(
      { _id: id, user: userId },
      { $set: { status } },
      { new: true }
    ).lean({ virtuals: true });
    if (!doc) return res.status(404).json({ error: "Guide not found" });
    res.json({ guide: doc });
  } catch (err) {
    res.status(500).json({ error: "Failed to update", details: err.message });
  }
});

// DELETE /api/guides/:id
platformRouter.delete("/guides/:id", protect, async (req, res) => {
  try {
    const userId = userIdFrom(req);
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ error: "Invalid id" });
    const r = await LaunchGuide.deleteOne({ _id: id, user: userId });
    if (!r.deletedCount) return res.status(404).json({ error: "Guide not found" });
    res.json({ message: "Guide deleted" });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete", details: err.message });
  }
});

export default platformRouter;
