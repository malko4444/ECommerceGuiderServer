import mongoose from "mongoose";

// One scenario the user has analyzed. Math fields are computed server-side
// and stored so we never re-derive them on the frontend (single source of truth).
const profitCalcSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // Optional cross-links — let users see "for the skincare roadmap with PKR 50k budget".
    roadmap: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Roadmap",
      default: null,
      index: true,
    },
    budget: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Budget",
      default: null,
      index: true,
    },

    productType: { type: String, default: "", trim: true },
    label: { type: String, default: "", trim: true }, // user-given scenario name e.g. "v1 - 1500 selling"

    // Inputs
    cost: { type: Number, required: true, min: 0 },
    adBudget: { type: Number, required: true, min: 0 },
    sellingPrice: { type: Number, required: true, min: 0 },
    units: { type: Number, default: 0, min: 0 }, // planned units (optional)

    // Derived metrics (computed server-side once and stored)
    grossProfit: { type: Number, default: 0 },          // selling - cost (per unit)
    netProfit: { type: Number, default: 0 },            // gross - (adBudget / units) per unit
    margin: { type: Number, default: 0 },               // % of selling price
    roi: { type: Number, default: 0 },                  // % return on cost+ads basis
    breakEven: { type: Number, default: 0 },            // units to recover ad spend

    // AI-generated verdict + recommendations
    verdict: {
      type: String,
      enum: ["profitable", "marginal", "loss", "unknown"],
      default: "unknown",
    },
    verdictReason: { type: String, default: "", trim: true },
    recommendations: { type: [String], default: [] },

    status: {
      type: String,
      enum: ["active", "archived"],
      default: "active",
    },
  },
  { timestamps: true }
);

profitCalcSchema.set("toJSON", { virtuals: true });
profitCalcSchema.set("toObject", { virtuals: true });

export default mongoose.model("ProfitCalc", profitCalcSchema);
