/* ============================================================
   📦 1) الإعدادات العامة – API و الكونستانت
============================================================ */

// 🔧 Normalize Arabic text for matching (removes Hamza, diacritics, etc.)
function normalizeArabic(str) {
  if (!str) return "";

  return str
    .replace(/[أإآا]/g, "ا")     // كل أنواع الألف = "ا"
    .replace(/ى/g, "ي")          // ى → ي
    .replace(/ئ/g, "ي")          // ئ → ي
    .replace(/ؤ/g, "و")          // ؤ → و
    .replace(/ة/g, "ه")          // ة → ه
    .replace(/[^\u0600-\u06FF ]/g, "") // إزالة الرموز غير العربية
    .normalize("NFD")            // إزالة التشكيل
    .replace(/[\u064B-\u065F]/g, "")   // حركات التشكيل
    .trim();
}

// 🔧 تقدير عمر القصة (بالأيام)
function estimateStoryAgeDays(story) {
  if (!story || !story.date) return 365; // نفترض سنة لو مفيش تاريخ

  const storyDate = new Date(story.date);
  if (isNaN(storyDate.getTime())) return 365;

  const now = new Date();
  const diffMs = now - storyDate;
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return Math.max(0, diffDays);
}

// 🔧 تقييم تشبّع الموضوع (كل ما كان أقدم = تشبّع أعلى)
function estimateSaturation(name) {
  // مبدئيًا نخليها وسط لو مفيش معلومات أخرى
  return "متوسط";
}

// 🔧 تقدير شكل الفيديو الأفضل
function guessBestFormatFromName(name) {
  const n = name || "";
  const nNorm = normalizeArabic(n);

  if (/(حرب|معركه|معركة|ثوره|ثورة|سيره|سيرة ذاتيه|حياه)/.test(nNorm)) {
    return "فيديو طويل (وثائقي/سردي)";
  }

  if (/(حادثه|جريمه|جريمة|اختفاء|لغز|سر)/.test(nNorm)) {
    return "قصة مشوقة متوسطة الطول (8–15 دقيقة)";
  }

  if (/(موقف طريف|لقطه|مقطع قصير|ريلز)/.test(nNorm)) {
    return "ريلز/شورت أقل من 60 ثانية";
  }

  return "قصة مرنة (يمكن تنفيذها كريلز أو فيديو متوسط)";
}

// 🔧 تقدير ملاءمة القصة لجمهور القناة
function estimateAudienceMatch(type) {
  switch (type) {
    case "crime":
    case "mystery":
    case "history":
      return 95;
    case "biography":
      return 90;
    default:
      return 80;
  }
}

/* ============================================================
   📦 2) الكونستانت الخاصة بالـ API
============================================================ */

const API_CONFIG = {
  // حط هنا رابط السيرفر الوسيط لما تجهزه (Netlify Functions / Cloudflare Worker / أي Backend)
  baseUrl: "https://your-middleware-domain.com", // TODO: عدّل ده لاحقًا (تريندات جوجل/يوتيوب/وفيات)

  googleTrendsEndpoint: "/api/google-trends",
  youtubeTrendsEndpoint: "/api/youtube-trends",
  deathsEndpoint: "/api/recent-deaths",

  // 🔥 Worker الخاص بالترندات (الكود السحري الجديد)
  storyBaseUrl: "https://odd-credit-25c6.namozg50.workers.dev", // ⬅️ دي اللي انت عدلتها
  storyAllEndpoint: "/api/story-all",
  storyGeoEndpoint: "/api/story"
};

const ARAB_COUNTRIES = [
  "EG", "SA", "AE", "KW", "QA", "BH", "OM", "JO", "LB", "SY", "IQ",
  "YE", "PS", "SD", "LY", "TN", "DZ", "MA", "MR", "SO", "DJ", "KM"
];

const LOCAL_STORAGE_KEY = "eyelhekaya_stories_v1";

let stories = [];
let storyTrendCache = {
  data: null,
  updatedAt: null
};

const elements = {
  storiesTableBody: document.querySelector("#storiesTableBody"),
  aiOutput: document.querySelector("#aiOutput"),
  btnPickToday: document.querySelector("#btnPickToday"),
  btnPickLong: document.querySelector("#btnPickLong"),
  btnPickShort: document.querySelector("#btnPickShort"),
  btnAnalyzeAll: document.querySelector("#btnAnalyzeAll"),
  textareaNewStories: document.querySelector("#textareaNewStories"),
  btnAddStories: document.querySelector("#btnAddStories")
};

/* ============================================================
   📦 3) ربط بالـ Worker الجديد (Story Trend Worker V4)
============================================================ */

async function fetchStoryTrendsAll() {
  try {
    if (!API_CONFIG.storyBaseUrl || API_CONFIG.storyBaseUrl.includes("your-story-worker")) {
      console.warn("⚠ لم يتم ضبط رابط الـ Story Worker بعد. عدّل API_CONFIG.storyBaseUrl.");
    }

    // لو عندنا كاش في نفس الجلسة نستخدمه
    if (storyTrendCache.data) {
      return storyTrendCache.data;
    }

    const url = API_CONFIG.storyBaseUrl + API_CONFIG.storyAllEndpoint;
    const res = await fetch(url);

    if (!res.ok) throw new Error("Story API error: " + res.status);

    const data = await res.json();
    storyTrendCache.data = data;
    storyTrendCache.updatedAt = new Date().toISOString();

    console.log("Story Worker data loaded:", data);
    return data;
  } catch (err) {
    console.error("Story Worker API error:", err);
    elements.aiOutput.innerHTML = "<p>⚠ تعذر الاتصال بسيرفر الترندات (Worker). تأكد من رابط storyBaseUrl في الكود.</p>";
    return null;
  }
}

// ✅ تفريغ بيانات الـ Worker إلى عناصر واضحة (يدعم الشكل القديم + الجديد V4)
function flattenWorkerResults(workerData) {
  if (!workerData || !Array.isArray(workerData.countries)) return [];

  const items = [];

  workerData.countries.forEach(countryObj => {
    if (!countryObj) return;

    const regionType = countryObj.type || "arab";
    const countryCode =
      countryObj.country_code ||
      countryObj.code ||
      countryObj.region ||
      "";
    const countryName =
      countryObj.country ||
      countryObj.region ||
      countryCode ||
      "غير معروف";

    const storyGroups = Array.isArray(countryObj.stories)
      ? countryObj.stories
      : [];

    if (!storyGroups.length) return;

    // 🔁 دعم الشكل القديم (group.google / group.youtube) لضمان التوافق
    const looksLikeOldShape =
      storyGroups.length &&
      (Object.prototype.hasOwnProperty.call(storyGroups[0], "google") ||
        Object.prototype.hasOwnProperty.call(storyGroups[0], "youtube"));

    if (looksLikeOldShape) {
      storyGroups.forEach(group => {
        if (!group) return;

        const groupWeight =
          typeof group.weight === "number"
            ? group.weight
            : ((Array.isArray(group.google) ? group.google.length : 0) * 0.8 +
               (Array.isArray(group.youtube) ? group.youtube.length : 0) * 0.2);

        if (Array.isArray(group.google)) {
          group.google.forEach(g => {
            if (!g || !g.title) return;
            items.push({
              title: g.title,
              link: g.link || "",
              snippet: g.snippet || "",
              views: "",
              published: "",
              source: "google",
              countryCode,
              country: countryName,
              regionType,
              storyType: "قصة / بحث",
              weight: groupWeight,
              score: groupWeight
            });
          });
        }

        if (Array.isArray(group.youtube)) {
          group.youtube.forEach(y => {
            if (!y || !y.title) return;
            items.push({
              title: y.title,
              link: y.link || "",
              snippet: "",
              views: y.views || "",
              published: y.published || "",
              source: "youtube",
              countryCode,
              country: countryName,
              regionType,
              storyType: "قصة / بحث",
              weight: groupWeight,
              score: groupWeight
            });
          });
        }
      });

      return;
    }

    // ✅ الشكل الجديد في Worker V4: مصفوفة عناصر جاهزة (title / link / snippet / views / published / weight)
    storyGroups.forEach(entry => {
      if (!entry || !entry.title) return;

      const title = entry.title;
      const link = entry.link || "";
      const snippet = entry.snippet || "";
      const views = entry.views || "";
      const published = entry.published || "";

      const baseWeight =
        typeof entry.weight === "number"
          ? entry.weight
          : typeof entry.score === "number"
          ? entry.score
          : 50;

      const normTitle = normalizeArabic(title);

      let storyType = "قصة / قضية";
      if (/(وفاه|وفاة|رحيل|مات|توفي|توفيت|ماتت)/.test(normTitle)) {
        storyType = "وفاة مشهور/شخصية";
      } else if (/(حرب|نزاع|صراع|معركه|معركة|جبهه|جبهة|احتلال)/.test(normTitle)) {
        storyType = "حرب/صراع تاريخي";
      } else if (/(جريمه|جريمة|قتل|مقتل|اغتيال|اختطاف|اعتداء|سفاح)/.test(normTitle)) {
        storyType = "جريمة مكتشفة";
      }

      const source =
        views || published ? "youtube" : "google";

      items.push({
        title,
        link,
        snippet,
        views,
        published,
        source,
        countryCode,
        country: countryName,
        regionType,
        storyType,
        weight: baseWeight,
        score: baseWeight
      });
    });
  });

  return items;
}

// فلترة التكرار حسب العنوان
function dedupeByTitle(items, maxPerTitle = 1) {
  const map = new Map();
  const result = [];

  items.forEach(it => {
    const key = normalizeArabic(it.title);
    const count = map.get(key) || 0;

    if (count < maxPerTitle) {
      result.push(it);
      map.set(key, count + 1);
    }
  });

  return result;
}

/* ============================================================
   🧠 4) تحليل القصة المسجّلة بالموقع
============================================================ */

function classifyStoryType(name) {
  const n = normalizeArabic(name);

  if (/(جريمه|قتل|مقتل|اغتيال|اختطاف|سفاح|سرقه|سرقة)/.test(n)) {
    return "crime";
  }
  if (/(اختفاء|مفقود|غموض|لغز)/.test(n)) {
    return "mystery";
  }
  if (/(حرب|ثوره|ثورة|انقلاب|صراع|نزاع|احتلال)/.test(n)) {
    return "history";
  }
  if (/(فنان|فنانه|ممثله|ممثلة|ممثل|مغني|مطرب|مطربه|مغنيه)/.test(n)) {
    return "biography";
  }

  return "general";
}

function estimateAttractiveness(story) {
  const name = story.name || "";
  const n = normalizeArabic(name);

  let base = 70;

  if (/(جريمه|قتل|مقتل|اغتيال|اختفاء|مفقود|لغز|سر)/.test(n)) {
    base += 15;
  }

  if (/(فنان|فنانه|ممثله|ممثلة|ممثل|مغني|مطرب|مطربه|مغنيه)/.test(n)) {
    base += 10;
  }

  const ageDays = estimateStoryAgeDays(story);
  if (ageDays < 365) {
    base += 5;
  } else if (ageDays > 365 * 5) {
    base -= 5;
  }

  if (base > 100) base = 100;
  if (base < 0) base = 0;

  return Math.round(base);
}

function estimateViralChance(story, trendState, attractiveness) {
  const type = classifyStoryType(story.name);
  const audienceMatch = estimateAudienceMatch(type);

  const trendFactor = trendState?.globalScore ?? 50;

  let result = (attractiveness * 0.4) +
               (audienceMatch * 0.3) +
               (trendFactor * 0.3);

  if (result > 100) result = 100;
  if (result < 0) result = 0;

  return Math.round(result);
}

function estimateTrendMatching(story, trendState) {
  const nameNorm = normalizeArabic(story.name);

  if (!trendState || !Array.isArray(trendState.topQueries)) {
    return 50;
  }

  let bestMatch = 0;

  trendState.topQueries.forEach(q => {
    const qNorm = normalizeArabic(q.query || "");
    if (!qNorm) return;

    if (nameNorm.includes(qNorm) || qNorm.includes(nameNorm)) {
      const matchScore = 60 + Math.min(q.score || 40, 40);
      if (matchScore > bestMatch) bestMatch = matchScore;
    }
  });

  if (!bestMatch) {
    bestMatch = 40;
  }

  return bestMatch;
}

function analyzeStory(story, trendState) {
  const type = classifyStoryType(story.name);
  const attractiveness = estimateAttractiveness(story);
  const saturation = estimateSaturation(story.name);
  const viralChance = estimateViralChance(story, trendState, attractiveness);
  const trendMatching = estimateTrendMatching(story, trendState);
  const audienceMatch = estimateAudienceMatch(type);

  const intelligenceScore =
    viralChance * 0.4 +
    trendMatching * 0.3 +
    audienceMatch * 0.2 +
    (story.score ?? 80) * 0.1;

  const fixed = Math.round(Math.max(0, Math.min(100, intelligenceScore)));

  return {
    type,
    attractiveness,
    saturation,
    viralChance,
    trendMatching,
    audienceMatch,
    intelligenceScore: fixed,
    bestFormat: guessBestFormatFromName(story.name)
  };
}

/* ============================================================
   💾 5) تحميل / حفظ القصص من localStorage
============================================================ */

function loadStoriesFromLocalStorage() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch (err) {
    console.error("Error parsing stories from localStorage:", err);
    return [];
  }
}

function saveStories() {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(stories));
}

/* ============================================================
   📋 6) رسم جدول القصص
============================================================ */

function renderStoriesTable() {
  if (!elements.storiesTableBody) return;

  elements.storiesTableBody.innerHTML = "";

  if (!stories.length) {
    elements.storiesTableBody.innerHTML = `
      <tr>
        <td colspan="6" class="text-center">لا توجد قصص مسجّلة بعد.</td>
      </tr>
    `;
    return;
  }

  stories.forEach((story, index) => {
    const analysis = story.analysis || {};
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${index + 1}</td>
      <td>${story.name || ""}</td>
      <td>${analysis.type || "-"}</td>
      <td>${analysis.intelligenceScore ?? "-"}</td>
      <td>${story.score ?? "-"}</td>
      <td>${story.done ? "✅" : "⏳"}</td>
    `;

    elements.storiesTableBody.appendChild(tr);
  });
}

/* ============================================================
   ✍️ 7) إضافة قصص جديدة من Textarea
============================================================ */

function parseStoriesFromTextarea(text) {
  if (!text) return [];

  return text
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 3)
    .map(line => ({
      name: line,
      score: 80,
      done: false
    }));
}

function addStoriesFromTextarea() {
  const raw = elements.textareaNewStories.value;
  const parsed = parseStoriesFromTextarea(raw);

  if (!parsed.length) {
    alert("لم يتم العثور على أي سطور صالحة لإضافتها كقصص.");
    return;
  }

  stories = stories.concat(parsed);
  saveStories();
  renderStoriesTable();
  elements.textareaNewStories.value = "";
}

/* ============================================================
   🤝 8) ربط الأحداث بالأزرار
============================================================ */

function initEventListeners() {
  if (elements.btnAddStories) {
    elements.btnAddStories.addEventListener("click", addStoriesFromTextarea);
  }

  if (elements.btnAnalyzeAll) {
    elements.btnAnalyzeAll.addEventListener("click", handleAnalyzeAll);
  }

  if (elements.btnPickToday) {
    elements.btnPickToday.addEventListener("click", handlePickToday);
  }

  if (elements.btnPickLong) {
    elements.btnPickLong.addEventListener("click", handlePickLong);
  }

  if (elements.btnPickShort) {
    elements.btnPickShort.addEventListener("click", handlePickShort);
  }
}

/* ============================================================
   📊 9) تحليل كل القصص المسجلة
============================================================ */

async function handleAnalyzeAll() {
  elements.aiOutput.innerHTML = "<p>⏳ يتم الآن تحليل كل القصص المسجّلة...</p>";

  const trendData = null;

  stories = stories.map(story => {
    const analysis = analyzeStory(story, trendData);
    return {
      ...story,
      analysis
    };
  });

  saveStories();
  renderStoriesTable();

  elements.aiOutput.innerHTML = "<p>✅ تم تحليل كل القصص وتحديث الجدول.</p>";
}

/* ============================================================
   🌍 10) زر 1: عرض خريطة الترند (فيديوهات طويلة + ريلز)
============================================================ */

async function handlePickToday() {
  elements.aiOutput.innerHTML =
    "<p>⏳ يتم الآن جلب كل نتائج البحث من Worker الترندات (آخر 365 يوم)...</p>";

  const data = await fetchStoryTrendsAll();
  if (!data) return;

  const items = flattenWorkerResults(data);
  if (!items.length) {
    elements.aiOutput.innerHTML =
      "<p>⚠ لا توجد نتائج ترند متاحة حاليًا من الـ Worker.</p>";
    return;
  }

  // تجميع حسب الدولة
  const byCountry = {};
  items.forEach(it => {
    const key = it.countryCode || it.country || "UNKNOWN";
    if (!byCountry[key]) {
      byCountry[key] = {
        countryCode: it.countryCode || "",
        country: it.country || key,
        regionType: it.regionType || "arab",
        items: []
      };
    }
    byCountry[key].items.push(it);
  });

  // ترتيب داخلي لكل دولة + إزالة التكرارات + قص أفضل 5–10 عناصر
  Object.values(byCountry).forEach(group => {
    group.items.sort((a, b) => {
      const sa = typeof a.score === "number" ? a.score : (a.weight || 0);
      const sb = typeof b.score === "number" ? b.score : (b.weight || 0);
      return sb - sa;
    });

    group.items = dedupeByTitle(group.items, 1).slice(0, 10);
  });

  const groups = Object.values(byCountry).sort((a, b) =>
    a.country.localeCompare(b.country, "ar")
  );

  const htmlParts = [
    "<h2>🎥 خريطة الترند خلال آخر 365 يوم (حسب الدولة)</h2>",
    `<p>يتم عرض القصص الرائجة (جرائم مكتشفة بالكامل، وفيات مشاهير، حروب وصراعات تاريخية) مرتبة تنازليًا حسب الأهمية لكل دولة. النتائج ناتجة عن دمج <strong>بحث Google</strong> و<strong>بحث YouTube</strong> بناءً على Worker V4.</p>`,
    `<p>عدد الدول/المناطق: <strong>${groups.length}</strong></p>`
  ];

  groups.forEach(group => {
    const badge =
      group.regionType === "global" ? "🌐 منطقة عالمية" : "🌍 دولة عربية";

    htmlParts.push(`
      <section class="trend-country-card">
        <header class="trend-country-header">
          <h3>${group.country}</h3>
          <span class="trend-badge">${badge}</span>
        </header>
        <div class="trend-table-wrapper">
          <table class="trend-table">
            <thead>
              <tr>
                <th>#</th>
                <th>عنوان القصة</th>
                <th>النوع</th>
                <th>الوزن</th>
                <th>المصدر</th>
                <th>الدولة/المنطقة</th>
              </tr>
            </thead>
            <tbody>
              ${group.items
                .map((it, idx) => {
                  const score =
                    typeof it.weight === "number"
                      ? it.weight
                      : typeof it.score === "number"
                      ? it.score
                      : "";
                  const sourceLabel =
                    it.source === "youtube"
                      ? "YouTube"
                      : it.source === "google"
                      ? "Google"
                      : "Trend";

                  const safeTitle = it.title || "";
                  const safeCountry = it.country || group.country;

                  return `
                    <tr class="trend-row">
                      <td>${idx + 1}</td>
                      <td>
                        <div class="trend-title">
                          <a href="${it.link ||
                            "#"}" target="_blank" rel="noopener">
                            ${safeTitle}
                          </a>
                        </div>
                      </td>
                      <td>${it.storyType || "قصة / قضية"}</td>
                      <td>${score}</td>
                      <td>${sourceLabel}</td>
                      <td>${safeCountry}</td>
                    </tr>
                  `;
                })
                .join("")}
            </tbody>
          </table>
        </div>
      </section>
    `);
  });

  elements.aiOutput.innerHTML = htmlParts.join("");
}

/* ============================================================
   🎬 12) زر 2: اختيار قصة عشوائية مسجّلة بالموقع (فيديو طويل)
============================================================ */

function computeStoryHitCountFromTrends(story, trendItems) {
  const normName = normalizeArabic(story.name);

  if (!normName || !trendItems?.length) {
    return 0;
  }

  let hits = 0;

  trendItems.forEach(it => {
    const normTitle = normalizeArabic(it.title);
    if (!normTitle) return;

    if (normTitle.includes(normName) || (normName.length > 6 && normName.includes(normTitle))) {
      hits++;
    }
  });

  return hits;
}

async function handlePickLong() {
  elements.aiOutput.innerHTML = "<p>⏳ يتم الآن حساب أفضل القصص المسجّلة بالموقع بناءً على تقييمك + الترند...</p>";

  const data = await fetchStoryTrendsAll();
  if (!data) return;

  const trendItems = flattenWorkerResults(data);

  const candidates = stories.filter(s => !s.done); // قصص لم تُنفذ بعد
  if (!candidates.length) {
    elements.aiOutput.innerHTML = "<p>⚠ لا توجد قصص متاحة (كل القصص تم تنفيذها).</p>";
    return;
  }

  const ranked = candidates.map(story => {
    const analysis = ensureStoryAnalysis(story);
    const hitCount = computeStoryHitCountFromTrends(story, trendItems);

    // نحول عدد الـ Hits إلى درجة من 0 إلى 100 (بحد أقصى 10 Hits)
    const hitScore = Math.min(hitCount, 10) / 10 * 100;

    // وزن داخلي للقصة (ذكاء + جاذبية + عمر...)
    const { intelligenceScore, attractiveness, bestFormat, saturation } = analysis;
    const baseLongWeight =
      intelligenceScore * 0.5 +
      attractiveness * 0.2 +
      (story.score ?? 80) * 0.2 +
      (bestFormat.includes("طويل") ? 10 : 0);

    let finalWeight =
      baseLongWeight * 0.7 +
      hitScore * 0.3;

    if (finalWeight > 100) finalWeight = 100;
    if (finalWeight < 0) finalWeight = 0;

    return {
      story,
      analysis,
      hitCount,
      hitScore: Math.round(hitScore),
      baseLongWeight: Math.round(baseLongWeight),
      finalWeight: Math.round(finalWeight)
    };
  });

  // ترتيب تنازلي واختيار أفضل 5
  ranked.sort((a, b) => b.finalWeight - a.finalWeight);
  const top5 = ranked.slice(0, 5);

  // تجهيز HTML
  const htmlParts = [
    "<h2>🎥 أفضل 5 قصص مسجّلة بالموقع لفيديو طويل</h2>",
    "<p>الاختيار مبني على <strong>تقييمك الشخصي</strong> + <strong>عدد مرات ظهور العنوان في الترند</strong> آخر فترة.</p>",
    "<ol>"
  ];

  top5.forEach(item => {
    const { story, analysis, finalWeight, hitCount, hitScore, baseLongWeight } = item;
    const { intelligenceScore, attractiveness, bestFormat, saturation } = analysis;

    // استخراج بعض عناوين الترند المطابقة (بحد أقصى 3)
    const related = trendItems
      .filter(it => {
        const normTitle = normalizeArabic(it.title);
        const normName = normalizeArabic(story.name);
        return normTitle.includes(normName) || (normName.length > 6 && normName.includes(normTitle));
      })
      .slice(0, 3);

    htmlParts.push(`
      <li>
        <p class="ai-title">${story.name}</p>
        <ul class="ai-list">
          <li>درجة ذكاء القصة (تحليل داخلي): <strong>${intelligenceScore}/100</strong></li>
          <li>عامل الجاذبية: <strong>${attractiveness}/100</strong></li>
          <li>أفضل شكل للفيديو: <strong>${bestFormat}</strong> – مستوى التشبع: <strong>${saturation}</strong></li>
          <li>تقييمك الشخصي (score): <strong>${story.score ?? 80}</strong></li>
          <li>وزن القصة الداخلي للفيديوهات الطويلة: <strong>${baseLongWeight}</strong></li>
          <li>عدد مرات ظهور العنوان في نتائج الترند: <strong>${hitCount}</strong> (درجة الترند: ${hitScore}/100)</li>
          <li>💡 الوزن النهائي للاختيار: <strong>${finalWeight}/100</strong></li>
        </ul>

        ${
          related.length
            ? `
            <details>
              <summary>🔎 بعض النتائج المطابقة في الترند (${related.length}):</summary>
              <ul class="ai-list">
                ${related
                  .map(
                    r =>
                      `<li>[${r.source === "google" ? "Google" : "YouTube"}] ${r.title} – <a href="${r.link}" target="_blank" rel="noopener">رابط</a></li>`
                  )
                  .join("")}
              </ul>
            </details>
          `
            : `<p>لا توجد روابط مطابقة مباشرة، لكن القصة قوية من حيث تقييمك وتحليلها الداخلي.</p>`
        }
      </li>
    `);
  });

  htmlParts.push("</ol>");

  elements.aiOutput.innerHTML = htmlParts.join("");
}

/* ============================================================
   🎯 13) زر 3: اختيار فكرة ريلز من الترند
============================================================ */

function isTitleShortFriendly(title) {
  const t = title || "";
  const tNorm = normalizeArabic(t);

  if (tNorm.length < 8) return false;

  if (/(قصه|قصة|حكاية|حكايه|جريمه|جريمة|حادثه|حادثة|اختفاء|مفقود|كارثه|كارثة|فضيحه|فضيحة)/.test(tNorm)) {
    return true;
  }

  return false;
}

function estimateShortVideoDuration(title) {
  const len = (title || "").length;

  if (len < 40) return 30;
  if (len < 80) return 45;
  return 60;
}

async function handlePickShort() {
  elements.aiOutput.innerHTML = "<p>⏳ يتم الآن تحليل الترند لاختيار أفضل أفكار ريلز...</p>";

  const data = await fetchStoryTrendsAll();
  if (!data) return;

  let items = flattenWorkerResults(data);
  if (!items.length) {
    elements.aiOutput.innerHTML = "<p>⚠ لا توجد نتائج ترند مناسبة حاليًا.</p>";
    return;
  }

  // استبعاد العناوين الموجودة بالفعل في القصص المسجّلة بالموقع
  const storyNamesNorm = stories.map(st => normalizeArabic(st.name));

  items = items.filter(it => {
    const normTitle = normalizeArabic(it.title);
    if (!normTitle) return false;

    const existsInLocal = storyNamesNorm.some(n => n && (normTitle.includes(n) || n.includes(normTitle)));
    if (existsInLocal) return false;

    // نريد فقط العناوين السريعة (جرائم / اختفاء / صدمة...)
    return isTitleShortFriendly(it.title);
  });

  if (!items.length) {
    elements.aiOutput.innerHTML = "<p>⚠ لا توجد قصص قصيرة مناسبة للريلز حاليًا (بعد استبعاد القصص المسجّلة عندك).</p>";
    return;
  }

  items = dedupeByTitle(items, 1);

  items.sort((a, b) => {
    const sa = typeof a.score === "number" ? a.score : (a.weight || 0);
    const sb = typeof b.score === "number" ? b.score : (b.weight || 0);
    return sb - sa;
  });

  const top5 = items.slice(0, 5);

  const htmlParts = [
    "<h2>🎬 أفضل 5 أفكار ريلز من الترند</h2>",
    "<p>تم استبعاد أي عنوان مسجّل مسبقًا عندك في قائمة القصص، وتم اختيار العناوين الأقرب لطبيعة الريلز (قصص صدمة/اختفاء/جريمة سريعة).</p>",
    "<ol>"
  ];

  top5.forEach(it => {
    const metaDuration = estimateShortVideoDuration(it.title);

    const hashtags = [
      "ايه_الحكاية",
      "قصص_حقيقية",
      "ريلز",
      "shorts",
      "وثائقيات",
      "قصة_اليوم"
    ];

    const desc = `قصة قصيرة مشوقة عن: ${it.title}.\nتابع قناة "إيه الحكاية؟" للمزيد من القصص الحقيقية المشوقة.`;

    htmlParts.push(`
      <li>
        <p class="ai-title">${it.title}</p>
        <p>المصدر: <strong>${it.source === "google" ? "Google" : "YouTube"}</strong> – الدولة: <strong>${it.country}</strong></p>
        <p>🔗 <a href="${it.link}" target="_blank" rel="noopener">فتح الرابط الأصلي</a></p>

        <h4>📝 عنوان مقترح للريلز:</h4>
        <p>«${it.title}… الحكاية في أقل من دقيقة»</p>

        <h4>📄 وصف مقترح:</h4>
        <p>${desc}</p>

        <h4>⏱ مدة مقترحة:</h4>
        <p>${metaDuration} ثانية تقريبًا.</p>

        <h4>🏷 هاشتاجات مقترحة:</h4>
        <p class="ai-tags">${hashtags.map(h => "#" + h).join(" ")}</p>
      </li>
    `);
  });

  htmlParts.push("</ol>");

  elements.aiOutput.innerHTML = htmlParts.join("");
}

/* ============================================================
   🚀 14) تهيئة التطبيق عند التحميل
============================================================ */

async function loadStories() {
  stories = loadStoriesFromLocalStorage();

  if (stories.length) {
    console.log("Loaded stories from localStorage:", stories.length);
    return;
  }

  try {
    const res = await fetch("./stories.json");
    if (!res.ok) throw new Error("Failed to load stories.json");
    const data = await res.json();
    if (Array.isArray(data)) {
      stories = data;
      console.log("Loaded stories from stories.json:", stories.length);
      saveStories();
    }
  } catch (err) {
    console.error("Error loading stories.json:", err);
    stories = [];
  }
}

function ensureStoryAnalysis(story) {
  if (!story.analysis) {
    story.analysis = analyzeStory(story, null);
  }
  return story.analysis;
}

async function initApp() {
  elements.aiOutput.innerHTML = "<p>⏳ يتم تحميل القصص…</p>";
  await loadStories();
  stories.forEach(st => ensureStoryAnalysis(st));
  renderStoriesTable();
  elements.aiOutput.innerHTML = "<p>✅ تم تحميل القصص. يمكنك الآن اختيار قصة أو لصق قصص جديدة.</p>";
}

document.addEventListener("DOMContentLoaded", () => {
  initEventListeners();
  initApp().catch(err => {
    console.error("App init error:", err);
    elements.aiOutput.innerHTML = "<p>حدث خطأ عند تحميل التطبيق.</p>";
  });
});
