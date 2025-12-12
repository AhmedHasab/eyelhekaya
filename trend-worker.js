// ==================================
// trend-worker.js – نسخة معدّلة 100% بدون Bing API
// ==================================

const YT_API_KEY = "AIzaSyCYVZKHbhpFTba-eKWR23oR0JzNVf10eNc"; 
const YT_BASE_URL = "https://www.googleapis.com/youtube/v3";

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

// أنواع القصص
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

// =========================================
// 1) YouTube API – جلب فيديوهات التريند
// =========================================
async function fetchJSON(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" }
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return JSON.parse(text.replace(")]}',", ""));
  }
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

  const videoIds = items.map(i => i.id && i.id.videoId).filter(Boolean);
  let statsById = {};

  if (videoIds.length) {
    const statsUrl = new URL(`${YT_BASE_URL}/videos`);
    statsUrl.searchParams.set("key", YT_API_KEY);
    statsUrl.searchParams.set("part", "statistics");
    statsUrl.searchParams.set("id", videoIds.join(","));
    const statsData = await fetchJSON(statsUrl.toString());

    (statsData.items || []).forEach(v => {
      const id = v.id;
      const viewCount = v.statistics?.viewCount ? Number(v.statistics.viewCount) : 0;
      statsById[id] = { viewCount };
    });
  }

  return items.map(item => {
    const vid = item.id?.videoId;
    const snippet = item.snippet || {};
    const stats = statsById[vid] || { viewCount: 0 };

    return {
      videoId: vid,
      title: snippet.title || "",
      description: snippet.description || "",
      channelTitle: snippet.channelTitle || "",
      publishedAt: snippet.publishedAt || "",
      viewCount: stats.viewCount,
      url: vid ? `https://www.youtube.com/watch?v=${vid}` : null
    };
  });
}

// =========================================
// 2) Google Trends Scraper (مجاني بالكامل)
// =========================================
async function fetchGoogleTrendsScore(query, countryCode = "EG") {
  try {
    const exploreUrl =
      `https://trends.google.com/trends/api/explore?hl=ar&q=${encodeURIComponent(query)}&geo=${countryCode}&tz=-120`;

    const exploreRaw = await fetch(exploreUrl).then(r => r.text());
    const exploreJson = JSON.parse(exploreRaw.replace(")]}',", ""));

    const tokenData = exploreJson.widgets.find(w => w.token && w.request);
    if (!tokenData) return 20;

    const widgetUrl =
      `https://trends.google.com/trends/api/widgetdata/multiline?hl=ar&req=${encodeURIComponent(JSON.stringify(tokenData.request))}&token=${tokenData.token}`;

    const widgetRaw = await fetch(widgetUrl).then(r => r.text());
    const widgetJson = JSON.parse(widgetRaw.replace(")]}',", ""));

    const timeline = widgetJson.default.timelineData;
    if (!timeline?.length) return 20;

    const values = timeline.map(i => Number(i.value[0]) || 0);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const max = Math.max(...values);

    return Math.round((avg * 0.6) + (max * 0.4));

  } catch (e) {
    console.warn("Google Trends error:", e);
    return 20;
  }
}

// =========================================
// 3) DuckDuckGo Scraper – بديل الويب المجاني
// =========================================
async function fetchDuckDuckGoScore(query) {
  try {
    const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

    const html = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" }
    }).then(r => r.text());

    const matches = html.match(/result__snippet/g) || [];
    const count = matches.length;

    return Math.min(100, Math.round(Math.log10(count + 2) * 40));

  } catch (e) {
    console.warn("DuckDuckGo error:", e);
    return 10;
  }
}

// =========================================
// 4) بديل Bing API — دمج Google Trends + DuckDuckGo
// =========================================
async function searchWebTrend(query, countryCode = "EG") {
  const [googleScore, ddgScore] = await Promise.all([
    fetchGoogleTrendsScore(query, countryCode),
    fetchDuckDuckGoScore(query)
  ]);

  const finalScore = Math.round(0.6 * googleScore + 0.4 * ddgScore);

  return {
    googleScore,
    ddgScore,
    score: finalScore
  };
}

// =========================================
// 5) حساب التريند لقصة واحدة (للزر العشوائي)
// =========================================
async function computeStoryTrendForName(name) {
  const country = ARAB_COUNTRIES[0];

  const [webTrend, ytItems] = await Promise.all([
    searchWebTrend(name, country.code),
    searchYouTube(name, country.code, 5)
  ]);

  const totalViews = ytItems.reduce((sum, v) => sum + (v.viewCount || 0), 0);
  const ytScore = totalViews
    ? Math.min(100, Math.round(Math.log10(totalViews + 10) * 20))
    : 0;

  const trendScore = Math.round(0.6 * (webTrend.score || 0) + 0.4 * ytScore);

  return {
    searchScore: webTrend.score,
    ytScore,
    trendScore,
    totalViews
  };
}

// =========================================
// 6) Queries للتريند (طويل / قصير)
// =========================================
const TREND_QUERIES_LONG = [
  { type: STORY_TYPES.CRIME, query: "جريمة غامضة تم كشفها تقرير وثائقي" },
  { type: STORY_TYPES.CRIME, query: "قضية قتل شهيرة تحقيق صحفي" },
  { type: STORY_TYPES.DEATH, query: "وفاة لاعب كرة شهير ملابسات" },
  { type: STORY_TYPES.DEATH, query: "وفاة فنان عربي ظروف غامضة" },
  { type: STORY_TYPES.WAR, query: "وثائقي عن حرب عربية معركة كبرى" },
  { type: STORY_TYPES.WAR, query: "تاريخ معركة حاسمة وثائقي" },
  { type: STORY_TYPES.SPY, query: "قصة جاسوس حقيقية تم كشفها" },
  { type: STORY_TYPES.SPY, query: "قصة مخابرات عربية سرية" }
];

const TREND_QUERIES_SHORT = [
  { type: STORY_TYPES.CRIME, query: "قصة جريمة غريبة جدا في دقيقة" },
  { type: STORY_TYPES.DEATH, query: "قصة وفاة غريبة لشخصية مشهورة" },
  { type: STORY_TYPES.WAR, query: "قصة معركة في دقيقة" },
  { type: STORY_TYPES.SPY, query: "أغرب حيلة جاسوس في التاريخ" }
];

// اختيار الدول
function pickCountriesForTrend() {
  return {
    arab: ARAB_COUNTRIES,
    global: GLOBAL_COUNTRIES
  };
}

// =========================================
// 7) بناء نتائج التريند (5 نتائج فقط)
// =========================================
async function buildTrendItems(queries, isShort) {
  const { arab, global } = pickCountriesForTrend();
  const tasks = [];

  arab.forEach(country => {
    queries.forEach(q => {
      tasks.push({ country, storyType: q.type, query: q.query });
    });
  });

  global.forEach(country => {
    queries.forEach(q => {
      tasks.push({ country, storyType: q.type, query: q.query });
    });
  });

  const limited = tasks.slice(0, 30);
  const results = [];

  for (const t of limited) {
    try {
      const ytItems = await searchYouTube(t.query, t.country.code, 3);
      if (!ytItems.length) continue;

      const best = ytItems.reduce((a, b) => (a.viewCount > b.viewCount ? a : b));
      const web = await searchWebTrend(t.query, t.country.code);

      const searchScore = web.score || 0;

      const ytScore = best.viewCount
        ? Math.min(100, Math.round(Math.log10(best.viewCount + 10) * 20))
        : 0;

      const trendScore = Math.round(0.6 * searchScore + 0.4 * ytScore);

      results.push({
        title: best.title,
        url: best.url,
        country: t.country.name,
        category: t.storyType,
        source: "GoogleTrends + DuckDuckGo + YouTube",
        searchScore,
        ytScore,
        score: trendScore,
        reason: isShort
          ? "قصة مناسبة لريلز ويمكن تلخيصها بسهولة."
          : "قصة طويلة مليئة بالتفاصيل ويمكن إنتاج فيديو وثائقي عنها."
      });
    } catch (e) {
      console.warn("Trend error:", e);
    }
  }

  results.sort((a, b) => (b.score || 0) - (a.score || 0));
  return results.slice(0, 5);
}

// =========================================
// 8) الزر العشوائي – تقييم 40% شخصي + 60% تريند
// =========================================
async function pickRandomStoriesWithTrend(stories) {
  if (!stories?.length) return { items: [], meta: null };

  const candidates = stories.filter(s => !s.done);

  candidates.sort((a, b) => (b.score || 0) - (a.score || 0));
  const limited = candidates.slice(0, 40);

  const evaluated = [];

  for (const story of limited) {
    try {
      const trend = await computeStoryTrendForName(story.name);

      const personalScore = story.score ?? 50;

      const finalScore = Math.round(
        0.4 * personalScore + 0.6 * trend.trendScore
      );

      evaluated.push({
        ...story,
        personalScore,
        trendScore: trend.trendScore,
        finalScore
      });

    } catch (e) {
      console.warn("Random trend error:", e);
    }
  }

  evaluated.sort((a, b) => (b.finalScore || 0) - (a.finalScore || 0));

  return {
    items: evaluated.slice(0, 10),
    meta: {
      evaluated: evaluated.length,
      formula: "40% personal + 60% trend"
    }
  };
}

// =========================================
// 9) استقبال الرسائل من app.js
// =========================================
self.onmessage = async (event) => {
  const { type, payload } = event.data || {};

  try {
    if (type === "FETCH_TREND_LONG") {
      const items = await buildTrendItems(TREND_QUERIES_LONG, false);
      postMessageSafe("TREND_LONG_RESULT", { items });

    } else if (type === "FETCH_TREND_SHORT") {
      const items = await buildTrendItems(TREND_QUERIES_SHORT, true);
      postMessageSafe("TREND_SHORT_RESULT", { items });

    } else if (type === "FETCH_RANDOM_STORIES") {
      const stories = payload?.stories || [];
      const result = await pickRandomStoriesWithTrend(stories);
      postMessageSafe("RANDOM_STORIES_RESULT", result);

    } else if (type === "UPDATE_TRENDS_SNAPSHOT") {
      postMessageSafe("TREND_LONG_RESULT", { items: [] });
    }

  } catch (err) {
    postMessageSafe("ERROR", { message: err.message });
  }
};
