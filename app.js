// Cloudflare Worker – Hasaballa Story Trends Engine
// يعمل كـ API واحد لكل الطلبات من app.js

const DEFAULT_YT_API_KEY = "AIzaSyCYVZKHbhpFTba-eKWR23oR0JzNVf10eNc";

// أسواق Bing لمجموعة الدول
const ARAB_MARKETS = [
  { code: "ar-EG", country: "مصر" },
  { code: "ar-SA", country: "السعودية" },
  { code: "ar-YE", country: "اليمن" },
  { code: "ar-IQ", country: "العراق" },
  { code: "ar-LY", country: "ليبيا" },
  { code: "ar-LB", country: "لبنان" },
  { code: "ar-SY", country: "سوريا" },
  { code: "ar-MA", country: "المغرب" },
];

const WORLD_MARKETS = [
  { code: "en-US", country: "الولايات المتحدة" },
  { code: "es-CO", country: "كولومبيا" },
  { code: "ko-KR", country: "كوريا الجنوبية" },
  { code: "pt-BR", country: "البرازيل" },
  { code: "en-AU", country: "أستراليا" },
];

// كلمات مفتاحية لتحديد نوع القصة
const CRIME_KEYWORDS = [
  "جريمة",
  "قتل",
  "مقتل",
  "اغتيال",
  "مذبحة",
  "سفاح",
  "جنايات",
  "murder",
  "killed",
  "assassination",
  "crime",
];

const DEATH_KEYWORDS = [
  "وفاة",
  "رحيل",
  "رحل",
  "مات",
  "توفي",
  "died",
  "death",
  "passed away",
];

const WAR_KEYWORDS = [
  "حرب",
  "معركة",
  "غزو",
  "اجتياح",
  "هجوم",
  "صراع",
  "انتفاضة",
  "اشتباكات",
  "war",
  "battle",
  "conflict",
  "invasion",
];

const SPY_KEYWORDS = [
  "جاسوس",
  "جاسوسة",
  "تجسس",
  "مخابرات",
  "عميل",
  "عملية سرية",
  "spy",
  "espionage",
  "intelligence",
];

// =====================
// Utils
// =====================

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function normalizeText(str) {
  if (!str) return "";
  let s = str.toString().toLowerCase();
  s = s.replace(/[أإآا]/g, "ا");
  s = s.replace(/[ىي]/g, "ي");
  s = s.replace(/ة/g, "ه");
  s = s.replace(/[\u064B-\u0652]/g, "");
  s = s.replace(/[^\p{L}\p{N}\s]/gu, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function classifyStoryFromText(text) {
  const t = normalizeText(text);

  const hasCrime = CRIME_KEYWORDS.some((w) => t.includes(normalizeText(w)));
  const hasDeath = DEATH_KEYWORDS.some((w) => t.includes(normalizeText(w)));
  const hasWar = WAR_KEYWORDS.some((w) => t.includes(normalizeText(w)));
  const hasSpy = SPY_KEYWORDS.some((w) => t.includes(normalizeText(w)));

  if (hasSpy) return { type: "spy", label: "قصة مخابرات / جاسوسية" };
  if (hasCrime) return { type: "crime", label: "جريمة موثقة" };
  if (hasWar) return { type: "war", label: "حرب / معركة / حدث عسكري" };
  if (hasDeath) return { type: "death", label: "وفاة شخصية عامة" };

  return { type: "other", label: "غير مصنف" };
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Cache key helper للـ Worker Cache
function makeCacheKey(request, extraKey) {
  const url = new URL(request.url);
  url.search = "";
  url.hash = "";
  if (extraKey) {
    url.pathname = url.pathname + "::" + extraKey;
  }
  return new Request(url.toString(), { method: "GET" });
}

// =====================
// Bing News Search Helper
// =====================

async function fetchBingNews(env, query, market, days = 365) {
  const apiKey = env.BING_API_KEY;
  if (!apiKey) {
    // لو مفيش مفتاح، نرجع نتيجة فاضية بس عشان الكود ما يقعش
    return { value: [], totalEstimatedMatches: 0 };
  }

  const endpoint = "https://api.bing.microsoft.com/v7.0/news/search";

  const params = new URLSearchParams({
    q: query,
    count: "25",
    mkt: market,
    freshness: days >= 365 ? "Year" : "Month",
    textFormat: "Raw",
    safeSearch: "Off",
  });

  const url = `${endpoint}?${params.toString()}`;
  const res = await fetch(url, {
    headers: {
      "Ocp-Apim-Subscription-Key": apiKey,
    },
  });

  if (!res.ok) {
    return { value: [], totalEstimatedMatches: 0 };
  }

  const data = await res.json();
  return data;
}

// =====================
// YouTube Search Helper
// =====================

async function fetchYoutube(env, query, days = 365, maxResults = 15) {
  const apiKey = env.YT_API_KEY || DEFAULT_YT_API_KEY;
  const now = new Date();
  const past = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const publishedAfter = past.toISOString();

  const endpoint = "https://www.googleapis.com/youtube/v3/search";
  const params = new URLSearchParams({
    key: apiKey,
    part: "snippet",
    q: query,
    maxResults: String(maxResults),
    type: "video",
    order: "viewCount",
    publishedAfter,
  });

  const url = `${endpoint}?${params.toString()}`;
  const res = await fetch(url);

  if (!res.ok) {
    return { items: [] };
  }

  const data = await res.json();
  return data;
}

// =====================
// Trend Builders
// =====================

async function buildTrendResults(env, caches, { shortForm = false }) {
  // shortForm = false → فيديوهات طويلة
  // shortForm = true → ريلز / Shorts

  const cache = caches.default;
  const cacheKey = makeCacheKey(
    new Request("https://example.com/trend"),
    shortForm ? "short" : "long"
  );
  const cached = await cache.match(cacheKey);
  if (cached) {
    const data = await cached.json();
    return data;
  }

  // توزيع 80% عرب + 20% عالم
  const markets = [
    ...ARAB_MARKETS.map((m) => ({ ...m, weight: 0.8 / ARAB_MARKETS.length })),
    ...WORLD_MARKETS.map((m) => ({
      ...m,
      weight: 0.2 / WORLD_MARKETS.length,
    })),
  ];

  // كلمات بحث عامة للأربع أنواع
  const baseQuery = [
    "جريمة",
    "اغتيال",
    "وفاة",
    "حرب",
    "معركة",
    "جاسوس",
    "murder",
    "war",
    "spy",
  ].join(" OR ");

  const allNewsItems = [];

  for (const m of markets) {
    const data = await fetchBingNews(env, baseQuery, m.code, 365);
    if (Array.isArray(data.value)) {
      data.value.forEach((v) => {
        allNewsItems.push({
          ...v,
          _market: m,
        });
      });
    }
  }

  // فلترة حسب نوع القصة
  const filtered = allNewsItems
    .map((item) => {
      const text = `${item.name || ""} ${item.description || ""}`;
      const cls = classifyStoryFromText(text);
      return {
        ...item,
        _cls: cls,
      };
    })
    .filter((item) => ["crime", "death", "war", "spy"].includes(item._cls.type));

  // مزج مع YouTube – نستخدم عنوان الخبر كـ Query
  const topForYT = filtered.slice(0, 30); // لتقليل عدد الطلبات

  const ytScores = new Map(); // key=normalized title, value=hits count

  for (const item of topForYT) {
    const q = item.name || "";
    const ytData = await fetchYoutube(env, q, 365, shortForm ? 10 : 15);
    const hits = Array.isArray(ytData.items) ? ytData.items.length : 0;
    const key = normalizeText(q);
    ytScores.set(key, (ytScores.get(key) || 0) + hits);
  }

  // حساب Score بسيط: 60% من سوق الأخبار (التكرار) + 40% من YouTube
  const countByTitle = new Map();
  filtered.forEach((item) => {
    const key = normalizeText(item.name || "");
    countByTitle.set(key, (countByTitle.get(key) || 0) + 1);
  });

  const entries = [];
  for (const item of filtered) {
    const key = normalizeText(item.name || "");
    const newsCount = countByTitle.get(key) || 0;
    const ytCount = ytScores.get(key) || 0;
    entries.push({
      title: item.name,
      summary: item.description || "",
      country: item._market.country,
      source: "محركات البحث + أخبار",
      categoryLabel: item._cls.label,
      clsType: item._cls.type,
      url: item.url,
      newsCount,
      ytCount,
    });
  }

  if (entries.length === 0) {
    const fallback = { results: [] };
    // خزّن حتى لو فاضي عشان ما نكرر الطلبات
    await cache.put(cacheKey, new Response(JSON.stringify(fallback), { headers: { "Content-Type": "application/json" } }));
    return fallback;
  }

  const maxNews = Math.max(...entries.map((e) => e.newsCount));
  const maxYt = Math.max(...entries.map((e) => e.ytCount));

  const scored = entries.map((e) => {
    const newsScore = maxNews > 0 ? e.newsCount / maxNews : 0;
    const ytScore = maxYt > 0 ? e.ytCount / maxYt : 0;
    const finalScore = Math.round((newsScore * 0.6 + ytScore * 0.4) * 100);
    return {
      ...e,
      trendScore: finalScore,
    };
  });

  // لو فيديوهات قصيرة نفضّل الأخبار الأحدث (30 يوم مثلًا)
  let sorted = scored;
  if (shortForm) {
    sorted = scored.sort((a, b) => b.trendScore - a.trendScore);
  } else {
    sorted = scored.sort((a, b) => b.trendScore - a.trendScore);
  }

  const results = sorted.slice(0, 5);
  const payload = { results };

  await cache.put(
    cacheKey,
    new Response(JSON.stringify(payload), {
      headers: { "Content-Type": "application/json" },
    })
  );

  return payload;
}

// =====================
// Random Stories Scoring
// =====================

async function scoreStories(env, caches, storiesInput, maxResults) {
  const cache = caches.default;

  if (!Array.isArray(storiesInput)) {
    return { rankedStories: [] };
  }

  // استبعد التي تم تنفيذها إن لم تكن مصفّاة بالفعل
  const candidates = storiesInput.filter((s) => !s.done);

  // لأسباب عملية، لا نزيد عن 50 قصة في المرّة
  const limited = candidates.slice(0, 50);

  const scores = [];

  for (const story of limited) {
    const name = story.name || "";
    const normName = normalizeText(name);
    if (!normName) continue;

    const cacheKey = makeCacheKey(
      new Request("https://example.com/story"),
      "storytrend:" + normName + ":" + todayISO()
    );
    const cached = await cache.match(cacheKey);
    let trendData;

    if (cached) {
      trendData = await cached.json();
    } else {
      // Bing + YouTube بعدد نتائج بسيط
      const bingData = await fetchBingNews(env, `"${name}"`, "ar-EG", 365);
      const newsMatches =
        typeof bingData.totalEstimatedMatches === "number"
          ? bingData.totalEstimatedMatches
          : (Array.isArray(bingData.value) ? bingData.value.length : 0);

      const ytData = await fetchYoutube(env, name, 365, 10);
      const ytHits = Array.isArray(ytData.items) ? ytData.items.length : 0;

      trendData = {
        newsMatches,
        ytHits,
      };

      await cache.put(
        cacheKey,
        new Response(JSON.stringify(trendData), {
          headers: { "Content-Type": "application/json" },
        })
      );
    }

    scores.push({
      id: story.id,
      name: story.name,
      personalScore:
        typeof story.score === "number" ? story.score : 0,
      newsMatches: trendData.newsMatches || 0,
      ytHits: trendData.ytHits || 0,
      category: story.category || "",
      notes: story.notes || "",
    });
  }

  if (scores.length === 0) {
    return { rankedStories: [] };
  }

  const maxNews = Math.max(...scores.map((s) => s.newsMatches));
  const maxYt = Math.max(...scores.map((s) => s.ytHits));

  const enriched = scores.map((s) => {
    const newsScore = maxNews > 0 ? s.newsMatches / maxNews : 0;
    const ytScore = maxYt > 0 ? s.ytHits / maxYt : 0;
    const trendScore = Math.round((newsScore * 0.6 + ytScore * 0.4) * 100);

    const finalScore = Math.round(
      (s.personalScore || 0) * 0.4 + trendScore * 0.6
    );

    return {
      ...s,
      trendScore,
      finalScore,
    };
  });

  const rankedStories = enriched
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, maxResults || 10);

  return { rankedStories };
}

// =====================
// update_trends (مجرد تحديث timestamps)
// =====================

async function updateTrends(env, caches) {
  const today = todayISO();
  return {
    trendsUpdatedAt: today,
    youtubeUpdatedAt: today,
    deathsUpdatedAt: today, // ممكن لاحقًا تضيف لوجيك خاص بالوفيات
  };
}

// =====================
// Worker fetch
// =====================

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    if (request.method !== "POST") {
      return jsonResponse(
        { error: "Only POST is allowed for this endpoint." },
        405
      );
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse(
        { error: "Invalid JSON. Expected {action, payload}." },
        400
      );
    }

    const action = body.action;
    const payload = body.payload || {};
    const cachesObj = caches;

    try {
      if (action === "pick_long_trend") {
        const data = await buildTrendResults(env, cachesObj, {
          shortForm: false,
        });
        return jsonResponse(data);
      }

      if (action === "pick_short_trend") {
        const data = await buildTrendResults(env, cachesObj, {
          shortForm: true,
        });
        return jsonResponse(data);
      }

      if (action === "score_stories") {
        const { stories, maxResults } = payload;
        const data = await scoreStories(env, cachesObj, stories, maxResults);
        return jsonResponse(data);
      }

      if (action === "update_trends") {
        const data = await updateTrends(env, cachesObj);
        return jsonResponse(data);
      }

      return jsonResponse({ error: "Unknown action" }, 400);
    } catch (err) {
      console.error("Worker error:", err);
      return jsonResponse(
        { error: "Internal error in worker", details: String(err) },
        500
      );
    }
  },
};
