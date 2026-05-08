import mongoose from "mongoose";

// "Bookmark" + a private note attached to that bookmark.
// Each (user, vendor) pair is unique — saving twice just updates the note.
const savedVendorSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
      index: true,
    },
    note: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: "",
    },
  },
  { timestamps: true }
);

savedVendorSchema.index({ user: 1, vendor: 1 }, { unique: true });

export default mongoose.model("SavedVendor", savedVendorSchema);
