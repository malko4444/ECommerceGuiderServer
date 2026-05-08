import mongoose from "mongoose";

// Structured tutorial body — same shape across catalog topics and free-form ones.
const tutorialContentSchema = new mongoose.Schema(
  {
    whatIsIt:    { type: String, default: "", trim: true },
    whyItMatters:{ type: String, default: "", trim: true },
    steps:       { type: [String], default: [] },
    tips:        { type: [String], default: [] },
    mistakes:    { type: [String], default: [] },
    resources:   { type: [String], default: [] },
  },
  { _id: false }
);

const tutorialSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // For catalog topics, slug is canonical (e.g. "facebook-ads-pk").
    // For free-text topics, slug is auto-derived from the topic string.
    slug:    { type: String, required: true, trim: true, lowercase: true, index: true },
    topic:   { type: String, required: true, trim: true },     // Display name
    category: { type: String, default: "", trim: true },
    isCatalog: { type: Boolean, default: false },              // true if from curated catalog
    content: { type: tutorialContentSchema, default: () => ({}) },
    bookmarked: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

// One row per (user, slug) — same topic re-requested just updates the
// existing row instead of duplicating.
tutorialSchema.index({ user: 1, slug: 1 }, { unique: true });

export default mongoose.model("Tutorial", tutorialSchema);
