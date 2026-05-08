import mongoose from "mongoose";

// One row per (user, vendor). When the same user "reviews again", we update
// the existing row instead of creating a duplicate — enforced by the unique
// compound index below.
const reviewSchema = new mongoose.Schema(
  {
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // Snapshot of reviewer name so we can render reviews even if the user is deleted.
    userName: {
      type: String,
      default: "",
      trim: true,
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    comment: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: "",
    },
  },
  { timestamps: true }
);

// Hard-stop duplicates: each user gets exactly one review row per vendor.
reviewSchema.index({ user: 1, vendor: 1 }, { unique: true });

export default mongoose.model("Review", reviewSchema);
