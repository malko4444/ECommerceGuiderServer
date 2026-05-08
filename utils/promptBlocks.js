import { PLATFORMS, platformSummary, competingPlatformNames, resolvePlatform } from "./platforms.js";

// ════════════════════════════════════════════════════════════
// Reusable AI prompt fragments. Each route assembles its own
// system prompt by concatenating these. The point: enforce
// platform commitment in ONE place, used everywhere.
// ════════════════════════════════════════════════════════════

/**
 * Platform-lock block to insert into a system prompt.
 *
 * If the user picked a platform (e.g. "shopify"), this returns a strict
 * "commit to Shopify, do NOT mention Daraz / Instagram / etc" instruction
 * plus the canonical fact sheet. If the user picked nothing, returns a
 * short "be platform-agnostic" instruction.
 */
export function platformLockBlock(platformInput) {
  const key = resolvePlatform(platformInput);
  if (!key) {
    return [
      "PLATFORM CONTEXT: User has NOT chosen a specific platform.",
      "Recommend across Daraz, Shopify, Instagram, Facebook, TikTok Shop, WhatsApp Business as appropriate.",
      "Do not commit to one platform; suggest 1–2 best fits with brief reasoning.",
    ].join("\n");
  }

  const others = competingPlatformNames(key);
  return [
    `━━━ PLATFORM LOCK ━━━`,
    `User has chosen: ${PLATFORMS[key].name}.`,
    `You MUST tailor every recommendation to ${PLATFORMS[key].name} only.`,
    `Do NOT recommend, compare with, or mention these other platforms unless directly asked: ${others.join(", ")}.`,
    `If a step does not apply on ${PLATFORMS[key].name}, replace it with the closest equivalent ON THIS PLATFORM, do not skip to another.`,
    ``,
    `━━━ ${PLATFORMS[key].name.toUpperCase()} FACT SHEET (use these numbers and terms) ━━━`,
    platformSummary(key),
  ].join("\n");
}

/**
 * Pakistan market context block — values like PKR, payment methods,
 * delivery norms. Used by every coaching tool for consistency.
 */
export const PAKISTAN_MARKET_BLOCK = [
  "━━━ PAKISTAN MARKET RULES ━━━",
  "All money values in PKR (Pakistani Rupees). No USD unless explicitly comparing.",
  "Default payment expectation: Cash on Delivery (COD) is dominant. Mention JazzCash / EasyPaisa / bank transfer as alternatives.",
  "Common couriers: TCS, Leopards, M&P, BlueEx, PostEx (PostEx best for COD automation).",
  "Common wholesale markets: Akbari Mandi (Lahore), Tariq Road / Bolton Market / Jodia Bazar (Karachi), Raja Bazaar (Rawalpindi), Hafeez Centre (Lahore — electronics).",
  "Cities with strongest e-commerce demand: Karachi, Lahore, Islamabad, Rawalpindi, Faisalabad.",
].join("\n");

/**
 * Experience-level adjustment block — softens or hardens advice.
 */
export function experienceBlock(experience) {
  switch ((experience || "").toLowerCase()) {
    case "first_time":
    case "beginner":
      return [
        "USER EXPERIENCE: First-time online seller.",
        "Use simple language. Avoid jargon. Default to safer, lower-risk choices.",
        "Allocate more contingency in budgets. Suggest small batches, not bulk imports.",
      ].join("\n");
    case "sold_before":
    case "intermediate":
      return [
        "USER EXPERIENCE: Has sold online before.",
        "Skip 101 explanations. Focus on optimization, scaling, and platform-specific tactics.",
      ].join("\n");
    case "brand_owner":
    case "advanced":
      return [
        "USER EXPERIENCE: Already runs a brand.",
        "Treat them as a peer. Focus on growth, automation, ad optimization, and unit economics.",
      ].join("\n");
    default:
      return "USER EXPERIENCE: Not specified — use default beginner-friendly tone.";
  }
}

/**
 * City-specific block — names actual nearby wholesale markets.
 */
export function cityBlock(city) {
  if (!city || typeof city !== "string") return "USER CITY: Not specified.";
  const c = city.trim();
  const map = {
    karachi: "Tariq Road (clothing), Bolton Market (general wholesale), Jodia Bazar (textiles + electronics), Saddar.",
    lahore: "Akbari Mandi (general wholesale), Hafeez Centre (electronics), Anarkali, Liberty Market.",
    islamabad: "Sunday Bazaar, F-10 / G-9 markets. Many sellers source from Rawalpindi.",
    rawalpindi: "Raja Bazaar, Saddar, Commercial Market.",
    faisalabad: "Ghanta Ghar / 8 Bazaars (textile capital).",
    multan: "Hussain Agahi, Cantt Bazaar.",
    peshawar: "Qissa Khwani Bazaar, Saddar.",
  };
  const known = map[c.toLowerCase()];
  if (known) {
    return `USER CITY: ${c}. Reference these local wholesale options when relevant: ${known}`;
  }
  return `USER CITY: ${c}. Reference closest known wholesale hubs in Pakistan if relevant.`;
}

/**
 * Compose a full coaching context block from the inputs you usually have.
 * Pass it to the system prompt before your tool-specific instructions.
 */
export function coachingContextBlock({ platform, city, experience }) {
  return [
    platformLockBlock(platform),
    "",
    cityBlock(city),
    "",
    experienceBlock(experience),
    "",
    PAKISTAN_MARKET_BLOCK,
  ].join("\n");
}
