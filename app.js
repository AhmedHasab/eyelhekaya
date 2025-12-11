// app.js
// ذكاء اختيار القصص – "إيه الحكاية؟"

// =========================
// إعداد متغيرات عامة
// =========================

const TREND_API_URL = "/api/story-all"; 
// 🔧 لو الـ Worker على دومين مستقل:
// const TREND_API_URL = "https://odd-credit-25c6.namozg50.workers.dev";

let stories = [];       // كل القصص من stories.json + الإضافات
let trendData = null;   // بيانات التريند من الـ Worker

// عناصر DOM
let aiOutput;
let storiesTbody;
let rawInput;
let manualName, manualType, manualScore, manualNotes;
let statusTrends, statusYoutube, statusDeaths;
let searchInput;
let suggestionsBox;
let aiPanel, storiesPanel;

// =========================
// أدوات مساعدة
// =========================

// حماية من إدخال HTML
function escapeHtml(text) {
  if (!text && text !== 0) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// تحديث صندوق نتائج الذكاء
function setAI(html) {
  aiOutput.innerHTML = html;
}

// label للجاذبية حسب الـ score
function getAttractivenessLabel(score) {
  const s = Number(score) || 0;
  if (s >= 95) return "🔥 جذابة جدًا ومضمونة";
  if (s >= 85) return "✨ قوية ومناسبة للفيديو";
  if (s >= 75) return "👍 جيدة وتستحق التجربة";
  if (s >= 60) return "🙂 متوسطة – يمكن تطويرها";
  return "🕊 فكرة تجريبية";
}

// مبدئيًا: ذكاء = نفس السكور (تحسب لاحقًا مع تكامل جوجل/يوتيوب)
function getAIScoreLabel(score) {
  const s = Number(score) || 0;
  if (s >= 95) return "A+ – أولوية قصوى";
  if (s >= 85) return "A – أولوية عالية";
  if (s >= 75) return "B – جيدة";
  if (s >= 60) return "C – متوسطة";
  return "D – ضعيفة";
}

// تاريخ اليوم بصيغة YYYY-MM-DD
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// الحصول على ID جديد للقصص
function getNextStoryId() {
  if (!stories.length) return 1;
  return Math.max(...stories.map((s) => Number(s.id) || 0)) + 1;
}

// =========================
// تحميل وإدارة القصص (stories.json)
// =========================

async function loadStories() {
  try {
    const res = await fetch("stories.json", { cache: "no-cache" });
    if (!res.ok) throw new Error("خطأ في تحميل stories.json");
    const data = await res.json();
    stories = Array.isArray(data) ? data : [];
    renderStoriesTable(stories);
  } catch (err) {
    console.error(err);
    stories = [];
    setAI(
      `<p style="color:#b71c1c;">⚠ تعذر تحميل ملف القصص stories.json – تأكد أن الملف في نفس مجلد index.html وأنه بصيغة JSON صحيحة.</p>`
    );
  }
}

// رسم جدول القصص
function renderStoriesTable(list) {
  const rows = list.map((s, index) => {
    const done = !!s.done;
    const cat = s.category || "—";
    const added = s.added || "";
    const notes = s.notes || "";
    const score = s.score ?? "";
    const attract = getAttractivenessLabel(score);
    const aiScore = getAIScoreLabel(score);

    return `
      <tr data-id="${s.id}">
        <td>${index + 1}</td>
        <td>${escapeHtml(s.name)}</td>
        <td>${escapeHtml(cat)}</td>
        <td>${escapeHtml(score)}</td>
        <td>${escapeHtml(attract)}</td>
        <td>${escapeHtml(aiScore)}</td>
        <td>
          <span class="${done ? "badge-done" : "badge-not-done"}">
            ${done ? "تم" : "لم يتم"}
          </span>
        </td>
        <td>${escapeHtml(added)}</td>
        <td>${escapeHtml(notes)}</td>
        <td class="table-actions">
          <button class="btn secondary small js-show-story">عرض</button>
          <button class="btn secondary small js-toggle-done">${
            done ? "إلغاء" : "تم"
          }</button>
          <button class="btn secondary small js-delete-story">حذف</button>
        </td>
      </tr>
    `;
  });

  storiesTbody.innerHTML = rows.join("");
  attachRowEvents();
}

// ربط أزرار كل سطر
function attachRowEvents() {
  storiesTbody
    .querySelectorAll(".js-show-story")
    .forEach((btn) => btn.addEventListener("click", onRowShowStory));
  storiesTbody
    .querySelectorAll(".js-toggle-done")
    .forEach((btn) => btn.addEventListener("click", onRowToggleDone));
  storiesTbody
    .querySelectorAll(".js-delete-story")
    .forEach((btn) => btn.addEventListener("click", onRowDeleteStory));
}

// جلب قصة من ID
function findStoryByRow(btn) {
  const tr = btn.closest("tr");
  if (!tr) return null;
  const id = Number(tr.dataset.id);
  return stories.find((s) => Number(s.id) === id) || null;
}

// عرض تفاصيل قصة من الجدول
function onRowShowStory(e) {
  const story = findStoryByRow(e.target);
  if (!story) return;
  showStoryDetails(story);
}

// تغيير حالة التنفيذ
function onRowToggleDone(e) {
  const story = findStoryByRow(e.target);
  if (!story) return;
  story.done = !story.done;
  renderStoriesTable(stories);
}

// حذف قصة
function onRowDeleteStory(e) {
  const story = findStoryByRow(e.target);
  if (!story) return;
  const ok = window.confirm(
    `هل تريد حذف القصة "${story.name}" نهائيًا من القائمة؟`
  );
  if (!ok) return;
  stories = stories.filter((s) => s !== story);
  renderStoriesTable(stories);
}

// عرض القصة في لوحة "نتائج الذكاء"
function showStoryDetails(story) {
  const cat = story.category || "غير محددة";
  const score = story.score ?? "—";
  const added = story.added || "غير معروف";
  const notes = story.notes || "—";
  const attract = getAttractivenessLabel(score);
  const aiScore = getAIScoreLabel(score);

  setAI(`
    <h3>📖 تفاصيل القصة المختارة</h3>
    <p><strong>الاسم:</strong> ${escapeHtml(story.name)}</p>
    <p><strong>الفئة:</strong> ${escapeHtml(cat)}</p>
    <p><strong>تقييمك الشخصي (الدرجة):</strong> ${escapeHtml(score)}</p>
    <p><strong>تقدير الجاذبية:</strong> ${escapeHtml(attract)}</p>
    <p><strong>تقدير ذكاء الاختيار:</strong> ${escapeHtml(aiScore)}</p>
    <p><strong>تاريخ الإضافة:</strong> ${escapeHtml(added)}</p>
    <p><strong>ملاحظات / روابط:</strong> ${escapeHtml(notes)}</p>
    <hr>
    <p>🎬 يمكنك استخدام هذه القصة كفيديو طويل أو ريلز حسب طريقة التناول البصري والدرامي.</p>
  `);
}

// =========================
// إدخال خام + إدخال يدوي
// =========================

// تحويل النص الخام إلى قصص
function handleParseRaw() {
  const text = rawInput.value || "";
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (!lines.length) {
    alert("اكتب سطر واحد على الأقل في مربع النص الخام.");
    return;
  }

  const baseScore = 80;

  lines.forEach((nameLine) => {
    const story = {
      id: getNextStoryId(),
      name: nameLine,
      score: baseScore,
      done: false,
      category: "",
      added: todayISO(),
      notes: "",
      analysis: null,
    };
    stories.push(story);
  });

  rawInput.value = "";
  renderStoriesTable(stories);
  setAI(
    `<p>✅ تم إضافة ${lines.length} قصة من النص الخام بنجاح. يمكنك الآن تعديل الفئات أو الدرجات من الجدول أو البحث عنها من شريط البحث.</p>`
  );
}

// إضافة قصة يدويًا
function handleAddManual() {
  const name = (manualName.value || "").trim();
  const type = manualType.value || "";
  const scoreVal = Number(manualScore.value || 0);
  const notes = (manualNotes.value || "").trim();

  if (!name) {
    alert("من فضلك اكتب اسم القصة.");
    return;
  }

  const story = {
    id: getNextStoryId(),
    name,
    score: isNaN(scoreVal) ? 80 : Math.max(0, Math.min(100, scoreVal)),
    done: false,
    category: type,
    added: todayISO(),
    notes,
    analysis: null,
  };

  stories.push(story);
  renderStoriesTable(stories);

  manualName.value = "";
  manualType.value = "";
  manualScore.value = "80";
  manualNotes.value = "";

  setAI(
    `<p>✅ تم إضافة القصة "<strong>${escapeHtml(
      name
    )}</strong>" يدويًا.</p>`
  );
}

// =========================
// تصدير / استيراد القصص
// =========================

function handleExportStories() {
  const blob = new Blob([JSON.stringify(stories, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `stories-export-${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function handleImportStories(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!Array.isArray(data)) throw new Error("not array");
      stories = data;
      renderStoriesTable(stories);
      setAI(
        `<p>✅ تم استيراد ${stories.length} قصة من الملف بنجاح.</p>`
      );
    } catch (err) {
      console.error(err);
      alert("⚠ ملف غير صالح. تأكد أنه JSON يحتوي على مصفوفة قصص.");
    } finally {
      event.target.value = "";
    }
  };
  reader.readAsText(file, "utf-8");
}

// =========================
// البحث + القائمة المنسدلة
// =========================

function setupSearchSuggestions() {
  suggestionsBox = document.createElement("div");
  suggestionsBox.id = "stories-search-suggestions";
  suggestionsBox.style.border = "1px solid #ddd";
  suggestionsBox.style.background = "#fff";
  suggestionsBox.style.maxHeight = "200px";
  suggestionsBox.style.overflowY = "auto";
  suggestionsBox.style.fontSize = "0.85rem";
  suggestionsBox.style.marginTop = "4px";
  suggestionsBox.style.display = "none";
  suggestionsBox.style.borderRadius = "8px";
  suggestionsBox.style.boxShadow = "0 2px 8px rgba(0,0,0,0.08)";
  suggestionsBox.style.zIndex = "10";

  searchInput.parentNode.appendChild(suggestionsBox);

  suggestionsBox.addEventListener("click", (e) => {
    const item = e.target.closest(".suggestion-item");
    if (!item) return;
    const id = Number(item.dataset.id);
    const story = stories.find((s) => Number(s.id) === id);
    if (!story) return;
    searchInput.value = story.name;
    suggestionsBox.style.display = "none";
    showStoryDetails(story);
  });
}

function handleSearchInput() {
  const q = (searchInput.value || "").trim();
  if (!q) {
    suggestionsBox.style.display = "none";
    // رجّع الجدول كما هو
    renderStoriesTable(stories);
    return;
  }

  const matches = stories.filter((s) =>
    s.name.toLowerCase().includes(q.toLowerCase())
  );

  // تحديث الجدول طبقًا للبحث
  renderStoriesTable(matches);

  // بناء القائمة المنسدلة
  if (!matches.length) {
    suggestionsBox.innerHTML =
      '<div style="padding:6px 10px;color:#777;">لا توجد نتائج مطابقة.</div>';
    suggestionsBox.style.display = "block";
    return;
  }

  const items = matches.slice(0, 20).map(
    (s) => `
      <div class="suggestion-item" data-id="${s.id}"
           style="padding:6px 10px; cursor:pointer; border-bottom:1px solid #f3f3f3;">
        ${escapeHtml(s.name)}
      </div>
    `
  );
  suggestionsBox.innerHTML = items.join("");
  suggestionsBox.style.display = "block";
}

// =========================
// التريند – جلب من الـ Worker
// =========================

function setTrendStatusesLoading() {
  statusTrends.textContent = "⏳ جاري تحميل تريندات Google/YouTube...";
  statusTrends.classList.remove("muted", "ok");
  statusTrends.classList.add("warn");

  statusYoutube.textContent = "⏳ يتم الآن استخدام بيانات YouTube مع Google";
  statusYoutube.classList.remove("muted", "ok");
  statusYoutube.classList.add("warn");
}

function setTrendStatusesOK(updatedDateText) {
  statusTrends.textContent =
    "✅ تم تحميل تريندات Google/YouTube لآخر سنة " +
    (updatedDateText ? `(${updatedDateText})` : "");
  statusTrends.classList.remove("muted", "warn");
  statusTrends.classList.add("ok");

  statusYoutube.textContent = "✅ نتائج YouTube مدمجة في التحليل";
  statusYoutube.classList.remove("muted", "warn");
  statusYoutube.classList.add("ok");

  statusDeaths.textContent = "ℹ لم يتم ربط وفيات آخر 48 ساعة بعد";
  statusDeaths.classList.remove("ok");
  statusDeaths.classList.add("warn");
}

function setTrendStatusesError() {
  statusTrends.textContent = "⚠ تعذر تحميل التريندات – تحقق من رابط الـ Worker.";
  statusTrends.classList.remove("ok", "muted");
  statusTrends.classList.add("warn");

  statusYoutube.textContent = "⚠ لم يتم تحديث تريندات YouTube.";
  statusYoutube.classList.remove("ok", "muted");
  statusYoutube.classList.add("warn");
}

async function ensureTrendsLoaded() {
  if (trendData) return trendData;

  try {
    setTrendStatusesLoading();
    const res = await fetch(TREND_API_URL, { cache: "no-cache" });
    if (!res.ok) throw new Error("Trend API not OK");
    const data = await res.json();
    trendData = data;
    const updatedText = data.updated
      ? new Date(data.updated).toLocaleString("ar-EG")
      : "";
    setTrendStatusesOK(updatedText);
    return trendData;
  } catch (err) {
    console.error(err);
    setTrendStatusesError();
    throw err;
  }
}

// زر "📈 تحديث التريندات"
async function handleUpdateTrends() {
  try {
    setAI(`<p>⏳ جاري تحديث التريندات من Google و YouTube لآخر سنة...</p>`);
    trendData = null;
    const data = await ensureTrendsLoaded();
    const totalBlocks = (data.countries || []).length;

    setAI(`
      <h3>📈 تم تحديث بيانات التريند بنجاح</h3>
      <p>تم جلب القصص من <strong>${totalBlocks}</strong> منطقة (دول عربية + مناطق عالمية).</p>
      <p>يمكنك الآن الضغط على:
        <br>🎬 "اختيار قصة فيديو طويل وفقا للترند"
        <br>⚡ "اختيار فيديو (ريلز) من الترند"
        لاختيار القصص الأنسب تلقائيًا.</p>
    `);
  } catch {
    // الحالة تم التعامل معها بالفعل في setTrendStatusesError
  }
}

// اختيار قصص لفيديوهات طويلة من التريند
async function handlePickTrendLongVideo() {
  try {
    setAI(`<p>⏳ جاري تحليل التريند لاختيار قصص لفيديو طويل...</p>`);
    const data = await ensureTrendsLoaded();

    const blocks = [];
    (data.countries || []).forEach((block) => {
      const stories = block.stories || [];
      if (!stories.length) return;

      const title = block.country || block.region || "منطقة";
      const typeLabel = block.type === "arab" ? "منطقة عربية" : "منطقة عالمية";

      const listHtml = stories
        .slice(0, 5)
        .map(
          (s, idx) => `
            <li>
              <strong>${idx + 1}. ${escapeHtml(s.title)}</strong><br>
              <small>${escapeHtml(s.snippet || "")}</small><br>
              ${
                s.link
                  ? `<a href="${s.link}" target="_blank" rel="noopener">🔗 مصدر القصة</a>`
                  : ""
              }
            </li>
          `
        )
        .join("");

      blocks.push(`
        <section class="trend-block">
          <h3>${escapeHtml(title)} – ${typeLabel}</h3>
          <ol>${listHtml}</ol>
        </section>
      `);
    });

    setAI(`
      <h3>🎥 أفضل القصص المقترحة لفيديوهات طويلة (تريند آخر سنة)</h3>
      <p>تم التركيز على:
        <br>• الجرائم المكتملة التي كُشف كل ملابساتها
        <br>• وفاة المشاهير (فن، سياسة، إعلام، رياضة...)
        <br>• الحروب والصراعات ذات الجذور التاريخية
      </p>
      ${blocks.join("")}
      <p>💡 اختَر قصة واحدة أو أكثر، ثم ارجع لقائمة القصص داخل الموقع لتسجّلها وتربطها بمشروع فيديو فعلي.</p>
    `);
  } catch {
    // تم التعامل مع الخطأ مسبقًا
  }
}

// اختيار قصص ريلز من التريند
async function handlePickTrendReels() {
  try {
    setAI(`<p>⏳ جاري تحليل التريند لاختيار قصص مناسبة للريلز (حتى 3 دقائق)...</p>`);
    const data = await ensureTrendsLoaded();

    const all = [];
    (data.countries || []).forEach((block) => {
      const regionLabel = block.country || block.region || "";
      const regionType = block.type || "";
      (block.stories || []).forEach((s) => {
        all.push({
          ...s,
          regionLabel,
          regionType,
        });
      });
    });

    // ترتيب حسب وزن التريند (أعلى أولاً)
    all.sort((a, b) => (b.weight || 0) - (a.weight || 0));

    // اختيار قصص قصيرة العنوان، مناسبة لريلز + عدد معقول
    const candidates = all
      .filter((s) => (s.title || "").length <= 60)
      .slice(0, 20);

    const items = candidates
      .map((s, idx) => {
        const regionTypeLabel =
          s.regionType === "arab" ? "منطقة عربية" : "منطقة عالمية";
        return `
          <li>
            <strong>${idx + 1}. ${escapeHtml(s.title)}</strong>
            <br><small>${escapeHtml(s.snippet || "")}</small>
            <br><small>🌍 ${escapeHtml(
              s.regionLabel
            )} – ${regionTypeLabel}</small>
            ${
              s.link
                ? `<br><a href="${s.link}" target="_blank" rel="noopener">🔗 مصدر القصة</a>`
                : ""
            }
          </li>
        `;
      })
      .join("");

    setAI(`
      <h3>⚡ ترشيحات ريلز (قصص تصلح لفيديوهات قصيرة حتى 3 دقائق)</h3>
      <p>الاختيار مبني على:
        <br>• قوة التريند خلال سنة كاملة (Google + YouTube)
        <br>• وضوح الحدث وسهولة تلخيصه في مدة قصيرة
        <br>• تفضيل العناوين الأقصر والأكثر مباشرة
      </p>
      <ol>${items}</ol>
      <p>🎯 استخدم هذه القائمة لاختيار ريلز سريع، ثم ارجع لقائمة القصص عندك لتسجيل الفكرة وتطويرها.</p>
    `);
  } catch {
    // تم التعامل مع الخطأ مسبقًا
  }
}

// =========================
// اختيار قصة عشوائية من القصص المسجَّلة
// =========================

// اختيار عشوائي بوزن الـ score
function pickWeightedRandomStory(list) {
  if (!list.length) return null;
  const total = list.reduce((sum, s) => sum + (Number(s.score) || 0), 0);
  if (!total) {
    // لو كلهم 0 – نختار عشوائي عادي
    return list[Math.floor(Math.random() * list.length)];
  }
  let r = Math.random() * total;
  for (const s of list) {
    r -= Number(s.score) || 0;
    if (r <= 0) return s;
  }
  return list[list.length - 1];
}

function handlePickRandomStory() {
  if (!stories.length) {
    alert("لا توجد قصص في القائمة بعد. أضف بعض القصص أولًا.");
    return;
  }

  const picked = pickWeightedRandomStory(stories);
  const top10 = [...stories]
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 10);

  let topListHtml = top10
    .map(
      (s, idx) => `
      <li>
        <strong>${idx + 1}. ${escapeHtml(s.name)}</strong>
        – درجة: ${escapeHtml(s.score ?? "—")}
        – فئة: ${escapeHtml(s.category || "غير محددة")}
      </li>
    `
    )
    .join("");

  setAI(`
    <h3>🎲 اختيار قصة عشوائية من القصص المسجَّلة بالموقع (فيديو طويل)</h3>
    <p>✅ تم اختيار القصة التالية بناءً على مزيج من تقييمك الشخصي (الدرجة) واحتمالية الجذب:</p>
    <p style="font-size:1.1rem;"><strong>القصة المختارة:</strong> ${escapeHtml(
      picked.name
    )}</p>
    <p><strong>الفئة:</strong> ${escapeHtml(picked.category || "غير محددة")}</p>
    <p><strong>الدرجة:</strong> ${escapeHtml(picked.score ?? "—")}</p>
    <hr>
    <h4>🏆 أعلى 10 قصص في التقييم الإجمالي (للتخطيط المستقبلي):</h4>
    <ol>${topListHtml}</ol>
  `);
}

// =========================
// التحكم في عرض اللوحين (AI / القصص)
// =========================

function handleShowStoriesOnly() {
  aiPanel.style.display = "none";
  storiesPanel.style.display = "block";
}

function handleShowBoth() {
  aiPanel.style.display = "block";
  storiesPanel.style.display = "block";
}

function handleShowAIOnly() {
  aiPanel.style.display = "block";
  storiesPanel.style.display = "none";
}

// =========================
// تهيئة التطبيق
// =========================

function init() {
  // عناصر DOM
  aiOutput = document.getElementById("ai-output");
  storiesTbody = document.getElementById("stories-tbody");
  rawInput = document.getElementById("raw-input");

  manualName = document.getElementById("manual-name");
  manualType = document.getElementById("manual-type");
  manualScore = document.getElementById("manual-score");
  manualNotes = document.getElementById("manual-notes");

  statusTrends = document.getElementById("status-trends");
  statusYoutube = document.getElementById("status-youtube");
  statusDeaths = document.getElementById("status-deaths");

  searchInput = document.getElementById("stories-search");
  aiPanel = document.querySelector(".ai-panel");
  storiesPanel = document.querySelector(".stories-panel");

  // أزرار أعلى الصفحة
  document
    .getElementById("btn-pick-today")
    .addEventListener("click", () => handlePickTrendLongVideo());
  document
    .getElementById("btn-pick-long")
    .addEventListener("click", () => handlePickRandomStory());
  document
    .getElementById("btn-pick-short")
    .addEventListener("click", () => handlePickTrendReels());
  document
    .getElementById("btn-update-trends")
    .addEventListener("click", () => handleUpdateTrends());

  // أزرار التحكم في اللوحين
  document
    .getElementById("btn-show-stories-only")
    .addEventListener("click", handleShowStoriesOnly);
  document
    .getElementById("btn-show-both")
    .addEventListener("click", handleShowBoth);
  document
    .getElementById("btn-show-ai-only")
    .addEventListener("click", handleShowAIOnly);

  // إدارة القصص
  document
    .getElementById("btn-parse-raw")
    .addEventListener("click", handleParseRaw);
  document
    .getElementById("btn-add-manual")
    .addEventListener("click", handleAddManual);
  document
    .getElementById("btn-export")
    .addEventListener("click", handleExportStories);
  document
    .getElementById("import-file")
    .addEventListener("change", handleImportStories);

  // البحث والقائمة المنسدلة
  setupSearchSuggestions();
  searchInput.addEventListener("input", handleSearchInput);

  // حالة مبدئية للـ Status
  statusTrends.textContent = "تريندات Google غير محدثة بعد";
  statusYoutube.textContent = "تريندات YouTube غير محدثة بعد";
  statusDeaths.textContent = "وفيات آخر 48 ساعة غير محدثة";

  // تحميل القصص من stories.json
  loadStories();

  // رسالة افتراضية
  setAI("<p>اضغط على أحد الأزرار بالأعلى لبدء التحليل أو لاختيار قصة من قائمتك.</p>");
}

document.addEventListener("DOMContentLoaded", init);
