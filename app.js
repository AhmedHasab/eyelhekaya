/* ============================================================
   ⚡ Hasaballa Story Picker – Final APP.JS
   إعادة بناء كاملة – إصدار 2025
   يعمل مع Worker.js المرسل سابقًا
============================================================ */

/* ------------------------------------------------------------
   1) المتغيرات العامة
------------------------------------------------------------ */
let stories = [];
let worker = null;
let CACHE = {
  trendLong: null,
  trendShort: null,
  random: null,
  timestamp: 0,
};

/* ------------------------------------------------------------
   2) توحيد النص – إزالة الهمزات والنقط والشرطات
------------------------------------------------------------ */
function normalize(str) {
  if (!str) return "";
  return str
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/-/g, " ")
    .replace(/[^\w\s\u0600-\u06FF]/g, "")
    .trim();
}

/* ------------------------------------------------------------
   3) تحميل القصص من LocalStorage
------------------------------------------------------------ */
function loadStories() {
  const saved = localStorage.getItem("stories");
  if (saved) stories = JSON.parse(saved);
}

function saveStories() {
  localStorage.setItem("stories", JSON.stringify(stories));
}

/* ------------------------------------------------------------
   4) ربط الـ Worker
------------------------------------------------------------ */
function initWorker() {
  worker = new Worker("worker.js");

  worker.onmessage = (e) => {
    const { type, payload } = e.data;

    if (type === "TREND_LONG_RESULT") {
      CACHE.trendLong = payload.items;
      CACHE.timestamp = Date.now();
      renderAIResults(payload.items, false);
      updateStatus("long");
    }

    if (type === "TREND_SHORT_RESULT") {
      CACHE.trendShort = payload.items;
      CACHE.timestamp = Date.now();
      renderAIResults(payload.items, true);
      updateStatus("short");
    }

    if (type === "RANDOM_STORIES_RESULT") {
      CACHE.random = payload;
      CACHE.timestamp = Date.now();
      renderRandomResults(payload);
      updateStatus("random");
    }
  };
}

/* ------------------------------------------------------------
   5) Status Pills
------------------------------------------------------------ */
function updateStatus(type) {
  const now = Date.now();
  const pillTrend = document.getElementById("status-trends");
  const pillYT = document.getElementById("status-youtube");

  const fresh = now - CACHE.timestamp < 24 * 60 * 60 * 1000;

  if (fresh) {
    pillTrend.textContent = "✓ تم تحديث التريند";
    pillTrend.className = "status-pill ok";

    pillYT.textContent = "✓ تم تحديث YouTube";
    pillYT.className = "status-pill ok";
  }
}

/* ------------------------------------------------------------
   6) عرض نتائج التريند (كروت)
------------------------------------------------------------ */
function renderAIResults(items, isShort) {
  const output = document.getElementById("ai-output");
  output.innerHTML = "";

  items.forEach((item, i) => {
    const div = document.createElement("div");
    div.className = "trend-card";

    div.innerHTML = `
      <div class="trend-rank">#${i + 1}</div>
      <div class="trend-title">${item.title}</div>

      <div class="trend-meta">
        <span>الدولة: ${item.country}</span> |
        <span>النوع: ${item.category}</span>
      </div>

      <div class="trend-scores">
        <span>📊 التريند: ${item.score}</span>
        <span>🔥 YouTube: ${item.ytScore}</span>
      </div>

      ${item.url ? `<a href="${item.url}" class="trend-link" target="_blank">رابط</a>` : ""}

      <button class="btn primary small add-btn" data-i="${i}">➕ إضافة للقائمة</button>
    `;

    output.appendChild(div);
  });

  // إضافة القصة من التريند
  document.querySelectorAll(".add-btn").forEach((btn) => {
    btn.onclick = () => {
      const item = items[btn.dataset.i];
      addStoryFromTrend(item, isShort);
    };
  });
}

/* ------------------------------------------------------------
   7) عرض نتائج زر العشوائي
------------------------------------------------------------ */
function renderRandomResults(results) {
  const output = document.getElementById("ai-output");
  output.innerHTML = "<h3>🔀 أفضل 10 قصص بناءً على التقييم + التريند</h3>";

  results.forEach((r, i) => {
    const div = document.createElement("div");
    div.className = "trend-card";

    div.innerHTML = `
      <div class="trend-rank">#${i + 1}</div>
      <div class="trend-title">${r.name}</div>

      <div class="trend-scores">
        <span>شخصي: ${r.personal}</span>
        <span>تريند: ${r.trendScore}</span>
        <span>نهائي: ${r.finalScore}</span>
      </div>

      ${r.url ? `<a href="${r.url}" target="_blank">رابط</a>` : ""}
    `;

    output.appendChild(div);
  });
}

/* ------------------------------------------------------------
   8) إضافة قصة من التريند
------------------------------------------------------------ */
function addStoryFromTrend(item, isShort) {
  if (stories.some((s) => normalize(s.name) === normalize(item.title))) {
    alert("⚠️ القصة موجودة بالفعل");
    return;
  }

  const newStory = {
    id: Date.now(),
    name: item.title,
    type: isShort ? "short" : "long",
    score: 50,
    attraction: "-",
    analysis: "-",
    added: new Date().toISOString().split("T")[0],
    done: false,
    notes: `تريند من ${item.country}`,
  };

  stories.push(newStory);
  saveStories();
  renderStoriesTable();
  alert("تمت الإضافة");
}

/* ------------------------------------------------------------
   9) رسم جدول القصص (Long + Short)
------------------------------------------------------------ */
function renderStoriesTable() {
  const tbodyLong = document.getElementById("stories-tbody");
  const tbodyShort = document.getElementById("stories-short-tbody");

  tbodyLong.innerHTML = "";
  tbodyShort.innerHTML = "";

  stories.forEach((s, idx) => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td>${s.name}</td>
      <td>${s.type}</td>
      <td>${s.score}</td>
      <td>${s.attraction}</td>
      <td>${s.analysis}</td>
      <td>
        <span class="${s.done ? "badge-done" : "badge-not-done"}">
          ${s.done ? "تم" : "لم يتم"}
        </span>
      </td>
      <td>${s.added}</td>
      <td>${s.notes}</td>

      <td>
        <button class="btn secondary small" onclick="toggleDone(${s.id})">
          ${s.done ? "إلغاء" : "✓ تنفيذ"}
        </button>
        <button class="btn secondary small" onclick="deleteStory(${s.id})">🗑</button>
      </td>
    `;

    if (s.type === "short") tbodyShort.appendChild(tr);
    else tbodyLong.appendChild(tr);
  });
}

/* ------------------------------------------------------------
   10) حذف + تنفيذ
------------------------------------------------------------ */
function toggleDone(id) {
  stories = stories.map((s) =>
    s.id === id ? { ...s, done: !s.done } : s
  );
  saveStories();
  renderStoriesTable();
}

function deleteStory(id) {
  if (!confirm("هل أنت متأكد؟")) return;
  stories = stories.filter((s) => s.id !== id);
  saveStories();
  renderStoriesTable();
}

/* ------------------------------------------------------------
   11) البحث + الاقتراحات
------------------------------------------------------------ */
function initSearch() {
  const input = document.getElementById("stories-search");

  input.addEventListener("input", () => {
    const value = normalize(input.value);

    const filtered = stories.filter((s) =>
      normalize(s.name).includes(value)
    );

    renderStoriesTable(filtered);
  });
}

/* ------------------------------------------------------------
   12) إضافة نص خام → قصص
------------------------------------------------------------ */
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

/* ------------------------------------------------------------
   13) إضافة يدوي
------------------------------------------------------------ */
function addManual() {
  const name = document.getElementById("manual-name").value.trim();
  const type = document.getElementById("manual-type").value;
  const score = Number(document.getElementById("manual-score").value);
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

/* ------------------------------------------------------------
   14) استيراد + تصدير
------------------------------------------------------------ */
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

/* ------------------------------------------------------------
   15) Panel Switching
------------------------------------------------------------ */
function switchPanels() {
  const ai = document.querySelector(".ai-panel");
  const st = document.querySelector(".stories-panel");

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

/* ------------------------------------------------------------
   16) ربط الأزرار مع الـ Worker
------------------------------------------------------------ */
function bindButtons() {
  document.getElementById("btn-pick-today").onclick = () => {
    worker.postMessage({ type: "FETCH_TREND_LONG" });
  };

  document.getElementById("btn-pick-short").onclick = () => {
    worker.postMessage({ type: "FETCH_TREND_SHORT" });
  };

  document.getElementById("btn-pick-long").onclick = () => {
    worker.postMessage({
      type: "FETCH_RANDOM_STORIES",
      payload: { stories },
    });
  };

  document.getElementById("btn-update-trends").onclick = () => {
    CACHE.timestamp = 0;
    worker.postMessage({ type: "FETCH_TREND_LONG" });
  };

  document.getElementById("btn-parse-raw").onclick = parseRaw;
  document.getElementById("btn-add-manual").onclick = addManual;
  document.getElementById("btn-export").onclick = exportStories;
  document.getElementById("import-file").onchange = importStories;
}

/* ------------------------------------------------------------
   17) Boot
------------------------------------------------------------ */
window.onload = () => {
  loadStories();
  initWorker();
  bindButtons();
  switchPanels();
  initSearch();
  renderStoriesTable();
};
/* =====================================================
   🟢 Auto Backup + Auto Restore (Simple & Automatic)
   دالة واحدة فقط – بدون أي إعدادات – بدون تعديلات أخرى
===================================================== */

// 1) حفظ نسخة احتياطية تلقائيًا بعد أي تعديل
function autoBackup() {
  try {
    localStorage.setItem("stories_backup", JSON.stringify(stories));
  } catch (e) {
    console.warn("Backup failed:", e);
  }
}

// 2) استرجاع النسخة الاحتياطية عند فتح الموقع لو القصص فاضية
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

// 3) ندمج الدوال مع النظام تلقائيًا بدون تغيير أي كود آخر
//    نعدّل فقط وظائف الحفظ الأساسية لتفعيل AutoBackup
const _saveStoriesOriginal = saveStories;
saveStories = function () {
  _saveStoriesOriginal();
  autoBackup();
};

// 4) تشغيل Auto Restore عند بداية الصفحة
autoRestore();
