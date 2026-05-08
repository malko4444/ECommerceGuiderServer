import express from "express";
import mongoose from "mongoose";
import OpenAI from "openai";
import dotenv from "dotenv";
import Conversation from "../models/Conversation.js";
import Roadmap from "../models/Roadmap.js";
import Budget from "../models/Budget.js";
import { protect } from "../middleware/auth.js";
import { coachingContextBlock } from "../utils/promptBlocks.js";

dotenv.config();

const mentorRouter = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);
const userIdFrom = (req) => req.user?.id || req.user?._id || req.user?.userId;

const isInvalidText = (v) => {
  if (!v || typeof v !== "string") return true;
  const t = v.trim();
  if (t.length < 2) return true;
  return false;
};

// ─── Pull active roadmap + budget so the mentor can reference them ───
async function pullUserContext(userId) {
  const [roadmap, budget] = await Promise.all([
    Roadmap.findOne({ user: userId, status: "active" }).sort({ updatedAt: -1 }).lean(),
    Budget.findOne({ user: userId, status: "active" }).sort({ updatedAt: -1 }).lean(),
  ]);

  // Compute roadmap progress so the mentor can say "you're 38% in"
  let progress = null;
  let phaseLabel = "";
  if (roadmap?.phases) {
    const all = roadmap.phases.flatMap((p) => p.tasks || []);
    const done = all.filter((t) => t.done).length;
    const total = all.length;
    progress = total ? Math.round((done / total) * 100) : 0;
    // Find the first phase with unfinished tasks
    const stuckPhase = roadmap.phases.find((p) => (p.tasks || []).some((t) => !t.done));
    phaseLabel = stuckPhase ? stuckPhase.title : "Growth";
  }

  return { roadmap, budget, progress, phaseLabel };
}

function snapshotFromContext({ roadmap, budget }) {
  return {
    productType: roadmap?.productType || budget?.productType || "",
    platform:    roadmap?.inputs?.platform || budget?.inputs?.platform || "",
    city:        roadmap?.inputs?.city || budget?.inputs?.city || "",
    experience:  roadmap?.inputs?.experience || budget?.inputs?.experience || "",
    budgetTotal: budget?.totalBudget || 0,
    tier:        budget?.tier || "",
  };
}

// ─── System prompt builder — composes mentor persona + user context ───
function buildSystemPrompt({ roadmap, budget, progress, phaseLabel, snapshot }) {
  const persona = `You are MENTOR — a friendly, experienced e-commerce advisor inside a Pakistani seller coaching app.

YOUR PERSONALITY:
- Talk like a knowledgeable older sibling who has built successful online businesses in Pakistan.
- Warm, direct — no corporate fluff.
- Natural Urdu/English mix is OK (e.g. "bhai", "yaar") but stay professional.
- Give SPECIFIC advice, not motivational fluff.
- End every response with: "👉 Today's action: <one specific next step>".

BOUNDARIES:
- If the question is unrelated to business / selling / marketing / finance / entrepreneurship, reply:
  "Yaar, I am your e-commerce mentor — I can only help with business topics! Ask me about products, ads, returns, or growing your store."
- If offensive content, reply:
  "Let's keep things professional and focused on your business."

RESPONSE STYLE:
- 150-250 words max unless detail is genuinely needed.
- Reference the user's actual roadmap, budget, or active phase when it helps.
- If they ask about a tool that has its own page, point them there:
  Roadmap → /roadmap, Budget → /budget, Profit → /profit, Vendors → /match,
  Trends → /trending-products, Competitors → /competitor.`;

  let userContext = "";
  if (roadmap || budget) {
    userContext = `\n━━━ THIS USER'S CURRENT WORK ━━━\n`;
    if (roadmap) {
      userContext += `Active roadmap: "${roadmap.productType}" — ${progress}% complete. Currently working on phase "${phaseLabel}".\n`;
    }
    if (budget) {
      userContext += `Active budget: PKR ${Number(budget.totalBudget || 0).toLocaleString("en-PK")} (${budget.tier} tier).\n`;
    }
    userContext += `When relevant, reference these by name. The user has actually invested time in them — use that context.\n`;
  } else {
    userContext = `\nThis user has not started a roadmap yet. If they ask "where do I start", recommend they generate a roadmap first at /roadmap.`;
  }

  // Add platform lock + city + experience block from the shared utility
  const ctx = coachingContextBlock({
    platform: snapshot.platform,
    city: snapshot.city,
    experience: snapshot.experience,
  });

  return [persona, userContext, "", ctx].join("\n");
}

// Auto-derive a short conversation title from the first user message.
function deriveTitle(text) {
  if (!text) return "New conversation";
  const trimmed = text.trim().replace(/\s+/g, " ").slice(0, 80);
  return trimmed.length < text.trim().length ? trimmed + "..." : trimmed;
}

// ════════════════════════════════════════════════════════════
// POST /api/mentor-chat
// Body: { message, conversationId? }
// If no id → creates a new conversation, snapshots context.
// If id → appends, calls AI with last 10 messages + system prompt.
// ════════════════════════════════════════════════════════════
mentorRouter.post("/mentor-chat", protect, async (req, res) => {
  try {
    const userId = userIdFrom(req);
    if (!userId) return res.status(401).json({ error: "Login required" });

    const { message, conversationId = null } = req.body || {};
    if (isInvalidText(message)) {
      return res.status(400).json({
        error: "Please type your question. Example: 'How do I get my first sale on Daraz?'",
      });
    }
    if (message.length > 4000) {
      return res.status(400).json({ error: "Message too long (max 4000 chars)." });
    }

    // 1) Pull or create the conversation
    let convo = null;
    if (conversationId && isValidId(conversationId)) {
      convo = await Conversation.findOne({ _id: conversationId, user: userId });
      if (!convo) return res.status(404).json({ error: "Conversation not found" });
    }

    // 2) Pull user context (used for system prompt every time, not just on create)
    const { roadmap, budget, progress, phaseLabel } = await pullUserContext(userId);
    const snapshot = snapshotFromContext({ roadmap, budget });

    if (!convo) {
      // Brand new — snapshot the context and derive a title from this first message
      convo = await Conversation.create({
        user: userId,
        title: deriveTitle(message),
        messages: [],
        contextSnapshot: snapshot,
        lastMessageAt: new Date(),
        status: "active",
      });
    }

    // 3) Append the user message
    const userMsg = { role: "user", content: message.trim() };
    convo.messages.push(userMsg);

    // Cheap safety: cap at 200 messages per conversation to keep doc size sane.
    if (convo.messages.length > 200) {
      convo.messages = convo.messages.slice(-200);
    }

    // 4) Build the OpenAI messages array
    const systemPrompt = buildSystemPrompt({ roadmap, budget, progress, phaseLabel, snapshot });
    // Keep last 10 messages for context window control
    const history = convo.messages
      .slice(-10)
      .map((m) => ({ role: m.role, content: m.content }));
    const aiMessages = [{ role: "system", content: systemPrompt }, ...history];

    // 5) Call AI (with graceful fallback)
    let assistantContent = "";
    try {
      if (!process.env.OPENAI_API_KEY) {
        throw new Error("AI not configured");
      }
      const resp = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: aiMessages,
      });
      assistantContent = resp.choices?.[0]?.message?.content || "";
    } catch (err) {
      console.error("[mentor] AI failed:", err.message);
      assistantContent =
        "Sorry yaar, my AI brain hiccupped. Please try again in a moment. Meanwhile, you can check the Roadmap or Budget tools directly.";
    }

    // 6) Persist assistant reply
    convo.messages.push({ role: "assistant", content: assistantContent });
    convo.lastMessageAt = new Date();
    await convo.save();

    res.status(200).json({
      conversationId: convo._id,
      title: convo.title,
      reply: assistantContent,
      // Echo the last few messages back so the frontend can rehydrate without
      // a second round-trip.
      messages: convo.messages.slice(-2), // user + assistant
    });
  } catch (err) {
    console.error("[/api/mentor-chat] failed:", err);
    res.status(500).json({ error: "Mentor chat failed", details: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// GET /api/mentor-conversations — list mine (sidebar)
// ════════════════════════════════════════════════════════════
mentorRouter.get("/mentor-conversations", protect, async (req, res) => {
  try {
    const userId = userIdFrom(req);
    if (!userId) return res.json({ conversations: [] });
    const docs = await Conversation.find({ user: userId })
      .sort({ pinned: -1, lastMessageAt: -1 })
      // Don't ship full message history in the sidebar — just the metadata
      .select("title status lastMessageAt contextSnapshot createdAt messages")
      .lean();
    // Trim messages to last 1 for preview (and message count)
    const compact = docs.map((d) => ({
      _id: d._id,
      title: d.title,
      status: d.status,
      lastMessageAt: d.lastMessageAt,
      createdAt: d.createdAt,
      contextSnapshot: d.contextSnapshot,
      messageCount: (d.messages || []).length,
      preview: (d.messages || []).slice(-1).map((m) => ({ role: m.role, content: m.content.slice(0, 120) }))[0] || null,
    }));
    res.json({ conversations: compact });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch conversations", details: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// GET /api/mentor-conversations/:id — full thread
// ════════════════════════════════════════════════════════════
mentorRouter.get("/mentor-conversations/:id", protect, async (req, res) => {
  try {
    const userId = userIdFrom(req);
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ error: "Invalid id" });
    const doc = await Conversation.findOne({ _id: id, user: userId }).lean();
    if (!doc) return res.status(404).json({ error: "Conversation not found" });
    res.json({ conversation: doc });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch conversation", details: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// PATCH /api/mentor-conversations/:id — rename / archive
// ════════════════════════════════════════════════════════════
mentorRouter.patch("/mentor-conversations/:id", protect, async (req, res) => {
  try {
    const userId = userIdFrom(req);
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ error: "Invalid id" });
    const update = {};
    if (typeof req.body?.title === "string") update.title = req.body.title.trim().slice(0, 120) || "Untitled";
    if (["active", "archived"].includes(req.body?.status)) update.status = req.body.status;
    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: "Nothing to update (send `title` or `status`)." });
    }
    const doc = await Conversation.findOneAndUpdate(
      { _id: id, user: userId },
      { $set: update },
      { new: true }
    ).lean();
    if (!doc) return res.status(404).json({ error: "Conversation not found" });
    res.json({ conversation: doc });
  } catch (err) {
    res.status(500).json({ error: "Failed to update", details: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// DELETE /api/mentor-conversations/:id
// ════════════════════════════════════════════════════════════
mentorRouter.delete("/mentor-conversations/:id", protect, async (req, res) => {
  try {
    const userId = userIdFrom(req);
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ error: "Invalid id" });
    const r = await Conversation.deleteOne({ _id: id, user: userId });
    if (!r.deletedCount) return res.status(404).json({ error: "Conversation not found" });
    res.json({ message: "Conversation deleted" });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete", details: err.message });
  }
});

export default mentorRouter;
