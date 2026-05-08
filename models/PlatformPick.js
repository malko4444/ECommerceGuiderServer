import mongoose from "mongoose";

// One recommended platform inside the result. The "top" pick is the first
// of these or stored separately on the parent — schema treats them the same.
const platformOptionSchema = new mongoose.Schema(
  {
    platform: { type: String, required: true, trim: true },     // canonical key, e.g. "shopify"
    name: { type: String, default: "", trim: true },             // display name
    score: { type: Number, default: 0, min: 0, max: 100 },
    reason: { type: String, default: "", trim: true },
    setupEase: { type: String, default: "", trim: true },        // e.g. "Easy", "Medium"
    fees: { type: String, default: "", trim: true },             // free-text summary
    bestFor: { type: String, default: "", trim: true },
    firstStep: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const platformPickSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    roadmap: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Roadmap",
      default: null,
      index: true,
    },
    goal: { type: String, required: true, trim: true },
    top: { type: platformOptionSchema, default: null },
    alternatives: { type: [platformOptionSchema], default: [] },
    // For backward-compatible UI that wanted a single "advice" string.
    summary: { type: String, default: "", trim: true },
  },
  { timestamps: true }
);

platformPickSchema.index({ user: 1, createdAt: -1 });

export default mongoose.model("PlatformPick", platformPickSchema);
