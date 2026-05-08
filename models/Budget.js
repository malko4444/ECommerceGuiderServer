import mongoose from "mongoose";

// One expense entry per "I spent X on Y" log against a category.
// Stored inline on the allocation so per-category math is one read.
const expenseSchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true, min: 0 },
    note: { type: String, default: "", trim: true, maxlength: 200 },
    spentAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const allocationSchema = new mongoose.Schema(
  {
    category: { type: String, required: true, trim: true }, // "Stock", "Packaging", ...
    amount: { type: Number, default: 0, min: 0 },
    percent: { type: Number, default: 0, min: 0, max: 100 },
    tip: { type: String, default: "", trim: true },
    expenses: { type: [expenseSchema], default: [] }, // ready for Stage C
  },
  { _id: true }
);

const budgetSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // Optional link back to the roadmap that spawned this budget — that's
    // the whole point of Stage A.
    roadmap: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Roadmap",
      default: null,
      index: true,
    },

    productType: { type: String, default: "", trim: true },

    inputs: {
      city: { type: String, default: "", trim: true },
      platform: { type: String, default: "", trim: true },
      experience: { type: String, default: "", trim: true },
    },

    totalBudget: { type: Number, required: true, min: 1 },
    tier: { type: String, default: "", trim: true }, // Micro|Small|Medium|Large

    allocations: { type: [allocationSchema], default: [] },

    estimatedRevenue: {
      low: { type: Number, default: 0 },
      high: { type: Number, default: 0 },
    },
    tips: { type: [String], default: [] },

    status: {
      type: String,
      enum: ["active", "archived", "completed"],
      default: "active",
    },

    rawOutput: { type: String, default: "" }, // diagnostics
  },
  { timestamps: true }
);

// Convenience derived fields — recomputed on every read so a stray write
// can never leave totals out of sync with their parts.
budgetSchema.virtual("totalSpent").get(function () {
  return (this.allocations || []).reduce((sum, a) => {
    return sum + (a.expenses || []).reduce((s, e) => s + (e.amount || 0), 0);
  }, 0);
});

budgetSchema.virtual("burnPct").get(function () {
  if (!this.totalBudget) return 0;
  return Math.round((this.totalSpent / this.totalBudget) * 100);
});

budgetSchema.set("toJSON", { virtuals: true });
budgetSchema.set("toObject", { virtuals: true });

export default mongoose.model("Budget", budgetSchema);
