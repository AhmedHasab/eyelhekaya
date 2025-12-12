// app.js
// ===============================
// ذكاء اختيار القصص – إيه الحكاية؟
// ملف واحد يحتوي على:
// - إدارة القصص (stories.json + CRUD + بحث + اقتراحات)
// - الربط مع Cloudflare Worker (تريند طويل / ريلز / قصة عشوائية)
// - كاش محلي 24 ساعة + Auto Backup (localStorage)
// - Panel Switching + Status Pills
// ===============================

(() => {
  "use strict";

  // ===============================
  // إعدادات عامة
  // ===============================

  const WORKER_BASE_URL =
    "https://odd-credit-25c6.namozg50.workers.dev"; // عدل لو غيرت المسار داخل الـ Worker

  const STORAGE_KEYS = {
    STORIES: "hasaballa_stories_v1",
    TRENDS_LONG: "hasaballa_trends_long_v1",
    TRENDS_SHORT: "hasaballa_trends_short_v1",
    RANDOM_CACHE: "hasaballa_random_cache_v1",
    STATUS_META: "hasaballa_status_meta_v1",
  };

  const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 ساعة

  // حالة التطبيق
  let stories = [];
  let filteredStories = [];
  let editingStoryId = null;

  // عناصر DOM
  const dom = {};

  // ===============================
  // Utils
  // ===============================

  function $(id) {
    return document.getElementById(id);
  }

  function safeJSONParse(str, fallback) {
    try {
      return JSON.parse(str);
    } catch {
      return fallback;
    }
  }

  function saveToStorage(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function loadFromStorage(key, fallback = null) {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return safeJSONParse(raw, fallback);
  }

  function nowTs() {
    return Date.now();
  }

  function isFresh(ts) {
    if (!ts) return false;
    return nowTs() - ts < CACHE_TTL_MS;
  }

  // تطبيع النص العربي: إزالة التشكيل + توحيد الألفات + حذف العلامات
  function normalizeArabic(text) {
    if (!text) return "";
    return text
      .toString()
      .trim()
      .replace(/[\u064B-\u065F]/g, "") // التشكيل
      .replace(/[أإآا]/g, "ا")
      .replace(/[ىی]/g, "ي")
      .replace(/ة/g, "ه")
      .replace(/[^\p{L}\p{N}]+/gu, "") // إزالة كل شيء غير حروف/أرقام
      .toLowerCase();
  }

  function generateId() {
    return "s_" + Math.random().toString(36).slice(2) + "_" + Date.now();
  }

  function formatDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString("ar-EG", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }

  function round2(num) {
    return Math.round(num * 100) / 100;
  }

  // ===============================
  // Auto Backup (بدون سيرفر / بدون Worker)
  // ===============================

  function autoDownloadBackup() {
    // هنا المقصود "Backup تلقائي" = تخزين في localStorage باسم واضح
    // بدون ما نزعجك بتنزيل ملف في كل تعديل
    saveToStorage(STORAGE_KEYS.STORIES, { stories, ts: nowTs() });
  }

  async function autoLoadBackupIfExists() {
    // 1) من الـ localStorage لو موجود
    const backup = loadFromStorage(STORAGE_KEYS.STORIES, null);
    if (backup && Array.isArray(backup.stories)) {
      stories = backup.stories;
      filteredStories = [...stories];
      renderStoriesTable();
      return;
    }

    // 2) لو مفيش Backup محلي: نحاول نقرأ stories.json من السيرفر
    try {
      const res = await fetch("stories.json");
      if (!res.ok) throw new Error("Failed to load stories.json");
      const data = await res.json();
      stories = normalizeStoriesFromFile(data);
      filteredStories = [...stories];
      autoDownloadBackup();
      renderStoriesTable();
    } catch (err) {
      console.error("Error loading initial stories:", err);
      stories = [];
      filteredStories = [];
      renderStoriesTable();
    }
  }

  function normalizeStoriesFromFile(data) {
    // نحاول نكون مرنين مع شكل الملف
    // متوقع شكل زي:
    // { "stories": [ { id, name, type, personalScore, notes, executed, createdAt, aiScore, finalScore } ] }
    // أو Array مباشرة
    let list = [];
    if (Array.isArray(data)) {
      list = data;
    } else if (Array.isArray(data.stories)) {
      list = data.stories;
    } else if (Array.isArray(data.items)) {
      list = data.items;
    } else {
      console.warn("Unknown stories.json format, starting empty.");
      return [];
    }

    return list.map((raw, idx) => {
      if (typeof raw === "string") {
        return {
          id: generateId(),
          name: raw,
          type: "",
          personalScore: 80,
          notes: "",
          createdAt: new Date().toISOString(),
          executed: false,
          aiScore: null,
          finalScore: null,
        };
      }
      return {
        id: raw.id || generateId(),
        name: raw.name || raw.title || `قصة بدون اسم #${idx + 1}`,
        type: raw.type || raw.category || "",
        personalScore:
          typeof raw.personalScore === "number"
            ? raw.personalScore
            : typeof raw.score === "number"
            ? raw.score
            : 80,
        notes: raw.notes || raw.comment || "",
        createdAt: raw.createdAt || raw.created_at || new Date().toISOString(),
        executed: !!raw.executed,
        aiScore:
          typeof raw.aiScore === "number"
            ? raw.aiScore
            : typeof raw.trendScore === "number"
            ? raw.trendScore
            : null,
        finalScore:
          typeof raw.finalScore === "number"
            ? raw.finalScore
            : typeof raw.combinedScore === "number"
            ? raw.combinedScore
            : null,
      };
    });
  }

  // ===============================
  // Status Pills (التريندات)
  // ===============================

  function updateStatusPills() {
    const meta = loadFromStorage(STORAGE_KEYS.STATUS_META, {
      trendsLongUpdatedAt: null,
      trendsShortUpdatedAt: null,
      randomUpdatedAt: null,
      deathsUpdatedAt: null,
      youtubeUpdatedAt: null,
    });

    const elTrends = $("status-trends");
    const elYouTube = $("status-youtube");
    const elDeaths = $("status-deaths");

    function updatePill(el, ts, labelFresh, labelOld) {
      if (!el) return;
      el.classList.remove("muted", "ok", "stale");
      if (isFresh(ts)) {
        el.classList.add("ok");
        el.textContent = labelFresh;
      } else if (ts) {
        el.classList.add("stale");
        el.textContent = labelOld;
      } else {
        el.classList.add("muted");
      }
    }

    updatePill(
      elTrends,
      meta.trendsLongUpdatedAt,
      "تريندات Google / Bing محدثة (آخر 24 ساعة)",
      "تريندات Google / Bing قديمة – يفضل تحديثها"
    );

    updatePill(
      elYouTube,
      meta.youtubeUpdatedAt,
      "تريندات YouTube محدثة (آخر 24 ساعة)",
      "تريندات YouTube قديمة – يفضل تحديثها"
    );

    updatePill(
      elDeaths,
      meta.deathsUpdatedAt,
      "وفيات آخر 48 ساعة محدثة",
      "وفيات آخر 48 ساعة غير محدثة"
    );
  }

  function setStatusMeta(partial) {
    const meta = loadFromStorage(STORAGE_KEYS.STATUS_META, {
      trendsLongUpdatedAt: null,
      trendsShortUpdatedAt: null,
      randomUpdatedAt: null,
      deathsUpdatedAt: null,
      youtubeUpdatedAt: null,
    });
    const updated = { ...meta, ...partial };
    saveToStorage(STORAGE_KEYS.STATUS_META, updated);
    updateStatusPills();
  }

  // ===============================
  // DOM + Events
  // ===============================

  function initDomRefs() {
    dom.btnPickToday = $("btn-pick-today"); // long من التريند
    dom.btnPickLong = $("btn-pick-long"); // عشوائي من القصص
    dom.btnPickShort = $("btn-pick-short"); // ريلز من التريند
    dom.btnUpdateTrends = $("btn-update-trends");

    dom.aiOutput = $("ai-output");
    dom.storiesTbody = $("stories-tbody");

    dom.rawInput = $("raw-input");
    dom.btnParseRaw = $("btn-parse-raw");

    dom.manualName = $("manual-name");
    dom.manualType = $("manual-type");
    dom.manualScore = $("manual-score");
    dom.manualNotes = $("manual-notes");
    dom.btnAddManual = $("btn-add-manual");

    dom.btnExport = $("btn-export");
    dom.importFile = $("import-file");

    dom.searchInput = $("stories-search");

    dom.btnShowStoriesOnly = $("btn-show-stories-only");
    dom.btnShowBoth = $("btn-show-both");
    dom.btnShowAiOnly = $("btn-show-ai-only");

    dom.aiPanel = document.querySelector(".ai-panel");
    dom.storiesPanel = document.querySelector(".stories-panel");

    // صندوق اقتراحات البحث نضيفه ديناميكياً
    const searchRow = dom.searchInput?.parentElement;
    if (searchRow && !$("#search-suggestions")) {
      const ul = document.createElement("ul");
      ul.id = "search-suggestions";
      ul.className = "search-suggestions";
      searchRow.appendChild(ul);
      dom.searchSuggestions = ul;
    }
  }

  function bindEvents() {
    // زر: فيديو طويل من التريند
    dom.btnPickToday?.addEventListener("click", handlePickLongFromTrend);

    // زر: قصة عشوائية من القصص (فيديو طويل)
    dom.btnPickLong?.addEventListener("click", handleRandomStory);

    // زر: ريلز من التريند
    dom.btnPickShort?.addEventListener("click", handlePickShortFromTrend);

    // زر: تحديث التريندات (يجبر تحديث الكاش)
    dom.btnUpdateTrends?.addEventListener("click", handleUpdateTrends);

    // تحويل نص خام إلى قصص
    dom.btnParseRaw?.addEventListener("click", handleParseRaw);

    // إضافة قصة يدويًا
    dom.btnAddManual?.addEventListener("click", handleAddManualStory);

    // تصدير / استيراد
    dom.btnExport?.addEventListener("click", handleExportStories);
    dom.importFile?.addEventListener("change", handleImportStories);

    // بحث + اقتراحات
    dom.searchInput?.addEventListener("input", handleSearchChange);

    // التحكم في الصفوف (عرض / تعديل / حذف / تنفيذ)
    dom.storiesTbody?.addEventListener("click", handleStoriesTableClick);

    // Panel switching
    dom.btnShowStoriesOnly?.addEventListener("click", () =>
      setLayoutMode("stories")
    );
    dom.btnShowBoth?.addEventListener("click", () => setLayoutMode("both"));
    dom.btnShowAiOnly?.addEventListener("click", () =>
      setLayoutMode("ai-only")
    );

    // تحميل تلقائي للـ Backup
    window.addEventListener("load", autoLoadBackupIfExists);
  }

  // ===============================
  // Panel Switching
  // ===============================

  function setLayoutMode(mode) {
    switch (mode) {
      case "stories":
        if (dom.aiPanel) dom.aiPanel.style.display = "none";
        if (dom.storiesPanel) dom.storiesPanel.style.display = "block";
        break;
      case "ai-only":
        if (dom.aiPanel) dom.aiPanel.style.display = "block";
        if (dom.storiesPanel) dom.storiesPanel.style.display = "none";
        break;
      case "both":
      default:
        if (dom.aiPanel) dom.aiPanel.style.display = "block";
        if (dom.storiesPanel) dom.storiesPanel.style.display = "block";
        break;
    }
  }

  // ===============================
  // عرض القصص في الجدول
  // ===============================

  function renderStoriesTable() {
    if (!dom.storiesTbody) return;
    const list = filteredStories.length ? filteredStories : stories;
    dom.storiesTbody.innerHTML = "";

    list.forEach((s, idx) => {
      const tr = document.createElement("tr");
      tr.dataset.storyId = s.id;

      const executedLabel = s.executed ? "✅ منفّذ" : "⏳ لم ينفّذ بعد";
      const executedClass = s.executed ? "executed-badge" : "pending-badge";

      tr.innerHTML = `
        <td>${idx + 1}</td>
        <td>${escapeHtml(s.name)}</td>
        <td>${escapeHtml(s.type || "")}</td>
        <td>${s.personalScore ?? ""}</td>
        <td>${s.finalScore != null ? round2(s.finalScore) : "-"}</td>
        <td>${s.aiScore != null ? round2(s.aiScore) : "-"}</td>
        <td><span class="${executedClass}">${executedLabel}</span></td>
        <td>${formatDate(s.createdAt)}</td>
        <td>${escapeHtml(s.notes || "")}</td>
        <td>
          <button class="btn tiny btn-show" data-action="show">👁 عرض</button>
          <button class="btn tiny btn-edit" data-action="edit">✏ تعديل</button>
          <button class="btn tiny btn-toggle" data-action="toggle">
            ${s.executed ? "↩ إرجاع" : "✅ تنفيذ"}
          </button>
          <button class="btn tiny btn-delete" data-action="delete">🗑 حذف</button>
        </td>
      `;
      dom.storiesTbody.appendChild(tr);
    });
  }

  function escapeHtml(str) {
    if (str == null) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // ===============================
  // إدارة القصص – CRUD
  // ===============================

  function handleParseRaw() {
    const text = dom.rawInput?.value || "";
    if (!text.trim()) return;

    const lines = text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    const baseScore = Number(dom.manualScore?.value || 80);

    const newStories = lines.map((name) => ({
      id: generateId(),
      name,
      type: dom.manualType?.value || "",
      personalScore: baseScore || 80,
      notes: "",
      createdAt: new Date().toISOString(),
      executed: false,
      aiScore: null,
      finalScore: null,
    }));

    stories.push(...newStories);
    filteredStories = [];
    dom.rawInput.value = "";
    autoDownloadBackup();
    renderStoriesTable();
  }

  function handleAddManualStory() {
    const name = dom.manualName?.value.trim();
    const type = dom.manualType?.value || "";
    const score = Number(dom.manualScore?.value || 80);
    const notes = dom.manualNotes?.value.trim() || "";

    if (!name) {
      alert("من فضلك أدخل اسم القصة.");
      return;
    }

    if (!editingStoryId) {
      // إضافة جديدة
      const story = {
        id: generateId(),
        name,
        type,
        personalScore: isNaN(score) ? 80 : score,
        notes,
        createdAt: new Date().toISOString(),
        executed: false,
        aiScore: null,
        finalScore: null,
      };
      stories.push(story);
    } else {
      // تعديل
      const idx = stories.findIndex((s) => s.id === editingStoryId);
      if (idx !== -1) {
        stories[idx] = {
          ...stories[idx],
          name,
          type,
          personalScore: isNaN(score) ? stories[idx].personalScore : score,
          notes,
        };
      }
      editingStoryId = null;
      dom.btnAddManual.textContent = "➕ إضافة قصة يدويًا";
    }

    dom.manualName.value = "";
    dom.manualType.value = "";
    dom.manualScore.value = "80";
    dom.manualNotes.value = "";

    filteredStories = [];
    autoDownloadBackup();
    renderStoriesTable();
  }

  function handleStoriesTableClick(e) {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;

    const action = btn.dataset.action;
    const tr = btn.closest("tr");
    const storyId = tr?.dataset.storyId;
    if (!storyId) return;

    const story = stories.find((s) => s.id === storyId);
    if (!story) return;

    if (action === "show") {
      showStoryInAiPanel(story);
    } else if (action === "edit") {
      editingStoryId = story.id;
      dom.manualName.value = story.name;
      dom.manualType.value = story.type || "";
      dom.manualScore.value = story.personalScore ?? 80;
      dom.manualNotes.value = story.notes || "";
      dom.btnAddManual.textContent = "💾 حفظ التعديل";
    } else if (action === "delete") {
      if (confirm(`هل تريد حذف القصة: "${story.name}"؟`)) {
        stories = stories.filter((s) => s.id !== story.id);
        filteredStories = [];
        autoDownloadBackup();
        renderStoriesTable();
      }
    } else if (action === "toggle") {
      story.executed = !story.executed;
      autoDownloadBackup();
      renderStoriesTable();
    }
  }

  function showStoryInAiPanel(story) {
    if (!dom.aiOutput) return;

    dom.aiOutput.innerHTML = `
      <h3>📖 تفاصيل القصة المختارة</h3>
      <p><strong>الاسم:</strong> ${escapeHtml(story.name)}</p>
      <p><strong>النوع:</strong> ${escapeHtml(story.type || "")}</p>
      <p><strong>تقييمك الشخصي:</strong> ${
        story.personalScore ?? "غير محدد"
      }</p>
      <p><strong>درجة التريند (ذكاء):</strong> ${
        story.aiScore != null ? round2(story.aiScore) : "لم تُحسب بعد"
      }</p>
      <p><strong>الدرجة النهائية (40% شخصي + 60% تريند):</strong> ${
        story.finalScore != null ? round2(story.finalScore) : "لم تُحسب بعد"
      }</p>
      <p><strong>الحالة:</strong> ${
        story.executed ? "✅ تم تنفيذ فيديو عن القصة" : "⏳ لم يتم تنفيذها بعد"
      }</p>
      <p><strong>تاريخ التسجيل:</strong> ${formatDate(story.createdAt)}</p>
      <p><strong>ملاحظات:</strong> ${escapeHtml(story.notes || "لا توجد")}</p>
    `;
  }

  // ===============================
  // Export / Import
  // ===============================

  function handleExportStories() {
    const payload = {
      exportedAt: new Date().toISOString(),
      stories,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stories-backup-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function handleImportStories(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const text = evt.target.result;
        const data = JSON.parse(text);
        if (Array.isArray(data)) {
          stories = normalizeStoriesFromFile(data);
        } else if (Array.isArray(data.stories)) {
          stories = normalizeStoriesFromFile(data.stories);
        } else {
          alert("صيغة ملف JSON غير متوقعة.");
          return;
        }
        filteredStories = [];
        autoDownloadBackup();
        renderStoriesTable();
      } catch (err) {
        console.error("Import error:", err);
        alert("فشل في قراءة ملف JSON.");
      }
    };
    reader.readAsText(file, "utf-8");
  }

  // ===============================
  // بحث + اقتراحات
  // ===============================

  function handleSearchChange(e) {
    const q = e.target.value;
    const normQ = normalizeArabic(q);
    if (!normQ) {
      filteredStories = [];
      renderStoriesTable();
      renderSearchSuggestions([]);
      return;
    }

    filteredStories = stories.filter((s) => {
      const normName = normalizeArabic(s.name);
      const normNotes = normalizeArabic(s.notes || "");
      const normType = normalizeArabic(s.type || "");
      return (
        normName.includes(normQ) ||
        normNotes.includes(normQ) ||
        normType.includes(normQ)
      );
    });

    renderStoriesTable();

    const suggestions = filteredStories.slice(0, 7).map((s) => s.name);
    renderSearchSuggestions(suggestions);
  }

  function renderSearchSuggestions(list) {
    if (!dom.searchSuggestions) return;
    dom.searchSuggestions.innerHTML = "";
    if (!list.length) return;

    list.forEach((name) => {
      const li = document.createElement("li");
      li.textContent = name;
      li.addEventListener("click", () => {
        dom.searchInput.value = name;
        dom.searchSuggestions.innerHTML = "";
        filteredStories = stories.filter(
          (s) => normalizeArabic(s.name) === normalizeArabic(name)
        );
        renderStoriesTable();
      });
      dom.searchSuggestions.appendChild(li);
    });
  }

  // ===============================
  // الاتصال بالـ Worker
  // ===============================

  async function callWorker(action, payload = {}, useCacheKey = null) {
    // كاش محلي للنتائج (24 ساعة)
    if (useCacheKey) {
      const cacheObj = loadFromStorage(useCacheKey, null);
      if (cacheObj && isFresh(cacheObj.ts)) {
        return cacheObj.data;
      }
    }

    const res = await fetch(WORKER_BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action, payload }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("Worker error:", text);
      throw new Error("Worker returned non-OK status");
    }

    const data = await res.json();

    if (useCacheKey) {
      saveToStorage(useCacheKey, { ts: nowTs(), data });
    }

    return data;
  }

  // ===============================
  // أزرار التريند
  // ===============================

  async function handlePickLongFromTrend() {
    try {
      setAiOutputLoading("جاري اختيار أفضل 5 قصص لفيديو طويل وفقًا للتريند...");
      const result = await callWorker(
        "pick-long-trend",
        {
          // لو حبيت تبعت إعدادات إضافية هنا
        },
        STORAGE_KEYS.TRENDS_LONG
      );

      setStatusMeta({
        trendsLongUpdatedAt: nowTs(),
        youtubeUpdatedAt: nowTs(),
      });

      renderTrendResultInAiPanel(result, "🎥 قصص مقترحة لفيديو طويل");
    } catch (err) {
      console.error(err);
      setAiOutputError("حدث خطأ أثناء جلب التريند لفيديو طويل.");
    }
  }

  async function handlePickShortFromTrend() {
    try {
      setAiOutputLoading("جاري اختيار أفضل 5 قصص لفيديو ريلز / شورت...");
      const result = await callWorker(
        "pick-short-trend",
        {},
        STORAGE_KEYS.TRENDS_SHORT
      );
      setStatusMeta({
        trendsShortUpdatedAt: nowTs(),
        youtubeUpdatedAt: nowTs(),
      });
      renderTrendResultInAiPanel(result, "⚡ قصص مقترحة لفيديوهات ريلز / شورت");
    } catch (err) {
      console.error(err);
      setAiOutputError("حدث خطأ أثناء جلب التريند لفيديو ريلز.");
    }
  }

  async function handleRandomStory() {
    try {
      // نستبعد القصص المنفذة
      const candidates = stories.filter((s) => !s.executed);
      if (!candidates.length) {
        setAiOutputError(
          "لا توجد قصص متاحة للاختيار العشوائي (ربما كل القصص تم تنفيذها بالفعل)."
        );
        return;
      }

      setAiOutputLoading(
        "جاري حساب التقييم النهائي (40% من تقييمك الشخصي + 60% من التريند)..."
      );

      const payloadStories = candidates.map((s) => ({
        id: s.id,
        name: s.name,
        personalScore: s.personalScore ?? 80,
      }));

      const result = await callWorker(
        "random-story",
        { stories: payloadStories },
        // لا نستخدم كاش ثابت لأن القصص تتغير، لكن يمكننا عمل كاش خفيف
        null
      );

      // result.topStories: [{ id, name, personalScore, trendScore, finalScore }]
      // ندمج الدرجات داخل state
      if (Array.isArray(result.topStories)) {
        const byId = new Map(result.topStories.map((s) => [s.id, s]));
        stories = stories.map((s) => {
          const upd = byId.get(s.id);
          if (!upd) return s;
          return {
            ...s,
            aiScore: upd.trendScore,
            finalScore: upd.finalScore,
          };
        });
        autoDownloadBackup();
        filteredStories = [];
        renderStoriesTable();
      }

      setStatusMeta({
        randomUpdatedAt: nowTs(),
        trendsLongUpdatedAt: nowTs(),
        youtubeUpdatedAt: nowTs(),
      });

      renderRandomStoriesInAiPanel(result.topStories || []);
    } catch (err) {
      console.error(err);
      setAiOutputError(
        "حدث خطأ أثناء اختيار قصة عشوائية اعتمادًا على التريند."
      );
    }
  }

  async function handleUpdateTrends() {
    try {
      setAiOutputLoading("جاري تحديث التريندات (Google / Bing + YouTube)...");
      const result = await callWorker("update-trends", {});
      if (result && result.ok) {
        setStatusMeta({
          trendsLongUpdatedAt: nowTs(),
          trendsShortUpdatedAt: nowTs(),
          youtubeUpdatedAt: nowTs(),
        });
        setAiOutputInfo(
          "تم تحديث الكاش الداخلي للتريندات بنجاح داخل الـ Worker."
        );
      } else {
        setAiOutputError("لم ينجح التحديث التلقائي للتريندات.");
      }
    } catch (err) {
      console.error(err);
      setAiOutputError("حدث خطأ أثناء تحديث التريندات.");
    }
  }

  // ===============================
  // عرض النتائج في لوحة الذكاء
  // ===============================

  function setAiOutputLoading(msg) {
    if (!dom.aiOutput) return;
    dom.aiOutput.innerHTML = `<p class="loading">${escapeHtml(msg)}</p>`;
  }

  function setAiOutputError(msg) {
    if (!dom.aiOutput) return;
    dom.aiOutput.innerHTML = `<p class="error">${escapeHtml(msg)}</p>`;
  }

  function setAiOutputInfo(msg) {
    if (!dom.aiOutput) return;
    dom.aiOutput.innerHTML = `<p class="info">${escapeHtml(msg)}</p>`;
  }

  function renderTrendResultInAiPanel(list, title) {
    if (!dom.aiOutput) return;

    const items = Array.isArray(list) ? list : list?.stories || [];

    if (!items.length) {
      dom.aiOutput.innerHTML =
        "<p>لم يتم العثور على نتائج مناسبة للمعايير المطلوبة.</p>";
      return;
    }

    const htmlItems = items
      .map((item, idx) => {
        const name = item.arabicTitle || item.title || item.name || "";
        const reason = item.reason || "";
        const category = item.category || "";
        const geo = item.geo || "";
        const score = item.score != null ? round2(item.score) : null;

        return `
          <li>
            <h4>${idx + 1}. ${escapeHtml(name)}</h4>
            ${
              category
                ? `<p><strong>نوع القصة:</strong> ${escapeHtml(category)}</p>`
                : ""
            }
            ${
              geo ? `<p><strong>الدولة/المصدر:</strong> ${escapeHtml(geo)}</p>` : ""
            }
            ${
              score != null
                ? `<p><strong>درجة التريند الكلية:</strong> ${score}/100</p>`
                : ""
            }
            ${
              reason
                ? `<p><strong>سبب الاختيار:</strong> ${escapeHtml(
                    reason
                  )}</p>`
                : ""
            }
          </li>
        `;
      })
      .join("");

    dom.aiOutput.innerHTML = `
      <h3>${escapeHtml(title)}</h3>
      <ol class="ai-list">
        ${htmlItems}
      </ol>
    `;
  }

  function renderRandomStoriesInAiPanel(list) {
    if (!dom.aiOutput) return;

    if (!Array.isArray(list) || !list.length) {
      dom.aiOutput.innerHTML =
        "<p>لم يتم العثور على قصص مناسبة وفقًا للمعادلة (40% تقييم شخصي + 60% تريند).</p>";
      return;
    }

    const htmlItems = list
      .map((item, idx) => {
        const name = item.name || "";
        const personal = item.personalScore ?? "";
        const trend = item.trendScore != null ? round2(item.trendScore) : "";
        const finalScore =
          item.finalScore != null ? round2(item.finalScore) : "";

        return `
          <li>
            <h4>${idx + 1}. ${escapeHtml(name)}</h4>
            <p><strong>تقييمك الشخصي:</strong> ${personal}</p>
            <p><strong>درجة التريند (Google/Bing + YouTube):</strong> ${trend}</p>
            <p><strong>الدرجة النهائية (40% شخصي + 60% تريند):</strong> ${finalScore}</p>
          </li>
        `;
      })
      .join("");

    dom.aiOutput.innerHTML = `
      <h3>🎲 أفضل 10 قصص عشوائية مرتبة حسب (40% تقييم شخصي + 60% تريند)</h3>
      <ol class="ai-list">
        ${htmlItems}
      </ol>
      <p class="hint">
        ✅ تم استبعاد القصص التي تم تنفيذها بالفعل (المعلّمة كـ "منفّذة") من الحساب.
      </p>
    `;
  }

  // ===============================
  // تشغيل أولي
  // ===============================

  document.addEventListener("DOMContentLoaded", () => {
    initDomRefs();
    bindEvents();
    updateStatusPills();
    // autoLoadBackupIfExists يتم استدعاؤها في window.load
  });
})();
