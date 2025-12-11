/* ============================================================
   📦 1) الإعدادات العامة – API و الكونستانت
============================================================ */

const API_CONFIG = {
  // حط هنا رابط السيرفر الوسيط لما تجهزه (Netlify Functions / Cloudflare Worker / أي Backend)
  baseUrl: "https://your-middleware-domain.com", // TODO: عدّل ده لاحقًا (تريندات جوجل/يوتيوب/وفيات)

  googleTrendsEndpoint: "/api/google-trends",
  youtubeTrendsEndpoint: "/api/youtube-trends",
  deathsEndpoint: "/api/recent-deaths",

  // 🔥 Worker الخاص بالترندات (الكود السحري الجديد)
  storyBaseUrl: "https://odd-credit-25c6.namozg50.workers.dev/", // ⬅️ عدّلها لرابط الـ Worker فعليًا
  storyAllEndpoint: "/api/story-all",
  storyGeoEndpoint: "/api/story"
};

const ARAB_COUNTRIES = [
  "EG", "SA", "AE", "KW", "QA", "BH", "OM", "JO", "LB", "SY", "IQ",
  "YE", "PS", "SD", "LY", "TN", "DZ", "MA", "MR", "SO", "DJ", "KM"
];

const LOCAL_STORAGE_KEY = "eyelhekaya_stories_v1";
const TODAY = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

// حالة التريندات (Google / YouTube / وفيات)
const trendState = {
  googleTrends: [],
  youtubeTrends: [],
  deaths: [],
  lastUpdated: null
};

// حالة تريند الـ Worker (الترندات حسب الدول والقصص)
const storyTrendCache = {
  data: null,
  lastUpdated: null
};

// مصفوفة القصص
let stories = [];

// ربط عناصر DOM
const elements = {
  aiOutput: document.getElementById("ai-output"),
  tbody: document.getElementById("stories-tbody"),
  rawInput: document.getElementById("raw-input"),
  btnParseRaw: document.getElementById("btn-parse-raw"),
  btnExport: document.getElementById("btn-export"),
  inputImport: document.getElementById("import-file"),
  btnPickToday: document.getElementById("btn-pick-today"),   // ← زر: اختيار قصة فيديو طويل وفقًا للترند
  btnPickLong: document.getElementById("btn-pick-long"),     // ← زر: اختيار قصة عشوائية مسجّلة بالموقع (فيديو طويل)
  btnPickShort: document.getElementById("btn-pick-short"),   // ← زر: اختيار فيديو (ريلز) من الترند
  btnUpdateTrends: document.getElementById("btn-update-trends"),
  statusTrends: document.getElementById("status-trends"),
  statusYoutube: document.getElementById("status-youtube"),
  statusDeaths: document.getElementById("status-deaths")
};


/* ============================================================
   🧩 2) تحميل القصص من LocalStorage أو من stories.json
============================================================ */

async function loadStories() {
  // جرّب الأول تحميل من LocalStorage
  const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        stories = parsed;
        console.log("Loaded stories from localStorage:", stories.length);
        return;
      }
    } catch (e) {
      console.warn("Failed to parse stories from localStorage:", e);
    }
  }

  // لو مفيش في LocalStorage → حمّل من stories.json
  try {
    const res = await fetch("stories.json", { cache: "no-cache" });
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

function saveStories() {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(stories));
}


/* ============================================================
   📋 3) عرض القصص في الجدول
============================================================ */

function renderStoriesTable() {
  elements.tbody.innerHTML = "";

  if (!stories.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 9;
    cell.textContent = "لا توجد قصص حالياً. أضف قصصًا من الأعلى أو من ملف التصدير.";
    cell.style.textAlign = "center";
    row.appendChild(cell);
    elements.tbody.appendChild(row);
    return;
  }

  stories
    .slice()
    .sort((a, b) => (a.id ?? 0) - (b.id ?? 0))
    .forEach((story, index) => {
      const tr = document.createElement("tr");
      tr.dataset.id = story.id;

      const analysis = ensureStoryAnalysis(story);

      const cells = [
        index + 1,
        story.name || "",
        analysis.type || "",
        story.score ?? "",
        analysis.attractiveness ?? "",
        analysis.intelligenceLabel || "",
        story.done ? "✔" : "✖",
        story.added || "",
        "" // التحكم
      ];

      cells.forEach((val, i) => {
        const td = document.createElement("td");
        if (i === 6) {
          // عمود تنفيذ
          const doneBtn = document.createElement("button");
          doneBtn.textContent = story.done ? "تم" : "لم يُنفذ";
          doneBtn.className = story.done ? "btn tiny success" : "btn tiny";
          doneBtn.addEventListener("click", () => toggleStoryDone(story.id));
          td.appendChild(doneBtn);
        } else if (i === 8) {
          // عمود تحكم
          td.appendChild(buildControlButtons(story));
        } else {
          td.textContent = val;
        }
        tr.appendChild(td);
      });

      elements.tbody.appendChild(tr);
    });
}

function buildControlButtons(story) {
  const container = document.createElement("div");
  container.className = "table-controls";

  const btnView = document.createElement("button");
  btnView.textContent = "👁 تحليل";
  btnView.className = "btn tiny secondary";
  btnView.addEventListener("click", () => showStoryAnalysis(story));

  const btnEdit = document.createElement("button");
  btnEdit.textContent = "✏ تعديل";
  btnEdit.className = "btn tiny";
  btnEdit.addEventListener("click", () => editStoryPrompt(story.id));

  const btnDelete = document.createElement("button");
  btnDelete.textContent = "🗑 حذف";
  btnDelete.className = "btn tiny danger";
  btnDelete.addEventListener("click", () => deleteStory(story.id));

  container.appendChild(btnView);
  container.appendChild(btnEdit);
  container.appendChild(btnDelete);
  return container;
}

function toggleStoryDone(id) {
  const s = stories.find(st => st.id === id);
  if (!s) return;
  s.done = !s.done;
  saveStories();
  renderStoriesTable();
}

function deleteStory(id) {
  if (!confirm("هل أنت متأكد من حذف هذه القصة؟")) return;
  stories = stories.filter(st => st.id !== id);
  saveStories();
  renderStoriesTable();
}

function editStoryPrompt(id) {
  const s = stories.find(st => st.id === id);
  if (!s) return;

  const newName = prompt("تعديل اسم القصة:", s.name);
  if (newName && newName.trim()) {
    s.name = newName.trim();
  }

  const newScoreStr = prompt("تعديل درجة القصة (0-100):", s.score ?? "");
  const num = Number(newScoreStr);
  if (!Number.isNaN(num) && num >= 0 && num <= 100) {
    s.score = num;
  }

  saveStories();
  renderStoriesTable();
}


/* ============================================================
   ✂️ 4) تحويل النص الخام إلى قصص جديدة
============================================================ */

function parseRawStories() {
  const raw = elements.rawInput.value || "";
  const lines = raw
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0);

  if (!lines.length) {
    alert("من فضلك الصق نص يحتوي على قصص (كل سطر = قصة).");
    return;
  }

  const maxId = stories.reduce((m, s) => Math.max(m, s.id ?? 0), 0);
  let nextId = maxId + 1;

  lines.forEach(name => {
    // تجنب التكرار التام
    if (stories.some(s => s.name === name)) return;

    const story = {
      id: nextId++,
      name,
      score: 80, // قيمة افتراضية – يمكن تعديلها لاحقًا
      done: false,
      category: "",
      added: TODAY,
      notes: "",
      analysis: null
    };

    story.analysis = analyzeStory(story, trendState);
    stories.push(story);
  });

  saveStories();
  renderStoriesTable();
  elements.rawInput.value = "";
}


/* ============================================================
   💾 5) التصدير والاستيراد (Backup)
============================================================ */

function exportStories() {
  const dataStr = JSON.stringify(stories, null, 2);
  const blob = new Blob([dataStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `stories-backup-${TODAY}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

function handleImportFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = e => {
    try {
      const imported = JSON.parse(e.target.result);
      if (!Array.isArray(imported)) {
        alert("صيغة الملف غير صحيحة. يجب أن يكون مصفوفة JSON.");
        return;
      }
      stories = imported;
      saveStories();
      renderStoriesTable();
      alert("تم استيراد القصص بنجاح.");
    } catch (err) {
      console.error("Import error:", err);
      alert("حدث خطأ أثناء قراءة الملف.");
    }
  };
  reader.readAsText(file, "utf-8");
  // إعادة تعيين القيمة للسماح برفع نفس الملف مرة أخرى
  event.target.value = "";
}


/* ============================================================
   🧠 6) التحليل الذكي الداخلي لكل قصة
============================================================ */

function classifyStoryType(name) {
  const n = name || "";

  const crimeWords = ["مقتل", "جريمة", "مذبحة", "سفّاح", "قتل", "اغتيال", "قضية", "مذبحة"];
  const intelWords = ["جاسوس", "الموساد", "مخابرات", "عملية", "عميل", "تجسس"];
  const warWords = ["حرب", "معركة", "غزوة", "الاستنزاف", "أكتوبر", "نكسة", "عملية"];
  const politicsWords = ["رئيس", "ملك", "حكومة", "رئاسة", "انقلاب", "ثورة"];
  const disasterWords = ["كارثة", "مأساة", "اختفاء", "حادثة", "انفجار", "تحطم"];
  const biographyWords = ["فنان", "ممثلة", "كاتب", "عالم", "مفكر", "شيخ", "داعية", "قاريء", "منشد"];
  const historyWords = ["الفرعونية", "التتار", "المغول", "صلاح الدين", "قطز", "تاريخ", "الخلافة"];

  const lower = n.toLowerCase();
  const has = arr => arr.some(w => n.includes(w) || lower.includes(w.toLowerCase()));

  if (has(crimeWords)) return "جريمة";
  if (has(intelWords)) return "مخابرات";
  if (has(warWords)) return "حرب";
  if (has(politicsWords)) return "سياسة";
  if (has(disasterWords)) return "كارثة";
  if (has(biographyWords)) return "سيرة ذاتية";
  if (has(historyWords)) return "تاريخ";

  return "سيرة/تاريخ";
}

function estimateSaturation(name) {
  const n = name || "";
  const veryFamousWords = [
    "أم كلثوم", "عبدالحليم", "نجيب محفوظ", "جمال عبدالناصر",
    "هتلر", "غاندي", "صدام حسين", "محمد مرسي", "معمر القذافي"
  ];
  const mediumWords = [
    "هواري بومدين", "الملك فيصل", "سعد زغلول", "طلعت حرب",
    "عمر المختار", "مصطفى محمود", "صلاح نصر"
  ];

  if (veryFamousWords.some(w => n.includes(w))) return "High";
  if (mediumWords.some(w => n.includes(w))) return "Medium";
  return "Low";
}

function estimateAttractiveness(story) {
  const n = story.name || "";
  const base = story.score ?? 70;
  let extra = 0;

  if (/اغتيال|مقتل|جريمة|سفّاح|اختفاء|كارثة/.test(n)) extra += 15;
  if (/رئيس|ملك|زعيم|ثورة|انقلاب/.test(n)) extra += 10;
  if (/سر|لغز|اختفاء|مأساة/.test(n)) extra += 10;

  let result = base + extra;
  if (result > 100) result = 100;
  if (result < 0) result = 0;
  return Math.round(result);
}

function estimateViralChance(story, trendState, attractiveness) {
  let viral = attractiveness;
  const name = story.name || "";

  if (trendState.googleTrends && trendState.googleTrends.length) {
    const hit = trendState.googleTrends.some(t => name.includes(t.keyword));
    if (hit) viral += 10;
  }

  if (trendState.youtubeTrends && trendState.youtubeTrends.length) {
    const hit = trendState.youtubeTrends.some(v => name.includes(v.keyword));
    if (hit) viral += 10;
  }

  if (viral > 100) viral = 100;
  if (viral < 0) viral = 0;
  return Math.round(viral);
}

function estimateTrendMatching(story, trendState) {
  const name = story.name || "";
  let score = 0;

  if (trendState.googleTrends && trendState.googleTrends.length) {
    trendState.googleTrends.forEach(t => {
      if (name.includes(t.keyword)) score += 15;
    });
  }

  if (trendState.youtubeTrends && trendState.youtubeTrends.length) {
    trendState.youtubeTrends.forEach(v => {
      if (name.includes(v.keyword)) score += 10;
    });
  }

  if (score > 100) score = 100;
  return Math.round(score);
}

function estimateAudienceMatch(storyType) {
  switch (storyType) {
    case "سيرة ذاتية":
    case "سيرة/تاريخ":
      return 90;
    case "جريمة":
      return 95;
    case "مخابرات":
      return 100;
    case "سياسة":
      return 95;
    case "حرب":
      return 85;
    case "كارثة":
      return 80;
    case "تاريخ":
      return 80;
    default:
      return 75;
  }
}

function estimateCompetitionLevel(saturation) {
  switch (saturation) {
    case "High":
      return 80;
    case "Medium":
      return 60;
    case "Low":
    default:
      return 40;
  }
}

function estimateBestFormat(storyType, saturation, viralChance) {
  if (storyType === "جريمة" || storyType === "كارثة" || storyType === "مخابرات") {
    if (viralChance >= 80) return "الاثنين";
    return "قصير";
  }
  if (storyType === "سيرة ذاتية" || storyType === "تاريخ" || storyType === "حرب" || storyType === "سياسة") {
    if (saturation === "High" && viralChance < 70) return "قصير";
    return "طويل";
  }
  return "الاثنين";
}

function computeIntelligenceScore(story, metrics) {
  const baseScore = story.score ?? 70;
  const { viralChance, trendMatching, audienceMatch, competitionLevel } = metrics;

  const competitionPenalty = (competitionLevel / 100) * 20; // حد أقصى 20 نقطة خصم

  let result =
    baseScore * 0.3 +
    viralChance * 0.25 +
    trendMatching * 0.2 +
    audienceMatch * 0.25 -
    competitionPenalty;

  if (result > 100) result = 100;
  if (result < 0) result = 0;

  return Math.round(result);
}

function analyzeStory(story, trendState) {
  const type = classifyStoryType(story.name);
  const attractiveness = estimateAttractiveness(story);
  const saturation = estimateSaturation(story.name);
  const viralChance = estimateViralChance(story, trendState, attractiveness);
  const trendMatching = estimateTrendMatching(story, trendState);
  const audienceMatch = estimateAudienceMatch(type);
  const competitionLevel = estimateCompetitionLevel(saturation);
  const bestFormat = estimateBestFormat(type, saturation, viralChance);

  const intelligenceScore = computeIntelligenceScore(story, {
    viralChance,
    trendMatching,
    audienceMatch,
    competitionLevel
  });

  const analysis = {
    type,
    attractiveness,
    viralChance,
    saturation,
    bestFormat,
    expectationScore: intelligenceScore,
    viralProbability: viralChance,
    trendMatching,
    audienceMatch,
    competitionLevel,
    intelligenceScore,
    intelligenceLabel: `درجة الذكاء: ${intelligenceScore}/100`
  };

  story.analysis = analysis;
  return analysis;
}

function ensureStoryAnalysis(story) {
  if (!story.analysis) {
    return analyzeStory(story, trendState);
  }
  return story.analysis;
}


/* ============================================================
   👁 7) عرض تحليل قصة في لوحة الذكاء
============================================================ */

function showStoryAnalysis(story) {
  const a = ensureStoryAnalysis(story);

  const html = `
    <h3>📌 تحليل قصة: <span class="ai-title">${story.name}</span></h3>
    <ul class="ai-list">
      <li><strong>نوع القصة:</strong> ${a.type}</li>
      <li><strong>عامل الجاذبية:</strong> ${a.attractiveness} / 100</li>
      <li><strong>فرصة الانفجار (Viral Chance):</strong> ${a.viralChance}%</li>
      <li><strong>مستوى التشبع:</strong> ${a.saturation}</li>
      <li><strong>أفضل شكل فيديو:</strong> ${a.bestFormat}</li>
      <li><strong>Trend Matching:</strong> ${a.trendMatching} / 100</li>
      <li><strong>Audience Match:</strong> ${a.audienceMatch} / 100</li>
      <li><strong>Competition Level:</strong> ${a.competitionLevel} / 100</li>
      <li><strong>درجة الذكاء:</strong> ${a.intelligenceScore} / 100</li>
    </ul>
  `;

  elements.aiOutput.innerHTML = html;
}


/* ============================================================
   🌍 8) الاتصال بالسيرفر الوسيط (تريندات + وفيات)
============================================================ */

async function callMiddleware(endpoint, fallbackData = []) {
  try {
    if (!API_CONFIG.baseUrl || API_CONFIG.baseUrl.includes("your-middleware")) {
      console.warn("⚠ لم يتم إعداد السيرفر الوسيط بعد. يتم استخدام بيانات تجريبية.");
      return fallbackData;
    }

    const url = API_CONFIG.baseUrl + endpoint;
    const res = await fetch(url);
    if (!res.ok) throw new Error("API error: " + res.status);
    const data = await res.json();
    return data;
  } catch (err) {
    console.error("Middleware error:", err);
    return fallbackData;
  }
}

async function fetchGoogleTrends() {
  const fallback = [
    { keyword: "حرب غزة", score: 98 },
    { keyword: "اغتيال", score: 87 },
    { keyword: "انقلاب عسكري", score: 76 }
  ];
  const data = await callMiddleware(API_CONFIG.googleTrendsEndpoint, fallback);
  trendState.googleTrends = data;
  trendState.lastUpdated = new Date().toISOString();
  elements.statusTrends.textContent = "✅ تم تحديث تريندات Google";
  elements.statusTrends.classList.remove("muted");
  elements.statusTrends.classList.add("success");
}

async function fetchYoutubeTrends() {
  const fallback = [
    { keyword: "وثائقي", views: 1000000, velocity: 90 },
    { keyword: "قصة حقيقية", views: 750000, velocity: 80 },
    { keyword: "قضية قتل", views: 500000, velocity: 85 }
  ];
  const data = await callMiddleware(API_CONFIG.youtubeTrendsEndpoint, fallback);
  trendState.youtubeTrends = data;
  trendState.lastUpdated = new Date().toISOString();
  elements.statusYoutube.textContent = "✅ تم تحديث تريندات YouTube";
  elements.statusYoutube.classList.remove("muted");
  elements.statusYoutube.classList.add("success");
}

async function fetchRecentDeaths() {
  const fallback = [
    { name: "شخصية سياسية عربية (افتراضية)", relevance: 80 },
    { name: "فنان عربي (افتراضي)", relevance: 70 }
  ];
  const data = await callMiddleware(API_CONFIG.deathsEndpoint, fallback);
  trendState.deaths = data;
  trendState.lastUpdated = new Date().toISOString();
  elements.statusDeaths.textContent = "✅ تم تحديث بيانات الوفيات";
  elements.statusDeaths.classList.remove("muted");
  elements.statusDeaths.classList.add("success");
}

async function handleUpdateTrends() {
  elements.aiOutput.innerHTML = "<p>⏳ يتم الآن تحديث تريندات Google و YouTube والوفيات الأخيرة...</p>";

  await Promise.all([
    fetchGoogleTrends(),
    fetchYoutubeTrends(),
    fetchRecentDeaths()
  ]);

  elements.aiOutput.innerHTML = `
    <h3>✅ تم تحديث التريندات</h3>
    <p>يمكنك الآن اختيار قصة لفيديو طويل أو قصير اعتمادًا على أحدث المعطيات.</p>
  `;
}


/* ============================================================
   🌐 9) الاتصال بـ Worker الترندات (Story API)
============================================================ */

function normalizeText(str) {
  return (str || "")
    .toString()
    .trim()
    .replace(/\s+/g, "")
    .toLowerCase();
}

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
    storyTrendCache.lastUpdated = new Date().toISOString();
    return data;
  } catch (err) {
    console.error("Story Worker API error:", err);
    elements.aiOutput.innerHTML = "<p>⚠ تعذر الاتصال بسيرفر الترندات (Worker). تأكد من رابط storyBaseUrl في الكود.</p>";
    return null;
  }
}

// تفريغ بيانات الـ Worker إلى عناصر واضحة (عنوان / دولة / نوع / وزن)
function flattenWorkerResults(workerData) {
  if (!workerData || !Array.isArray(workerData.countries)) return [];

  const items = [];

  workerData.countries.forEach(countryObj => {
    const countryCode = countryObj.code || countryObj.country_code;
    const countryName = countryObj.country;
    const storyGroups = countryObj.stories || [];

    storyGroups.forEach(group => {
      const groupWeight = group.weight ?? (
        (Array.isArray(group.google) ? group.google.length : 0) * 0.8 +
        (Array.isArray(group.youtube) ? group.youtube.length : 0) * 0.2
      );

      // نتائج Google
      (group.google || []).forEach(g => {
        items.push({
          title: g.title,
          link: g.link,
          snippet: g.snippet || "",
          source: "google",
          countryCode,
          country: countryName,
          score: groupWeight * 0.8
        });
      });

      // نتائج YouTube
      (group.youtube || []).forEach(y => {
        items.push({
          title: y.title,
          link: y.link,
          views: y.views || "",
          published: y.published || "",
          source: "youtube",
          countryCode,
          country: countryName,
          score: groupWeight * 0.2
        });
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
    const key = normalizeText(it.title);
    const count = map.get(key) || 0;
    if (count < maxPerTitle) {
      result.push(it);
      map.set(key, count + 1);
    }
  });

  return result;
}

// تصنيف مناسب لريلز بناء على العنوان فقط
function isTitleShortFriendly(title) {
  const t = title || "";
  return /جريمة|قتل|مقتل|اغتيال|اختفاء|اختطاف|كارثة|فضيحة|سر|لغز|صادم|انفجار|تحطم/.test(t);
}


/* ============================================================
   🎬 10) دوال الوزن القديمة (ما زالت مفيدة)
============================================================ */

function computeStoryWeightForLong(story) {
  const a = ensureStoryAnalysis(story);

  const ageDays = (() => {
    if (!story.added) return 0;
    const d = new Date(story.added);
    if (Number.isNaN(d.getTime())) return 0;
    const diff = Date.now() - d.getTime();
    return diff / (1000 * 60 * 60 * 24);
  })();

  const recencyFactor = ageDays < 7 ? 1.2 : ageDays < 30 ? 1.0 : 0.9;

  let saturationPenalty = 1;
  if (a.saturation === "High") saturationPenalty = 0.8;
  if (a.saturation === "Medium") saturationPenalty = 0.9;

  const trendBoost = 1 + (a.trendMatching / 200); // لو 100 → +0.5

  const weight =
    (a.intelligenceScore * 0.4 +
      a.viralChance * 0.25 +
      (story.score ?? 70) * 0.2 +
      a.audienceMatch * 0.15) *
    recencyFactor *
    saturationPenalty *
    trendBoost;

  return weight;
}

function weightedRandomChoice(items, weights) {
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total <= 0) return items[0];

  const r = Math.random() * total;
  let acc = 0;
  for (let i = 0; i < items.length; i++) {
    acc += weights[i];
    if (r <= acc) return items[i];
  }
  return items[items.length - 1];
}


/* ============================================================
   🎬 11) زر 1: اختيار قصة فيديو طويل وفقًا للترند (من الـ Worker)
       (اختيار قصة فيديو طويل وفقا للترند)
============================================================ */

async function handlePickToday() {
  elements.aiOutput.innerHTML = "<p>⏳ يتم الآن جلب كل نتائج البحث من Worker الترندات...</p>";

  const data = await fetchStoryTrendsAll();
  if (!data) return;

  const items = flattenWorkerResults(data);
  if (!items.length) {
    elements.aiOutput.innerHTML = "<p>⚠ لا توجد نتائج ترند متاحة حاليًا من الـ Worker.</p>";
    return;
  }

  // تجميع حسب الدولة
  const byCountry = {};
  items.forEach(it => {
    const key = it.countryCode || it.country;
    if (!byCountry[key]) {
      byCountry[key] = {
        country: it.country,
        items: []
      };
    }
    byCountry[key].items.push(it);
  });

  // ترتيب داخل كل دولة حسب score، وتحديد أفضل 10 فقط لكل دولة
  Object.values(byCountry).forEach(group => {
    group.items.sort((a, b) => b.score - a.score);
    group.items = dedupeByTitle(group.items).slice(0, 10);
  });

  const htmlParts = [
    "<h2>🎥 كل نتائج الترند الحالية (حسب الدول العربية)</h2>",
    `<p>عدد الدول: <strong>${Object.keys(byCountry).length}</strong> – تم الدمج بنسبة <strong>80% Google + 20% YouTube</strong>.</p>`
  ];

  Object.values(byCountry).forEach(group => {
    htmlParts.push(`<h3>🌍 ${group.country}</h3>`);
    htmlParts.push("<ol>");
    group.items.forEach(it => {
      htmlParts.push(`
        <li>
          <strong>[${it.source === "google" ? "Google" : "YouTube"}]</strong>
          <span>${it.title}</span>
          <br>
          <a href="${it.link}" target="_blank" rel="noopener">🔗 فتح الرابط</a>
        </li>
      `);
    });
    htmlParts.push("</ol>");
  });

  elements.aiOutput.innerHTML = htmlParts.join("");
}


/* ============================================================
   🎬 12) زر 2: اختيار قصة عشوائية مسجّلة بالموقع (فيديو طويل)
        (اختيار قصة عشوائية مسجلة بالموقع (فيديو طويل))
============================================================ */

// حساب عدد مرات ظهور عنوان القصة داخل نتائج الـ Worker
function computeStoryHitCountFromTrends(story, trendItems) {
  const normName = normalizeText(story.name);
  if (!normName || !trendItems.length) return 0;

  let hits = 0;
  trendItems.forEach(it => {
    const normTitle = normalizeText(it.title);
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
    const baseLongWeight = computeStoryWeightForLong(story); // من 0 إلى ~100

    // المعامل النهائي: 60% تقييمك + ذكاء القصة + 40% الترند (HitScore)
    const finalWeight = baseLongWeight * 0.6 + hitScore * 0.4;

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
        const normTitle = normalizeText(it.title);
        const normName = normalizeText(story.name);
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
   ⚡ 13) زر 3: اختيار فيديو (ريلز) من الترند
        (اختيار فيديو (ريلز) من الترند)
============================================================ */

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
  const storyNamesNorm = stories.map(st => normalizeText(st.name));

  items = items.filter(it => {
    const normTitle = normalizeText(it.title);
    if (!normTitle) return false;

    const existsInLocal = storyNamesNorm.some(n => n && (normTitle.includes(n) || n.includes(normTitle)));
    if (existsInLocal) return false;

    // نريد فقط العناوين السريعة (جرائم / اختفاء / صدمة...)
    return isTitleShortFriendly(it.title);
  });

  if (!items.length) {
    elements.aiOutput.innerHTML = "<p>⚠ لا توجد قصص ترند مناسبة للريلز وغير مسجّلة عندك حاليًا.</p>";
    return;
  }

  // ترتيب حسب score (80% جوجل + 20% يوتيوب متضمنة في score الأصلي)
  items.sort((a, b) => b.score - a.score);
  items = dedupeByTitle(items);
  const top5 = items.slice(0, 5);

  const htmlParts = [
    "<h2>⚡ أفضل 5 أفكار ريلز من الترند الحالي</h2>",
    "<p>تم اختيار هذه القصص بنسبة وزن <strong>80% Google + 20% YouTube</strong>، مع استبعاد القصص المسجّلة بالفعل في موقعك.</p>",
    "<ol>"
  ];

  top5.forEach(it => {
    const metaDuration = Math.floor(45 + Math.random() * 45); // بين 45 و 90 ثانية
    const hashtags = [
      "إيه_الحكاية",
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
   🧠 14) تهيئة الأحداث وتشغيل التطبيق
============================================================ */

function initEventListeners() {
  if (elements.btnParseRaw) {
    elements.btnParseRaw.addEventListener("click", parseRawStories);
  }
  if (elements.btnExport) {
    elements.btnExport.addEventListener("click", exportStories);
  }
  if (elements.inputImport) {
    elements.inputImport.addEventListener("change", handleImportFile);
  }

  // 🔘 الأزرار الثلاثة الرئيسية أعلى الصفحة
  if (elements.btnPickToday) {
    elements.btnPickToday.addEventListener("click", handlePickToday);
  }
  if (elements.btnPickLong) {
    elements.btnPickLong.addEventListener("click", handlePickLong);
  }
  if (elements.btnPickShort) {
    elements.btnPickShort.addEventListener("click", handlePickShort);
  }

  if (elements.btnUpdateTrends) {
    elements.btnUpdateTrends.addEventListener("click", handleUpdateTrends);
  }
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
