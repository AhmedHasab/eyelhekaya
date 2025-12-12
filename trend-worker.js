// ==================================
// trend-worker.js – النسخة النهائية المتوافقة مع Cloudflare Proxy
// ==================================

const YT_API_KEY = "AIzaSyCYVZKHbhpFTba-eKWR23oR0JzNVf10eNc";
const YT_BASE_URL = "https://www.googleapis.com/youtube/v3";
const PROXY_URL = "https://odd-credit-25c6.namozg50.workers.dev/api/trends";

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

// الدول العربية (80%)
const ARAB_COUNTRIES = [
  { code: "EG", name: "مصر" },
  { code: "SA", name: "السعودية" },
  { code: "YE", name: "اليمن" },
  { code: "IQ", name: "العراق" },
  { code: "LY", name: "ليبيا" },
  { code: "LB", name: "لبنان" },
  { code: "SY", name: "سوريا" },
  { code: "MA", name: "المغرب" }
];

// دول عالمية (20%)
const GLOBAL_COUNTRIES = [
  { code: "US", name: "أمريكا" },
  { code: "CO", name: "كولومبيا" },
  { code: "KR", name: "كوريا الجنوبية" },
  { code: "BR", name: "البرازيل" },
  { code: "AU", name: "أستراليا" }
];

const STORY_TYPES = {
  CRIME: "جريمة / قضية جنائية",
  DEATH: "وفاة شخصية معروفة",
  WAR: "حرب / معركة / حدث عسكري",
  SPY: "قصة جاسوسية"
};

// إرسال رسالة للـ app.js
function postMessageSafe(type, payload) {
  self.postMessage({ type, payload });
}

// ============================================
// 1) API Proxy — استخدام Cloudflare Worker بديل كامل للتريند
// ============================================
async function fetchTrendProxy(query, country = "EG") {
  try {
    const url = `${PROXY_URL}?query=${encodeURIComponent(query)}&country=${country}`;
    const res = await fetch(url);
    return await res.json();
  } catch (err) {
    console.warn("Proxy error:", err);
    return { score: 20, googleScore: 10, ddgScore: 10 };
  }
}

// ============================================
// 2) YouTube API
// ============================================
async function fetchJSON(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" }
  });
  return await res.json();
}

async function searchYouTube(query, regionCode, maxResults = 5) {
  const publishedAfter = new Date(Date.now() - ONE_YEAR_MS).toISOString();

  const url = new URL(`${YT_BASE_URL}/search`);
  url.searchParams.set("key", YT_API_KEY);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("maxResults", maxResults);
  url.searchParams.set("order", "viewCount");
  url.searchParams.set("type", "video");
  url.searchParams.set("q", query);
  url.searchParams.set("regionCode", regionCode);
  url.searchParams.set("publishedAfter", publishedAfter);

  const data = await fetchJSON(url.toString());
  const items = data.items || [];

  const videoIds = items.map(i => i.id.videoId).filter(Boolean);

  // احصائيات الفيديوهات
  let statsById = {};
  if (videoIds.length > 0) {
    const statsUrl = new URL(`${YT_BASE_URL}/videos`);
    statsUrl.searchParams.set("key", YT_API_KEY);
    statsUrl.searchParams.set("part", "statistics");
    statsUrl.searchParams.set("id", videoIds.join(","));

    const statsData = await fetchJSON(statsUrl.toString());
    (statsData.items || []).forEach(v => {
      statsById[v.id] = Number(v.statistics?.viewCount || 0);
    });
  }

  return items.map(item => {
    const vid = item.id.videoId;
    return {
      videoId: vid,
      title: item.snippet.title,
      description: item.snippet.description,
      channelTitle: item.snippet.channelTitle,
      publishedAt: item.snippet.publishedAt,
      viewCount: statsById[vid] || 0,
      url: `https://www.youtube.com/watch?v=${vid}`
    };
  });
}

// ============================================
// 3) دالة حساب التريند لقصة واحدة (للزر العشوائي)
// ============================================
async function computeStoryTrendForName(name) {
  const country = "EG";

  const trend = await fetchTrendProxy(name, country);
  const ytItems = await searchYouTube(name, country, 5);

  const totalViews = ytItems.reduce((sum, v) => sum + v.viewCount, 0);
  const ytScore = totalViews
    ? Math.min(100, Math.round(Math.log10(totalViews + 10) * 20))
    : 0;

  const finalTrendScore = Math.round(0.6 * trend.score + 0.4 * ytScore);

  return {
    trendScore: finalTrendScore,
    searchScore: trend.score,
    ytScore,
    totalViews
  };
}

// ============================================
// 4) Queries التريند
// ============================================
const TREND_QUERIES_LONG = [
  { type: STORY_TYPES.CRIME, query: "جريمة غامضة تم كشفها تقرير وثائقي" },
  { type: STORY_TYPES.CRIME, query: "قضية قتل شهيرة تحقيق صحفي" },
  { type: STORY_TYPES.DEATH, query: "وفاة لاعب كرة شهير ملابسات" },
  { type: STORY_TYPES.DEATH, query: "وفاة فنان عربي ظروف غامضة" },
  { type: STORY_TYPES.WAR, query: "وثائقي عن حرب عربية معركة كبرى" },
  { type: STORY_TYPES.WAR, query: "تاريخ معركة حاسمة وثائقي" },
  { type: STORY_TYPES.SPY, query: "قصة جاسوس تم كشفه" },
  { type: STORY_TYPES.SPY, query: "عملية مخابرات سرية تم كشفها" }
];

const TREND_QUERIES_SHORT = [
  { type: STORY_TYPES.CRIME, query: "قصة جريمة غريبة جدا في دقيقة" },
  { type: STORY_TYPES.DEATH, query: "قصة وفاة غريبة لشخصية مشهورة" },
  { type: STORY_TYPES.WAR, query: "قصة معركة في دقيقة" },
  { type: STORY_TYPES.SPY, query: "أغرب قصة جاسوس في التاريخ" }
];

// ============================================
// 5) بناء نتائج التريند (20 عربي + 5 عالمي)
// ============================================
async function buildTrendItems(queries, isShort) {
  const results = [];

  // 🟢 الدول العربية (20 نتيجة كاملة)
  for (const country of ARAB_COUNTRIES) {
    for (const q of queries) {
      try {
        const yt = await searchYouTube(q.query, country.code, 5);
        const best = yt.length ? yt.reduce((a, b) => (a.viewCount > b.viewCount ? a : b)) : null;

        const trend = await fetchTrendProxy(q.query, country.code);
        const ytScore = best
          ? Math.min(100, Math.round(Math.log10(best.viewCount + 10) * 20))
          : 0;

        const score = Math.round(0.6 * trend.score + 0.4 * ytScore);

        results.push({
          title: best?.title || q.query,
          url: best?.url || null,
          country: country.name,
          category: q.type,
          searchScore: trend.score,
          ytScore,
          score,
          reason: isShort ? "مناسب لريلز قصيرة" : "مناسب لفيديو طويل"
        });
      } catch (err) {}
    }
  }

  // 🔵 أعلى 5 عالميًا
  for (const country of GLOBAL_COUNTRIES.slice(0, 5)) {
    for (const q of queries) {
      try {
        const yt = await searchYouTube(q.query, country.code, 5);
        const best = yt.length ? yt.reduce((a, b) => (a.viewCount > b.viewCount ? a : b)) : null;

        const trend = await fetchTrendProxy(q.query, country.code);
        const ytScore = best
          ? Math.min(100, Math.round(Math.log10(best.viewCount + 10) * 20))
          : 0;

        const score = Math.round(0.6 * trend.score + 0.4 * ytScore);

        results.push({
          title: best?.title || q.query,
          url: best?.url || null,
          country: country.name,
          category: q.type,
          searchScore: trend.score,
          ytScore,
          score,
          reason: "تريند عالمي قوي"
        });
      } catch (err) {}
    }
  }

  results.sort((a, b) => b.score - a.score);

  return results.slice(0, isShort ? 20 : 20); // 20 نتيجة
}

// ============================================
// 6) الزر العشوائي
// ============================================
async function pickRandomStoriesWithTrend(stories) {
  const list = stories.filter(s => !s.done);
  const results = [];

  for (const story of list) {
    try {
      const trend = await computeStoryTrendForName(story.name);
      const personal = story.score ?? 50;

      const finalScore = Math.round(0.4 * personal + 0.6 * trend.trendScore);

      results.push({
        ...story,
        trendScore: trend.trendScore,
        finalScore
      });
    } catch (err) {}
  }

  results.sort((a, b) => b.finalScore - a.finalScore);

  return {
    items: results.slice(0, 10),
    meta: {
      formula: "40% Personal + 60% Trend"
    }
  };
}

// ============================================
// استقبال رسائل app.js
// ============================================
self.onmessage = async (event) => {
  const { type, payload } = event.data || {};

  if (type === "FETCH_TREND_LONG") {
    const items = await buildTrendItems(TREND_QUERIES_LONG, false);
    postMessageSafe("TREND_LONG_RESULT", { items });
  }

  if (type === "FETCH_TREND_SHORT") {
    const items = await buildTrendItems(TREND_QUERIES_SHORT, true);
    postMessageSafe("TREND_SHORT_RESULT", { items });
  }

  if (type === "FETCH_RANDOM_STORIES") {
    const result = await pickRandomStoriesWithTrend(payload.stories);
    postMessageSafe("RANDOM_STORIES_RESULT", result);
  }
};
