/* ============================================================
   📦 1) الإعدادات العامة – API و الكونستانت
============================================================ */

const API_CONFIG = {
  // حط هنا رابط السيرفر الوسيط لما تجهزه (Netlify Functions / Cloudflare Worker / أي Backend)
  baseUrl: "https://your-middleware-domain.com", // TODO: عدّل ده لاحقًا
  googleTrendsEndpoint: "/api/google-trends",
  youtubeTrendsEndpoint: "/api/youtube-trends",
  deathsEndpoint: "/api/recent-deaths"
};

const ARAB_COUNTRIES = [
  "EG", "SA", "AE", "KW", "QA", "BH", "OM", "JO", "LB", "SY", "IQ",
  "YE", "PS", "SD", "LY", "TN", "DZ", "MA", "MR", "SO", "DJ", "KM"
];

const LOCAL_STORAGE_KEY = "eyelhekaya_stories_v1";
const TODAY = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

// حالة التريندات
const trendState = {
  googleTrends: [],
  youtubeTrends: [],
  deaths: [],
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
  btnPickToday: document.getElementById("btn-pick-today"),
  btnPickLong: document.getElementById("btn-pick-long"),
  btnPickShort: document.getElementById("btn-pick-short"),
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
   🎬 9) اختيار قصة اليوم + فيديو طويل
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

function suggestTitlesForStory(story, analysis) {
  const baseName = story.name;
  const type = analysis.type;
  const variants = [];

  if (type === "جريمة" || type === "مخابرات" || /جاسوس|عملية/.test(baseName)) {
    variants.push(
      `حكاية ${baseName}… القصة الكاملة التي لم تُروَ من قبل`,
      `${baseName}… من الأرشيف السري إلى الشاشة`,
      `${baseName}… أخطر ملف مخابراتي في تاريخنا الحديث؟`
    );
  } else if (type === "سيرة ذاتية" || type === "سيرة/تاريخ") {
    variants.push(
      `${baseName}… الوجه الآخر الذي لا يعرفه أحد`,
      `${baseName}… قصة صعود وسقوط نجم استثنائي`,
      `${baseName}… الحكاية من أول مشهد لآخر نفس`
    );
  } else if (type === "سياسة" || type === "حرب") {
    variants.push(
      `${baseName}… قرارات غيّرت وجه المنطقة`,
      `${baseName}… كيف بدأ كل شيء؟`,
      `${baseName}… الأسرار وراء الكواليس`
    );
  } else {
    variants.push(
      `${baseName}… القصة الحقيقية`,
      `القصة الكاملة لـ ${baseName}`,
      `${baseName}… ما الذي حدث فعلاً؟`
    );
  }

  return variants;
}

function suggestKeywordsForStory(story, analysis) {
  const name = story.name;
  const type = analysis.type;

  const base = [
    "إيه الحكاية",
    "قصة حقيقية",
    "وثائقي عربي",
    "قصص مشوقة",
    "قناة إيه الحكاية"
  ];

  if (type === "جريمة") {
    base.push("جرائم حقيقية", "قصة جريمة", "جريمة غامضة", "قصة قتل");
  }
  if (type === "مخابرات") {
    base.push("قصص مخابرات", "جاسوس", "الموساد", "المخابرات المصرية");
  }
  if (type === "سيرة ذاتية" || type === "سيرة/تاريخ") {
    base.push("سيرة ذاتية", "حياة الفنانين", "قصة حياة");
  }
  if (type === "سياسة") {
    base.push("قصة سياسية", "تاريخ سياسي", "زعماء العرب");
  }
  if (type === "حرب" || type === "تاريخ") {
    base.push("حروب", "تاريخ العرب", "قصة حرب");
  }

  base.push(name);

  return [...new Set(base)];
}

function estimateViewRange(analysis) {
  const iq = analysis.intelligenceScore;
  const viral = analysis.viralChance;

  const baseMin = 5000;
  let multiplier = iq / 80 + viral / 120;

  if (multiplier < 0.8) multiplier = 0.8;
  if (multiplier > 3) multiplier = 3;

  const minViews = Math.round(baseMin * multiplier);
  const maxViews = Math.round(minViews * (1.8 + viral / 200));

  return { minViews, maxViews };
}

function buildStrengthsAndWeaknesses(analysis) {
  const strengths = [];
  const weaknesses = [];

  if (analysis.viralChance >= 80) strengths.push("فرصة عالية للانتشار (Viral) على المنصات.");
  if (analysis.audienceMatch >= 85) strengths.push("متناسبة جدًا مع جمهور قناة \"إيه الحكاية؟\".");
  if (analysis.trendMatching >= 60) strengths.push("مرتبطة جزئيًا بتريندات حالية أو متجددة.");
  if (analysis.saturation === "Low") strengths.push("القصة غير مستهلكة بالكامل على يوتيوب.");

  if (analysis.saturation === "High") weaknesses.push("الموضوع متشبع إلى حد كبير على يوتيوب.");
  if (analysis.trendMatching < 40) weaknesses.push("القصة ليست مرتبطة بقوة بتريندات اللحظة الحالية.");
  if (analysis.intelligenceScore < 80) weaknesses.push("تحتاج معالجة بصرية وسينمائية قوية لتعويض المنافسة.");

  if (!strengths.length) strengths.push("قابلة للتقديم بأسلوب مختلف يخدم هوية القناة.");
  if (!weaknesses.length) weaknesses.push("لا توجد نقاط ضعف جوهرية، فقط تحتاج تنفيذًا عالي الجودة.");

  return { strengths, weaknesses };
}

function describeYoutubeFit(analysis) {
  let text = "";

  if (analysis.intelligenceScore >= 90) {
    text = "القصة متوافقة جدًا مع خوارزمية يوتيوب لو تم تنفيذها بصريًا وصوتيًا بجودة عالية، مع عنوان جذاب وصورة مصغرة قوية.";
  } else if (analysis.intelligenceScore >= 80) {
    text = "القصة مناسبة جدًا ليوتيوب، مع فرصة جيدة للحصول على دفع من خوارزمية التوصيات، خاصة لو تم تقسيمها إلى مشاهد مشوقة.";
  } else {
    text = "القصة تحتاج معالجة أذكى في العنوان والصورة المصغرة وبناء السرد القصصي حتى تحصل على فرصة أعلى في اقتراحات يوتيوب.";
  }

  if (analysis.saturation === "High") {
    text += " لكن يجب الانتباه لمستوى التشبع والبحث عن زاوية مختلفة تمامًا عن الموجود.";
  }

  return text;
}

function buildThumbnailIdea(story, analysis) {
  const name = story.name;
  const type = analysis.type;

  if (type === "جريمة") {
    return `لقطة سينمائية مظلمة لشارع أو غرفة تحقيق، وفي المنتصف صورة بورتريه للشخصية الأساسية مع عنوان كبير باللون الأحمر: «${name}» وخلفية فيها تدرجات حمراء/سوداء تعكس التوتر والخطر.`;
  }
  if (type === "مخابرات") {
    return `خريطة أو مستندات سرية ممزقة مع صورة ظلية لعميل مجهول وعيون تراقب من الخلفية، واسم «${name}» بخط واضح مع كلمة مثل «الملف السري» أو «قصة الجاسوس».`;
  }
  if (type === "سيرة ذاتية" || type === "سيرة/تاريخ") {
    return `بورتريه واضح للشخصية في المنتصف، مع تقسيم الشاشة إلى نصفين: جانب يكشف المجد والنجاح وجانب آخر مظلم يعكس المعاناة أو النهاية، وكتابة «الحكاية اللي محدش قالها» مع اسم «${name}».`;
  }
  if (type === "سياسة" || type === "حرب") {
    return `خريطة أو علم الدولة المرتبط بها الحدث في الخلفية، وصورة للزعيم أو الشخصية السياسية في المقدمة، مع عناصر مثل دخان أو نيران خفيفة تعبر عن الصراع، واسم «${name}» بخط جريء وواضح.`;
  }
  return `صورة تعبيرية قريبة من أجواء القصة، مع إبراز اسم «${name}» في المنتصف، واستخدام ألوان متباينة (أصفر/أسود أو أحمر/أسود) مع لمسة درامية بسيطة.`;
}

function handlePickToday() {
  const candidates = stories.filter(s => !s.done);
  if (!candidates.length) {
    elements.aiOutput.innerHTML = "<p>⚠ لا توجد قصص متاحة (أو أن جميع القصص تم تنفيذها).</p>";
    return;
  }

  const weights = candidates.map(st => computeStoryWeightForLong(st));

  const sorted = candidates
    .map((st, idx) => ({ story: st, weight: weights[idx] }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5);

  const topStories = sorted.map(x => x.story);
  const topWeights = sorted.map(x => x.weight);

  const chosen = weightedRandomChoice(topStories, topWeights);
  const analysis = ensureStoryAnalysis(chosen);
  const titles = suggestTitlesForStory(chosen, analysis);
  const keywords = suggestKeywordsForStory(chosen, analysis);
  const { minViews, maxViews } = estimateViewRange(analysis);
  const { strengths, weaknesses } = buildStrengthsAndWeaknesses(analysis);
  const youtubeFitText = describeYoutubeFit(analysis);

  const html = `
    <h2>🗓 قصة اليوم المثالية للنشر</h2>
    <h3>القصة المختارة:</h3>
    <p class="ai-title">${chosen.name}</p>

    <h3>🎯 عناوين مقترحة (3 خيارات):</h3>
    <ol>
      <li>${titles[0]}</li>
      <li>${titles[1]}</li>
      <li>${titles[2]}</li>
    </ol>

    <h3>🤖 لماذا هذه القصة الأنسب لليوم؟</h3>
    <ul class="ai-list">
      <li>درجة الذكاء: <strong>${analysis.intelligenceScore}/100</strong></li>
      <li>عامل الجاذبية: <strong>${analysis.attractiveness}/100</strong></li>
      <li>فرصة الانفجار (Viral Chance): <strong>${analysis.viralChance}%</strong></li>
      <li>مستوى التشبع: <strong>${analysis.saturation}</strong></li>
      <li>أفضل شكل فيديو حاليًا: <strong>${analysis.bestFormat}</strong></li>
      <li>تطابق مع التريند: <strong>${analysis.trendMatching}/100</strong></li>
      <li>Audience Match: <strong>${analysis.audienceMatch}/100</strong></li>
    </ul>

    <h3>📊 توقع عدد المشاهدات لو نزلت النهاردة:</h3>
    <p>المدى التقريبي: <strong>${minViews.toLocaleString()} – ${maxViews.toLocaleString()} مشاهدة</strong> (مع تنفيذ بصري وصوتي قوي).</p>

    <h3>🧠 ملاءمتها لخوارزمية يوتيوب اليوم:</h3>
    <p>${youtubeFitText}</p>

    <h3>✅ نقاط القوة:</h3>
    <ul class="ai-list">
      ${strengths.map(s => `<li>${s}</li>`).join("")}
    </ul>

    <h3>⚠ نقاط تحتاج انتباه في التنفيذ:</h3>
    <ul class="ai-list">
      ${weaknesses.map(w => `<li>${w}</li>`).join("")}
    </ul>

    <h3>🔑 كلمات مفتاحية مقترحة للنشر اليوم:</h3>
    <p class="ai-tags">${keywords.map(k => `#${k.replace(/\s+/g, "_")}`).join(" ")}</p>

    <h3>🖼 فكرة للصورة المصغرة:</h3>
    <p>${buildThumbnailIdea(chosen, analysis)}</p>
  `;

  elements.aiOutput.innerHTML = html;
}

function handlePickLong() {
  const candidates = stories.filter(s => !s.done);
  if (!candidates.length) {
    elements.aiOutput.innerHTML = "<p>⚠ لا توجد قصص متاحة (أو أن جميع القصص تم تنفيذها).</p>";
    return;
  }

  const weights = candidates.map(st => computeStoryWeightForLong(st));

  const sorted = candidates
    .map((st, idx) => ({ story: st, weight: weights[idx] }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5);

  const topStories = sorted.map(x => x.story);
  const topWeights = sorted.map(x => x.weight);

  const chosen = weightedRandomChoice(topStories, topWeights);
  const analysis = ensureStoryAnalysis(chosen);
  const titles = suggestTitlesForStory(chosen, analysis);
  const keywords = suggestKeywordsForStory(chosen, analysis);
  const { minViews, maxViews } = estimateViewRange(analysis);
  const { strengths, weaknesses } = buildStrengthsAndWeaknesses(analysis);
  const youtubeFitText = describeYoutubeFit(analysis);

  const html = `
    <h2>🎥 ترشيح فيديو طويل</h2>
    <h3>القصة المختارة:</h3>
    <p class="ai-title">${chosen.name}</p>

    <h3>🎯 عناوين مقترحة (3 خيارات):</h3>
    <ol>
      <li>${titles[0]}</li>
      <li>${titles[1]}</li>
      <li>${titles[2]}</li>
    </ol>

    <h3>🤖 سبب اختيار هذه القصة:</h3>
    <ul class="ai-list">
      <li>درجة الذكاء: <strong>${analysis.intelligenceScore}/100</strong></li>
      <li>عامل الجاذبية: <strong>${analysis.attractiveness}/100</strong></li>
      <li>فرصة الانفجار (Viral Chance): <strong>${analysis.viralChance}%</strong></li>
      <li>مستوى التشبع: <strong>${analysis.saturation}</strong></li>
      <li>أفضل شكل فيديو: <strong>${analysis.bestFormat}</strong></li>
      <li>تطابق مع التريند: <strong>${analysis.trendMatching}/100</strong></li>
      <li>Audience Match: <strong>${analysis.audienceMatch}/100</strong></li>
    </ul>

    <h3>📊 توقع عدد المشاهدات المتوقعة:</h3>
    <p>المدى التقريبي المتوقّع: <strong>${minViews.toLocaleString()} – ${maxViews.toLocaleString()} مشاهدة</strong> (مع تنفيذ بصري وصوتي قوي).</p>

    <h3>🧠 مدى توافقها مع خوارزمية يوتيوب:</h3>
    <p>${youtubeFitText}</p>

    <h3>✅ نقاط القوة:</h3>
    <ul class="ai-list">
      ${strengths.map(s => `<li>${s}</li>`).join("")}
    </ul>

    <h3>⚠ نقاط الضعف:</h3>
    <ul class="ai-list">
      ${weaknesses.map(w => `<li>${w}</li>`).join("")}
    </ul>

    <h3>🔑 كلمات مفتاحية مقترحة:</h3>
    <p class="ai-tags">${keywords.map(k => `#${k.replace(/\s+/g, "_")}`).join(" ")}</p>

    <h3>🖼 فكرة للصورة المصغرة (Thumbnail Idea):</h3>
    <p>${buildThumbnailIdea(chosen, analysis)}</p>
  `;

  elements.aiOutput.innerHTML = html;
}


/* ============================================================
   ⚡ 10) اختيار فيديو قصير (ريلز)
============================================================ */

function isShortFriendlyStory(story) {
  const name = story.name || "";
  const type = classifyStoryType(name);

  const isCrimeOrFast =
    type === "جريمة" ||
    type === "مخابرات" ||
    type === "كارثة" ||
    /اغتيال|مقتل|سفّاح|قضية|اختطاف/.test(name);

  return isCrimeOrFast;
}

function pickShortStoryCandidate() {
  const filtered = stories.filter(s => isShortFriendlyStory(s) && !s.done);
  if (filtered.length) {
    const weights = filtered.map(st => {
      const a = ensureStoryAnalysis(st);
      return a.viralChance * 0.6 + a.attractiveness * 0.4;
    });
    return weightedRandomChoice(filtered, weights);
  }
  return null;
}

function generateExternalShortIdeas() {
  const arabIdeas = [
    "جريمة غامضة في حي شعبي عربي انتهت بحكم صادم",
    "قصة مسؤول عربي كبير سقط بسبب مكالمة مسرّبة",
    "اختفاء ناشط عربي في ظروف غامضة وظهور أسرار خطيرة لاحقًا",
    "فضيحة تجسس عربية تم التستر عليها سنوات طويلة",
    "حادثة تحطم طائرة عربية غيّرت قوانين الطيران في المنطقة"
  ];

  const globalIdeas = [
    "قصة أخطر عملية سرقة بنك في التاريخ الحديث",
    "قضية اختفاء طائرة عالمية لا زالت لغزًا حتى اليوم"
  ];

  const chosenArab = arabIdeas[Math.floor(Math.random() * arabIdeas.length)];
  const chosenGlobal = globalIdeas[Math.floor(Math.random() * globalIdeas.length)];

  return {
    arab: chosenArab,
    global: chosenGlobal
  };
}

function buildShortVideoMetadata(titleCore) {
  const durationSec = Math.floor(45 + Math.random() * 45); // بين 45 و 90 ثانية
  const hashtags = [
    "إيه_الحكاية",
    "قصص_حقيقية",
    "ريلز",
    "shorts",
    "وثائقيات",
    "قصة_اليوم"
  ];
  const desc = `قصة قصيرة مشوقة عن: ${titleCore}.\nتابع قناة "إيه الحكاية؟" للمزيد من القصص الحقيقية المشوقة.`;

  return {
    durationSec,
    hashtags,
    description: desc
  };
}

function handlePickShort() {
  const candidate = pickShortStoryCandidate();
  const { arab, global } = generateExternalShortIdeas();

  const selectedTitle = candidate ? candidate.name : arab;
  const analysis = candidate ? ensureStoryAnalysis(candidate) : null;
  const meta = buildShortVideoMetadata(selectedTitle);

  const reasonLines = [];
  if (analysis) {
    reasonLines.push(`• نوع القصة: ${analysis.type}`);
    reasonLines.push(`• عامل الجاذبية: ${analysis.attractiveness}/100`);
    reasonLines.push(`• فرصة الانفجار (Viral): ${analysis.viralChance}%`);
    reasonLines.push(`• مستوى التشبع: ${analysis.saturation}`);
    reasonLines.push("• مناسبة جدًا لريلز/Shorts بسبب سرعة الحدث وقوة الحبكة.");
  } else {
    reasonLines.push("• القصة المقترحة مبنية على نمط رائج في الريلز (جرائم/اختفاءات/انفجارات سريعة).");
  }

  const html = `
    <h2>⚡ ترشيح فيديو قصير (ريلز)</h2>

    <h3>📌 قصة قصيرة جاهزة للنشر:</h3>
    <p class="ai-title">${selectedTitle}</p>

    <h3>📝 عنوان مقترح:</h3>
    <p>«${selectedTitle}… الحكاية في أقل من دقيقة»</p>

    <h3>📄 وصف مقترح:</h3>
    <p>${meta.description}</p>

    <h3>🏷 هاشتاجات مقترحة:</h3>
    <p class="ai-tags">${meta.hashtags.map(h => "#" + h).join(" ")}</p>

    <h3>⏱ مدة الفيديو المقترحة:</h3>
    <p>${meta.durationSec} ثانية تقريبًا.</p>

    <h3>🧠 سبب قوة هذا الموضوع:</h3>
    <ul class="ai-list">
      ${reasonLines.map(r => `<li>${r}</li>`).join("")}
    </ul>

    <hr>

    <h3>💡 قصص جديدة مقترحة (غير موجودة في القائمة حاليًا):</h3>
    <ul class="ai-list">
      <li>قصة عربية (85%): ${arab}</li>
      <li>قصة عالمية (15%): ${global}</li>
    </ul>
  `;

  elements.aiOutput.innerHTML = html;
}


/* ============================================================
   🧠 11) تهيئة الأحداث وتشغيل التطبيق
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
