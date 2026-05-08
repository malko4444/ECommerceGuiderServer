import mongoose from "mongoose";

// One persisted message — a row in the chat thread.
const messageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ["user", "assistant", "system"], required: true },
    content: { type: String, required: true, trim: true, maxlength: 8000 },
  },
  { _id: true, timestamps: { createdAt: true, updatedAt: false } }
);

const conversationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: { type: String, default: "New conversation", trim: true, maxlength: 120 },
    messages: { type: [messageSchema], default: [] },

    // Snapshots taken when the conversation started — gives the AI a stable
    // "what is the user working on" anchor even if the user later edits or
    // deletes the underlying roadmap/budget.
    contextSnapshot: {
      productType: { type: String, default: "", trim: true },
      platform:    { type: String, default: "", trim: true },
      city:        { type: String, default: "", trim: true },
      experience:  { type: String, default: "", trim: true },
      budgetTotal: { type: Number, default: 0 },
      tier:        { type: String, default: "", trim: true },
    },

    lastMessageAt: { type: Date, default: Date.now },
    status: { type: String, enum: ["active", "archived"], default: "active" },
  },
  { timestamps: true }
);

conversationSchema.index({ user: 1, lastMessageAt: -1 });

export default mongoose.model("Conversation", conversationSchema);
