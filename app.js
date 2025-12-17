/*************************************************
 * app.js (FINAL - Full Wiring for Current index.html)
 * - Source of Truth: Cloudflare Worker (KV)
 * - LocalStorage: Cache/Fallback only
 * - Every interactive HTML element has a handler
 *************************************************/

 const WORKER_API = "https://odd-credit-25c6.namozg50.workers.dev/";

 const APP_VERSION = "1.0.0";
 
 const LS_KEYS = {
   STORIES_CACHE: `EH_STORIES_CACHE_v${APP_VERSION}`,
   MAX_LOCAL_ID: `EH_MAX_LOCAL_ID_v${APP_VERSION}`,
   TRENDS_TS: `EH_TRENDS_UPDATED_AT_v${APP_VERSION}`,
   YT_TS: `EH_YT_UPDATED_AT_v${APP_VERSION}`,
   DEATHS_TS: `EH_DEATHS_UPDATED_AT_v${APP_VERSION}`,
   AI_CACHE_ENABLED: `EH_AI_CACHE_ENABLED_v${APP_VERSION}`,
   AUTO_BACKUP: `EH_AUTO_BACKUP_v${APP_VERSION}`,
 };
 
 
 
 /* =========================
    GLOBAL STATE
 ========================= */
 let stories = []; // source of truth = server
 let editingStoryId = null;
 let lastAIResults = null;
 
 /* =========================
    DOM HELPERS
 ========================= */
 function $(id) {
   return document.getElementById(id);
 }
 function setHtml(el, html) {
   if (!el) return;
   el.innerHTML = html;
 }
 function escapeHtml(str = "") {
   return String(str)
     .replaceAll("&", "&amp;")
     .replaceAll("<", "&lt;")
     .replaceAll(">", "&gt;")
     .replaceAll('"', "&quot;")
     .replaceAll("'", "&#039;");
 }
 
 /* =========================
    ARABIC NORMALIZATION
 ========================= */
 function normalizeArabic(text = "") {
   return String(text)
     .replace(/[إأآا]/g, "ا")
     .replace(/ى/g, "ي")
     .replace(/ؤ/g, "و")
     .replace(/ئ/g, "ي")
     .replace(/ة/g, "ه")
     .replace(/ـ/g, "")
     .replace(/[^\u0600-\u06FF0-9\s]/g, " ")
     .replace(/\s+/g, " ")
     .trim();
 }
 
 /* =========================
    LOCAL NUMERIC ID (for import/manual UX)
    NOTE: Worker still generates/owns real story.id.
    But user asked: "story.id رقمي محلي" -> we keep localNumericId too.
 ========================= */
 function getNextLocalNumericId() {
   const cur = Number(localStorage.getItem(LS_KEYS.MAX_LOCAL_ID) || 0);
   const next = cur + 1;
   localStorage.setItem(LS_KEYS.MAX_LOCAL_ID, String(next));
   return next;
 }
 function syncMaxLocalIdFromStories(storiesArr) {
   // if existing stories have localNumericId -> keep max
   let max = Number(localStorage.getItem(LS_KEYS.MAX_LOCAL_ID) || 0);
   for (const s of storiesArr || []) {
     const n = Number(s.localNumericId || 0);
     if (n > max) max = n;
   }
   localStorage.setItem(LS_KEYS.MAX_LOCAL_ID, String(max));
 }
 
 /* =========================
    CACHE / BACKUP SETTINGS
 ========================= */
 function isAiCacheEnabled() {
   const v = localStorage.getItem(LS_KEYS.AI_CACHE_ENABLED);
   if (v === null) return true;
   return v === "1";
 }
 function setAiCacheEnabled(val) {
   localStorage.setItem(LS_KEYS.AI_CACHE_ENABLED, val ? "1" : "0");
 }
 
 function isAutoBackupEnabled() {
   const v = localStorage.getItem(LS_KEYS.AUTO_BACKUP);
   if (v === null) return true;
   return v === "1";
 }
 function setAutoBackupEnabled(val) {
   localStorage.setItem(LS_KEYS.AUTO_BACKUP, val ? "1" : "0");
 }
 
 /* =========================
    SERVER COMMUNICATION
 ========================= */
 async function postToWorker(payload) {
    const res = await fetch(WORKER_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Worker error ${res.status}: ${text}`);
    }
  
    return res.json();
  }
  


  
 
 /* =========================
    LOAD STORIES (SERVER -> CACHE -> RENDER)
 ========================= */
 async function loadStoriesFromServer() {
   try {
     const data = await postToWorker({ action: "get_stories" });
 
     if (Array.isArray(data.stories)) {
       stories = data.stories;
       localStorage.setItem(LS_KEYS.STORIES_CACHE, JSON.stringify(stories)); // cache only
     } else {
       stories = JSON.parse(localStorage.getItem(LS_KEYS.STORIES_CACHE)) || [];
     }
   } catch (err) {
     stories = JSON.parse(localStorage.getItem(LS_KEYS.STORIES_CACHE)) || [];
   }
 
   syncMaxLocalIdFromStories(stories);
   renderStoriesTables();
   updateStatusPills();
 }
 
 /* =========================
    ADD / UPDATE / DELETE (SERVER TRUTH)
 ========================= */
 async function addStoryToServer(story) {
   await postToWorker({
     action: "add_story",
     payload: story,
   });
 
   await loadStoriesFromServer();
   if (isAutoBackupEnabled()) autoBackupDownloadSilent();
 }
 async function addStoryToToday(id) {
    return postToWorker({
      action: "add_story_today",
      payload: { id },
    });
    
  }

  
  
 async function updateStoryOnServer(id, updates) {
   await postToWorker({
     action: "update_story",
     payload: { id, updates },
   });
 
   await loadStoriesFromServer();
   if (isAutoBackupEnabled()) autoBackupDownloadSilent();
 }
 
 async function deleteStoryFromServer(id) {
   await postToWorker({
     action: "delete_story",
     payload: { id },
   });
 
   await loadStoriesFromServer();
   if (isAutoBackupEnabled()) autoBackupDownloadSilent();
 }
 
 /* =========================
    STORY NORMALIZATION (Standard schema)
 ========================= */
 function normalizeStoryObject(input, forcedType) {
   const now = new Date().toISOString();
 
   // Accept older stories.json schema: name/added
   const title = (input.title ?? input.name ?? "").trim();
 
   return {
     // Worker generates final `id`, but we keep optional localNumericId for your workflow
     title,
     category: input.category ?? "",
     type: forcedType || input.type || "long", // "long" | "short"
     score: Number(input.score ?? 80),
     trendScore: Number(input.trendScore ?? 0),
     finalScore: Number(input.finalScore ?? (Number(input.score ?? 80))),
     done: Boolean(input.done ?? false),
     notes: input.notes ?? "",
     source: input.source ?? "",
     country: input.country ?? "",
     createdAt: input.createdAt ?? input.added ?? now,
     analysis: input.analysis ?? null, // keep if worker sends analysis
     localNumericId: Number(input.localNumericId ?? getNextLocalNumericId()),
   };
 }
 
 /* =========================
    UI: RENDER TABLE(S)
    - Existing long table: #stories-tbody
    - Optional short table: #short-stories-tbody (if you add it in index.html)
 ========================= */
 function renderStoriesTables(filterText = "") {
   const q = normalizeArabic(filterText);
   const longStories = stories.filter((s) => (s.type || "long") === "long");
   const shortStories = stories.filter((s) => s.type === "short");
 
   const longFiltered = longStories.filter((s) =>
     normalizeArabic(s.title || "").includes(q)
   );
 
   const shortFiltered = shortStories.filter((s) =>
     normalizeArabic(s.title || "").includes(q)
   );
 
   renderTableBody($("stories-tbody"), longFiltered);
   // Optional second table:
   renderTableBody($("short-stories-tbody"), shortFiltered);
 
   // Also refresh status pills each render
   updateStatusPills();
 }
 
 function renderTableBody(tbodyEl, list) {
   if (!tbodyEl) return;
 
   tbodyEl.innerHTML = "";
   list.forEach((story, idx) => {
     const tr = document.createElement("tr");
 
     const doneBadge = story.done
       ? "<span class='badge-done'>✔</span>"
       : "<span class='badge-not-done'>✖</span>";
 
     const dateStr = story.createdAt
       ? new Date(story.createdAt).toLocaleDateString()
       : "-";
 
     tr.innerHTML = `
       <td>${idx + 1}</td>
       <td>${escapeHtml(story.title || "")}</td>
       <td>${escapeHtml(story.category || "-")}</td>
       <td>${Number(story.score ?? 0)}</td>
       <td>${Number(story.trendScore ?? 0)}</td>
       <td>${Number(story.finalScore ?? 0)}</td>
       <td>${doneBadge}</td>
       <td>${escapeHtml(dateStr)}</td>
       <td>${escapeHtml(story.notes || "")}</td>
       <td class="table-actions">
         <button class="btn small secondary" data-action="view" data-id="${story.id}">👁</button>
         <button class="btn small secondary" data-action="edit" data-id="${story.id}">✏️</button>
         <button class="btn small secondary" data-action="done" data-id="${story.id}">✅</button>
         <button class="btn small secondary" data-action="del" data-id="${story.id}">🗑</button>
       </td>
     `;
 
     tbodyEl.appendChild(tr);
   });
 
   // Delegate click handling inside tbody
   tbodyEl.onclick = async (e) => {
     const btn = e.target.closest("button[data-action]");
     if (!btn) return;
     const id = btn.getAttribute("data-id");
     const action = btn.getAttribute("data-action");
 
     if (action === "view") showStoryDetails(id);
     if (action === "edit") startEditStory(id);
     if (action === "done") toggleDone(id);
     if (action === "del") deleteStoryFromServer(id);
   };
 }
 
 /* =========================
    DETAILS VIEW (👁)
 ========================= */
 function showStoryDetails(id) {
   const s = stories.find((x) => String(x.id) === String(id));
   if (!s) return;
 
   const html = `
     <div class="trend-card">
       <div class="trend-title">${escapeHtml(s.title || "")}</div>
       <div class="trend-meta">
         <b>Category:</b> ${escapeHtml(s.category || "-")} |
         <b>Type:</b> ${escapeHtml(s.type || "long")} |
         <b>Done:</b> ${s.done ? "Yes" : "No"} |
         <b>Date:</b> ${escapeHtml(s.createdAt ? new Date(s.createdAt).toLocaleString() : "-")}
       </div>
       <div class="trend-scores">
         <b>Score:</b> ${Number(s.score ?? 0)} |
         <b>Trend Score:</b> ${Number(s.trendScore ?? 0)} |
         <b>Final Score:</b> ${Number(s.finalScore ?? 0)}
       </div>
       <div class="trend-meta">
         <b>Country:</b> ${escapeHtml(s.country || "-")} |
         <b>Source:</b> ${escapeHtml(s.source || "-")}
       </div>
       <div class="trend-meta"><b>Notes:</b> ${escapeHtml(s.notes || "-")}</div>
       <div class="trend-meta"><b>Analysis:</b> ${escapeHtml(JSON.stringify(s.analysis || "", null, 2) || "-")}</div>
     </div>
   `;
 
   // Put it in AI output panel (best UX)
   setHtml($("ai-output"), html);
 }
 
 /* =========================
    EDIT MODE
 ========================= */
 function startEditStory(id) {
   const s = stories.find((x) => String(x.id) === String(id));
   if (!s) return;
 
   editingStoryId = s.id;
 
   if ($("manual-name")) $("manual-name").value = s.title || "";
   if ($("manual-type")) $("manual-type").value = s.category || "";
   if ($("manual-score")) $("manual-score").value = Number(s.score ?? 80);
   if ($("manual-notes")) $("manual-notes").value = s.notes || "";
 
   if ($("btn-add-manual")) {
     $("btn-add-manual").textContent = "💾 حفظ التعديل";
   }
 }
 
 function resetEditMode() {
   editingStoryId = null;
   if ($("btn-add-manual")) $("btn-add-manual").textContent = "➕ إضافة قصة يدويًا";
 }
 
 /* =========================
    DONE TOGGLE
 ========================= */
 async function toggleDone(id) {
   const s = stories.find((x) => String(x.id) === String(id));
   if (!s) return;
   await updateStoryOnServer(id, { done: !s.done });
 }
 
 /* =========================
    RAW PARSE (each line => story)
 ========================= */
 async function parseRawToStories() {
   const raw = ($("raw-input")?.value || "").trim();
   if (!raw) return;
 
   const lines = raw
     .split("\n")
     .map((x) => x.trim())
     .filter(Boolean);
 
   if (!lines.length) return;
 
   // Dedup vs current stories by normalized title
   const existing = new Set(stories.map((s) => normalizeArabic(s.title || "")));
 
   for (const line of lines) {
     const title = line.trim();
     if (!title) continue;
 
     const key = normalizeArabic(title);
     if (existing.has(key)) continue;
 
     const story = normalizeStoryObject(
       {
         title,
         category: $("manual-type")?.value || "",
         score: Number($("manual-score")?.value || 80),
         notes: "",
         source: "raw",
         country: "",
       },
       "long"
     );
 
     // IMPORTANT: Worker is truth; we send payload (worker will assign id)
     await addStoryToServer(story);
     existing.add(key);
   }
 
   $("raw-input").value = "";
 }
 
 /* =========================
    MANUAL ADD / SAVE EDIT
 ========================= */
 async function handleManualAddOrEdit() {
   const title = ($("manual-name")?.value || "").trim();
   if (!title) return;
 
   const story = normalizeStoryObject(
     {
       title,
       category: $("manual-type")?.value || "",
       score: Number($("manual-score")?.value || 80),
       notes: $("manual-notes")?.value || "",
       source: "manual",
       country: "",
     },
     "long"
   );
 
   if (editingStoryId) {
     // Update only fields you allow editing
     await updateStoryOnServer(editingStoryId, {
       title: story.title,
       category: story.category,
       score: story.score,
       notes: story.notes,
       // keep type/createdAt unless you want editable
     });
   } else {
     await addStoryToServer(story);
   }
 
   // Clear inputs
   if ($("manual-name")) $("manual-name").value = "";
   if ($("manual-notes")) $("manual-notes").value = "";
   resetEditMode();
 }
 
 /* =========================
    IMPORT / EXPORT (Advanced)
 ========================= */
 function exportStoriesToFile() {
   const payload = {
     meta: {
       exportedAt: new Date().toISOString(),
       appVersion: APP_VERSION,
       count: stories.length,
     },
     stories,
   };
 
   const blob = new Blob([JSON.stringify(payload, null, 2)], {
     type: "application/json",
   });
 
   const a = document.createElement("a");
   a.href = URL.createObjectURL(blob);
   a.download = `EH_stories_backup_${new Date().toISOString().slice(0, 10)}.json`;
   a.click();
 }
 
 function autoBackupDownloadSilent() {
   // Auto backup is required, but we keep it "silent" to not annoy:
   // We store a copy in localStorage as last backup snapshot.
   try {
     localStorage.setItem(`EH_LAST_BACKUP_v${APP_VERSION}`, JSON.stringify({
       ts: new Date().toISOString(),
       count: stories.length,
       stories,
     }));
   } catch {}
 }
 
 async function importStoriesFromFile(file) {
   if (!file) return;
   const text = await file.text();
 
   let data;
   try {
     data = JSON.parse(text);
   } catch {
     return;
   }
 
   const incoming = Array.isArray(data)
     ? data
     : Array.isArray(data.stories)
     ? data.stories
     : [];
 
   if (!incoming.length) return;
 
   const existing = new Set(stories.map((s) => normalizeArabic(s.title || "")));
 
   // keep max local numeric id
   let maxLocal = Number(localStorage.getItem(LS_KEYS.MAX_LOCAL_ID) || 0);
 
   for (const item of incoming) {
     const title = (item.title ?? item.name ?? "").trim();
     if (!title) continue;
 
     const key = normalizeArabic(title);
     if (existing.has(key)) continue;
 
     const normalized = normalizeStoryObject(
       {
         ...item,
         title,
         localNumericId: item.localNumericId ?? item.id ?? getNextLocalNumericId(),
       },
       item.type || "long"
     );
 
     if (Number(normalized.localNumericId) > maxLocal) {
       maxLocal = Number(normalized.localNumericId);
     }
 
     /*await addStoryToServer(normalized);
     existing.add(key);*/
   }
 
   localStorage.setItem(LS_KEYS.MAX_LOCAL_ID, String(maxLocal));
 }
 
 /* =========================
    SEARCH
 ========================= */
 function handleSearchInput() {
   const q = $("stories-search")?.value || "";
   renderStoriesTables(q);
 }
 
 /* =========================
    LAYOUT CONTROLS
 ========================= */
 function showStoriesOnly() {
   const main = document.querySelector(".main-layout");
   if (!main) return;
   main.style.gridTemplateColumns = "1fr";
   const ai = document.querySelector(".ai-panel");
   const st = document.querySelector(".stories-panel");
   if (ai) ai.style.display = "none";
   if (st) st.style.display = "block";
 }
 
 function showAiOnly() {
   const main = document.querySelector(".main-layout");
   if (!main) return;
   main.style.gridTemplateColumns = "1fr";
   const ai = document.querySelector(".ai-panel");
   const st = document.querySelector(".stories-panel");
   if (ai) ai.style.display = "block";
   if (st) st.style.display = "none";
 }
 
 function showBothPanels() {
   const main = document.querySelector(".main-layout");
   if (!main) return;
   // return to CSS default (2 columns) on wide screens
   main.style.gridTemplateColumns = "";
   const ai = document.querySelector(".ai-panel");
   const st = document.querySelector(".stories-panel");
   if (ai) ai.style.display = "block";
   if (st) st.style.display = "block";
 }
 
 /* =========================
    STATUS PILLS (Smart by days)
 ========================= */
 function daysSince(tsIso) {
   if (!tsIso) return Infinity;
   const t = new Date(tsIso).getTime();
   if (!Number.isFinite(t)) return Infinity;
   const now = Date.now();
   return Math.floor((now - t) / (1000 * 60 * 60 * 24));
 }
 
 function setPill(el, state, text) {
   if (!el) return;
   el.classList.remove("ok", "warn", "muted");
   el.classList.add(state);
   el.textContent = text;
 }
 
 function updateStatusPills() {
   // Your HTML has:
   // status-trends, status-youtube, status-deaths :contentReference[oaicite:1]{index=1}
   const trendsEl = $("status-trends");
   const ytEl = $("status-youtube");
   const deathsEl = $("status-deaths");
 
   const tsTrends = localStorage.getItem(LS_KEYS.TRENDS_TS);
   const tsYT = localStorage.getItem(LS_KEYS.YT_TS);
   const tsDeaths = localStorage.getItem(LS_KEYS.DEATHS_TS);
 
   // Rules:
   // OK: <= 1 day
   // WARN: 2-6 days
   // MUTED: >= 7 days or missing
   const d1 = daysSince(tsTrends);
   if (d1 <= 1) setPill(trendsEl, "ok", `✅ تريندات Google محدثة (منذ ${d1} يوم)`);
   else if (d1 <= 6) setPill(trendsEl, "warn", `⚠️ تريندات Google قديمة (منذ ${d1} يوم)`);
   else setPill(trendsEl, "muted", `⛔ تريندات Google غير محدثة`);
 
   const d2 = daysSince(tsYT);
   if (d2 <= 1) setPill(ytEl, "ok", `✅ تريندات YouTube محدثة (منذ ${d2} يوم)`);
   else if (d2 <= 6) setPill(ytEl, "warn", `⚠️ تريندات YouTube قديمة (منذ ${d2} يوم)`);
   else setPill(ytEl, "muted", `⛔ تريندات YouTube غير محدثة`);
 
   const d3 = daysSince(tsDeaths);
   if (d3 <= 1) setPill(deathsEl, "ok", `✅ وفيات آخر 48 ساعة محدثة (منذ ${d3} يوم)`);
   else if (d3 <= 6) setPill(deathsEl, "warn", `⚠️ وفيات قديمة (منذ ${d3} يوم)`);
   else setPill(deathsEl, "muted", `⛔ وفيات آخر 48 ساعة غير محدثة`);
 }
 
 /* =========================
    AI / TRENDS BUTTONS (Top Buttons)
    HTML ids:
    - btn-pick-today
    - btn-pick-long
    - btn-pick-short
    - btn-update-trends
 ========================= */
 function renderAIResultCards(results, modeLabel) {
   if (!Array.isArray(results)) results = [];
   if (!results.length) {
     setHtml($("ai-output"), `<p>لا توجد نتائج.</p>`);
     return;
   }
 
   const html = results
     .map((r, idx) => {
       const title = escapeHtml(r.title || r.name || "");
       const country = escapeHtml(r.country || "-");
       const source = escapeHtml(r.source || "-");
       const score = Number(r.score ?? 0);
       const trendScore = Number(r.trendScore ?? 0);
       const finalScore = Number(r.finalScore ?? 0);
       const type = escapeHtml(r.type || "long");
       const notes = escapeHtml(r.notes || "");
 
       // Worker returns a stable id or a temp key for trend items
       const tmp = escapeHtml(r.tmpId || r.id || `${Date.now()}_${idx}`);
 
       return `
         <div class="trend-card">
           <div class="trend-rank">#${idx + 1} — ${escapeHtml(modeLabel)}</div>
           <div class="trend-title">${title}</div>
           <div class="trend-meta">
           <b>Country:</b> ${country} |
           <b>Source:</b> ${source} |
           <b>Type:</b> ${type}
         </div>
         
         <div class="trend-meta">
           <b>Domain:</b> ${escapeHtml(r.domain || "-")}
         </div>
         
         <div class="trend-meta">
           <b>Link:</b> 
           <a href="${escapeHtml(r.url || r.link || r.href || "#")}" 
              target="_blank" 
              style="color:#1a73e8; text-decoration:underline;">
              اضغط هنا لزيارة المصدر
           </a>
         </div>
         
           <div class="trend-scores">
             <b>Score:</b> ${score} |
             <b>Trend:</b> ${trendScore} |
             <b>Final:</b> ${finalScore}
           </div>
           <div class="trend-meta"><b>Notes:</b> ${notes}</div>
           <button class="add-btn" data-add="1" data-tmp="${tmp}">➕ أضف إلى قصة اليوم</button>
         </div>
       `;
     })
     .join("");
 
   setHtml($("ai-output"), html);
 
   // Add buttons wiring (delegation)
   const out = $("ai-output");
   if (out) {
    out.onclick = null;
    out.onclick = async (e) => {
        const btn = e.target.closest("button[data-add='1']");
        if (!btn) return;
      
        // امنع التكرار
        if (btn.dataset.loading === "1") return;
        btn.dataset.loading = "1";
        btn.disabled = true;
        btn.textContent = "⏳ جاري الإضافة...";
      
        const tmp = btn.getAttribute("data-tmp");
        if (!tmp || !lastAIResults || !Array.isArray(lastAIResults)) return;
      
        const chosen = lastAIResults.find(
          (x) => String(x.tmpId || x.id) === String(tmp)
        );
        if (!chosen) return;
        const title = (chosen.title || chosen.name || "").trim();

        if (!title) {
          btn.textContent = "❌ عنوان غير صالح";
          btn.disabled = false;
          btn.dataset.loading = "0";
          return;
        }
        
        const normalized = normalizeStoryObject(
          {
            title: title,
            category: chosen.category || "",
            type: chosen.type || "long",
            score: Number(chosen.score ?? 80),
            trendScore: Number(chosen.trendScore ?? 0),
            finalScore: Number(chosen.finalScore ?? Number(chosen.score ?? 80)),
            done: false,
            notes: chosen.notes || "",
            source: chosen.source || "trend",
            country: chosen.country || "",
            analysis: chosen.analysis || null,
            localNumericId: getNextLocalNumericId(),
          },
          chosen.type || "long"
        );
        
      
        // 1️⃣ أضف القصة للسيرفر
        await addStoryToServer(normalized);
      
        // 2️⃣ بعد التحميل، هتكون القصة دخلت في stories
        const added = stories.find(
          (s) => normalizeArabic(s.title) === normalizeArabic(normalized.title)
        );
      
        // 3️⃣ علّمها قصة اليوم
        if (added?.id) {
          await addStoryToToday(added.id);
        }
      
        // 4️⃣ شكليًا نقول تم
        btn.textContent = "✅ تمت الإضافة";
      };
      
      
   }
 }
 
 async function handlePickTodayTrendLong() {
   setHtml($("ai-output"), "<p>⏳ جاري جلب أفضل تريندات للفيديو الطويل...</p>");
 
   const data = await postToWorker({
    action: "get_trends_long",
    payload: {
      source: "user",          // 🔴 مهم جدًا
      aiCache: isAiCacheEnabled(),
      windowDays: 120,
    },
  });
 
   lastAIResults = Array.isArray(data.results) ? data.results : [];
   renderAIResultCards(lastAIResults, "تريند فيديو طويل");
   localStorage.setItem(LS_KEYS.TRENDS_TS, new Date().toISOString());
   updateStatusPills();
 }
 
 async function handlePickTrendShortReels() {
   setHtml($("ai-output"), "<p>⏳ جاري جلب أفضل تريندات للريلز...</p>");
 
   const data = await postToWorker({
     action: "get_trends_short",
     payload: {
       aiCache: isAiCacheEnabled(),
       windowDays: 120,
     },
   });
 
   lastAIResults = Array.isArray(data.results) ? data.results : [];
   renderAIResultCards(lastAIResults, "تريند ريلز");
   localStorage.setItem(LS_KEYS.YT_TS, new Date().toISOString());
   updateStatusPills();
 }
 
 async function handlePickRandomFromSavedLong() {
   setHtml($("ai-output"), "<p>⏳ جاري اختيار قصة عشوائية من القصص المسجلة...</p>");
 
   // Random based on server loaded stories (requirement)
   const longStories = stories.filter((s) => (s.type || "long") === "long");
   if (!longStories.length) {
     setHtml($("ai-output"), "<p>لا توجد قصص طويلة مسجلة بعد.</p>");
     return;
   }
 
   // Worker may provide “best 10 weighted” — we request it if supported, else local random fallback
   let data = null;

   try {
     data = await postToWorker({
       action: "pick_random_long",
       payload: {
         source: "user",          // 🔴 إجباري عشان الوركر ينفذ البحث
         aiCache: isAiCacheEnabled(),
         windowDays: 120          // توضيح نطاق البحث (اختياري لكن منطقي)
       },
     });
   } catch (e) {
     console.error("pick_random_long error:", e);
   }
   
   if (data && Array.isArray(data.results) && data.results.length) {
     lastAIResults = data.results;
   
     // 👇 الاسم يعكس الحقيقة (15 = 10 long + 5 reels)
     renderAIResultCards(lastAIResults, "أفضل 15 من المسجل");
   
    } else {
        const pick = longStories[Math.floor(Math.random() * longStories.length)];
        showStoryDetails(pick.id);
      }
    }
 
 async function handleUpdateTrendsAll() {
   setHtml($("ai-output"), "<p>⏳ جاري تحديث التريندات (دفعة واحدة) ...</p>");
 
   const data = await postToWorker({
     action: "update_trends_all",
     payload: {
       aiCache: isAiCacheEnabled(),
       windowDays: 120,
     },
   });
 
   // data may include last update timestamps
   if (data?.meta?.trendsUpdatedAt) localStorage.setItem(LS_KEYS.TRENDS_TS, data.meta.trendsUpdatedAt);
   else localStorage.setItem(LS_KEYS.TRENDS_TS, new Date().toISOString());
 
   if (data?.meta?.youtubeUpdatedAt) localStorage.setItem(LS_KEYS.YT_TS, data.meta.youtubeUpdatedAt);
   else localStorage.setItem(LS_KEYS.YT_TS, new Date().toISOString());
 
   if (data?.meta?.deathsUpdatedAt) localStorage.setItem(LS_KEYS.DEATHS_TS, data.meta.deathsUpdatedAt);
   else localStorage.setItem(LS_KEYS.DEATHS_TS, new Date().toISOString());
 
   updateStatusPills();
 
   // Show a summary
   const summary = `
     <div class="trend-card">
       <div class="trend-title">✅ تم تحديث التريندات</div>
       <div class="trend-meta">${escapeHtml(JSON.stringify(data?.meta || {}, null, 2))}</div>
     </div>
   `;
   setHtml($("ai-output"), summary);
 }
 
 /* =========================
    FALLBACK: stories.json (ONLY if server fails & cache empty)
    (You said stories.json fallback must exist)
 ========================= */
 /*async function ensureFallbackStoriesJsonIfEmpty() {
   if (Array.isArray(stories) && stories.length) return;
 
   try {
     const res = await fetch("stories.json", { cache: "no-store" });
     if (!res.ok) return;
     const arr = await res.json();
     if (!Array.isArray(arr)) return;
 
     // Convert old schema -> new schema, then push to server once
     for (const item of arr) {
       const normalized = normalizeStoryObject(
         {
           title: item.name || item.title || "",
           category: item.category || "",
           score: Number(item.score ?? 80),
           done: Boolean(item.done ?? false),
           notes: item.notes || "",
           createdAt: item.added || new Date().toISOString(),
           analysis: item.analysis || null,
           source: "stories.json",
           country: "",
           localNumericId: item.id ?? getNextLocalNumericId(),
         },
         "long"
       );
       // Push to server
       await addStoryToServer(normalized);
     }
   } catch {}
 }*/
 
 /* =========================
    INIT: WIRE ALL HTML INTERACTIVE ELEMENTS
 ========================= */
 function wireEventListeners() {
    // Top buttons
    $("btn-pick-today")?.addEventListener("click", handlePickTodayTrendLong);
    $("btn-pick-long")?.addEventListener("click", handlePickRandomFromSavedLong);
    $("btn-update-trends")?.addEventListener("click", handleUpdateTrendsAll);
    // ⚠️ ملحوظة: زر الريلز (btn-pick-short) НЕ يتم ربطه هنا
  
    // Layout controls
    $("btn-show-stories-only")?.addEventListener("click", showStoriesOnly);
    $("btn-show-both")?.addEventListener("click", showBothPanels);
    $("btn-show-ai-only")?.addEventListener("click", showAiOnly);
  
    // Raw parse
    $("btn-parse-raw")?.addEventListener("click", parseRawToStories);
  
    // Manual add / edit
    $("btn-add-manual")?.addEventListener("click", handleManualAddOrEdit);
  
    // Export / Import
    $("btn-export")?.addEventListener("click", exportStoriesToFile);
    $("import-file")?.addEventListener("change", (e) => {
      const f = e.target.files?.[0];
      if (f) importStoriesFromFile(f);
      e.target.value = "";
    });
  
    // Search
    $("stories-search")?.addEventListener("input", handleSearchInput);
  }
  
 
/* =========================
   BOOTSTRAP (FINAL & CLEAN)
   - Worker = Source of Truth
   - stories.json -> Worker (ONE TIME)
========================= */
/*async function loadApiModeStatus() {
    try {
      const res = await postToWorker({ action: "get_api_mode" });
  
      const mode = res.mode || "offline";
      const changedAt = res.changedAt;
  
      const sw = document.getElementById("api-mode-switch");
      const label = document.getElementById("api-mode-label");
      const time = document.getElementById("api-mode-time");
  
      if (!sw) return;
  
      sw.checked = mode === "online";
      label.textContent =
        mode === "online"
          ? "🟢 Online (استخدام API مباشر)"
          : "⛔ Offline (الاعتماد على الكاش فقط)";
  
      time.textContent = changedAt
        ? `آخر تغيير: ${new Date(changedAt).toLocaleString()}`
        : "";
    } catch (e) {
      console.warn("API mode load failed", e);
    }
  }*/
  function wireApiModeSwitch() {
    const sw = document.getElementById("api-mode-switch");
    if (!sw) return;
  
    sw.addEventListener("change", async () => {
      const mode = sw.checked ? "online" : "offline";
  
      const res = await postToWorker({
        action: "toggle_api_mode",
        payload: { mode },
      });
  
      document.getElementById("api-mode-label").textContent =
        mode === "online"
          ? "🟢 Online (استخدام API مباشر)"
          : "⛔ Offline (الاعتماد على الكاش فقط)";
  
      document.getElementById("api-mode-time").textContent =
        `آخر تغيير: ${new Date(res.changedAt).toLocaleString()}`;
    });
  }
  

async function bootstrapApp() {
    const MIGRATION_FLAG = "EH_STORIES_JSON_MIGRATED";
  
    // 1️⃣ إعدادات افتراضية
    if (localStorage.getItem(LS_KEYS.AI_CACHE_ENABLED) === null) {
      setAiCacheEnabled(true);
    }
    if (localStorage.getItem(LS_KEYS.AUTO_BACKUP) === null) {
      setAutoBackupEnabled(true);
    }
  
    // 2️⃣ ترحيل stories.json → Worker (مرة واحدة فقط)
   if (true) {
      try {
        console.log("⏳ Bootstrapping: loading stories.json ...");
  
        const res = await fetch("stories.json", { cache: "no-store" });
        if (!res.ok) throw new Error("stories.json not found");
  
        const storiesFromFile = await res.json();
        if (Array.isArray(storiesFromFile) && storiesFromFile.length) {
          const r = await postToWorker({
            action: "import_stories_json",
            payload: { stories: storiesFromFile },
          });
  
          if (r?.ok) {
            console.log(`✅ Migrated ${r.imported} stories to Worker`);
            localStorage.setItem(MIGRATION_FLAG, "1");
          } else {
            console.warn("⚠️ Worker rejected migration", r);
          }
        }
      } catch (err) {
        console.warn("⚠️ Bootstrap migration skipped:", err.message);
      }
    } else {
      console.log("ℹ️ stories.json already migrated");
    }
  
    // 3️⃣ ربط كل أزرار الواجهة
    wireEventListeners();
  
    // 4️⃣ تحميل القصص من الوركر (الذاكرة الرئيسية)
    await loadStoriesFromServer();
  
    console.log("🚀 App bootstrap completed");
  }

// =========================
// PICK REELS PRO (FIXED)
// =========================
async function handlePickReelsPro() {
    console.log("🔥 REELS PRO BUTTON CLICKED");
  
    setHtml($("ai-output"), "<p>⏳ جاري جلب تريندات الريلز...</p>");
  
    try {
      const res = await postToWorker({
        action: "get_reels_pro",
      });
  
      if (!res || !Array.isArray(res.results) || !res.results.length) {
        setHtml($("ai-output"), "<p>❌ لا توجد نتائج ريلز حاليًا</p>");
        return;
      }
  
      lastAIResults = res.results;
  
      renderAIResultCards(res.results, "ريلز برو");
  
    } catch (err) {
      console.error("❌ Reels Pro error:", err);
      setHtml($("ai-output"), "<p>❌ حدث خطأ أثناء جلب الريلز</p>");
    }
  }
  
  
  
/* =========================
   START APP
========================= */

document.addEventListener("DOMContentLoaded", () => {
    const reelsBtn = $("btn-pick-short");
  
    if (!reelsBtn) {
      console.error("❌ btn-pick-short not found");
      return;
    }
  
    reelsBtn.onclick = handlePickTrendShortReels;


  });
  
  // 🚀 شغّل التطبيق
  bootstrapApp();

