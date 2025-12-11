/* ============================================================
   نظام ذكاء اختيار القصص – إيه الحكاية
   واجهة JavaScript للتعامل مع السيرفر الوسيط (Cloudflare Worker)
   ============================================================ */

/*  
  ⚠️ مهم جدًا:
  بعد إنشاء Cloudflare Worker سنضع رابط الـ API هنا.
  مثال:
  const API_BASE = "https://hasaballa-api.workers.dev";
*/

const API_BASE = "YOUR_WORKER_URL_HERE";

/* سرّ الوصول للسيرفر الوسيط */
const SECRET_KEY = "YOUR_SECRET_KEY"; // هنغيره بعد إنشاء الـ Worker

/* عناصر الواجهة */
const aiOutputEl = document.getElementById("ai-output");
const storiesTbody = document.getElementById("stories-tbody");

let stories = [];

/* ===========================
   تحميل القصص من LocalStorage
   =========================== */
function loadStories() {
  const saved = localStorage.getItem("eh_stories");
  if (saved) {
    try {
      stories = JSON.parse(saved);
    } catch {
      stories = [];
    }
  }
  renderStoriesTable();
}

function saveStories() {
  localStorage.setItem("eh_stories", JSON.stringify(stories));
}

/* ===========================
   إضافة قصص من النص الخام
   =========================== */
document.getElementById("btn-parse-raw").onclick = () => {
  const raw = document.getElementById("raw-input").value.trim();
  if (!raw) return alert("الصق أسماء القصص أولًا.");

  const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const today = new Date().toISOString().slice(0, 10);

  let added = 0;

  for (const line of lines) {
    if (stories.some(s => s.name === line)) continue;

    const story = {
      id: Math.random().toString(36).substr(2, 9),
      name: line,
      baseScore: 50,
      done: false,
      added: today,
      analysis: null
    };

    stories.push(story);
    added++;
  }

  saveStories();
  renderStoriesTable();

  aiOutputEl.innerHTML = `✅ تم إضافة <strong>${added}</strong> قصة.`;
};

/* ================
   تحديث التريندات
   ================ */
document.getElementById("btn-update-trends").onclick = async () => {
  aiOutputEl.innerHTML = "⏳ يتم الآن جلب التريندات من السيرفر الوسيط...";

  try {
    const res = await fetch(`${API_BASE}/api/update-trends`, {
      headers: { "X-Hasaballa-Key": SECRET_KEY }
    });

    const data = await res.json();

    aiOutputEl.innerHTML = `
      ✅ <strong>تم تحديث التريندات</strong><br>
      Google Trends: ${data.google.status}<br>
      YouTube Trending: ${data.youtube.status}<br>
      Recent Deaths: ${data.deaths.status}
    `;
  } catch (err) {
    aiOutputEl.innerHTML = `❌ خطأ أثناء جلب التريندات: ${err}`;
  }
};

/* ==============================
   اختيار قصة لفيديو طويل – AI
   ============================== */
document.getElementById("btn-pick-long").onclick = async () => {
  aiOutputEl.innerHTML = "⏳ يحلل الآن أفضل قصة لفيديو طويل...";

  try {
    const res = await fetch(`${API_BASE}/api/pick-long-story`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hasaballa-Key": SECRET_KEY
      },
      body: JSON.stringify({ stories })
    });

    const data = await res.json();

    aiOutputEl.innerHTML = formatLongStoryOutput(data);
  } catch (err) {
    aiOutputEl.innerHTML = `❌ خطأ أثناء اختيار القصة: ${err}`;
  }
};

/* ==============================
   اختيار قصة قصيرة (ريلز)
   ============================== */
document.getElementById("btn-pick-short").onclick = async () => {
  aiOutputEl.innerHTML = "⏳ يحلل الآن أفضل قصة قصيرة...";

  try {
    const res = await fetch(`${API_BASE}/api/pick-short-story`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Hasaballa-Key": SECRET_KEY
      },
      body: JSON.stringify({ stories })
    });

    const data = await res.json();

    aiOutputEl.innerHTML = formatShortStoryOutput(data);

  } catch (err) {
    aiOutputEl.innerHTML = `❌ خطأ أثناء اختيار الريلز: ${err}`;
  }
};

/* ======================================
   تنسيق نتائج الفيديو الطويل في الواجهة
   ====================================== */
function formatLongStoryOutput(d) {
  return `
    <h3>🎥 أفضل قصة للفيديو الطويل</h3>
    <p><strong>${d.story}</strong></p>

    <h4>🧠 سبب الاختيار</h4>
    <ul>
      <li>نوع القصة: ${d.type}</li>
      <li>عامل الجاذبية: ${d.attractiveness}/100</li>
      <li>فرصة الفيرال: ${d.viral}%</li>
      <li>مستوى التشبع: ${d.saturation}</li>
    </ul>

    <h4>📊 توقع المشاهدات</h4>
    <p>${d.views.min} → ${d.views.max} مشاهدة</p>

    <h4>🏷️ كلمات مفتاحية</h4>
    <p>${d.keywords.join(" ، ")}</p>

    <h4>🖼️ فكرة الصورة المصغرة</h4>
    <p>${d.thumbnail}</p>
  `;
}

/* ======================================
   تنسيق نتائج الريلز
   ====================================== */
function formatShortStoryOutput(d) {
  return `
    <h3>⚡ قصة مقترحة للريلز</h3>
    <p><strong>${d.story}</strong></p>

    <h4>🎯 عنوان مقترح</h4>
    <p>${d.title}</p>

    <h4>وصف الفيديو</h4>
    <p>${d.description}</p>

    <h4>هاشتاجات</h4>
    <p>${d.hashtags.join(" ")}</p>

    <h4>⏱ مدة الفيديو المقترحة</h4>
    <p>${d.duration}</p>

    <h4>🔥 سبب قوة الموضوع</h4>
    <p>${d.reason}</p>
  `;
}

/* ===========================
   الجدول – عرض القصص
   =========================== */
function renderStoriesTable() {
  storiesTbody.innerHTML = "";

  stories.forEach((s, i) => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${s.name}</td>
      <td>${s.analysis ? s.analysis.type : "-"}</td>
      <td>${s.baseScore}</td>
      <td>${s.analysis ? s.analysis.attractiveness : "-"}</td>
      <td>${s.analysis ? s.analysis.intelligence : "-"}</td>
      <td>${s.done ? "✔" : "✘"}</td>
      <td>${s.added}</td>
      <td>
        <button onclick="toggleDone('${s.id}')">✓</button>
        <button onclick="deleteStory('${s.id}')">🗑</button>
      </td>
    `;

    storiesTbody.appendChild(tr);
  });
}

function toggleDone(id) {
  stories = stories.map(s => s.id === id ? { ...s, done: !s.done } : s);
  saveStories();
  renderStoriesTable();
}

function deleteStory(id) {
  stories = stories.filter(s => s.id !== id);
  saveStories();
  renderStoriesTable();
}

/* ===========================
   تصدير / استيراد القصص
   =========================== */
document.getElementById("btn-export").onclick = () => {
  const blob = new Blob([JSON.stringify(stories, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "stories.json";
  a.click();
};

document.getElementById("import-file").onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      stories = JSON.parse(reader.result);
      saveStories();
      renderStoriesTable();
    } catch {
      alert("ملف غير صالح.");
    }
  };
  reader.readAsText(file);
};

/* ===========================
   بدء التطبيق
   =========================== */
loadStories();

