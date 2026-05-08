import mongoose from "mongoose";

// Each time a buyer clicks "Send Inquiry" on a vendor profile,
// we drop a row in here AND email the vendor. That dual-write is
// what turns a directory into a lead-gen platform.
const inquirySchema = new mongoose.Schema(
  {
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
      index: true,
    },
    fromUser: {
      // Optional — the buyer's User _id if logged in.
      // Schema kept loose so anonymous inquiries are also possible later.
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    // ─── Snapshot of the inquirer (in case they delete account later) ─
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, trim: true, default: "" },
    // ─── The actual ask ──────────────────────────────────────────────
    budget: { type: String, trim: true, default: "" }, // free-text e.g. "PKR 50,000/mo"
    message: { type: String, required: true, trim: true, maxlength: 2000 },
    // ─── Lifecycle ───────────────────────────────────────────────────
    status: {
      type: String,
      enum: ["new", "viewed", "replied", "closed"],
      default: "new",
    },
  },
  { timestamps: true }
);

export default mongoose.model("Inquiry", inquirySchema);
