// app.js
// ذكاء اختيار القصص – واجهة العميل (Frontend)

// ==========================
// إعدادات عامة وثوابت
// ==========================

const WORKER_URL = "https://odd-credit-25c6.namozg50.workers.dev"; // عدّلها لو غيّرت Route
const STORAGE_KEY_STORIES = "eh_story_picker_stories_v1";
const STORAGE_KEY_STATUS = "eh_story_picker_status_v1";
const STORAGE_KEY_LAYOUT = "eh_story_picker_layout_v1";
const STORAGE_KEY_AI_CACHE = "eh_story_picker_ai_cache_v1";

// عشان نمنع تنزيل Backup كل نص ثانية لو حد بيكتب بسرعة
const BACKUP_MIN_INTERVAL_MS = 15000;

// الحالة العامة
let stories = [];
let lastStoryId = 0;
let editingStoryId = null;
let lastBackupTime = 0;

// DOM Elements
let aiOutputEl,
  storiesTbodyEl,
  rawInputEl,
  manualNameEl,
  manualTypeEl,
  manualScoreEl,
  manualNotesEl,
  importFileEl,
  searchInputEl,
  statusTrendsEl,
  statusYoutubeEl,
  statusDeathsEl,
  aiPanelEl,
  storiesPanelEl,
  suggestionsBoxEl;

// ==========================
// Helpers – Normalization & تواريخ
// ==========================

// إزالة التشكيل والهمزات والنقط والرموز من أجل بحث موحّد
function normalizeArabic(str) {
  if (!str) return "";
  let s = str.toString().toLowerCase();

  // توحيد أشكال الألف
  s = s.replace(/[أإآا]/g, "ا");
  // توحيد الياء
  s = s.replace(/[ىي]/g, "ي");
  // توحيد الهاء/التاء المربوطة
  s = s.replace(/ة/g, "ه");

  // إزالة التشكيل
  s = s.replace(/[\u064B-\u0652]/g, "");

  // إزالة كل الرموز، النقط، الشرط، السلاش... إلخ
  s = s.replace(/[^\p{L}\p{N}\s]/gu, " ");

  // مسافات متتالية
  s = s.replace(/\s+/g, " ").trim();

  return s;
}

function todayISODate() {
  // تاريخ اليوم بصيغة YYYY-MM-DD
  return new Date().toISOString().slice(0, 10);
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toISOString().slice(0, 10);
}

function daysDiffFromNow(dateStr) {
  if (!dateStr) return Infinity;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return Infinity;
  const now = new Date();
  return Math.floor((now - d) / (1000 * 60 * 60 * 24));
}

// ==========================
// Auto Backup – LocalStorage + Download
// ==========================

function autoDownloadBackup() {
  const now = Date.now();
  if (now - lastBackupTime < BACKUP_MIN_INTERVAL_MS) return;
  lastBackupTime = now;

  const backupPayload = {
    createdAt: new Date().toISOString(),
    stories,
    lastStoryId,
  };

  const json = JSON.stringify(backupPayload, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  a.download = `stories-backup-${ts}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function saveStoriesToLocalStorage(triggerBackup = true) {
  const payload = {
    stories,
    lastStoryId,
  };
  localStorage.setItem(STORAGE_KEY_STORIES, JSON.stringify(payload));
  if (triggerBackup) {
    autoDownloadBackup();
  }
}

function autoLoadBackupIfExists() {
  // 1) جرّب Backup من LocalStorage
  const raw = localStorage.getItem(STORAGE_KEY_STORIES);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.stories)) {
        stories = parsed.stories;
        lastStoryId = parsed.lastStoryId || getMaxStoryId(stories);
        console.info("Loaded stories from local backup");
        renderStoriesTable(stories);
        return;
      }
    } catch (e) {
      console.warn("Failed to parse local backup, will use stories.json", e);
    }
  }

  // 2) لو مفيش أو فشل → استخدم stories.json
  fetch("stories.json")
    .then((res) => res.json())
    .then((data) => {
      if (Array.isArray(data)) {
        stories = data;
        lastStoryId = getMaxStoryId(stories);
        console.info("Loaded stories from stories.json");
        renderStoriesTable(stories);
        // خزّن نسخة فورًا محليًا
        saveStoriesToLocalStorage(false);
      }
    })
    .catch((err) => {
      console.error("Failed to load stories.json", err);
    });
}

function getMaxStoryId(list) {
  return list.reduce((max, s) => (s.id > max ? s.id : max), 0);
}

// ==========================
// AI Results Cache (24h)
// ==========================

function getAiCache() {
  const raw = localStorage.getItem(STORAGE_KEY_AI_CACHE);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function setAiCache(cache) {
  localStorage.setItem(STORAGE_KEY_AI_CACHE, JSON.stringify(cache));
}

function aiCacheKey(action) {
  const today = todayISODate();
  return `${action}:${today}`;
}

function getCachedAi(action) {
  const cache = getAiCache();
  const key = aiCacheKey(action);
  const entry = cache[key];
  if (!entry) return null;
  const ageMs = Date.now() - entry.timestamp;
  if (ageMs > 24 * 60 * 60 * 1000) return null;
  return entry.data;
}

function setCachedAi(action, data) {
  const cache = getAiCache();
  const key = aiCacheKey(action);
  cache[key] = {
    timestamp: Date.now(),
    data,
  };
  setAiCache(cache);
}

// ==========================
// Status Pills
// ==========================

function loadStatusFromLocal() {
  const raw = localStorage.getItem(STORAGE_KEY_STATUS);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveStatusToLocal(statusObj) {
  localStorage.setItem(STORAGE_KEY_STATUS, JSON.stringify(statusObj));
}

function updateStatusPill(el, text, state) {
  if (!el) return;
  el.textContent = text;
  el.classList.remove("ok", "warn", "muted");
  el.classList.add(state);
}

function refreshStatusPills() {
  const st = loadStatusFromLocal();

  // Google/Bing Trends
  if (st.trendsUpdatedAt) {
    const diff = daysDiffFromNow(st.trendsUpdatedAt);
    if (diff <= 1) {
      updateStatusPill(
        statusTrendsEl,
        `تريندات محركات البحث محدثة (${formatDate(st.trendsUpdatedAt)})`,
        "ok"
      );
    } else if (diff <= 7) {
      updateStatusPill(
        statusTrendsEl,
        `تريندات محركات البحث قديمة نسبيًا (${formatDate(
          st.trendsUpdatedAt
        )})`,
        "warn"
      );
    } else {
      updateStatusPill(
        statusTrendsEl,
        "تريندات محركات البحث غير محدثة",
        "muted"
      );
    }
  }

  // YouTube
  if (st.youtubeUpdatedAt) {
    const diff = daysDiffFromNow(st.youtubeUpdatedAt);
    if (diff <= 1) {
      updateStatusPill(
        statusYoutubeEl,
        `تريندات YouTube محدثة (${formatDate(st.youtubeUpdatedAt)})`,
        "ok"
      );
    } else if (diff <= 7) {
      updateStatusPill(
        statusYoutubeEl,
        `تريندات YouTube قديمة نسبيًا (${formatDate(
          st.youtubeUpdatedAt
        )})`,
        "warn"
      );
    } else {
      updateStatusPill(
        statusYoutubeEl,
        "تريندات YouTube غير محدثة",
        "muted"
      );
    }
  }

  // الوفيات (آخر 48 ساعة)
  if (st.deathsUpdatedAt) {
    const diff = daysDiffFromNow(st.deathsUpdatedAt);
    if (diff <= 2) {
      updateStatusPill(
        statusDeathsEl,
        `وفيات آخر 48 ساعة محدثة (${formatDate(st.deathsUpdatedAt)})`,
        "ok"
      );
    } else {
      updateStatusPill(
        statusDeathsEl,
        "وفيات آخر 48 ساعة غير محدثة",
        "muted"
      );
    }
  }
}

// ==========================
// Worker Calls
// ==========================

async function callWorker(action, payload = {}, useLocalCache = true) {
  // جرّب كاش محلي الأول
  if (useLocalCache) {
    const cached = getCachedAi(action);
    if (cached) {
      console.info(`Using cached AI result for ${action}`);
      return { fromCache: true, data: cached };
    }
  }

  try {
    const res = await fetch(WORKER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action,
        payload,
      }),
    });

    if (!res.ok) {
      throw new Error("Worker response not OK");
    }

    const data = await res.json();
    setCachedAi(action, data);
    return { fromCache: false, data };
  } catch (err) {
    console.error("Error calling worker:", err);
    throw err;
  }
}

// ==========================
// Rendering – AI Panel
// ==========================

function clearAiOutput() {
  aiOutputEl.innerHTML = "";
}

function renderTrendResults(results, { title, subtitle } = {}) {
  clearAiOutput();
  const container = document.createElement("div");

  if (title) {
    const h = document.createElement("h3");
    h.textContent = title;
    container.appendChild(h);
  }
  if (subtitle) {
    const p = document.createElement("p");
    p.textContent = subtitle;
    container.appendChild(p);
  }

  if (!results || results.length === 0) {
    const p = document.createElement("p");
    p.textContent = "لا توجد نتائج مناسبة حسب التريند والفلترة المحددة.";
    container.appendChild(p);
    aiOutputEl.appendChild(container);
    return;
  }

  results.forEach((item, index) => {
    const card = document.createElement("div");
    card.className = "trend-card";

    const rank = document.createElement("div");
    rank.className = "trend-rank";
    rank.textContent = `#${index + 1}`;
    card.appendChild(rank);

    const ttl = document.createElement("div");
    ttl.className = "trend-title";
    ttl.textContent = item.title || item.name || "عنوان غير متوفر";
    card.appendChild(ttl);

    const meta = document.createElement("div");
    meta.className = "trend-meta";
    meta.textContent =
      (item.categoryLabel || item.typeLabel || "") +
      (item.country ? ` · الدولة/المصدر: ${item.country}` : "") +
      (item.source ? ` · من: ${item.source}` : "");
    card.appendChild(meta);

    const scores = document.createElement("div");
    scores.className = "trend-scores";
    const pieces = [];
    if (typeof item.personalScore === "number") {
      pieces.push(`تقييمك الشخصي: ${item.personalScore}`);
    }
    if (typeof item.trendScore === "number") {
      pieces.push(`قوة التريند: ${item.trendScore}`);
    }
    if (typeof item.finalScore === "number") {
      pieces.push(`النتيجة النهائية: ${item.finalScore}`);
    }
    scores.textContent = pieces.join(" | ");
    card.appendChild(scores);

    if (item.summary) {
      const summary = document.createElement("p");
      summary.textContent = item.summary;
      card.appendChild(summary);
    }

    if (item.url) {
      const link = document.createElement("a");
      link.href = item.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.className = "trend-link";
      link.textContent = "🔗 قراءة/مشاهدة المزيد";
      card.appendChild(link);
    }

    const addBtn = document.createElement("button");
    addBtn.className = "add-btn";
    addBtn.textContent = "➕ إضافة هذه القصة لقائمة القصص";
    addBtn.addEventListener("click", () => {
      addStoryFromTrend(item);
    });
    card.appendChild(addBtn);

    container.appendChild(card);
  });

  aiOutputEl.appendChild(container);
}

function renderRandomStoriesResults(storiesRanked) {
  renderTrendResults(
    storiesRanked.map((s) => ({
      title: s.name,
      name: s.name,
      country: s.category || "",
      source: "قائمة القصص + التريند",
      personalScore: s.personalScore,
      trendScore: s.trendScore,
      finalScore: s.finalScore,
      summary: s.notes || "",
    })),
    {
      title: "🎲 أفضل 10 قصص عشوائية (40% تقييمك الشخصي + 60% قوة التريند)",
      subtitle:
        "الأعلى في الأعلى – يمكنك اختيار أي واحدة منها لكتابة سيناريو فيديو طويل.",
    }
  );
}

// ==========================
// Stories – CRUD + Rendering
// ==========================

function renderStoriesTable(list) {
  if (!storiesTbodyEl) return;
  const rows = [];

  list.forEach((story, idx) => {
    const tr = document.createElement("tr");

    // #
    const tdIndex = document.createElement("td");
    tdIndex.textContent = idx + 1;
    tr.appendChild(tdIndex);

    // الاسم
    const tdName = document.createElement("td");
    tdName.textContent = story.name || "";
    tr.appendChild(tdName);

    // النوع
    const tdCategory = document.createElement("td");
    tdCategory.textContent = story.category || "";
    tr.appendChild(tdCategory);

    // الدرجة (تقييم شخصي)
    const tdScore = document.createElement("td");
    tdScore.textContent =
      typeof story.score === "number" ? story.score.toString() : "";
    tr.appendChild(tdScore);

    // الجاذبية – نستخدم نفس الدرجة كبداية
    const tdAttract = document.createElement("td");
    tdAttract.textContent =
      typeof story.score === "number" ? story.score.toString() : "";
    tr.appendChild(tdAttract);

    // ذكاء – النتيجة النهائية إن وُجدت
    const tdAiScore = document.createElement("td");
    if (typeof story.finalScore === "number") {
      tdAiScore.textContent = story.finalScore.toString();
    } else {
      tdAiScore.textContent = "—";
    }
    tr.appendChild(tdAiScore);

    // تنفيذ (Done)
    const tdDone = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = story.done ? "badge-done" : "badge-not-done";
    badge.textContent = story.done ? "✔ تم التنفيذ" : "✖ لم تُنفّذ بعد";
    tdDone.appendChild(badge);
    tr.appendChild(tdDone);

    // تاريخ
    const tdDate = document.createElement("td");
    tdDate.textContent = story.added ? formatDate(story.added) : "";
    tr.appendChild(tdDate);

    // ملاحظات
    const tdNotes = document.createElement("td");
    tdNotes.textContent = story.notes || "";
    tr.appendChild(tdNotes);

    // تحكم
    const tdActions = document.createElement("td");
    tdActions.className = "table-actions";

    const btnShow = document.createElement("button");
    btnShow.textContent = "👁 عرض";
    btnShow.addEventListener("click", () => showStoryDetails(story.id));
    tdActions.appendChild(btnShow);

    const btnEdit = document.createElement("button");
    btnEdit.textContent = "✏ تعديل";
    btnEdit.addEventListener("click", () => startEditStory(story.id));
    tdActions.appendChild(btnEdit);

    const btnToggleDone = document.createElement("button");
    btnToggleDone.textContent = story.done ? "↩ إلغاء تنفيذ" : "✅ تم التنفيذ";
    btnToggleDone.addEventListener("click", () => toggleStoryDone(story.id));
    tdActions.appendChild(btnToggleDone);

    const btnDelete = document.createElement("button");
    btnDelete.textContent = "🗑 حذف";
    btnDelete.addEventListener("click", () => deleteStory(story.id));
    tdActions.appendChild(btnDelete);

    tr.appendChild(tdActions);
    rows.push(tr);
  });

  storiesTbodyEl.innerHTML = "";
  rows.forEach((r) => storiesTbodyEl.appendChild(r));
}

function addStoryFromTrend(item) {
  const name = item.title || item.name;
  if (!name) return;

  const exists = stories.some(
    (s) => normalizeArabic(s.name) === normalizeArabic(name)
  );
  if (exists) {
    alert("هذه القصة موجودة بالفعل في قائمة القصص.");
    return;
  }

  lastStoryId += 1;
  const newStory = {
    id: lastStoryId,
    name,
    score: typeof item.personalScore === "number" ? item.personalScore : 80,
    done: false,
    category: item.categoryLabel || "",
    added: todayISODate(),
    notes: item.url ? `رابط مرجع: ${item.url}` : "",
    analysis: null,
  };

  stories.push(newStory);
  saveStoriesToLocalStorage(true);
  renderStoriesTable(stories);
}

function addStoryManual() {
  const name = manualNameEl.value.trim();
  if (!name) {
    alert("من فضلك اكتب اسم القصة.");
    return;
  }
  const category = manualTypeEl.value || "";
  const score = parseInt(manualScoreEl.value || "0", 10);
  const notes = manualNotesEl.value.trim();

  if (editingStoryId != null) {
    // تعديل
    const idx = stories.findIndex((s) => s.id === editingStoryId);
    if (idx !== -1) {
      stories[idx].name = name;
      stories[idx].category = category;
      stories[idx].score = isNaN(score) ? 0 : score;
      stories[idx].notes = notes;
    }
    editingStoryId = null;
  } else {
    // إضافة جديدة
    lastStoryId += 1;
    stories.push({
      id: lastStoryId,
      name,
      score: isNaN(score) ? 0 : score,
      done: false,
      category,
      added: todayISODate(),
      notes,
      analysis: null,
    });
  }

  manualNameEl.value = "";
  manualTypeEl.value = "";
  manualScoreEl.value = "80";
  manualNotesEl.value = "";

  saveStoriesToLocalStorage(true);
  renderStoriesTable(stories);
}

function parseRawInput() {
  const text = rawInputEl.value || "";
  const lines = text.split("\n").map((l) => l.trim());
  let addedCount = 0;

  lines.forEach((line) => {
    if (!line) return;
    const exists = stories.some(
      (s) => normalizeArabic(s.name) === normalizeArabic(line)
    );
    if (exists) return;

    lastStoryId += 1;
    stories.push({
      id: lastStoryId,
      name: line,
      score: 80,
      done: false,
      category: "",
      added: todayISODate(),
      notes: "",
      analysis: null,
    });
    addedCount++;
  });

  if (addedCount > 0) {
    saveStoriesToLocalStorage(true);
    renderStoriesTable(stories);
  }

  alert(`تم إضافة ${addedCount} قصة جديدة من النص الخام.`);
}

function showStoryDetails(id) {
  const story = stories.find((s) => s.id === id);
  if (!story) return;

  clearAiOutput();
  const container = document.createElement("div");

  const h = document.createElement("h3");
  h.textContent = `تفاصيل القصة: ${story.name}`;
  container.appendChild(h);

  const ul = document.createElement("ul");
  const items = [
    ["النوع", story.category || "غير محدد"],
    ["تقييمك الشخصي", story.score],
    ["تم التنفيذ", story.done ? "نعم" : "لا"],
    ["تاريخ الإضافة", formatDate(story.added)],
    ["الملاحظات", story.notes || "—"],
    [
      "نتيجة الذكاء (إن وجدت)",
      typeof story.finalScore === "number"
        ? story.finalScore
        : "لم يتم حسابها بعد",
    ],
  ];

  items.forEach(([label, value]) => {
    const li = document.createElement("li");
    li.textContent = `${label}: ${value}`;
    ul.appendChild(li);
  });

  container.appendChild(ul);
  aiOutputEl.appendChild(container);
}

function startEditStory(id) {
  const story = stories.find((s) => s.id === id);
  if (!story) return;

  editingStoryId = id;
  manualNameEl.value = story.name || "";
  manualTypeEl.value = story.category || "";
  manualScoreEl.value =
    typeof story.score === "number" ? story.score.toString() : "80";
  manualNotesEl.value = story.notes || "";

  window.scrollTo({ top: manualNameEl.offsetTop - 80, behavior: "smooth" });
}

function toggleStoryDone(id) {
  const idx = stories.findIndex((s) => s.id === id);
  if (idx === -1) return;
  stories[idx].done = !stories[idx].done;
  saveStoriesToLocalStorage(true);
  renderStoriesTable(stories);
}

function deleteStory(id) {
  const story = stories.find((s) => s.id === id);
  if (!story) return;
  if (!confirm(`هل تريد حذف القصة: "${story.name}"؟`)) return;
  stories = stories.filter((s) => s.id !== id);
  saveStoriesToLocalStorage(true);
  renderStoriesTable(stories);
}

// ==========================
// Import / Export
// ==========================

function exportStories() {
  const payload = {
    exportedAt: new Date().toISOString(),
    stories,
    lastStoryId,
  };
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  a.download = `stories-export-${ts}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function importStoriesFromFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const text = e.target.result;
      const parsed = JSON.parse(text);
      let importedStories = [];

      if (Array.isArray(parsed)) {
        importedStories = parsed;
      } else if (Array.isArray(parsed.stories)) {
        importedStories = parsed.stories;
      } else {
        alert("ملف الاستيراد غير مفهوم، يُفضّل أن يكون Array أو {stories:[]}");
        return;
      }

      let maxId = getMaxStoryId(stories);
      const normalizedExisting = new Set(
        stories.map((s) => normalizeArabic(s.name))
      );

      importedStories.forEach((imp) => {
        const nName = normalizeArabic(imp.name || "");
        if (!nName || normalizedExisting.has(nName)) return;
        maxId += 1;
        stories.push({
          id: maxId,
          name: imp.name || "",
          score: typeof imp.score === "number" ? imp.score : 80,
          done: !!imp.done,
          category: imp.category || "",
          added: imp.added || todayISODate(),
          notes: imp.notes || "",
          analysis: imp.analysis || null,
        });
      });

      lastStoryId = getMaxStoryId(stories);
      saveStoriesToLocalStorage(true);
      renderStoriesTable(stories);
      alert("تم استيراد القصص بنجاح.");
    } catch (err) {
      console.error(err);
      alert("حدث خطأ أثناء قراءة ملف القصص.");
    }
  };
  reader.readAsText(file, "utf-8");
}

// ==========================
// Search + Suggestions
// ==========================

function ensureSuggestionsBox() {
  if (suggestionsBoxEl) return;
  const searchRow = searchInputEl.parentElement;
  const box = document.createElement("div");
  box.id = "search-suggestions";
  box.style.marginTop = "6px";
  box.style.background = "#fff";
  box.style.border = "1px solid #ddd";
  box.style.borderRadius = "8px";
  box.style.maxHeight = "150px";
  box.style.overflowY = "auto";
  box.style.fontSize = "0.85rem";
  box.style.padding = "4px 0";
  box.style.display = "none";
  searchRow.appendChild(box);
  suggestionsBoxEl = box;
}

function renderSuggestions(matches) {
  ensureSuggestionsBox();
  if (!matches || matches.length === 0) {
    suggestionsBoxEl.style.display = "none";
    suggestionsBoxEl.innerHTML = "";
    return;
  }

  suggestionsBoxEl.innerHTML = "";
  matches.slice(0, 10).forEach((story) => {
    const item = document.createElement("div");
    item.style.padding = "4px 10px";
    item.style.cursor = "pointer";
    item.textContent = story.name;
    item.addEventListener("click", () => {
      searchInputEl.value = story.name;
      suggestionsBoxEl.style.display = "none";
      filterStoriesBySearch();
    });
    suggestionsBoxEl.appendChild(item);
  });
  suggestionsBoxEl.style.display = "block";
}

function filterStoriesBySearch() {
  const query = normalizeArabic(searchInputEl.value || "");
  if (!query) {
    renderStoriesTable(stories);
    renderSuggestions([]);
    return;
  }

  const matches = stories.filter((s) =>
    normalizeArabic(s.name).includes(query)
  );
  renderStoriesTable(matches);
  renderSuggestions(matches);
}

// ==========================
// Panel Switching
// ==========================

function setLayoutMode(mode) {
  // modes: "both" | "ai" | "stories"
  if (!aiPanelEl || !storiesPanelEl) return;
  if (mode === "ai") {
    aiPanelEl.style.display = "";
    storiesPanelEl.style.display = "none";
  } else if (mode === "stories") {
    aiPanelEl.style.display = "none";
    storiesPanelEl.style.display = "";
  } else {
    aiPanelEl.style.display = "";
    storiesPanelEl.style.display = "";
  }
  localStorage.setItem(STORAGE_KEY_LAYOUT, mode);
}

function restoreLayoutMode() {
  const mode = localStorage.getItem(STORAGE_KEY_LAYOUT) || "both";
  setLayoutMode(mode);
}

// ==========================
// Button Handlers – Trend & Random
// ==========================

async function handlePickLongFromTrend() {
  clearAiOutput();
  aiOutputEl.innerHTML = "<p>⏳ جاري جلب أفضل 5 قصص لفيديو طويل من التريند...</p>";

  try {
    const { data } = await callWorker("pick_long_trend", {});
    if (data && Array.isArray(data.results)) {
      // تحديث Status
      const st = loadStatusFromLocal();
      st.trendsUpdatedAt = todayISODate();
      st.youtubeUpdatedAt = todayISODate();
      saveStatusToLocal(st);
      refreshStatusPills();

      renderTrendResults(data.results, {
        title: "🗓 أفضل قصص لفيديو طويل بناءً على التريند (آخر سنة)",
        subtitle:
          "النتائج مختارة من الدول العربية (80%) + دول عالمية (20%)، ومناسبة لفيديوهات طويلة مليانة تفاصيل.",
      });
    } else {
      aiOutputEl.innerHTML =
        "<p>لم يتم العثور على نتائج مناسبة من الـ Worker.</p>";
    }
  } catch (err) {
    aiOutputEl.innerHTML =
      "<p>حدث خطأ أثناء الاتصال بالـ Worker. تأكد أن الـ Worker شغال.</p>";
  }
}

async function handlePickShortFromTrend() {
  clearAiOutput();
  aiOutputEl.innerHTML =
    "<p>⏳ جاري جلب أفضل 5 قصص قصيرة (ريلز/Shorts) من التريند...</p>";

  try {
    const { data } = await callWorker("pick_short_trend", {});
    if (data && Array.isArray(data.results)) {
      const st = loadStatusFromLocal();
      st.trendsUpdatedAt = todayISODate();
      st.youtubeUpdatedAt = todayISODate();
      saveStatusToLocal(st);
      refreshStatusPills();

      renderTrendResults(data.results, {
        title: "⚡ أفضل قصص لفيديوهات ريلز/Shorts بناءً على التريند",
        subtitle:
          "أحداث بسيطة يمكن تلخيصها في فيديو لا يزيد عن 3 دقائق، ضمن الجرائم/الوفيات/الحروب/الجاسوسية.",
      });
    } else {
      aiOutputEl.innerHTML =
        "<p>لم يتم العثور على نتائج مناسبة من الـ Worker.</p>";
    }
  } catch (err) {
    aiOutputEl.innerHTML =
      "<p>حدث خطأ أثناء الاتصال بالـ Worker. تأكد أن الـ Worker شغال.</p>";
  }
}

async function handleRandomStory() {
  clearAiOutput();
  aiOutputEl.innerHTML =
    "<p>⏳ جاري حساب أفضل القصص عشوائيًا (40% تقييمك الشخصي + 60% قوة التريند)...</p>";

  // استبعد القصص التي تم تنفيذها
  const candidateStories = stories.filter((s) => !s.done);

  try {
    const { data } = await callWorker("score_stories", {
      stories: candidateStories,
      maxResults: 10,
    });

    if (data && Array.isArray(data.rankedStories)) {
      // حدّث الـ stories بالـ finalScore/trendScore
      const mapByName = new Map();
      data.rankedStories.forEach((rs) => {
        mapByName.set(normalizeArabic(rs.name), rs);
      });

      stories = stories.map((s) => {
        const m = mapByName.get(normalizeArabic(s.name));
        if (m) {
          return {
            ...s,
            personalScore: m.personalScore,
            trendScore: m.trendScore,
            finalScore: m.finalScore,
          };
        }
        return s;
      });

      saveStoriesToLocalStorage(false);
      renderStoriesTable(stories);
      renderRandomStoriesResults(data.rankedStories);
    } else {
      aiOutputEl.innerHTML =
        "<p>لم يتم استلام نتائج تقييم القصص من الـ Worker.</p>";
    }
  } catch (err) {
    console.error(err);
    aiOutputEl.innerHTML =
      "<p>حدث خطأ أثناء الاتصال بالـ Worker أثناء تقييم القصص.</p>";
  }
}

async function handleUpdateTrends() {
  clearAiOutput();
  aiOutputEl.innerHTML =
    "<p>⏳ جاري تحديث التريندات الكاملة (محركات البحث + YouTube + الوفيات)...</p>";

  try {
    const { data } = await callWorker("update_trends", {});
    // نتوقّع أن يرجع worker: {trendsUpdatedAt, youtubeUpdatedAt, deathsUpdatedAt}
    const st = loadStatusFromLocal();
    if (data.trendsUpdatedAt) st.trendsUpdatedAt = data.trendsUpdatedAt;
    if (data.youtubeUpdatedAt) st.youtubeUpdatedAt = data.youtubeUpdatedAt;
    if (data.deathsUpdatedAt) st.deathsUpdatedAt = data.deathsUpdatedAt;
    saveStatusToLocal(st);
    refreshStatusPills();

    aiOutputEl.innerHTML =
      "<p>✅ تم تحديث التريندات بنجاح (حسب ما تمكن الـ Worker من الوصول إليه).</p>";
  } catch (err) {
    console.error(err);
    aiOutputEl.innerHTML =
      "<p>حدث خطأ أثناء تحديث التريندات من الـ Worker.</p>";
  }
}

// ==========================
// Init
// ==========================

document.addEventListener("DOMContentLoaded", () => {
  // ربط العناصر
  aiOutputEl = document.getElementById("ai-output");
  storiesTbodyEl = document.getElementById("stories-tbody");
  rawInputEl = document.getElementById("raw-input");
  manualNameEl = document.getElementById("manual-name");
  manualTypeEl = document.getElementById("manual-type");
  manualScoreEl = document.getElementById("manual-score");
  manualNotesEl = document.getElementById("manual-notes");
  importFileEl = document.getElementById("import-file");
  searchInputEl = document.getElementById("stories-search");
  statusTrendsEl = document.getElementById("status-trends");
  statusYoutubeEl = document.getElementById("status-youtube");
  statusDeathsEl = document.getElementById("status-deaths");
  aiPanelEl = document.querySelector(".ai-panel");
  storiesPanelEl = document.querySelector(".stories-panel");

  // أزرار
  const btnPickToday = document.getElementById("btn-pick-today");
  const btnPickLong = document.getElementById("btn-pick-long");
  const btnPickShort = document.getElementById("btn-pick-short");
  const btnUpdateTrends = document.getElementById("btn-update-trends");

  const btnParseRaw = document.getElementById("btn-parse-raw");
  const btnAddManual = document.getElementById("btn-add-manual");
  const btnExport = document.getElementById("btn-export");

  const btnShowStoriesOnly = document.getElementById(
    "btn-show-stories-only"
  );
  const btnShowBoth = document.getElementById("btn-show-both");
  const btnShowAiOnly = document.getElementById("btn-show-ai-only");

  // أحداث الأزرار
  if (btnPickToday) btnPickToday.addEventListener("click", handlePickLongFromTrend);
  if (btnPickShort) btnPickShort.addEventListener("click", handlePickShortFromTrend);
  if (btnPickLong) btnPickLong.addEventListener("click", handleRandomStory);
  if (btnUpdateTrends) btnUpdateTrends.addEventListener("click", handleUpdateTrends);

  if (btnParseRaw) btnParseRaw.addEventListener("click", parseRawInput);
  if (btnAddManual) btnAddManual.addEventListener("click", addStoryManual);
  if (btnExport) btnExport.addEventListener("click", exportStories);

  if (importFileEl) {
    importFileEl.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) {
        importStoriesFromFile(file);
        importFileEl.value = "";
      }
    });
  }

  if (searchInputEl) {
    searchInputEl.addEventListener("input", filterStoriesBySearch);
  }

  if (btnShowStoriesOnly)
    btnShowStoriesOnly.addEventListener("click", () =>
      setLayoutMode("stories")
    );
  if (btnShowBoth)
    btnShowBoth.addEventListener("click", () => setLayoutMode("both"));
  if (btnShowAiOnly)
    btnShowAiOnly.addEventListener("click", () => setLayoutMode("ai"));

  // تحميل البيانات
  autoLoadBackupIfExists();
  refreshStatusPills();
  restoreLayoutMode();
});
