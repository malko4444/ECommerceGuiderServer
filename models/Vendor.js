import mongoose from "mongoose";

const vendorSchema = new mongoose.Schema(
  {
    // ─── Core (existing) ──────────────────────────
    vendorName: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      required: true,
      trim: true,
      enum: [
        "Home Decor",
        "Electronics",
        "IT Services",
        "Clothing",
        "Food Supplier",
        "Construction",
        "Marketing",
        "Other",
      ],
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    website: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },

    // ─── Stage 1 SaaS upgrades (all optional) ─────
    logo: {
      type: String,
      trim: true,
      default: "",
    },
    city: {
      type: String,
      trim: true,
      default: "",
    },
    description: {
      type: String,
      trim: true,
      maxlength: 600,
      default: "",
    },
    whatsapp: {
      type: String,
      trim: true,
      default: "",
    },
    services: {
      type: [String],
      default: [],
    },
    verified: {
      type: Boolean,
      default: false,
    },
    yearsInBusiness: {
      type: Number,
      min: 0,
      max: 200,
      default: 0,
    },
  },
  { timestamps: true }
);

// Helpful text index for future server-side search (Stage 2/3)
vendorSchema.index({
  vendorName: "text",
  description: "text",
  services: "text",
  city: "text",
});

export default mongoose.model("Vendor", vendorSchema);
