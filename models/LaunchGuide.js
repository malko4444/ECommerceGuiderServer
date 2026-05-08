import mongoose from "mongoose";

// Same checklist pattern we use in Roadmap — one task = one checkbox.
const guideTaskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    helpText: { type: String, default: "", trim: true },
    done: { type: Boolean, default: false },
    completedAt: { type: Date, default: null },
  },
  { _id: true }
);

const guidePhaseSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },     // e.g. "Account Setup"
    summary: { type: String, default: "", trim: true },
    tasks: { type: [guideTaskSchema], default: [] },
  },
  { _id: true }
);

const launchGuideSchema = new mongoose.Schema(
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
    platform: { type: String, required: true, trim: true },  // canonical key
    platformName: { type: String, default: "", trim: true }, // display name
    overview: { type: String, default: "", trim: true },
    phases: { type: [guidePhaseSchema], default: [] },
    status: {
      type: String,
      enum: ["active", "completed", "archived"],
      default: "active",
    },
  },
  { timestamps: true }
);

launchGuideSchema.virtual("progress").get(function () {
  const all = (this.phases || []).flatMap((p) => p.tasks || []);
  if (!all.length) return { done: 0, total: 0, pct: 0 };
  const done = all.filter((t) => t.done).length;
  return { done, total: all.length, pct: Math.round((done / all.length) * 100) };
});

launchGuideSchema.set("toJSON", { virtuals: true });
launchGuideSchema.set("toObject", { virtuals: true });

export default mongoose.model("LaunchGuide", launchGuideSchema);
