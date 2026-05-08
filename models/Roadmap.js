import mongoose from "mongoose";

// Each phase has tasks. Each task has its own _id so the frontend can
// flip "done" without sending the whole document back.
const taskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    helpText: { type: String, default: "", trim: true },
    // Optional deep-link to another tool inside the app, e.g.
    // "/match?q=clothing+lahore" or "/budget?amount=50000". Helps phase tasks
    // feel connected to the rest of the platform.
    linkTo: { type: String, default: "", trim: true },
    linkLabel: { type: String, default: "", trim: true },
    done: { type: Boolean, default: false },
    completedAt: { type: Date, default: null },
  },
  { _id: true }
);

const phaseSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true }, // e.g. "Setup"
    weeks: { type: String, default: "", trim: true },     // e.g. "Week 1–2"
    summary: { type: String, default: "", trim: true },
    tasks: { type: [taskSchema], default: [] },
  },
  { _id: true }
);

const roadmapSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    productType: { type: String, required: true, trim: true },

    // Inputs the user provided in the wizard (Stage C — already supported by the
    // schema so we don't migrate later). All optional.
    inputs: {
      budget: { type: Number, default: 0 },          // PKR
      city: { type: String, default: "", trim: true },
      experience: { type: String, default: "", trim: true },  // first_time | sold_before | brand_owner
      platform: { type: String, default: "", trim: true },    // daraz | instagram | shopify | multiple
      hoursPerWeek: { type: Number, default: 0 },
    },

    overview: { type: String, default: "", trim: true },
    phases: { type: [phaseSchema], default: [] },

    estimatedBudget: {
      min: { type: Number, default: 0 },
      max: { type: Number, default: 0 },
    },
    estimatedDays: { type: Number, default: 0 },

    status: {
      type: String,
      enum: ["draft", "active", "completed", "archived"],
      default: "active",
    },

    // Snapshot of the original markdown the AI returned, kept for diagnostics
    rawOutput: { type: String, default: "" },
  },
  { timestamps: true }
);

// Cheap virtual that derives progress on read — no extra writes needed.
roadmapSchema.virtual("progress").get(function () {
  const all = (this.phases || []).flatMap((p) => p.tasks || []);
  if (!all.length) return { done: 0, total: 0, pct: 0 };
  const done = all.filter((t) => t.done).length;
  return {
    done,
    total: all.length,
    pct: Math.round((done / all.length) * 100),
  };
});

roadmapSchema.set("toJSON", { virtuals: true });
roadmapSchema.set("toObject", { virtuals: true });

export default mongoose.model("Roadmap", roadmapSchema);
