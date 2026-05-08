// ════════════════════════════════════════════════════════════
// Platform fact sheets — single source of truth for AI prompts.
// Numbers are CURRENT-as-of-2026 and intentionally rounded to
// avoid AI hallucinating false precision. Update as policies change.
// ════════════════════════════════════════════════════════════

export const PLATFORMS = {
  daraz: {
    name: "Daraz",
    slug: "daraz",
    aka: ["daraz.pk"],
    setupCost: "Free seller account",
    subscription: "None",
    commission: "5–15% per sale (varies by category — Fashion 13%, Electronics 5%, FMCG 6%)",
    transactionFees: "PKR 0–60 payment service fee per order",
    payments: ["COD (dominant)", "JazzCash", "EasyPaisa", "Debit/Credit cards"],
    fulfillment: [
      "Daraz Smart Stations (drop-off saves PKR 50–100 vs courier pickup)",
      "Daraz Express (DEX) for nationwide delivery",
      "Self-ship via TCS / Leopards / M&P",
    ],
    marketing: [
      "Daraz Sponsored Products (PPC inside the app)",
      "Daraz Affiliate program",
      "11.11 / Black Friday seasonal mega-events",
    ],
    setupTime: "2–3 days (CNIC + bank verification)",
    bestFor: "Mass-market sellers, price-sensitive buyers, COD-heavy",
    weakness: "Heavy competition, fee creep, customer loyalty stays with Daraz not seller",
    keyTerms: ["Daraz Seller Centre", "DEX", "Smart Station", "Sponsored Products"],
  },

  shopify: {
    name: "Shopify",
    slug: "shopify",
    aka: ["shopify.com"],
    setupCost: "Custom domain ~PKR 4,500/year (~$15)",
    subscription: "Basic plan ~PKR 8,500/month (~$29 USD)",
    commission: "0% platform commission — you keep 100% of revenue",
    transactionFees:
      "2.9% + PKR 30 on credit cards via Shopify Payments alternatives. Pakistan does not have native Shopify Payments — use Stripe (with US entity), Paymob, or local gateways via aggregators.",
    payments: [
      "COD (via apps like Advanced Cash on Delivery)",
      "JazzCash for Business (manual integration)",
      "EasyPaisa Merchant",
      "Stripe (requires US/UK entity for full functionality)",
      "Paymob",
    ],
    fulfillment: [
      "Self-ship via TCS / Leopards / M&P / BlueEx (manual or via app)",
      "ShyftKart / PostEx for automated COD courier",
      "No native warehousing in Pakistan",
    ],
    marketing: [
      "Meta Ads (Facebook/Instagram) — primary traffic source",
      "Google Shopping",
      "TikTok Ads",
      "SEO + content marketing",
    ],
    setupTime: "1–2 days for store, 1–2 weeks to integrate Pakistani payment gateway",
    bestFor: "Brand owners, premium pricing, custom design, full data ownership",
    weakness: "Monthly cost from day one, payment gateway pain in Pakistan, you provide all the traffic",
    keyTerms: ["Shopify admin", "Liquid theme", "Shopify Apps", "checkout.liquid", "PostEx", "Paymob"],
  },

  instagram: {
    name: "Instagram Shop",
    slug: "instagram",
    aka: ["instagram", "insta", "ig", "ig shop"],
    setupCost: "Free",
    subscription: "Free",
    commission: "0% (sales happen off-platform)",
    transactionFees: "Whatever payment method you accept charges",
    payments: [
      "DM-based selling (most common in Pakistan)",
      "JazzCash / EasyPaisa transfer",
      "Bank transfer",
      "COD via courier",
    ],
    fulfillment: [
      "Self-ship via TCS / Leopards / M&P",
      "PostEx / BlueEx for automated COD",
      "Local pickup",
    ],
    marketing: [
      "Reels (organic reach is highest here)",
      "Story polls + countdowns",
      "Influencer partnerships (Pakistani micro-influencers)",
      "Meta Ads via Ads Manager",
    ],
    setupTime: "Same day (Instagram Business + Facebook Page + Catalog)",
    bestFor: "Visual products (fashion, beauty, home decor), brand storytelling, niche communities",
    weakness: "No native checkout in Pakistan, manual order capture, scaling beyond DMs is hard",
    keyTerms: ["Reels", "Commerce Manager", "Catalog", "Insights"],
  },

  facebook: {
    name: "Facebook",
    slug: "facebook",
    aka: ["fb", "facebook marketplace", "facebook page"],
    setupCost: "Free",
    subscription: "Free",
    commission: "0% on Marketplace; Page sales are off-platform",
    transactionFees: "None from Facebook directly",
    payments: ["COD", "JazzCash / EasyPaisa", "Bank transfer"],
    fulfillment: ["Local meetup (Marketplace)", "Self-ship via courier"],
    marketing: [
      "Meta Ads Manager (granular targeting)",
      "Facebook Groups (community-led selling)",
      "Live selling sessions",
    ],
    setupTime: "Same day",
    bestFor: "Local listings, larger items, community-driven niches, older demographic",
    weakness: "Marketplace = local only, organic page reach is dead without ads",
    keyTerms: ["Marketplace", "Page Shop", "Live", "Boost Post"],
  },

  tiktok: {
    name: "TikTok Shop",
    slug: "tiktok",
    aka: ["tiktok shop", "tiktok seller"],
    setupCost: "Free",
    subscription: "Free",
    commission: "1–8% per sale (lower than Daraz, currently subsidized to grow seller base)",
    transactionFees: "TikTok handles checkout in supported regions",
    payments: ["COD", "Card via TikTok checkout (where enabled)"],
    fulfillment: ["TikTok Fulfilled (TFP) where available", "Self-ship"],
    marketing: [
      "Live commerce (the biggest organic lever)",
      "Short videos with shoppable tags",
      "TikTok Ads (Spark Ads, Top View)",
      "Affiliate creators",
    ],
    setupTime: "1–3 days (account verification slow)",
    bestFor: "Trendy/impulse products, Gen-Z buyers, video-friendly items",
    weakness: "Newer in Pakistan — fewer buyers than Daraz, video creation effort",
    keyTerms: ["Live", "Shoppable video", "TikTok Seller Center", "Affiliates"],
  },

  whatsapp: {
    name: "WhatsApp Business",
    slug: "whatsapp",
    aka: ["whatsapp", "whatsapp business", "wa"],
    setupCost: "Free",
    subscription: "Free (WhatsApp Business app); paid for WhatsApp Business API",
    commission: "0%",
    transactionFees: "None from WhatsApp",
    payments: ["JazzCash / EasyPaisa", "Bank transfer", "COD via courier"],
    fulfillment: ["Local pickup", "Self-ship via courier"],
    marketing: [
      "Click-to-WhatsApp ads from Meta",
      "Status updates",
      "Broadcast lists",
      "Catalog with shareable product links",
    ],
    setupTime: "Same day",
    bestFor: "Order capture from social ads, repeat customers, B2B / wholesale, low-tech sellers",
    weakness: "Doesn't scale past a few hundred orders/month manually, no analytics, no checkout",
    keyTerms: ["Catalog", "Quick Reply", "Click-to-WhatsApp", "Broadcast"],
  },

  olx: {
    name: "OLX Pakistan",
    slug: "olx",
    aka: ["olx", "olx.com.pk"],
    setupCost: "Free",
    subscription: "Free (paid promo packages available)",
    commission: "0% on listings",
    transactionFees: "None on OLX itself",
    payments: ["COD / cash on pickup", "Bank transfer", "JazzCash"],
    fulfillment: ["Local pickup", "Self-ship"],
    marketing: ["Featured listings (paid)", "Top Ad placement", "Story-style boost"],
    setupTime: "Same day",
    bestFor: "Used / refurbished products, larger items, local buyers",
    weakness: "Used-goods reputation, low buyer trust for new brands",
    keyTerms: ["Featured Ad", "Top Ad", "Buyer chat"],
  },
};

// Resolve a user-typed string ("Daraz", "DARAZ", "ig shop") to a known
// platform key. Returns null if we don't recognize it.
export function resolvePlatform(input) {
  if (!input || typeof input !== "string") return null;
  const t = input.trim().toLowerCase();
  if (!t) return null;

  // Direct slug match
  if (PLATFORMS[t]) return t;

  // Match by name or aka
  for (const [key, p] of Object.entries(PLATFORMS)) {
    if (p.name.toLowerCase() === t) return key;
    if ((p.aka || []).some((a) => a.toLowerCase() === t)) return key;
    // Substring fallback so "Shopify Pakistan" still matches "shopify"
    if (t.includes(key) || key.includes(t)) return key;
  }
  return null;
}

// Compact summary used inside system prompts. Token-efficient.
export function platformSummary(key) {
  const p = PLATFORMS[key];
  if (!p) return "";
  return [
    `Platform: ${p.name}`,
    `Setup cost: ${p.setupCost}`,
    `Subscription: ${p.subscription}`,
    `Commission: ${p.commission}`,
    `Transaction fees: ${p.transactionFees}`,
    `Payments accepted: ${p.payments.join(", ")}`,
    `Fulfillment: ${p.fulfillment.join("; ")}`,
    `Marketing levers: ${p.marketing.join("; ")}`,
    `Setup time: ${p.setupTime}`,
    `Best for: ${p.bestFor}`,
    `Watch out for: ${p.weakness}`,
    `Use these terms: ${p.keyTerms.join(", ")}`,
  ].join("\n");
}

// List of every platform that is NOT the chosen one.
// Used to tell the AI: "do not mention these."
export function competingPlatformNames(chosenKey) {
  return Object.entries(PLATFORMS)
    .filter(([k]) => k !== chosenKey)
    .map(([, p]) => p.name);
}
