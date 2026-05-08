import jwt from "jsonwebtoken";
import Admin from "../models/Admin.js";


export const protectAdmin = async (req, res, next) => {
  try {
    console.log("Verifying admin access with cookies:", req.cookies);
      const token = req.cookies.adminToken;
      if (!token) return res.status(401).json({ error: "No token" });
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.admin = await Admin.findById(decoded.id).select("-password");
      } catch (error) {
        res.status(401).json({ error: "Invalid token" });
      } // available in protected routes
    next();
  } catch (error) {
    console.error("Auth error:", error);
    res.status(401).json({ error: "Invalid or expired token" });
  }
};