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
    .replace(/[^\u0600-\u06FF ]/g, "") 
    .normalize("NFD")
    .replace(/[\u064B-\u065F]/g, "")
    .trim();
}

// 🔧 تقدير عمر القصة (بالأيام)
function estimateStoryAgeDays(story) {
  if (!story || !story.date) return 365;
  const storyDate = new Date(story.date);
  if (isNaN(storyDate.getTime())) return 365;
  return Math.max(0, (new Date() - storyDate) / (1000*60*60*24));
}

// 🔧 تقدير التشبّع
function estimateSaturation(name) {
  return "متوسط";
}

// 🔧 تقدير شكل الفيديو
function guessBestFormatFromName(name) {
  const n = normalizeArabic(name);
  if (/(حرب|معركه|معركة|ثوره|ثورة|سيره|سيرة|حياه)/.test(n)) return "فيديو طويل (وثائقي)";
  if (/(حادثه|جريمه|جريمة|اختفاء|لغز|سر)/.test(n)) return "قصة مشوقة (8–15 دقيقة)";
  return "قصة مرنة (ريلز أو متوسط)";
}

// 🔧 ملاءمة الجمهور
function estimateAudienceMatch(type) {
  switch(type) {
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
  baseUrl: "https://your-middleware-domain.com",

  googleTrendsEndpoint: "/api/google-trends",
  youtubeTrendsEndpoint: "/api/youtube-trends",
  deathsEndpoint: "/api/recent-deaths",

  // Worker الجديد
  storyBaseUrl: "https://odd-credit-25c6.namozg50.workers.dev",
  storyAllEndpoint: "/api/story-all",
  storyGeoEndpoint: "/api/story"
};

const ARAB_COUNTRIES = [
  "EG","SA","AE","KW","QA","BH","OM","JO","LB","SY",
  "IQ","YE","PS","SD","LY","TN","DZ","MA","MR","SO","DJ","KM"
];

const LOCAL_STORAGE_KEY = "eyelhekaya_stories_v1";

let stories = [];
let storyTrendCache = { data: null, updatedAt: null };


// عناصر DOM
const elements = {
  storiesTableBody: document.querySelector("#storiesTableBody"),
  aiOutput: document.querySelector("#aiOutput"),
  btnPickToday: document.querySelector("#btnPickToday"),
  btnPickLong: document.querySelector("#btnPickLong"),
  btnPickShort: document.querySelector("#btnPickShort"),
  btnAnalyzeAll: document.querySelector("#btnAnalyzeAll"),
  textareaNewStories: document.querySelector("#textareaNewStories"),
  btnAddStories: document.querySelector("#btnAddStories"),
  searchInput: document.querySelector("#stories-search")
};


/* ============================================================
   📦 3) ربط بالـ Worker الجديد (Story Trend Worker V4)
============================================================ */

async function fetchStoryTrendsAll() {
  try {
    if (storyTrendCache.data) return storyTrendCache.data;

    const url = API_CONFIG.storyBaseUrl + API_CONFIG.storyAllEndpoint;
    const res = await fetch(url);

    if (!res.ok) throw new Error("Worker API error");

    const data = await res.json();
    storyTrendCache.data = data;
    storyTrendCache.updatedAt = new Date().toISOString();

    return data;
  } catch (err) {
    elements.aiOutput.innerHTML = "<p>⚠ خطأ الاتصال بالترند.</p>";
    return null;
  }
}


/* ============================================================
   📦 4) Flatten النتائج من الـ Worker
============================================================ */

function flattenWorkerResults(workerData) {
  if (!workerData || !Array.isArray(workerData.countries)) return [];
  const items = [];

  workerData.countries.forEach(countryObj => {
    if (!countryObj) return;

    const regionType = countryObj.type || "arab";
    const countryCode = 
      countryObj.country_code || 
      countryObj.code || 
      countryObj.region || "";
    const countryName = 
      countryObj.country || 
      countryObj.region || 
      countryCode || "غير معروف";

    const storyGroups = Array.isArray(countryObj.stories)
      ? countryObj.stories
      : [];

    storyGroups.forEach(entry => {
      if (!entry || !entry.title) return;

      const baseWeight =
        typeof entry.weight === "number"
          ? entry.weight
          : typeof entry.score === "number"
          ? entry.score
          : 50;

      const norm = normalizeArabic(entry.title);
      let storyType = "قصة / قضية";

      if (/(وفاه|وفاة|رحيل|مات|توفي)/.test(norm)) storyType = "وفاة مشهور";
      else if (/(حرب|نزاع|صراع|معركه|معركة)/.test(norm)) storyType = "حرب/صراع تاريخي";
      else if (/(جريمه|قتل|اغتيال|اختطاف)/.test(norm)) storyType = "جريمة مكتشفة";

      const source = entry.views || entry.published ? "youtube" : "google";

      items.push({
        title: entry.title,
        link: entry.link || "",
        snippet: entry.snippet || "",
        views: entry.views || "",
        published: entry.published || "",
        regionType,
        countryCode,
        country: countryName,
        storyType,
        source,
        weight: baseWeight,
        score: baseWeight
      });
    });
  });

  return items;
}


/* ============================================================
   🔁 إزالة التكرارات
============================================================ */

function dedupeByTitle(items, maxPerTitle=1) {
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

  if (/(جريمه|قتل|مقتل|اغتيال|اختطاف|سفاح|سرقه|سرقة)/.test(n)) return "crime";
  if (/(اختفاء|مفقود|غموض|لغز)/.test(n)) return "mystery";
  if (/(حرب|ثوره|ثورة|انقلاب|صراع|نزاع|احتلال)/.test(n)) return "history";
  if (/(فنان|فنانه|ممثله|ممثلة|ممثل|مغني|مطرب|مطربه|مغنيه)/.test(n)) return "biography";

  return "general";
}

function estimateAttractiveness(story) {
  const n = normalizeArabic(story.name || "");
  let base = 70;

  if (/(جريمه|قتل|اختفاء|لغز|سر)/.test(n)) base += 15;
  if (/(فنان|ممثل|مغني)/.test(n)) base += 10;

  const ageDays = estimateStoryAgeDays(story);
  if (ageDays < 365) base += 5;
  if (ageDays > 365 * 5) base -= 5;

  return Math.max(0, Math.min(100, Math.round(base)));
}

function estimateViralChance(story, trendState, attractiveness) {
  const type = classifyStoryType(story.name);
  const audienceMatch = estimateAudienceMatch(type);
  const trendFactor = trendState?.globalScore ?? 50;

  let score = attractiveness * 0.4 + audienceMatch * 0.3 + trendFactor * 0.3;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function estimateTrendMatching(story, trendState) {
  const nameNorm = normalizeArabic(story.name);

  if (!trendState || !Array.isArray(trendState.topQueries)) return 50;

  let best = 0;

  trendState.topQueries.forEach(q => {
    const qNorm = normalizeArabic(q.query || "");
    if (!qNorm) return;

    if (nameNorm.includes(qNorm) || qNorm.includes(nameNorm)) {
      const score = 60 + Math.min(q.score || 40, 40);
      if (score > best) best = score;
    }
  });

  return best || 40;
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

  return {
    type,
    attractiveness,
    saturation,
    viralChance,
    trendMatching,
    audienceMatch,
    intelligenceScore: Math.round(intelligenceScore),
    bestFormat: guessBestFormatFromName(story.name)
  };
}


/* ============================================================
   💾 5) تحميل/حفظ القصص
============================================================ */

function loadStoriesFromLocalStorage() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
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
        <td colspan="10" class="text-center">لا توجد قصص مُسجّلة.</td>
      </tr>`;
    return;
  }

  stories.forEach((story, index) => {
    const analysis = story.analysis || {};
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${index + 1}</td>
      <td>${story.name}</td>
      <td>${story.type || "-"}</td>
      <td>${analysis.intelligenceScore ?? "-"}</td>
      <td>${story.score ?? "-"}</td>
      <td>${story.attractiveness ?? "-"}</td>
      <td>${story.done ? "✅" : "⏳"}</td>
      <td>${story.date || "-"}</td>
      <td>${story.notes || ""}</td>
      <td>
        <button class="btn small danger" onclick="deleteStory(${index})">🗑 حذف</button>
      </td>
    `;

    elements.storiesTableBody.appendChild(tr);
  });
}

function deleteStory(index) {
  if (!confirm("هل أنت متأكد من حذف هذه القصة؟")) return;
  stories.splice(index, 1);
  saveStories();
  renderStoriesTable();
}


/* ============================================================
   🔍 7) البحث الفوري + صندوق الاقتراحات + نافذة النتائج
============================================================ */

let searchPopup = null;

// ☑ إنشاء مربع النتائج (Modal)
function createSearchPopup() {
  if (searchPopup) return;

  searchPopup = document.createElement("div");
  searchPopup.className = "search-modal";
  searchPopup.innerHTML = `
    <div class="search-modal-content">
      <button class="close-btn" id="closeSearchModal">×</button>
      <h3>نتائج البحث</h3>
      <div id="searchResultsContainer"></div>
    </div>
  `;
  document.body.appendChild(searchPopup);

  document.querySelector("#closeSearchModal").addEventListener("click", () => {
    searchPopup.style.display = "none";
  });
}

// ☑ صندوق الاقتراحات تحت خانة البحث
const suggestionBox = document.createElement("div");
suggestionBox.id = "suggestionBox";
suggestionBox.className = "suggestion-box";
document.querySelector(".search-row").appendChild(suggestionBox);


// دالة البحث
function searchStories(query) {
  const norm = normalizeArabic(query);
  if (!norm) return [];

  return stories.filter(st => {
    const nameNorm = normalizeArabic(st.name);
    return nameNorm.includes(norm);
  });
}


// عرض الاقتراحات تحت شريط البحث
function showSuggestions(results) {
  if (!results.length) {
    suggestionBox.style.display = "none";
    return;
  }

  suggestionBox.innerHTML = results
    .slice(0, 8)
    .map(st => `<div class="suggestion-item">${st.name}</div>`)
    .join("");

  suggestionBox.style.display = "block";
}


// عندما يكتب المستخدم
elements.searchInput.addEventListener("input", (e) => {
  const q = e.target.value.trim();
  if (!q) {
    suggestionBox.style.display = "none";
    return;
  }

  const results = searchStories(q);
  showSuggestions(results);
});


// عند الضغط Enter → افتح النافذة المنبثقة
elements.searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const q = elements.searchInput.value.trim();
    showSearchModal(q);
  }
});


// 👇 النافذة المنبثقة لجميع نتائج البحث
function showSearchModal(query) {
  createSearchPopup();

  const results = searchStories(query);

  const container = document.querySelector("#searchResultsContainer");

  if (!results.length) {
    container.innerHTML = "<p>لا توجد نتائج مطابقة.</p>";
  } else {
    container.innerHTML = `
      <table class="trend-table">
        <thead>
          <tr>
            <th>#</th>
            <th>الاسم</th>
            <th>النوع</th>
            <th>الذكاء</th>
            <th>تاريخ</th>
            <th>تحكم</th>
          </tr>
        </thead>
        <tbody>
          ${results
            .map(
              (st, i) => `
            <tr>
              <td>${i + 1}</td>
              <td>${st.name}</td>
              <td>${st.type || "-"}</td>
              <td>${st.analysis?.intelligenceScore ?? "-"}</td>
              <td>${st.date || "-"}</td>
              <td>
                <button class="btn small danger" onclick="deleteStoryByName('${st.name}')">🗑 حذف</button>
              </td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    `;
  }

  searchPopup.style.display = "block";
}

function deleteStoryByName(name) {
  const norm = normalizeArabic(name);
  const idx = stories.findIndex(st => normalizeArabic(st.name) === norm);
  if (idx >= 0) deleteStory(idx);
}
/* ============================================================
   📊 10) زر: اختيار قصة اليوم (الترند الكامل)
============================================================ */

async function handlePickToday() {
  elements.aiOutput.innerHTML = "<p>⏳ يتم الآن جلب الترند الكامل لآخر 365 يوم…</p>";

  const data = await fetchStoryTrendsAll();
  if (!data) return;

  const items = flattenWorkerResults(data);
  if (!items.length) {
    elements.aiOutput.innerHTML = "<p>⚠ لا توجد نتائج ترند متاحة.</p>";
    return;
  }

  // تجميع حسب الدولة
  const groups = {};
  items.forEach(it => {
    const key = it.country || "UNKNOWN";
    if (!groups[key]) groups[key] = [];
    groups[key].push(it);
  });

  // تجهيز HTML
  let html = `<h2>🌍 خريطة الترند – آخر 365 يوم</h2>`;

  Object.keys(groups).forEach(country => {
    const list = groups[country]
      .sort((a, b) => (b.score || b.weight) - (a.score || a.weight))
      .slice(0, 10);

    html += `
      <section class="trend-country-card">
        <header><h3>${country}</h3></header>
        <table class="trend-table">
          <thead>
            <tr>
              <th>#</th>
              <th>العنوان</th>
              <th>النوع</th>
              <th>الوزن</th>
              <th>المصدر</th>
            </tr>
          </thead>
          <tbody>
            ${list
              .map(
                (it, i) => `
              <tr>
                <td>${i + 1}</td>
                <td><a href="${it.link}" target="_blank">${it.title}</a></td>
                <td>${it.storyType || "?"}</td>
                <td>${it.weight || it.score}</td>
                <td>${it.source}</td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </section>
    `;
  });

  elements.aiOutput.innerHTML = html;
}


/* ============================================================
   🎥 11) زر: اختيار قصة طويلة من القصص المسجلة
============================================================ */

async function handlePickLong() {
  elements.aiOutput.innerHTML = "<p>⏳ يتم تحليل القصص + الترند…</p>";

  const data = await fetchStoryTrendsAll();
  const trendItems = flattenWorkerResults(data);

  const candidates = stories.filter(s => !s.done);
  if (!candidates.length) {
    elements.aiOutput.innerHTML = "<p>⚠ لا توجد قصص متاحة.</p>";
    return;
  }

  const ranked = candidates.map(story => {
    const analysis = ensureStoryAnalysis(story);
    const hits = trendItems.filter(it =>
      normalizeArabic(it.title).includes(normalizeArabic(story.name))
    ).length;

    const hitScore = Math.min(hits, 10) * 10;
    const finalWeight =
      analysis.intelligenceScore * 0.5 +
      analysis.attractiveness * 0.2 +
      (story.score ?? 80) * 0.2 +
      hitScore * 0.1;

    return {
      story,
      analysis,
      hits,
      final: Math.round(finalWeight)
    };
  });

  ranked.sort((a, b) => b.final - a.final);
  const top = ranked.slice(0, 5);

  let html = `<h2>🎬 أفضل 5 قصص لفيديو طويل</h2><ol>`;

  top.forEach(item => {
    html += `
      <li>
        <p class="ai-title">${item.story.name}</p>
        <ul class="ai-list">
          <li>ذكاء: ${item.analysis.intelligenceScore}</li>
          <li>جاذبية: ${item.analysis.attractiveness}</li>
          <li>Hits ترند: ${item.hits}</li>
          <li>🔮 الوزن النهائي: ${item.final}</li>
        </ul>
      </li>
    `;
  });

  html += `</ol>`;

  elements.aiOutput.innerHTML = html;
}


/* ============================================================
   ⚡ 12) زر: اختيار فكرة ريلز من الترند
============================================================ */

async function handlePickShort() {
  elements.aiOutput.innerHTML = "<p>⏳ يتم تحليل الترند للريلز…</p>";

  const data = await fetchStoryTrendsAll();
  const items = dedupeByTitle(flattenWorkerResults(data));

  let filtered = items.filter(it => {
    const t = normalizeArabic(it.title);
    return /(جريمه|اختفاء|حادث|لغز|سر)/.test(t) && t.length > 10;
  }).slice(0, 5);

  let html = "<h2>⚡ أفضل 5 أفكار ريلز</h2><ol>";

  filtered.forEach(item => {
    html += `
      <li>
        <p class="ai-title">${item.title}</p>
        <p>المصدر: ${item.source} – الدولة: ${item.country}</p>
        <p><a href="${item.link}" target="_blank">فتح الرابط</a></p>
      </li>
    `;
  });

  html += "</ol>";

  elements.aiOutput.innerHTML = html;
}


/* ============================================================
   💾 13) تصدير واستيراد القصص
============================================================ */

function exportStories() {
  const blob = new Blob([JSON.stringify(stories, null, 2)], {
    type: "application/json"
  });

  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "stories_backup.json";
  a.click();
}

document.querySelector("#btn-export")?.addEventListener("click", exportStories);

document.querySelector("#import-file")?.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (Array.isArray(data)) {
        stories = data;
        saveStories();
        renderStoriesTable();
        alert("✔ تم استيراد القصص بنجاح.");
      }
    } catch {
      alert("⚠ ملف غير صالح.");
    }
  };
  reader.readAsText(file);
});


/* ============================================================
   🚀 14) تهيئة التطبيق
============================================================ */

async function loadStories() {
  stories = loadStoriesFromLocalStorage();

  if (!stories.length) {
    try {
      const res = await fetch("./stories.json");
      stories = await res.json();
      saveStories();
    } catch {
      stories = [];
    }
  }
}

function ensureStoryAnalysis(story) {
  if (!story.analysis)
    story.analysis = analyzeStory(story, null);
  return story.analysis;
}

async function initApp() {
  elements.aiOutput.innerHTML = "<p>⏳ جاري التحميل…</p>";
  await loadStories();
  stories.forEach(ensureStoryAnalysis);
  renderStoriesTable();
  elements.aiOutput.innerHTML = "<p>✔ جاهز للعمل.</p>";
}

document.addEventListener("DOMContentLoaded", () => {
  initEventListeners();
  initApp();
});
