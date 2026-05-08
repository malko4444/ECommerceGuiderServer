// user history schema 
// models/Prompt.js
import mongoose from "mongoose";

const promptSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    prompt: { type: String, required: true },
    response: { type: String, required: true },
    category: { type: String }, // e.g. roadmap, budget, etc.
  },
  { timestamps: true }
);

export default mongoose.model("Prompt", promptSchema);
