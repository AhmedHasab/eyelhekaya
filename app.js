/*******************************************************
 * app.js
 * ذكاء اختيار القصص – واجهة العميل (Frontend)
 * -----------------------------------------------------
 * Source of Truth: Cloudflare Worker (KV)
 * LocalStorage: Cache / Fallback / UI State ONLY
 *******************************************************/

/* =====================================================
   CONSTANTS
===================================================== */

const WORKER_URL = "https://odd-credit-25c6.namozg50.workers.dev";
const WORKER_API = "https://odd-credit-25c6.namozg50.workers.dev/";

const STORAGE_KEY_STORIES = "eh_story_picker_stories_v1";
const STORAGE_KEY_STATUS = "eh_story_picker_status_v1";
const STORAGE_KEY_LAYOUT = "eh_story_picker_layout_v1";
const STORAGE_KEY_AI_CACHE = "eh_story_picker_ai_cache_v1";

const BACKUP_MIN_INTERVAL_MS = 15000;

/* =====================================================
   GLOBAL STATE
===================================================== */

let stories = [];                 // ← من السيرفر فقط
let editingStoryId = null;
let lastBackupTime = 0;

/* =====================================================
   DOM REFERENCES
===================================================== */

let aiOutputEl, aiPanelEl, storiesPanelEl;
let storiesTbodyEl, rawInputEl;
let manualNameEl, manualTypeEl, manualScoreEl, manualNotesEl;
let importFileEl, searchInputEl;
let statusTrendsEl, statusYoutubeEl, statusDeathsEl;
let suggestionsBoxEl = null;

/* =====================================================
   HELPERS
===================================================== */

function normalizeArabic(str = "") {
  let s = str.toString().toLowerCase();
  s = s.replace(/[أإآا]/g, "ا").replace(/[ىي]/g, "ي").replace(/ة/g, "ه");
  s = s.replace(/[\u064B-\u0652]/g, "");
  s = s.replace(/[^\p{L}\p{N}\s]/gu, " ");
  return s.replace(/\s+/g, " ").trim();
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(d) {
  try {
    return new Date(d).toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

/* =====================================================
   AUTO BACKUP (DOWNLOAD ONLY)
===================================================== */

function autoDownloadBackup() {
  const now = Date.now();
  if (now - lastBackupTime < BACKUP_MIN_INTERVAL_MS) return;
  lastBackupTime = now;

  const payload = {
    exportedAt: new Date().toISOString(),
    stories
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `stories-backup-${todayISO()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* =====================================================
   AI CACHE (24h)
===================================================== */

function aiCacheKey(action) {
  return `${action}:${todayISO()}`;
}

function getCachedAi(action) {
  try {
    const cache = JSON.parse(localStorage.getItem(STORAGE_KEY_AI_CACHE) || "{}");
    const entry = cache[aiCacheKey(action)];
    if (!entry) return null;
    if (Date.now() - entry.ts > 24 * 60 * 60 * 1000) return null;
    return entry.data;
  } catch {
    return null;
  }
}

function setCachedAi(action, data) {
  try {
    const cache = JSON.parse(localStorage.getItem(STORAGE_KEY_AI_CACHE) || "{}");
    cache[aiCacheKey(action)] = { ts: Date.now(), data };
    localStorage.setItem(STORAGE_KEY_AI_CACHE, JSON.stringify(cache));
  } catch {}
}

/* =====================================================
   STATUS PILLS
===================================================== */

function loadStatus() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY_STATUS) || "{}");
  } catch {
    return {};
  }
}

function saveStatus(st) {
  localStorage.setItem(STORAGE_KEY_STATUS, JSON.stringify(st));
}

function updatePill(el, text, cls) {
  el.textContent = text;
  el.classList.remove("ok", "warn", "muted");
  el.classList.add(cls);
}

function refreshStatusPills() {
  const st = loadStatus();
  if (st.trendsUpdatedAt)
    updatePill(statusTrendsEl, "تريندات محدثة", "ok");
  if (st.youtubeUpdatedAt)
    updatePill(statusYoutubeEl, "YouTube محدث", "ok");
  if (st.deathsUpdatedAt)
    updatePill(statusDeathsEl, "وفيات حديثة", "warn");
}

/* =====================================================
   WORKER COMMUNICATION
===================================================== */

async function callWorker(action, payload = {}, cacheable = false) {
  if (cacheable) {
    const cached = getCachedAi(action);
    if (cached) return cached;
  }

  const res = await fetch(WORKER_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, payload })
  });

  if (!res.ok) throw new Error("Worker error");
  const data = await res.json();
  if (cacheable) setCachedAi(action, data);
  return data;
}

/* =====================================================
   LOAD STORIES
===================================================== */

async function loadStoriesFromServer() {
  try {
    const data = await callWorker("get_stories");
    if (Array.isArray(data.stories)) {
      stories = data.stories;
      localStorage.setItem(STORAGE_KEY_STORIES, JSON.stringify(stories));
      renderStoriesTable(stories);
    }
  } catch {
    const cached = localStorage.getItem(STORAGE_KEY_STORIES);
    if (cached) {
      stories = JSON.parse(cached);
      renderStoriesTable(stories);
    }
  }
}

/* =====================================================
   CRUD – SERVER FIRST
===================================================== */

async function addStoryToServer(story) {
  await callWorker("add_story", story);
  await loadStoriesFromServer();
  autoDownloadBackup();
}

async function updateStoryOnServer(id, updates) {
  await callWorker("update_story", { id, updates });
  await loadStoriesFromServer();
}

async function deleteStoryFromServer(id) {
  if (!confirm("حذف القصة؟")) return;
  await callWorker("delete_story", { id });
  await loadStoriesFromServer();
}

/* =====================================================
   RENDER STORIES TABLE
===================================================== */

function renderStoriesTable(list) {
  storiesTbodyEl.innerHTML = "";
  list.forEach((s, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${s.title}</td>
      <td>${s.category || ""}</td>
      <td>${s.score}</td>
      <td>${s.score}</td>
      <td>${s.finalScore ?? "—"}</td>
      <td><span class="${s.done ? "badge-done" : "badge-not-done"}">
        ${s.done ? "✔" : "✖"}</span></td>
      <td>${formatDate(s.createdAt)}</td>
      <td>${s.notes || ""}</td>
      <td class="table-actions"></td>
    `;

    const actions = tr.querySelector(".table-actions");

    const btnView = document.createElement("button");
    btnView.textContent = "👁";
    btnView.onclick = () => showStoryDetails(s.id);
    actions.appendChild(btnView);

    const btnEdit = document.createElement("button");
    btnEdit.textContent = "✏";
    btnEdit.onclick = () => startEditStory(s.id);
    actions.appendChild(btnEdit);

    const btnDone = document.createElement("button");
    btnDone.textContent = s.done ? "↩" : "✔";
    btnDone.onclick = () =>
      updateStoryOnServer(s.id, { done: !s.done });
    actions.appendChild(btnDone);

    const btnDel = document.createElement("button");
    btnDel.textContent = "🗑";
    btnDel.onclick = () => deleteStoryFromServer(s.id);
    actions.appendChild(btnDel);

    storiesTbodyEl.appendChild(tr);
  });
}

/* =====================================================
   VIEW / EDIT
===================================================== */

function showStoryDetails(id) {
  const s = stories.find(x => x.id === id);
  if (!s) return;
  aiOutputEl.innerHTML = `
    <h3>${s.title}</h3>
    <ul>
      <li>التصنيف: ${s.category}</li>
      <li>الدرجة: ${s.score}</li>
      <li>تم التنفيذ: ${s.done ? "نعم" : "لا"}</li>
      <li>ملاحظات: ${s.notes || "—"}</li>
    </ul>`;
}

function startEditStory(id) {
  const s = stories.find(x => x.id === id);
  if (!s) return;
  editingStoryId = id;
  manualNameEl.value = s.title;
  manualTypeEl.value = s.category;
  manualScoreEl.value = s.score;
  manualNotesEl.value = s.notes || "";
}

/* =====================================================
   ADD / PARSE / IMPORT
===================================================== */

function addStoryManual() {
  const title = manualNameEl.value.trim();
  if (!title) return;

  const payload = {
    title,
    category: manualTypeEl.value,
    type: "long",
    score: Number(manualScoreEl.value || 80),
    notes: manualNotesEl.value,
    done: false,
    source: "manual",
    country: "",
    createdAt: new Date().toISOString()
  };

  if (editingStoryId) {
    updateStoryOnServer(editingStoryId, payload);
    editingStoryId = null;
  } else {
    addStoryToServer(payload);
  }

  manualNameEl.value = manualNotesEl.value = "";
}

function parseRawInput() {
  rawInputEl.value.split("\n").forEach(line => {
    const t = line.trim();
    if (!t) return;
    addStoryToServer({
      title: t,
      category: "",
      type: "long",
      score: 80,
      done: false,
      notes: "",
      source: "raw",
      country: "",
      createdAt: new Date().toISOString()
    });
  });
  rawInputEl.value = "";
}

/* =====================================================
   SEARCH + SUGGESTIONS
===================================================== */

function filterStories() {
  const q = normalizeArabic(searchInputEl.value);
  const matches = stories.filter(s =>
    normalizeArabic(s.title).includes(q)
  );
  renderStoriesTable(matches);
}

/* =====================================================
   LAYOUT
===================================================== */

function setLayout(mode) {
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

function restoreLayout() {
  setLayout(localStorage.getItem(STORAGE_KEY_LAYOUT) || "both");
}

/* =====================================================
   INIT
===================================================== */

document.addEventListener("DOMContentLoaded", () => {
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

  document.getElementById("btn-parse-raw").onclick = parseRawInput;
  document.getElementById("btn-add-manual").onclick = addStoryManual;
  document.getElementById("btn-show-ai-only").onclick = () => setLayout("ai");
  document.getElementById("btn-show-stories-only").onclick = () => setLayout("stories");
  document.getElementById("btn-show-both").onclick = () => setLayout("both");
  searchInputEl.oninput = filterStories;

  restoreLayout();
  refreshStatusPills();
  loadStoriesFromServer();
});
