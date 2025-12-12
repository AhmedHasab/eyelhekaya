// =====================================================================
//  app-extend.js
//  إضافات كاملة فوق app.js بدون تعديل ملف app.js الأصلي
//  Ahmed Hasaballa — 2025
// =====================================================================

// ننتظر تحميل الصفحة بالكامل ثم نبدأ الحقن
document.addEventListener("DOMContentLoaded", () => {

    // ================================================================
    // 1) إنشاء جدول القصص القصيرة ديناميكيًا أسفل جدول القصص الطويلة
    // ================================================================

    const storiesPanel = document.querySelector(".stories-panel");

    const shortStoriesContainer = document.createElement("div");
    shortStoriesContainer.id = "short-stories-container";
    shortStoriesContainer.style.marginTop = "30px";
    shortStoriesContainer.style.display = "none"; // يظهر فقط لو فيه قصص قصيرة

    shortStoriesContainer.innerHTML = `
        <h3 style="margin-bottom:10px;">📌 القصص القصيرة (Reels)</h3>

        <table class="stories-table">
            <thead>
                <tr>
                    <th>#</th>
                    <th>الاسم</th>
                    <th>النوع</th>
                    <th>تقييم شخصي</th>
                    <th>جاذبية</th>
                    <th>تحليل</th>
                    <th>تم التنفيذ</th>
                    <th>تاريخ الإضافة</th>
                    <th>ملاحظات</th>
                    <th>تحكم</th>
                </tr>
            </thead>
            <tbody id="stories-short-tbody"></tbody>
        </table>
    `;

    storiesPanel.appendChild(shortStoriesContainer);

    // ================================================================
    // 2) إضافة دالة لإعادة رسم جدول القصص الطويلة + القصيرة
    // ================================================================

    function renderLongAndShortStories() {
        if (typeof stories === "undefined") return;

        const longBody = document.getElementById("stories-tbody");
        const shortBody = document.getElementById("stories-short-tbody");

        longBody.innerHTML = "";
        shortBody.innerHTML = "";

        let shortCount = 0;

        stories.forEach((story, index) => {
            const tr = document.createElement("tr");

            tr.innerHTML = `
                <td>${index + 1}</td>
                <td>${story.name}</td>
                <td>${story.type || "طويل"}</td>
                <td>${story.score ?? "-"}</td>
                <td>${story.attraction ?? "-"}</td>
                <td>${story.analysis ?? "-"}</td>
                <td>
                    <span class="${story.done ? "badge-done" : "badge-not-done"}">
                        ${story.done ? "تم التنفيذ" : "لم تُنفذ بعد"}
                    </span>
                </td>
                <td>${story.added ?? "-"}</td>
                <td>${story.notes ?? "-"}</td>

                <td>
                    <button class="btn secondary small" data-action="show" data-id="${story.id}">👁 عرض</button>
                    <button class="btn secondary small" data-action="edit" data-id="${story.id}">✏ تعديل</button>
                    <button class="btn secondary small" data-action="toggle" data-id="${story.id}">
                        ${story.done ? "↩ إلغاء" : "✅ تنفيذ"}
                    </button>
                    <button class="btn secondary small" data-action="delete" data-id="${story.id}">🗑 حذف</button>
                </td>
            `;

            // إضافة حسب النوع
            if (story.type === "short") {
                shortBody.appendChild(tr);
                shortCount++;
            } else {
                longBody.appendChild(tr);
            }
        });

        // إظهار أو إخفاء جدول القصص القصيرة
        shortStoriesContainer.style.display = shortCount > 0 ? "block" : "none";
    }

    // نجعل الدالة عالمية ليستخدمها app.js
    window.renderLongAndShortStories = renderLongAndShortStories;

    // استبدال renderStoriesTable الأصلي بالنسخة الجديدة
    window.renderStoriesTable = renderLongAndShortStories;

    // ================================================================
    // 3) زر (+) — إضافة القصة من التريند للجدول المناسب
    // ================================================================

    window.addStoryFromTrend = function (item, isShort = false) {
        if (!window.stories) return;

        const newStory = {
            id: Date.now(),
            name: item.title,
            type: isShort ? "short" : "long",
            score: 50,
            attraction: "-",
            analysis: "-",
            notes: `من التريند — ${item.country} — ${item.category}`,
            added: new Date().toISOString().split("T")[0],
            done: false,
            link: item.url
        };

        // منع التكرار
        if (stories.some(s => s.name === newStory.name)) {
            alert("⚠️ القصة موجودة بالفعل!");
            return;
        }

        stories.push(newStory);
        window.saveStories();
        renderLongAndShortStories();

        alert(`✅ تمت إضافة القصة: ${newStory.name}`);
    };

    // ================================================================
    // 4) تحسين عرض التريند بالكامل + زر (+)
    // ================================================================

    window.renderAIResults = function (items, isShort = false) {
        const output = document.getElementById("ai-output");
        output.innerHTML = "";

        items.forEach((item, index) => {
            const card = document.createElement("div");
            card.className = "trend-card";

            card.innerHTML = `
                <div class="trend-rank">#${index + 1}</div>

                <div class="trend-title">${item.title}</div>

                <div class="trend-meta">
                    <span>🌍 الدولة: ${item.country}</span> |
                    <span>📌 النوع: ${item.category}</span>
                </div>

                <div class="trend-scores">
                    <span>📊 التريند: ${item.score}</span>
                    <span>🔥 YouTube: ${item.ytScore}</span>
                </div>

                <button class="add-btn" data-index="${index}">
                    ➕ إضافة للقائمة
                </button>

                ${item.url ? `<a href="${item.url}" target="_blank" class="trend-link">رابط الفيديو</a>` : ""}
            `;

            output.appendChild(card);
        });

        // Event لأزرار +
        document.querySelectorAll(".add-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                const index = btn.getAttribute("data-index");
                window.addStoryFromTrend(items[index], isShort);
            });
        });
    };

    // ================================================================
    // 5) تعديل استقبال رسائل الـ Worker لدعم الإضافة الجديدة
    // ================================================================

    if (window.worker) {
        const oldHandler = window.worker.onmessage;

        window.worker.onmessage = function (e) {
            const { type, payload } = e.data;

            if (type === "TREND_LONG_RESULT") {
                window.renderAIResults(payload.items, false); // قصة طويلة
            }

            else if (type === "TREND_SHORT_RESULT") {
                window.renderAIResults(payload.items, true); // قصة قصيرة
            }

            else {
                oldHandler?.(e);
            }
        };
    }

    // ================================================================
    // 6) CSS إضافي لتحسين شكل الكروت
    // ================================================================

    const style = document.createElement("style");
    style.textContent = `
        .trend-card {
            background: #fff;
            padding: 12px;
            margin: 10px 0;
            border-radius: 8px;
            border: 1px solid #e6e6e6;
            box-shadow: 0 2px 4px rgba(0,0,0,0.05);
        }
        .trend-rank {
            font-size: 18px;
            color: #c00;
            font-weight: bold;
        }
        .trend-title {
            font-size: 17px;
            margin: 6px 0;
            font-weight: bold;
        }
        .trend-meta, .trend-scores {
            font-size: 13px;
            color: #555;
            margin-bottom: 5px;
        }
        .add-btn {
            width: 100%;
            padding: 8px;
            background: #28a745;
            color: #fff;
            border-radius: 6px;
            border: none;
            cursor: pointer;
            margin-top: 8px;
            font-size: 15px;
        }
        .add-btn:hover {
            background: #218838;
        }
        .trend-link {
            display: block;
            margin-top: 6px;
            text-decoration: none;
            color: #007bff;
        }
    `;
    document.head.appendChild(style);


    // ================================================================
    // 7) أول إعادة رسم للقصص
    // ================================================================
    if (window.stories) {
        renderLongAndShortStories();
    }

});
