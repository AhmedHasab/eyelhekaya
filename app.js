// ===============================
// app.js – قلب واجهة "ذكاء اختيار القصص"
// ===============================

// مفاتيح التخزين المحلي (LocalStorage)
const STORAGE_KEYS = {
  STORIES: "hk_stories_v1",
  TRENDS_CACHE: "hk_trends_cache_v1" // نخزن فيه نتائج التريند لمدة 24 ساعة
};

// مراجع DOM أساسية
const aiOutputEl = document.getElementById("ai-output");
const storiesTbodyEl = document.getElementById("stories-tbody");
const rawInputEl = document.getElementById("raw-input");
const manualNameEl = document.getElementById("manual-name");
const manualTypeEl = document.getElementById("manual-type");
const manualScoreEl = document.getElementById("manual-score");
const manualNotesEl = document.getElementById("manual-notes");
const importFileEl = document.getElementById("import-file");
const storiesSearchEl = document.getElementById("stories-search");

// أزرار التحكم في العرض
const aiPanelEl = document.querySelector(".ai-panel");
const storiesPanelEl = document.querySelector(".stories-panel");

const btnPickToday = document.getElementById("btn-pick-today");   // فيديو طويل من التريند
const btnPickLong = document.getElementById("btn-pick-long");     // قصة عشوائية من قاعدة البيانات
const btnPickShort = document.getElementById("btn-pick-short");   // ريلز من التريند
const btnUpdateTrends = document.getElementById("btn-update-trends");

const btnShowStoriesOnly = document.getElementById("btn-show-stories-only");
const btnShowBoth = document.getElementById("btn-show-both");
const btnShowAiOnly = document.getElementById("btn-show-ai-only");

const btnParseRaw = document.getElementById("btn-parse-raw");
const btnAddManual = document.getElementById("btn-add-manual");
const btnExport = document.getElementById("btn-export");

// Status pills
const statusTrendsEl = document.getElementById("status-trends");
const statusYoutubeEl = document.getElementById("status-youtube");
const statusDeathsEl = document.getElementById("status-deaths");

// حالة التطبيق في الذاكرة
let stories = [];
let worker = null;

// فلاغ لتحديث التريند غصب عن الكاش
let forceTrendsRefresh = false;

// ===============
// أدوات مساعدة بسيطة
// ===============

// قراءة JSON من localStorage بأمان
function loadFromLocalStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    console.warn("LocalStorage read error", e);
    return fallback;
  }
}

// حفظ JSON في localStorage بأمان
function saveToLocalStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn("LocalStorage write error", e);
  }
}

// إنشاء ID جديد للقصص
function getNextStoryId() {
  if (!stories.length) return 1;
  return Math.max(...stories.map(s => s.id || 0)) + 1;
}

// فورمات التاريخ (YYYY-MM-DD)
function formatToday() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// فرق الوقت بالدقائق
function diffMinutes(fromTs, toTs) {
  return Math.round((toTs - fromTs) / (60 * 1000));
}

// ===============
// إدارة Status Pills
// ===============
function setPill(el, mode, text) {
  el.classList.remove("ok", "warn", "muted");
  el.classList.add(mode);
  el.textContent = text;
}

function refreshStatusPills() {
  const cache = loadFromLocalStorage(STORAGE_KEYS.TRENDS_CACHE, {});
  const now = Date.now();

  // الحالة العامة للتريند (محركات البحث + يوتيوب)
  if (cache.lastUpdate) {
    const mins = diffMinutes(cache.lastUpdate, now);
    if (mins < 60) {
      setPill(statusTrendsEl, "ok", `تريندات Google/Bing محدثة منذ ${mins} دقيقة`);
      setPill(statusYoutubeEl, "ok", `تريندات YouTube محدثة منذ ${mins} دقيقة`);
      setPill(statusDeathsEl, "ok", `وفيات آخر 48 ساعة متزامنة مع التريند`);
    } else if (mins < 24 * 60) {
      setPill(statusTrendsEl, "warn", `تريندات Google/Bing قديمة نسبيًا (${mins} دقيقة)`);
      setPill(statusYoutubeEl, "warn", `تريندات YouTube قديمة نسبيًا (${mins} دقيقة)`);
      setPill(statusDeathsEl, "warn", `بيانات الوفيات قديمة نسبيًا (${mins} دقيقة)`);
    } else {
      setPill(statusTrendsEl, "muted", "تريندات Google/Bing غير محدثة");
      setPill(statusYoutubeEl, "muted", "تريندات YouTube غير محدثة");
      setPill(statusDeathsEl, "muted", "وفيات آخر 48 ساعة غير محدثة");
    }
  } else {
    setPill(statusTrendsEl, "muted", "تريندات Google غير محدثة");
    setPill(statusYoutubeEl, "muted", "تريندات YouTube غير محدثة");
    setPill(statusDeathsEl, "muted", "وفيات آخر 48 ساعة غير محدثة");
  }
}

// عند استلام نتيجة جديدة من الـ Worker نحدث الكاش
function updateTrendsCacheFromWorker(payload) {
  const cache = {
    lastUpdate: Date.now(),
    // ممكن توسّع الكاش لاحقًا (long, short, randomMetrics...)
    ...payload
  };
  saveToLocalStorage(STORAGE_KEYS.TRENDS_CACHE, cache);
  refreshStatusPills();
}

// ===============
// إدارة القصص (Stories)
// ===============

// تحميل القصص أول مرة: نحاول من localStorage، لو فاضي نجيب من stories.json
async function loadStories() {
  const cached = loadFromLocalStorage(STORAGE_KEYS.STORIES, null);
  if (cached && Array.isArray(cached) && cached.length) {
    stories = cached;
    renderStoriesTable(stories);
    return;
  }

  try {
    const res = await fetch("stories.json");
    const data = await res.json();
    stories = Array.isArray(data) ? data : [];
    saveStories();
    renderStoriesTable(stories);
  } catch (err) {
    console.error("خطأ في تحميل stories.json", err);
    aiOutputEl.innerHTML = `<p>⚠ حدث خطأ في تحميل ملف القصص stories.json.</p>`;
  }
}

// حفظ القصص في localStorage
function saveStories() {
  saveToLocalStorage(STORAGE_KEYS.STORIES, stories);
}

// رسم الجدول بالكامل
function renderStoriesTable(list) {
  storiesTbodyEl.innerHTML = "";

  list.forEach((story, idx) => {
    const tr = document.createElement("tr");

    const isDone = !!story.done;

    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td>${story.name || ""}</td>
      <td>${story.category || ""}</td>
      <td>${story.score != null ? story.score : ""}</td>
      <td>${story.attraction != null ? story.attraction : "-"}</td>
      <td>${story.analysis != null ? story.analysis : "-"}</td>
      <td>
        <span class="${isDone ? "badge-done" : "badge-not-done"}">
          ${isDone ? "تم التنفيذ" : "لم تُنفذ بعد"}
        </span>
      </td>
      <td>${story.added || ""}</td>
      <td>${story.notes || ""}</td>
      <td>
        <div class="table-actions">
          <button class="btn secondary small" data-action="show" data-id="${story.id}">👁 عرض</button>
          <button class="btn secondary small" data-action="edit" data-id="${story.id}">✏ تعديل</button>
          <button class="btn secondary small" data-action="toggle" data-id="${story.id}">
            ${isDone ? "↩ إلغاء تنفيذ" : "✅ تنفيذ"}
          </button>
          <button class="btn secondary small" data-action="delete" data-id="${story.id}">🗑 حذف</button>
        </div>
      </td>
    `;

    storiesTbodyEl.appendChild(tr);
  });
}

// الحصول على Story بالـ id
function findStoryById(id) {
  return stories.find(s => String(s.id) === String(id));
}

// معالجة أزرار التحكم في كل سطر
storiesTbodyEl.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;

  const action = btn.getAttribute("data-action");
  const id = btn.getAttribute("data-id");
  const story = findStoryById(id);
  if (!story) return;

  if (action === "show") {
    showStoryDetails(story);
  } else if (action === "edit") {
    editStory(story);
  } else if (action === "delete") {
    deleteStory(story);
  } else if (action === "toggle") {
    toggleStoryDone(story);
  }
});

// عرض تفاصيل قصة واحدة داخل لوحة الذكاء
function showStoryDetails(story) {
  aiOutputEl.innerHTML = `
    <h3>📖 تفاصيل القصة: ${story.name}</h3>
    <ul>
      <li><strong>الفئة:</strong> ${story.category || "غير محددة"}</li>
      <li><strong>تقييمك الشخصي:</strong> ${story.score != null ? story.score : "غير مسجل"}</li>
      <li><strong>تم التنفيذ؟</strong> ${story.done ? "نعم" : "لا"}</li>
      <li><strong>تاريخ الإضافة:</strong> ${story.added || "غير مسجل"}</li>
      <li><strong>ملاحظات / روابط:</strong> ${story.notes || "لا يوجد"}</li>
    </ul>
  `;
}

// تعديل قصة (بشكل بسيط عن طريق prompt)
function editStory(story) {
  const newName = prompt("اسم القصة:", story.name || "");
  if (newName === null) return;

  const newCategory = prompt("نوع القصة (Category):", story.category || "");
  if (newCategory === null) return;

  const newScoreStr = prompt("تقييمك الشخصي (0-100):", story.score != null ? story.score : "80");
  if (newScoreStr === null) return;

  const newScore = Number(newScoreStr);
  if (!Number.isFinite(newScore) || newScore < 0 || newScore > 100) {
    alert("رقم التقييم غير صالح");
    return;
  }

  const newNotes = prompt("ملاحظات / روابط:", story.notes || "");
  if (newNotes === null) return;

  story.name = newName.trim();
  story.category = newCategory.trim();
  story.score = newScore;
  story.notes = newNotes.trim();

  saveStories();
  renderStoriesTable(stories);
}

// حذف قصة
function deleteStory(story) {
  if (!confirm(`هل أنت متأكد من حذف القصة "${story.name}"؟`)) return;
  stories = stories.filter(s => s.id !== story.id);
  saveStories();
  renderStoriesTable(stories);
}

// تغيير حالة التنفيذ
function toggleStoryDone(story) {
  story.done = !story.done;
  saveStories();
  renderStoriesTable(stories);
}

// ===============
// إضافة قصص
// ===============

// تحويل نص خام إلى قصص
function handleParseRaw() {
  const raw = rawInputEl.value || "";
  const lines = raw.split("\n").map(l => l.trim()).filter(Boolean);
  if (!lines.length) {
    alert("برجاء لصق نص يحتوي على سطور قصص أولًا.");
    return;
  }

  const today = formatToday();
  lines.forEach(name => {
    const story = {
      id: getNextStoryId(),
      name,
      score: 80,
      done: false,
      category: "",
      added: today,
      notes: "",
      analysis: null
    };
    stories.push(story);
  });

  saveStories();
  renderStoriesTable(stories);
  rawInputEl.value = "";
}

// إضافة قصة واحدة يدويًا
function handleAddManual() {
  const name = (manualNameEl.value || "").trim();
  const category = manualTypeEl.value || "";
  const scoreStr = manualScoreEl.value || "80";
  const notes = (manualNotesEl.value || "").trim();

  if (!name) {
    alert("اكتب اسم القصة أولًا.");
    return;
  }

  const score = Number(scoreStr);
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    alert("رقم التقييم غير صالح (0–100).");
    return;
  }

  const story = {
    id: getNextStoryId(),
    name,
    category,
    score,
    done: false,
    added: formatToday(),
    notes,
    analysis: null
  };

  stories.push(story);
  saveStories();
  renderStoriesTable(stories);

  manualNameEl.value = "";
  manualNotesEl.value = "";
  // لا نغير الفئة أو الدرجة لتسهيل إدخال أكثر من قصة في نفس الفئة
}

// ===============
// بحث + اقتراحات
// ===============
let suggestionBoxEl = null;

function ensureSuggestionBox() {
  if (suggestionBoxEl) return suggestionBoxEl;
  suggestionBoxEl = document.createElement("div");
  suggestionBoxEl.style.position = "relative";
  suggestionBoxEl.style.marginTop = "4px";

  const list = document.createElement("div");
  list.id = "stories-suggestions";
  list.style.position = "absolute";
  list.style.zIndex = "10";
  list.style.background = "#fff";
  list.style.border = "1px solid #ddd";
  list.style.borderRadius = "6px";
  list.style.width = "100%";
  list.style.maxHeight = "200px";
  list.style.overflowY = "auto";
  list.style.fontSize = "0.85rem";
  list.style.display = "none";

  suggestionBoxEl.appendChild(list);
  storiesSearchEl.parentElement.appendChild(suggestionBoxEl);
  return suggestionBoxEl;
}

function updateSuggestions(keyword) {
  ensureSuggestionBox();
  const list = document.getElementById("stories-suggestions");
  if (!keyword) {
    list.style.display = "none";
    list.innerHTML = "";
    return;
  }

  const lower = keyword.toLowerCase();
  const matches = stories
    .filter(s => (s.name || "").toLowerCase().includes(lower))
    .slice(0, 8);

  if (!matches.length) {
    list.style.display = "none";
    list.innerHTML = "";
    return;
  }

  list.innerHTML = "";
  matches.forEach(story => {
    const item = document.createElement("div");
    item.textContent = story.name;
    item.style.padding = "6px 10px";
    item.style.cursor = "pointer";
    item.addEventListener("click", () => {
      storiesSearchEl.value = story.name;
      applyStoriesSearch(story.name);
      list.style.display = "none";
    });
    list.appendChild(item);
  });

  list.style.display = "block";
}

function applyStoriesSearch(keyword) {
  const k = (keyword || "").trim().toLowerCase();
  if (!k) {
    renderStoriesTable(stories);
    return;
  }

  const filtered = stories.filter(s => {
    const name = (s.name || "").toLowerCase();
    const category = (s.category || "").toLowerCase();
    const notes = (s.notes || "").toLowerCase();
    return name.includes(k) || category.includes(k) || notes.includes(k);
  });

  renderStoriesTable(filtered);
}

storiesSearchEl.addEventListener("input", (e) => {
  const val = e.target.value;
  applyStoriesSearch(val);
  updateSuggestions(val);
});

// إخفاء الاقتراحات عند الضغط خارجها
document.addEventListener("click", (e) => {
  const list = document.getElementById("stories-suggestions");
  if (!list) return;
  if (!list.contains(e.target) && e.target !== storiesSearchEl) {
    list.style.display = "none";
  }
});

// ===============
// Export / Import
// ===============
function handleExportStories() {
  const blob = new Blob([JSON.stringify(stories, null, 2)], {
    type: "application/json;charset=utf-8"
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "stories-export.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function handleImportStories(evt) {
  const file = evt.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!Array.isArray(data)) throw new Error("صيغة الملف غير صحيحة.");

      // ممكن بعدين نعمل merge بدلاً من overwrite
      stories = data;
      saveStories();
      renderStoriesTable(stories);
      alert("✅ تم استيراد القصص بنجاح.");
    } catch (err) {
      console.error(err);
      alert("⚠ حدث خطأ في قراءة ملف الاستيراد.");
    }
  };
  reader.readAsText(file, "utf-8");
}

// ===============
// Panel Switching
// ===============
function showStoriesOnly() {
  storiesPanelEl.style.display = "block";
  aiPanelEl.style.display = "none";
}

function showAiOnly() {
  storiesPanelEl.style.display = "none";
  aiPanelEl.style.display = "block";
}

function showBothPanels() {
  storiesPanelEl.style.display = "block";
  aiPanelEl.style.display = "block";
}

btnShowStoriesOnly.addEventListener("click", showStoriesOnly);
btnShowAiOnly.addEventListener("click", showAiOnly);
btnShowBoth.addEventListener("click", showBothPanels);

// ===============
// ربط الـ Worker
// ===============

function initWorker() {
  if (!window.Worker) {
    console.warn("هذا المتصفح لا يدعم Web Workers.");
    aiOutputEl.innerHTML = `<p>⚠ متصفحك لا يدعم Web Worker، سيتم تعطيل وظائف التريند.</p>`;
    return;
  }

  worker = new Worker("trend-worker.js");

  worker.onmessage = (event) => {
    const { type, payload } = event.data || {};
    if (!type) return;

    if (type === "TREND_LONG_RESULT") {
      updateTrendsCacheFromWorker({ long: payload });
      renderTrendResult("فيديوهات طويلة من التريند", payload.items || []);
    } else if (type === "TREND_SHORT_RESULT") {
      updateTrendsCacheFromWorker({ short: payload });
      renderTrendResult("فيديوهات ريلز / قصيرة من التريند", payload.items || []);
    } else if (type === "RANDOM_STORIES_RESULT") {
      // زر القصة العشوائية – Top 10 بناءً على (40% شخصي + 60% تريند)
      renderRandomStoriesResult(payload);
    } else if (type === "ERROR") {
      aiOutputEl.innerHTML = `<p>⚠ خطأ من الـ Worker: ${payload.message}</p>`;
    }
  };
}

// رسم نتائج التريند (زر 1 و زر 2)
function renderTrendResult(title, items) {
  if (!items.length) {
    aiOutputEl.innerHTML = `<p>⚠ لم يتم العثور على نتائج مناسبة حاليًا.</p>`;
    return;
  }

  const lines = items.map((item, idx) => {
    const rank = idx + 1;
    const kind = item.category || "غير محدد";
    const source = item.source || "غير معروف";
    const country = item.country || "عام";
    const score = item.score != null ? item.score : "-";
    const urlPart = item.url
      ? `<br/><a href="${item.url}" target="_blank" rel="noopener">رابط مقترح للفيديو</a>`
      : "";

    return `
      <li>
        <strong>#${rank} – ${item.title}</strong><br/>
        <em>النوع:</em> ${kind} – <em>الدولة:</em> ${country} – <em>المصدر:</em> ${source} – <em>درجة التريند:</em> ${score}
        ${urlPart}
        ${item.reason ? `<br/><small>💡 سبب الاختيار: ${item.reason}</small>` : ""}
      </li>
    `;
  }).join("");

  aiOutputEl.innerHTML = `
    <h3>${title}</h3>
    <ol>${lines}</ol>
    <p style="font-size:0.8rem;color:#555;">
      *(يتم احتساب الترتيب تقريبًا بالاعتماد على دمج محركات البحث + YouTube خلال آخر 365 يوم، مع تفضيل الدول العربية.)*
    </p>
  `;
}

// رسم نتائج زر "قصة عشوائية" (Top 10)
function renderRandomStoriesResult(payload) {
  const { items = [], meta } = payload || {};
  if (!items.length) {
    aiOutputEl.innerHTML = `<p>⚠ لم يتم العثور على قصص مناسبة (ربما كل القصص معلّمة كـ "تم التنفيذ").</p>`;
    return;
  }

  const lines = items.map((item, idx) => {
    const rank = idx + 1;
    return `
      <li>
        <strong>#${rank} – ${item.name}</strong><br/>
        <em>الفئة:</em> ${item.category || "غير محددة"} – 
        <em>تقييمك الشخصي:</em> ${item.personalScore != null ? item.personalScore : "-"} – 
        <em>قوة التريند:</em> ${item.trendScore != null ? item.trendScore : "-"} – 
        <em>النتيجة النهائية:</em> ${item.finalScore != null ? item.finalScore : "-"}
        ${item.notes ? `<br/><small>ملاحظاتك: ${item.notes}</small>` : ""}
      </li>
    `;
  }).join("");

  const metaText = meta
    ? `<p style="font-size:0.8rem;color:#555;">تم حساب النتائج وفق المعادلة: 
        40% من تقييمك الشخصي + 60% من قوة التريند (بحث مباشر + غير مباشر من Google/Bing + YouTube).
      </p>`
    : "";

  aiOutputEl.innerHTML = `
    <h3>🎲 أفضل 10 قصص عشوائية مقترحة (جاهزة لفيديو طويل)</h3>
    <ol>${lines}</ol>
    ${metaText}
  `;
}

// ===============
// كاش التريند (24 ساعة) في الواجهة
// ===============

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function getFreshTrendsFromCache(typeKey) {
  const cache = loadFromLocalStorage(STORAGE_KEYS.TRENDS_CACHE, null);
  if (!cache || !cache.lastUpdate) return null;

  const age = Date.now() - cache.lastUpdate;
  if (age > ONE_DAY_MS) return null;

  if (typeKey === "long" && cache.long) return cache.long;
  if (typeKey === "short" && cache.short) return cache.short;
  return null;
}

// ===============
// handlers لأزرار التريند
// ===============

// زر 1 – "اختيار قصة فيديو طويل وفقا للترند"
function handlePickToday() {
  if (!worker) {
    aiOutputEl.innerHTML = `<p>⚠ الوظيفة غير متاحة لأن Web Worker غير مدعوم.</p>`;
    return;
  }

  aiOutputEl.innerHTML = `<p>⏳ جاري تحليل التريند لاختيار قصص لفيديو طويل...</p>`;

  if (!forceTrendsRefresh) {
    const cached = getFreshTrendsFromCache("long");
    if (cached) {
      renderTrendResult("فيديوهات طويلة من التريند (من الكاش خلال 24 ساعة)", cached.items || []);
      refreshStatusPills();
      return;
    }
  }

  worker.postMessage({
    type: "FETCH_TREND_LONG",
    payload: {
      // لو حبيت تبعت إعدادات إضافية هنا لاحقًا
    }
  });
}

// زر 2 – "اختيار فيديو (ريلز) من التريند"
function handlePickShort() {
  if (!worker) {
    aiOutputEl.innerHTML = `<p>⚠ الوظيفة غير متاحة لأن Web Worker غير مدعوم.</p>`;
    return;
  }

  aiOutputEl.innerHTML = `<p>⏳ جاري تحليل التريند لاختيار قصص لريلز / Shorts...</p>`;

  if (!forceTrendsRefresh) {
    const cached = getFreshTrendsFromCache("short");
    if (cached) {
      renderTrendResult("فيديوهات ريلز / قصيرة من التريند (من الكاش خلال 24 ساعة)", cached.items || []);
      refreshStatusPills();
      return;
    }
  }

  worker.postMessage({
    type: "FETCH_TREND_SHORT",
    payload: {}
  });
}

// زر 3 – "اختيار قصة عشوائية مسجلة بالموقع (فيديو طويل)"
function handlePickRandomLong() {
  if (!worker) {
    // لو مفيش Worker نعمل اختيار عشوائي بسيط من القصص
    const candidates = stories.filter(s => !s.done);
    if (!candidates.length) {
      aiOutputEl.innerHTML = `<p>⚠ لا توجد قصص متاحة (ربما كل القصص تم تنفيذها).</p>`;
      return;
    }
    const shuffled = [...candidates].sort(() => Math.random() - 0.5).slice(0, 10);
    aiOutputEl.innerHTML = `
      <h3>🎲 (نسخة بدون Worker) – 10 قصص عشوائية</h3>
      <ol>${shuffled.map(s => `<li>${s.name}</li>`).join("")}</ol>
    `;
    return;
  }

  aiOutputEl.innerHTML = `<p>⏳ جاري حساب التقييم النهائي (40% شخصي + 60% تريند) لكل قصة...</p>`;

  worker.postMessage({
    type: "FETCH_RANDOM_STORIES",
    payload: {
      stories: stories.filter(s => !s.done) // نستبعد المنفّذة
    }
  });
}

// زر "تحديث التريندات" – يعطّل الكاش مرة واحدة
function handleUpdateTrends() {
  forceTrendsRefresh = true;
  aiOutputEl.innerHTML = `<p>🔄 سيتم إعادة تحديث التريندات الآن (تجاهل الكاش لمدة 24 ساعة).</p>`;
  // نقدر نعمل نداء سريع للـ Worker لو حبيت:
  worker && worker.postMessage({ type: "UPDATE_TRENDS_SNAPSHOT" });
}

// ===============
// ربط الأحداث
// ===============
btnParseRaw.addEventListener("click", handleParseRaw);
btnAddManual.addEventListener("click", handleAddManual);
btnExport.addEventListener("click", handleExportStories);
importFileEl.addEventListener("change", handleImportStories);

btnPickToday.addEventListener("click", handlePickToday);
btnPickShort.addEventListener("click", handlePickShort);
btnPickLong.addEventListener("click", handlePickRandomLong);
btnUpdateTrends.addEventListener("click", handleUpdateTrends);

// ===============
// تهيئة التطبيق
// ===============
(async function initApp() {
  await loadStories();
  initWorker();
  refreshStatusPills();
})();
