import express from "express";
import mongoose from "mongoose";

const vendorRouter = express.Router();
import Vendor from "../models/Vendor.js";
import Inquiry from "../models/Inquiry.js";
import Review from "../models/Review.js";
import SavedVendor from "../models/SavedVendor.js";
import { protectAdmin } from "../middleware/protectAdmin.js";
import { protect } from "../middleware/auth.js";
import { sendInquiryEmail } from "../utils/sendEmail.js";

// ─── helpers ──────────────────────────────────────────────────
const buildVendorPayload = (body = {}) => {
  const {
    vendorName, category, website, email, phone,
    logo, city, description, whatsapp, services, verified, yearsInBusiness,
  } = body;

  let normalizedServices = [];
  if (Array.isArray(services)) {
    normalizedServices = services
      .map((s) => (typeof s === "string" ? s.trim() : ""))
      .filter(Boolean);
  } else if (typeof services === "string" && services.trim()) {
    normalizedServices = services.split(",").map((s) => s.trim()).filter(Boolean);
  }

  let years = 0;
  if (yearsInBusiness !== undefined && yearsInBusiness !== "") {
    const parsed = Number(yearsInBusiness);
    years = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }

  return {
    vendorName, category, website, email, phone,
    logo: typeof logo === "string" ? logo.trim() : "",
    city: typeof city === "string" ? city.trim() : "",
    description: typeof description === "string" ? description.trim() : "",
    whatsapp: typeof whatsapp === "string" ? whatsapp.trim() : "",
    services: normalizedServices,
    verified: Boolean(verified),
    yearsInBusiness: years,
  };
};

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);
const userIdFrom = (req) => req.user?.id || req.user?._id || req.user?.userId;

// Aggregate avgRating + reviewCount for a list of vendor ids.
// Returns a Map<vendorIdStr, { avg, count }>.
const getRatingsMap = async (vendorIds) => {
  if (!vendorIds.length) return new Map();
  const stats = await Review.aggregate([
    { $match: { vendor: { $in: vendorIds.map((v) => new mongoose.Types.ObjectId(v)) } } },
    { $group: { _id: "$vendor", avg: { $avg: "$rating" }, count: { $sum: 1 } } },
  ]);
  const map = new Map();
  stats.forEach((s) => map.set(String(s._id), { avg: s.avg, count: s.count }));
  return map;
};

// Returns a Set<vendorIdStr> of vendors saved by the given user.
const getSavedSet = async (userId, vendorIds) => {
  if (!userId || !vendorIds.length) return new Set();
  const saved = await SavedVendor.find({ user: userId, vendor: { $in: vendorIds } }, "vendor").lean();
  return new Set(saved.map((s) => String(s.vendor)));
};

// Decorates plain vendor objects with rating + savedByMe flags.
const decorateVendors = async (vendors, userId) => {
  const ids = vendors.map((v) => v._id);
  const [ratings, saved] = await Promise.all([
    getRatingsMap(ids),
    getSavedSet(userId, ids),
  ]);
  return vendors.map((v) => {
    const r = ratings.get(String(v._id));
    return {
      ...v,
      avgRating: r ? Number(r.avg.toFixed(2)) : 0,
      reviewCount: r ? r.count : 0,
      savedByMe: saved.has(String(v._id)),
    };
  });
};

// ============================================================
// ADMIN ROUTES
// ============================================================

vendorRouter.get("/dashboard", protectAdmin, async (req, res) => {
  try {
    const vendors = await Vendor.find({}).sort({ createdAt: -1 });
    res.json({ vendors });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch vendors", details: error.message });
  }
});

vendorRouter.post("/add", protectAdmin, async (req, res) => {
  try {
    const payload = buildVendorPayload(req.body);
    const newVendor = new Vendor(payload);
    const vendorSaved = await newVendor.save();
    return res.status(201).json({ message: "Vendor added successfully", vendor: vendorSaved });
  } catch (error) {
    console.log("SAVE ERROR:", error);
    return res.status(500).json({ error: "Failed to add vendor", details: error.message });
  }
});

vendorRouter.delete("/delete/:id", protectAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ error: "Invalid vendor id" });
    const deletedVendor = await Vendor.findByIdAndDelete(id);
    if (!deletedVendor) return res.status(404).json({ error: "Vendor not found" });
    // Cascade-clean: remove reviews/saved/inquiries pointing at it
    await Promise.all([
      Review.deleteMany({ vendor: id }),
      SavedVendor.deleteMany({ vendor: id }),
    ]);
    res.json({ message: `Vendor with ID ${id} deleted successfully`, vendor: deletedVendor });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete vendor", details: error.message });
  }
});

vendorRouter.put("/update/:id", protectAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ error: "Invalid vendor id" });
    const payload = buildVendorPayload(req.body);
    const updatedVendor = await Vendor.findByIdAndUpdate(id, payload, { new: true, runValidators: true });
    if (!updatedVendor) return res.status(404).json({ error: "Vendor not found" });
    res.json({ message: `Vendor with ID ${id} updated successfully`, vendor: updatedVendor });
  } catch (error) {
    res.status(500).json({ error: "Failed to update vendor", details: error.message });
  }
});

vendorRouter.get("/inquiries", protectAdmin, async (req, res) => {
  try {
    const inquiries = await Inquiry.find({})
      .sort({ createdAt: -1 })
      .populate("vendor", "vendorName email category city")
      .lean();
    res.json({ inquiries });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch inquiries", details: error.message });
  }
});

// ============================================================
// USER ROUTES — STATIC PATHS FIRST (before /:id matchers)
// ============================================================

// User: list all vendors (verified first), enriched with rating + savedByMe
vendorRouter.get("/all", protect, async (req, res) => {
  try {
    const vendors = await Vendor.find({}).sort({ verified: -1, createdAt: -1 }).lean();
    const decorated = await decorateVendors(vendors, userIdFrom(req));
    res.json({ vendors: decorated });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch vendors", details: error.message });
  }
});

// User: list inquiries the logged-in user has sent.
vendorRouter.get("/my-inquiries", protect, async (req, res) => {
  try {
    const userId = userIdFrom(req);
    if (!userId) return res.json({ inquiries: [] });
    const inquiries = await Inquiry.find({ fromUser: userId })
      .sort({ createdAt: -1 })
      .populate("vendor", "vendorName logo category city")
      .lean();
    res.json({ inquiries });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch your inquiries", details: error.message });
  }
});

// User: my saved vendors (with private notes).
vendorRouter.get("/saved", protect, async (req, res) => {
  try {
    const userId = userIdFrom(req);
    if (!userId) return res.json({ saved: [] });
    const rows = await SavedVendor.find({ user: userId })
      .sort({ createdAt: -1 })
      .populate("vendor")
      .lean();
    // Filter rows where the vendor was deleted out from under us.
    const filtered = rows.filter((r) => r.vendor);
    res.json({ saved: filtered });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch saved vendors", details: error.message });
  }
});

// User: update private note on a saved vendor (creates the saved row if missing).
vendorRouter.put("/saved/:vendorId/note", protect, async (req, res) => {
  try {
    const userId = userIdFrom(req);
    const { vendorId } = req.params;
    const { note = "" } = req.body || {};
    if (!isValidId(vendorId)) return res.status(400).json({ error: "Invalid vendor id" });
    if (typeof note !== "string" || note.length > 1000) {
      return res.status(400).json({ error: "Note must be a string ≤ 1000 chars." });
    }
    const updated = await SavedVendor.findOneAndUpdate(
      { user: userId, vendor: vendorId },
      { $set: { note: note.trim() } },
      { new: true, upsert: true }
    );
    res.json({ saved: updated });
  } catch (error) {
    res.status(500).json({ error: "Failed to update note", details: error.message });
  }
});

// User: unsave a vendor.
vendorRouter.delete("/saved/:vendorId", protect, async (req, res) => {
  try {
    const userId = userIdFrom(req);
    const { vendorId } = req.params;
    if (!isValidId(vendorId)) return res.status(400).json({ error: "Invalid vendor id" });
    await SavedVendor.deleteOne({ user: userId, vendor: vendorId });
    res.json({ message: "Vendor removed from saved." });
  } catch (error) {
    res.status(500).json({ error: "Failed to unsave vendor", details: error.message });
  }
});

// ============================================================
// USER ROUTES — DYNAMIC :id PATHS (kept LAST)
// ============================================================

// User: send inquiry to a vendor
vendorRouter.post("/:id/inquire", protect, async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ error: "Invalid vendor id" });
    const vendor = await Vendor.findById(id);
    if (!vendor) return res.status(404).json({ error: "Vendor not found" });

    const { name, email, phone = "", budget = "", message } = req.body || {};

    if (!name || typeof name !== "string" || name.trim().length < 2) {
      return res.status(400).json({ error: "Please provide your name." });
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Please provide a valid email." });
    }
    if (!message || typeof message !== "string" || message.trim().length < 10) {
      return res.status(400).json({
        error: "Message is too short. Please describe what you need (at least 10 characters).",
      });
    }
    if (message.length > 2000) {
      return res.status(400).json({ error: "Message too long (max 2000 chars)." });
    }

    const inquiry = await Inquiry.create({
      vendor: vendor._id,
      fromUser: userIdFrom(req) || null,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: String(phone).trim(),
      budget: String(budget).trim(),
      message: message.trim(),
    });

    let emailSent = true;
    try {
      await sendInquiryEmail({
        vendorEmail: vendor.email,
        vendorName: vendor.vendorName,
        fromName: inquiry.name,
        fromEmail: inquiry.email,
        fromPhone: inquiry.phone,
        budget: inquiry.budget,
        message: inquiry.message,
      });
    } catch (mailErr) {
      emailSent = false;
      console.error("Inquiry email failed:", mailErr.message);
    }

    res.status(201).json({
      message: emailSent
        ? "Inquiry sent! The vendor will get in touch soon."
        : "Inquiry saved, but email delivery is delayed. Vendor will still see it.",
      inquiry,
      emailSent,
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to send inquiry", details: error.message });
  }
});

// ─── REVIEWS ───────────────────────────────────────────────

// Public-ish (still requires login, like the rest of the user surface):
// list all reviews for one vendor, newest first.
vendorRouter.get("/:id/reviews", protect, async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ error: "Invalid vendor id" });

    const reviews = await Review.find({ vendor: id })
      .sort({ createdAt: -1 })
      .lean();

    // Attach myReviewId so the frontend knows which one to highlight as "yours".
    const myUserId = userIdFrom(req);
    const myReview = myUserId
      ? reviews.find((r) => String(r.user) === String(myUserId)) || null
      : null;

    const stats = await Review.aggregate([
      { $match: { vendor: new mongoose.Types.ObjectId(id) } },
      { $group: { _id: null, avg: { $avg: "$rating" }, count: { $sum: 1 } } },
    ]);
    const summary = stats[0]
      ? { avgRating: Number(stats[0].avg.toFixed(2)), reviewCount: stats[0].count }
      : { avgRating: 0, reviewCount: 0 };

    res.json({ reviews, myReview, summary });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch reviews", details: error.message });
  }
});

// Create or update the user's review for this vendor.
vendorRouter.post("/:id/review", protect, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = userIdFrom(req);
    if (!userId) return res.status(401).json({ error: "Login required" });
    if (!isValidId(id)) return res.status(400).json({ error: "Invalid vendor id" });

    const vendor = await Vendor.findById(id);
    if (!vendor) return res.status(404).json({ error: "Vendor not found" });

    const { rating, comment = "" } = req.body || {};
    const ratingNum = Number(rating);
    if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ error: "Rating must be an integer between 1 and 5." });
    }
    if (typeof comment !== "string" || comment.length > 1000) {
      return res.status(400).json({ error: "Comment must be ≤ 1000 chars." });
    }

    // Snapshot reviewer name from the JWT payload (best-effort).
    const userName = req.user?.email ? req.user.email.split("@")[0] : "Buyer";

    const review = await Review.findOneAndUpdate(
      { user: userId, vendor: id },
      { $set: { rating: ratingNum, comment: comment.trim(), userName } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    res.status(201).json({ message: "Review saved.", review });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ error: "You have already reviewed this vendor." });
    }
    res.status(500).json({ error: "Failed to save review", details: error.message });
  }
});

// Delete the user's own review for this vendor.
vendorRouter.delete("/:id/review", protect, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = userIdFrom(req);
    if (!userId) return res.status(401).json({ error: "Login required" });
    if (!isValidId(id)) return res.status(400).json({ error: "Invalid vendor id" });

    const result = await Review.deleteOne({ user: userId, vendor: id });
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: "You have no review on this vendor." });
    }
    res.json({ message: "Review deleted." });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete review", details: error.message });
  }
});

// ─── SAVE / UNSAVE ─────────────────────────────────────────

// Toggle save (idempotent — returns saved boolean).
vendorRouter.post("/:id/save", protect, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = userIdFrom(req);
    if (!userId) return res.status(401).json({ error: "Login required" });
    if (!isValidId(id)) return res.status(400).json({ error: "Invalid vendor id" });

    const vendor = await Vendor.findById(id);
    if (!vendor) return res.status(404).json({ error: "Vendor not found" });

    const existing = await SavedVendor.findOne({ user: userId, vendor: id });
    if (existing) {
      await SavedVendor.deleteOne({ _id: existing._id });
      return res.json({ saved: false, message: "Removed from saved." });
    }
    await SavedVendor.create({ user: userId, vendor: id, note: "" });
    res.status(201).json({ saved: true, message: "Saved!" });
  } catch (error) {
    res.status(500).json({ error: "Failed to toggle save", details: error.message });
  }
});

// ─── SINGLE VENDOR (must be LAST among /:id GETs) ──────────

vendorRouter.get("/:id", protect, async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`[vendor/:id] hit with id="${id}"`);
    if (!isValidId(id)) {
      return res.status(400).json({ error: "Invalid vendor id" });
    }
    const vendor = await Vendor.findById(id).lean();
    if (!vendor) {
      const total = await Vendor.countDocuments();
      return res.status(404).json({
        error: "Vendor not found",
        details: `No vendor with id ${id}. There are ${total} vendor(s) in the database.`,
      });
    }
    const [decorated] = await decorateVendors([vendor], userIdFrom(req));
    res.json({ vendor: decorated });
  } catch (error) {
    console.log(`[vendor/:id] error:`, error.message);
    res.status(500).json({ error: "Failed to fetch vendor", details: error.message });
  }
});

export default vendorRouter;
