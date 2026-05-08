import mongoose from "mongoose";

const competitorSchema = new mongoose.Schema(
  {
    name:        { type: String, required: true, trim: true },
    website:     { type: String, default: "", trim: true },
    description: { type: String, default: "", trim: true },
    // New structured fields — old responses without these still validate
    // because they're optional with defaults.
    priceRange:  { type: String, default: "", trim: true },
    strengths:   { type: [String], default: [] },
    weaknesses:  { type: [String], default: [] },
    audience:    { type: String, default: "", trim: true },
  },
  { _id: true }
);

const rawResultSchema = new mongoose.Schema(
  {
    title:   { type: String, default: "", trim: true },
    url:     { type: String, default: "", trim: true },
    content: { type: String, default: "" },
  },
  { _id: false }
);

const competitorReportSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // Optional link back to the roadmap that drove this analysis.
    roadmap: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Roadmap",
      default: null,
      index: true,
    },
    product: { type: String, required: true, trim: true },
    analysis: { type: String, default: "", trim: true },
    competitors: { type: [competitorSchema], default: [] },
    rawResults: { type: [rawResultSchema], default: [] },
  },
  { timestamps: true }
);

competitorReportSchema.index({ user: 1, product: 1, createdAt: -1 });

export default mongoose.model("CompetitorReport", competitorReportSchema);
