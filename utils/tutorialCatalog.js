// ════════════════════════════════════════════════════════════
// Curated tutorial catalog — canonical slugs the frontend can
// link to directly (e.g. /tutorials/daraz-seo-basics) without
// the AI inventing different titles each time.
//
// Each entry has slug, topic (display name), category, and a
// short description for the catalog grid.
// ════════════════════════════════════════════════════════════

export const TUTORIAL_CATEGORIES = [
  { id: "marketing",  label: "Marketing & Growth",  color: "rose" },
  { id: "platform",   label: "Platform Mastery",     color: "teal" },
  { id: "operations", label: "Operations",           color: "purple" },
  { id: "logistics",  label: "Logistics & Payments", color: "amber" },
  { id: "sales",      label: "Sales & Pricing",      color: "emerald" },
  { id: "branding",   label: "Branding",             color: "sky" },
  { id: "legal",      label: "Legal & Setup",        color: "slate" },
];

export const TUTORIAL_CATALOG = [
  // Marketing & Growth
  { slug: "facebook-ads-basics-pk", topic: "Facebook Ads for Beginners", category: "marketing",
    desc: "Set up your first ad campaign for a Pakistani store, from pixel to budget." },
  { slug: "instagram-reels-strategy", topic: "Instagram Reels Strategy", category: "marketing",
    desc: "What to post, when to post, and how to grow without paid ads." },
  { slug: "tiktok-organic-growth-pk", topic: "TikTok Organic Growth", category: "marketing",
    desc: "Get noticed on TikTok Pakistan without spending a single rupee." },
  { slug: "influencer-marketing-pk", topic: "Influencer Marketing in Pakistan", category: "marketing",
    desc: "Find micro-influencers, negotiate, and measure ROI." },
  { slug: "whatsapp-marketing", topic: "WhatsApp Marketing Automation", category: "marketing",
    desc: "Broadcasts, catalogs, click-to-WhatsApp ads — used right." },

  // Platform Mastery
  { slug: "daraz-seo-basics", topic: "Daraz SEO Basics", category: "platform",
    desc: "Win the search box on Daraz: titles, keywords, images." },
  { slug: "daraz-sponsored-products", topic: "Daraz Sponsored Products", category: "platform",
    desc: "Pay-per-click inside Daraz — bid strategy that doesn't burn cash." },
  { slug: "shopify-store-setup-pk", topic: "Shopify Store Setup for Pakistan", category: "platform",
    desc: "From sign-up to first sale — Pakistan-specific gateways and apps." },
  { slug: "instagram-shop-catalog", topic: "Instagram Shop & Catalog", category: "platform",
    desc: "Connect a Facebook catalog and tag products in Reels." },
  { slug: "tiktok-shop-seller-setup", topic: "TikTok Shop Seller Setup", category: "platform",
    desc: "Get verified, list products, and run your first Live." },

  // Operations
  { slug: "product-photography-budget", topic: "Product Photography on a Budget", category: "operations",
    desc: "Phone + window light + white sheet = pro-grade shots." },
  { slug: "product-titles-that-convert", topic: "Product Titles That Convert", category: "operations",
    desc: "The keyword-density formula buyers actually click." },
  { slug: "customer-service-whatsapp", topic: "Customer Service via WhatsApp", category: "operations",
    desc: "Templates, SLAs, and how to scale beyond 50 orders/day." },
  { slug: "handling-returns-refunds", topic: "Handling Returns & Refunds", category: "operations",
    desc: "Return policy that protects you while keeping buyers happy." },
  { slug: "order-management-workflow", topic: "Order Management Workflows", category: "operations",
    desc: "From new order to delivered: a checklist you can hand to a VA." },
  { slug: "inventory-tracking-basics", topic: "Inventory Tracking Basics", category: "operations",
    desc: "Free spreadsheet to stop overselling and dead stock." },

  // Logistics & Payments
  { slug: "cod-success-pakistan", topic: "Winning at COD in Pakistan", category: "logistics",
    desc: "Reduce returns and protect cash flow with smart COD policies." },
  { slug: "courier-comparison-pk", topic: "PostEx vs TCS vs Leopards vs M&P", category: "logistics",
    desc: "Real prices, COD remittance speeds, and which to pick when." },
  { slug: "easypaisa-jazzcash-setup", topic: "EasyPaisa & JazzCash Merchant Setup", category: "logistics",
    desc: "Documents, fees, and integrating with your store." },
  { slug: "reduce-return-rates", topic: "Reducing Return Rates", category: "logistics",
    desc: "The 5 biggest causes of Pakistani returns and how to fix each." },
  { slug: "courier-issue-handling", topic: "Handling Courier Issues", category: "logistics",
    desc: "Lost parcels, fake delivery scans, COD shortfalls — what to do." },

  // Sales & Pricing
  { slug: "pricing-psychology-pk", topic: "Pricing Psychology", category: "sales",
    desc: "Why PKR 1,499 sells better than PKR 1,500 (and other tricks)." },
  { slug: "discount-promo-strategy", topic: "Discount & Promo Strategy", category: "sales",
    desc: "When to discount, how deep, and how to avoid training bargain-hunters." },
  { slug: "bundle-pricing", topic: "Bundle Pricing", category: "sales",
    desc: "Sell more per order without lowering perceived value." },
  { slug: "free-shipping-math", topic: "Free Shipping Math", category: "sales",
    desc: "Should you offer it? Calculate the threshold that protects margins." },
  { slug: "cross-sell-upsell", topic: "Cross-sell & Upsell", category: "sales",
    desc: "Add 20-30% to your average order value with placement and offers." },

  // Branding
  { slug: "build-brand-instagram-pk", topic: "Build a Brand on Instagram", category: "branding",
    desc: "From day-one look-and-feel to a recognizable Pakistani brand." },
  { slug: "logo-design-budget", topic: "Logo Design on a Budget", category: "branding",
    desc: "Free tools, hire-a-designer rates, and what makes a great logo." },
  { slug: "packaging-design-wow", topic: "Packaging That Wows", category: "branding",
    desc: "Unboxing moments that earn Reels and reviews — without big spend." },
  { slug: "reviews-reputation", topic: "Reviews & Reputation", category: "branding",
    desc: "Get reviews ethically and fix bad ones without losing buyers." },

  // Legal & Setup
  { slug: "business-registration-pk", topic: "Business Registration in Pakistan", category: "legal",
    desc: "Sole proprietorship vs company, FBR, and when to register." },
  { slug: "ntn-tax-basics-sellers", topic: "NTN & Tax Basics for Sellers", category: "legal",
    desc: "Filing requirements, sales tax, and what marketplaces deduct." },
];

// Slug → catalog entry lookup
export const CATALOG_BY_SLUG = Object.fromEntries(
  TUTORIAL_CATALOG.map((t) => [t.slug, t])
);

// Helper to slugify any free-text topic safely.
export function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}
