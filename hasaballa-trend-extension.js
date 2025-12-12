// =====================================================================
//  Hasaballa Trend Extension
//  ملف إضافي شامل — بدون تعديل أي ملف أصلي
//  Ahmed Hasaballa — 2025
// =====================================================================

document.addEventListener("DOMContentLoaded", () => {

    // ================================================================
    // 1) دالة عرض التريند الجديدة بالكامل (كروت)
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
                    <span>📌 التصنيف: ${item.category}</span>
                </div>

                <div class="trend-scores">
                    <span>📊 تريند: ${item.score}</span>
                    <span>🔥 YouTube: ${item.ytScore}</span>
                    ${item.views ? `<span>👁 ظهور: ${item.views}</span>` : ""}
                </div>

                <button class="add-trend-btn" data-index="${index}">
                    ➕ إضافة للقائمة
                </button>

                ${item.url ? `<a href="${item.url}" class="trend-link" target="_blank">🔗 رابط الفيديو</a>` : ""}
            `;

            output.appendChild(card);
        });

        // ربط زر الإضافة +
        document.querySelectorAll(".add-trend-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                const idx = btn.getAttribute("data-index");
                window.addStoryFromTrend(items[idx], isShort);
            });
        });
    };

    // ================================================================
    // 2) إضافة قصة من التريند (فيديو طويل أو ريلز)
    // ================================================================
    window.addStoryFromTrend = function (item, isShort = false) {
        if (!window.stories) return;

        const storyName = item.title.trim();

        // منع التكرار
        if (window.stories.some(s => s.name === storyName)) {
            alert("⚠️ القصة موجودة بالفعل!");
            return;
        }

        const newStory = {
            id: Date.now(),
            name: storyName,
            type: isShort ? "short" : "long",
            score: 50,
            attraction: "-",
            analysis: "-",
            notes: `من التريند (${item.country}) — ${item.category}`,
            added: new Date().toISOString().split("T")[0],
            done: false,
            link: item.url || ""
        };

        window.stories.push(newStory);
        window.saveStories();
        window.renderStoriesTable(window.stories);

        alert(`✅ تمت إضافة القصة: ${storyName}`);
    };

    // ================================================================
    // 3) اعتراض رسائل الـ Worker وربطها بواجهة العرض الجديدة
    // ================================================================
    if (window.worker) {
        const oldHandler = window.worker.onmessage;

        window.worker.onmessage = function (e) {
            const { type, payload } = e.data;

            if (type === "TREND_LONG_RESULT") {
                window.renderAIResults(payload.items, false);
            }
            else if (type === "TREND_SHORT_RESULT") {
                window.renderAIResults(payload.items, true);
            }

            // نمرر الرسائل القديمة لو موجودة
            if (typeof oldHandler === "function") oldHandler(e);
        };
    }

    // ================================================================
    // 4) 🚀 Override كامل لـ renderTrendResult (لإلغاء طريقة العرض القديمة)
    // ================================================================
    window.renderTrendResult = function (title, items) {
        // تجاهل التايتل القديم واستبداله بالعرض الجديد
        const box = document.getElementById("ai-output");
        box.innerHTML = "";

        // استخدم الكروت الجديدة
        window.renderAIResults(items, false);
    };

    // ================================================================
    // 5) تصميم مخصص للكروت (Injected CSS)
    // ================================================================
    const style = document.createElement("style");
    style.innerHTML = `
        .trend-card {
            background: #fff;
            padding: 15px;
            margin: 12px 0;
            border-radius: 10px;
            border: 1px solid #e9e9e9;
            box-shadow: 0 2px 7px rgba(0,0,0,0.05);
        }
        .trend-rank {
            font-size: 20px;
            font-weight: bold;
            color: #d32f2f;
        }
        .trend-title {
            font-size: 18px;
            font-weight: bold;
            margin: 6px 0;
        }
        .trend-meta {
            color: #666;
            font-size: 14px;
            margin-bottom: 8px;
        }
        .trend-scores span {
            display: inline-block;
            margin-right: 10px;
            font-size: 14px;
            background: #f5f5f5;
            padding: 3px 8px;
            border-radius: 6px;
        }
        .add-trend-btn {
            padding: 6px 14px;
            background: #28a745;
            border: none;
            color: white;
            border-radius: 6px;
            cursor: pointer;
            margin-top: 10px;
        }
        .trend-link {
            display: inline-block;
            margin-top: 10px;
            color: #0277bd;
            text-decoration: none;
        }
        .trend-link:hover {
            text-decoration: underline;
        }
    `;
    document.body.appendChild(style);

});
