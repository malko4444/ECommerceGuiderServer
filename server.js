// server.js
import express from 'express';
import dotenv from 'dotenv';
import { tavily } from '@tavily/core';
import cors from 'cors';
import cookieParser from "cookie-parser";
import OpenAI from "openai";
import { router as authRoutes } from "./routes/authRoutes.js";
import connectDB from './config/db.js';
import Prompt from './models/Prompt.js';
import { protect } from './middleware/auth.js';
import vendorRouter from './routes/vendor.js';
import matchRouter from './routes/match.js';
import roadmapRouter from './routes/roadmap.js';
import budgetRouter from './routes/budget.js';
import discoveryRouter from './routes/discovery.js';
import profitRouter from './routes/profit.js';
import mentorRouter from './routes/mentor.js';
import platformRouter from './routes/platform.js';
import tutorialsRouter from './routes/tutorials.js';
import { adminRouter } from './routes/adminRoutes.js';

dotenv.config();

const app = express();


app.use(cors({
  origin: "http://localhost:3000",
  credentials: true
}));

app.use(cookieParser());
app.use(express.json());
app.use((req, res, next) => {
  console.log("Incoming cookies:", req.cookies);
  next();
});


connectDB();
app.use("/auth", authRoutes);
app.use("/vendor", vendorRouter);
app.use("/api", matchRouter);
app.use("/api", roadmapRouter);
app.use("/api", budgetRouter);
app.use("/api", discoveryRouter);
app.use("/api", profitRouter);
app.use("/api", mentorRouter);
app.use("/api", platformRouter);
app.use("/api", tutorialsRouter);


const tvly = tavily({ apiKey: process.env.TAVILY_KEY });
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ═══════════════════════════════════════════════════════
// HELPER: Call OpenAI with isolated system + user prompt
// ═══════════════════════════════════════════════════════
async function generateWithOpenAI(systemPrompt, userPrompt) {
  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user",   content: userPrompt   }
    ]
  });
  return response.choices[0].message.content;
}

// ═══════════════════════════════════════════════════════
// SHARED INPUT VALIDATORS  (fast-fail, no AI token cost)
// ═══════════════════════════════════════════════════════

function isInvalidText(value) {
  if (!value || typeof value !== "string") return true;
  const trimmed = value.trim();
  if (trimmed.length < 2) return true;
  const hasVowel = /[aeiouAEIOU]/.test(trimmed);
  if (trimmed.length > 4 && !hasVowel) return true;
  return false;
}

function isInvalidAmount(value) {
  const num = Number(value);
  return isNaN(num) || num <= 0;
}

function isExcessiveAmount(value) {
  return Number(value) > 100_000_000;
}

// Catches "5000", "PKR 500", "500 Rs", "$500", "5,000.00"
function isPureNumberOrAmount(value) {
  if (!value || typeof value !== "string") return false;
  return /^(PKR\s*)?\d[\d,\.]*(\s*PKR|\s*Rs\.?|\s*\$|%)?$/i.test(value.trim());
}

// Curated list of common Pakistani, Arabic, and Western first names
const PERSON_NAMES = new Set([
  "nouman","noman","ali","ahmed","usman","hassan","hussain","muhammad","mohammad",
  "muhamad","bilal","hamza","omar","umar","zain","zaid","saad","talha","asad",
  "adnan","imran","kamran","shahid","farhan","waseem","waqas","rizwan","tariq",
  "naeem","naveed","ahsan","faisal","danish","rehan","omer","junaid","asim",
  "shoaib","arif","nasir","zahid","irfan","sajid","azam","akram","sohail",
  "aisha","fatima","zara","hira","sana","nadia","rabia","amna","maryam",
  "ayesha","kiran","sadia","uzma","saima","mahnoor","nimra","alina","dania",
  "john","jane","mike","david","james","robert","william","richard","thomas",
  "charles","mark","donald","george","kevin","brian","adam","andrew","peter",
  "paul","matthew","chris","daniel","michael","steven","gary","eric","jason",
  "mary","patricia","jennifer","linda","barbara","susan","jessica","karen",
  "lisa","nancy","betty","margaret","dorothy","sandra","emily","anna","sarah",
  "ayaan","aayan","ayan","taha","sohaib","suhaib","muneeb","moiz","musa",
  "yahya","ibrahim","ismail","idris","nawaz","nawab","zubair","athar","kashif",
]);

function looksLikePersonName(value) {
  if (!value || typeof value !== "string") return false;
  const trimmed = value.trim().toLowerCase();
  if (PERSON_NAMES.has(trimmed)) return true;
  const parts = trimmed.split(/\s+/);
  if (parts.length === 2 && PERSON_NAMES.has(parts[0]) && PERSON_NAMES.has(parts[1])) return true;
  if (parts.length === 3 && parts.every(p => PERSON_NAMES.has(p))) return true;
  return false;
}

app.use("/admin", adminRouter);

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
