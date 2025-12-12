/* ============================================================
   Hasaballa – Story Picker App (نسخة مبسّطة مع Cloudflare Worker)
   - لا يوجد Web Worker محلي
   - اتصال مباشر مع Cloudflare Worker عبر fetch
   - تحميل القصص من localStorage أو stories.json
============================================================ */

/* --------------------- 0) متغيّرات عامة --------------------- */

let stories = [];
const CACHE = {
  trendLong: null,
  trendShort: null,
  randomStories: null,
  timestamp: 0,
};
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 ساعة

// ✨ IMPORTANT: غيّر هذا الرابط لرابط الـ Cloudflare Worker الخاص بك
const WORKER_URL = "https://odd-credit-25c6.namozg50.workers.dev"; // ← عدّل ده بس

window.stories = stories; // علشان سكربتات تانية لو احتاجته

/* --------------------- 1) أدوات عامة --------------------- */

function isCacheFresh() {
  return Date.now() - CACHE.timestamp < CACHE_TTL;
}

function normalize(str = "") {
  return str
    .toString()
    .trim()
    .replace(/[إأآا]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[ًٌٍَُِّْ]/g, "")
    .replace(/[^\w\u0600-\u06FF]+/g, "")
    .toLowerCase();
}

function updateStatus(id, text, cls) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  el.className = "status-pill " + (cls || "muted");
}

/* --------------------- 2) الاتصال بالـ Worker --------------------- */

async function callWorker(action, payload = null) {
  const url = new URL(WORKER_URL);
  url.searchParams.set("action", action);
  if (payload) {
    url.searchParams.set("payload", JSON.stringify(payload));
  }

  const res = await fetch(url.toString(), {
    method: "GET",
  });

  if (!res.ok) {
    throw new Error("Worker HTTP " + res.status);
  }

  const data = await res.json();
  if (data.error) {
    throw new Error(data.error);
  }

  return data;
}

/* --------------------- 3) تحميل / حفظ القصص --------------------- */

async function loadStories() {
  // 1) جرّب من localStorage
  try {
    const saved = localStorage.getItem("stories");
    if (saved) {
      stories = JSON.parse(saved) || [];
      window.stories = stories;
      return;
    }
  } catch (e) {
    console.warn("localStorage load error:", e);
  }

  // 2) لو مفيش، حمّل من stories.json
  try {
    const res = await fetch("stories.json");
    if (res.ok) {
      stories = await res.json();
      if (!Array.isArray(stories)) stories = [];
      saveStories(); // نحفظ نسخة في localStorage
      window.stories = stories;
      return;
    }
  } catch (e) {
    console.warn("fetch stories.json error:", e);
  }

  // 3) fallback
  if (!Array.isArray(stories)) stories = [];
  window.stories = stories;
}

function saveStories() {
  try {
    localStorage.setItem("stories", JSON.stringify(stories));
  } catch (e) {
    console.warn("localStorage save error:", e);
  }
  window.stories = stories;
}

/* --------------------- 4) عرض نتائج التريند --------------------- */

// نسخة بسيطة – سيتم استبدالها من app-extend.js / hasaballa-trend-extension.js
function renderAIResults(items, isShort = false) {
  const output = document.getElementById("ai-output");
  if (!output) return;

  output.innerHTML = "";

  if (!items || !items.length) {
    output.innerHTML = "<p>لا توجد نتائج متاحة حاليًا.</p>";
    return;
  }

  const ul = document.createElement("ul");
  ul.style.listStyle = "none";
  ul.style.padding = "0";

  items.forEach((item, idx) => {
    const li = document.createElement("li");
    li.style.marginBottom = "8px";
    li.innerHTML = `<strong>#${idx + 1}</strong> – ${item.title} (${item.country}) – ${item.score}`;
    ul.appendChild(li);
  });

  output.appendChild(ul);
}

window.renderAIResults = renderAIResults;

/* --------------------- 5) عرض نتائج Random Story --------------------- */

function renderRandomResults(list) {
  const output = document.getElementById("ai-output");
  if (!output) return;

  output.innerHTML = "";

  if (!list || !list.length) {
    output.innerHTML = "<p>لا توجد نتائج عشوائية متاحة.</p>";
    return;
  }

  const ul = document.createElement("ul");
  ul.style.listStyle = "none";
  ul.style.padding = "0";

  list.forEach((item, idx) => {
    const li = document.createElement("li");
    li.style.marginBottom = "8px";
    li.innerHTML = `
      <strong>#${idx + 1}</strong> – ${item.name}
      (الشخصي: ${item.personal} / التريند: ${item.trendScore} / النهائي: ${item.finalScore})
      ${item.url ? ` – <a href="${item.url}" target="_blank">رابط</a>` : ""}
    `;
    ul.appendChild(li);
  });

  output.appendChild(ul);
}

/* --------------------- 6) جدول القصص --------------------- */

function renderStoriesTable(list) {
  const tbodyLong = document.getElementById("stories-tbody");
  if (!tbodyLong) return;

  const tbodyShort = document.getElementById("stories-short-tbody"); // ممكن يكون مش موجود
  tbodyLong.innerHTML = "";
  if (tbodyShort) tbodyShort.innerHTML = "";

  const src = Array.isArray(list) ? list : stories;

  src.forEach((s, index) => {
    const tr = document.createElement("tr");

    const typeLabel = s.type || "long";

    tr.innerHTML = `
      <td>${index + 1}</td>
      <td>${s.name}</td>
      <td>${typeLabel}</td>
      <td>${s.score ?? "-"}</td>
      <td>${s.attraction ?? "-"}</td>
      <td>${s.analysis ?? "-"}</td>
      <td>
        <span class="${s.done ? "badge-done" : "badge-not-done"}">
          ${s.done ? "تم التنفيذ" : "لم تُنفذ بعد"}
        </span>
      </td>
      <td>${s.added || "-"}</td>
      <td>${s.notes || ""}</td>
      <td>
        <button class="btn secondary small" onclick="toggleDone(${s.id})">
          ${s.done ? "إلغاء" : "✓ تنفيذ"}
        </button>
        <button class="btn secondary small" onclick="deleteStory(${s.id})">🗑</button>
      </td>
    `;

    if (typeLabel === "short" && tbodyShort) {
      tbodyShort.appendChild(tr);
    } else {
      tbodyLong.appendChild(tr);
    }
  });
}

window.renderStoriesTable = renderStoriesTable;

/* --------------------- 7) حذف / تنفيذ --------------------- */

function toggleDone(id) {
  stories = stories.map((s) => (s.id === id ? { ...s, done: !s.done } : s));
  saveStories();
  renderStoriesTable();
}

function deleteStory(id) {
  if (!confirm("هل أنت متأكد من حذف هذه القصة؟")) return;
  stories = stories.filter((s) => s.id !== id);
  saveStories();
  renderStoriesTable();
}

window.toggleDone = toggleDone;
window.deleteStory = deleteStory;

/* --------------------- 8) البحث --------------------- */

function initSearch() {
  const input = document.getElementById("stories-search");
  if (!input) return;

  input.addEventListener("input", () => {
    const value = normalize(input.value);
    const filtered = stories.filter((s) => normalize(s.name).includes(value));
    renderStoriesTable(filtered);
  });
}

/* --------------------- 9) تحويل نص خام إلى قصص --------------------- */

function parseRaw() {
  const raw = document.getElementById("raw-input").value.trim();
  if (!raw) return;

  raw.split("\n").forEach((line) => {
    const name = line.trim();
    if (!name) return;

    if (!stories.some((s) => normalize(s.name) === normalize(name))) {
      stories.push({
        id: Date.now() + Math.random(),
        name,
        type: "long",
        score: 80,
        attraction: "-",
        analysis: "-",
        added: new Date().toISOString().split("T")[0],
        done: false,
        notes: "",
      });
    }
  });

  saveStories();
  renderStoriesTable();
}

/* --------------------- 10) إضافة يدوي --------------------- */

function addManual() {
  const name = document.getElementById("manual-name").value.trim();
  const type = document.getElementById("manual-type").value;
  const score = Number(document.getElementById("manual-score").value || 80);
  const notes = document.getElementById("manual-notes").value;

  if (!name) return alert("اكتب اسم القصة");

  stories.push({
    id: Date.now(),
    name,
    type: type || "long",
    score,
    attraction: "-",
    analysis: "-",
    added: new Date().toISOString().split("T")[0],
    done: false,
    notes,
  });

  saveStories();
  renderStoriesTable();
  alert("تمت الإضافة");
}

/* --------------------- 11) استيراد / تصدير --------------------- */

function exportStories() {
  const blob = new Blob([JSON.stringify(stories, null, 2)], {
    type: "application/json",
  });

  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "stories.json";
  a.click();
}

function importStories(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    stories = JSON.parse(reader.result);
    saveStories();
    renderStoriesTable();
  };
  reader.readAsText(file);
}

/* --------------------- 12) Panel Switching --------------------- */

function switchPanels() {
  const ai = document.querySelector(".ai-panel");
  const st = document.querySelector(".stories-panel");
  if (!ai || !st) return;

  document.getElementById("btn-show-ai-only").onclick = () => {
    ai.style.display = "block";
    st.style.display = "none";
  };

  document.getElementById("btn-show-stories-only").onclick = () => {
    ai.style.display = "none";
    st.style.display = "block";
  };

  document.getElementById("btn-show-both").onclick = () => {
    ai.style.display = "block";
    st.style.display = "block";
  };
}

/* --------------------- 13) ربط الأزرار مع Cloudflare Worker --------------------- */

function bindButtons() {
  // زر: اختيار قصة فيديو طويل وفقًا للتريند
  document.getElementById("btn-pick-long").onclick = async () => {
    try {
      updateStatus("status-trends", "جارِ تحليل تريند القصص الطويلة…", "warn");

      let items;
      if (isCacheFresh() && CACHE.trendLong) {
        items = CACHE.trendLong;
      } else {
        items = await callWorker("trend_long");
        CACHE.trendLong = items;
        CACHE.timestamp = Date.now();
      }

      renderAIResults(items, false);
      updateStatus("status-trends", "تم تحديث تريند القصص الطويلة", "ok");
    } catch (e) {
      console.error(e);
      updateStatus("status-trends", "تعذّر جلب التريند", "warn");
      alert("حدث خطأ أثناء الاتصال بالـ Worker (trend_long)");
    }
  };

  // زر: اختيار فيديو ريلز من التريند
  document.getElementById("btn-pick-short").onclick = async () => {
    try {
      updateStatus("status-youtube", "جارِ تحليل تريند الريلز…", "warn");

      let items;
      if (isCacheFresh() && CACHE.trendShort) {
        items = CACHE.trendShort;
      } else {
        items = await callWorker("trend_short");
        CACHE.trendShort = items;
        CACHE.timestamp = Date.now();
      }

      renderAIResults(items, true);
      updateStatus("status-youtube", "تم تحديث تريند الريلز", "ok");
    } catch (e) {
      console.error(e);
      updateStatus("status-youtube", "تعذّر جلب التريند", "warn");
      alert("حدث خطأ أثناء الاتصال بالـ Worker (trend_short)");
    }
  };

  // زر: اختيار قصة عشوائية مسجّلة بالموقع (يعتمد على stories.json + التريند)
  document.getElementById("btn-pick-today").onclick = async () => {
    try {
      updateStatus("status-deaths", "جارِ حساب أفضل القصص العشوائية…", "warn");

      let list;
      if (isCacheFresh() && CACHE.randomStories) {
        list = CACHE.randomStories;
      } else {
        const payload = {
          stories: stories.map((s) => ({
            name: s.name,
            score: s.score || 0,
          })),
        };

        list = await callWorker("random_stories", payload);
        CACHE.randomStories = list;
        CACHE.timestamp = Date.now();
      }

      renderRandomResults(list);
      updateStatus("status-deaths", "تم تحديث قائمة القصص العشوائية", "ok");
    } catch (e) {
      console.error(e);
      updateStatus("status-deaths", "تعذّر حساب القصص العشوائية", "warn");
      alert("حدث خطأ أثناء الاتصال بالـ Worker (random_stories)");
    }
  };

  // زر: تحديث التريندات (يمسح الكاش)
  document.getElementById("btn-update-trends").onclick = () => {
    CACHE.timestamp = 0;
    CACHE.trendLong = null;
    CACHE.trendShort = null;
    CACHE.randomStories = null;
    updateStatus("status-trends", "سيتم جلب التريند من جديد عند الطلب", "muted");
    updateStatus("status-youtube", "سيتم جلب التريند من جديد عند الطلب", "muted");
    updateStatus("status-deaths", "سيتم حساب القصص العشوائية من جديد عند الطلب", "muted");
  };

  // باقي الأزرار
  document.getElementById("btn-parse-raw").onclick = parseRaw;
  document.getElementById("btn-add-manual").onclick = addManual;
  document.getElementById("btn-export").onclick = exportStories;
  document.getElementById("import-file").onchange = importStories;
}

/* --------------------- 14) Auto Backup & Restore --------------------- */

function autoBackup() {
  try {
    localStorage.setItem("stories_backup", JSON.stringify(stories));
  } catch (e) {
    console.warn("Backup failed:", e);
  }
}

function autoRestore() {
  try {
    if ((!stories || stories.length === 0) && localStorage.getItem("stories_backup")) {
      stories = JSON.parse(localStorage.getItem("stories_backup"));
      saveStories();
    }
  } catch (e) {
    console.warn("Restore failed:", e);
  }
}

// نغلّف saveStories عشان يعمل Backup تلقائيًا
const _saveStoriesOriginal = saveStories;
saveStories = function () {
  _saveStoriesOriginal();
  autoBackup();
};

autoRestore();

/* --------------------- 15) Boot --------------------- */

window.onload = async () => {
  await loadStories();
  autoRestore();
  bindButtons();
  switchPanels();
  initSearch();
  renderStoriesTable();
};
