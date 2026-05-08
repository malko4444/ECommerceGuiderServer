import mongoose from "mongoose";

// One AI-curated trend item, extracted from a Tavily search result.
const trendItemSchema = new mongoose.Schema(
  {
    name:         { type: String, required: true, trim: true },
    category:     { type: String, default: "", trim: true },
    priceRange:   { type: String, default: "", trim: true }, // free-text, e.g. "PKR 800–1500"
    whyTrending:  { type: String, default: "", trim: true },
    source:       { type: String, default: "", trim: true }, // e.g. "daraz.pk"
    sourceUrl:    { type: String, default: "", trim: true },
  },
  { _id: true }
);

// Lightweight Tavily passthrough — keep just enough so the user can
// re-render the original results in /trends/:id without another AI call.
const rawResultSchema = new mongoose.Schema(
  {
    title:   { type: String, default: "", trim: true },
    url:     { type: String, default: "", trim: true },
    content: { type: String, default: "" },
  },
  { _id: false }
);

const trendSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    query:           { type: String, required: true, trim: true },
    normalizedQuery: { type: String, required: true, trim: true, lowercase: true },
    summary:         { type: String, default: "", trim: true },
    items:           { type: [trendItemSchema], default: [] },
    rawResults:      { type: [rawResultSchema], default: [] },
    pinned:          { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Per-user index so we can quickly find a recent identical search and skip
// running it again (cheap deduping in addition to Tavily's own cache).
trendSchema.index({ user: 1, normalizedQuery: 1, createdAt: -1 });

export default mongoose.model("Trend", trendSchema);
