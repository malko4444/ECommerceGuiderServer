import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
// import User from "../models/User.js";

import { sendOTPEmail } from "../utils/sendEmail.js";
import User from "../models/user.js";
import Otp from '../models/Otp.js'
import { protect } from "../middleware/auth.js";



export const router = express.Router();

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) throw new Error("Email and password required");

    const user = await User.findOne({ email });
    if (!user) throw new Error("User not found");

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) throw new Error("Invalid credentials");

    const token = jwt.sign(
      { id: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    res.status(200).json({ message: "Login successful", token });
  } catch (error) {
    console.error("Login error:", error);
    res.status(400).json({ error: error.message });
  }
});


// ✅ Generate OTP and send email
router.post("/otpGenerate", async (req, res) => {
  try {
    console.log("in the generate block");
    
    const { email } = req.body;
    if (!email) throw new Error("Email is required");


    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    console.log(`Generated OTP for ${email}: ${otp}`);

    await Otp.findOneAndUpdate(
      { email },
      { otp, createdAt: new Date() },
      { upsert: true, new: true }
    );

    await sendOTPEmail(email, otp);

    res.status(200).json({ message: "OTP sent successfully" });
  } catch (error) {
    console.error("OTP generation error:", error);
    res.status(400).json({ error: error.message });
  }
});

// ✅ Signup with OTP verification
router.post("/signup", async (req, res) => {
  try {
    const { email, password, name, gender, dob, otp } = req.body;

    const otpDoc = await Otp.findOne({ email });
    if (!otpDoc || otpDoc.otp !== otp) throw new Error("Invalid or expired OTP");

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      email,
      password: hashedPassword,
      name,
      gender,
      dob,
    });

    // Delete OTP after successful signup
    await Otp.deleteOne({ email });

    const token = jwt.sign(
      { id: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    res.status(201).json({ message: "User signed up successfully", token });
  } catch (error) {
    console.error("Signup error:", error);
    res.status(400).json({ error: error.message });
  }
}
);
router.get("/profile", protect, async (req, res) => {
  try {
    // `protect` middleware already decoded token → added `req.user`
    const userId = req.user.id;  

    const user = await User.findById(userId).select("-password"); // hide password
    if (!user) return res.status(404).json({ error: "User not found" });

    res.status(200).json({ message: "Profile fetched successfully", user });
  } catch (error) {
    console.error("Profile fetch error:", error);
    res.status(500).json({ error: "Server error" });
  }
});



