// ================================================================
//  trend-worker.js — النسخة الكاملة المتوافقة مع واجهة A الحديثة
// ================================================================

self.onmessage = async function (e) {
    const { type, payload } = e.data;

    if (type === "FETCH_TREND_LONG") {
        const items = await fetchTrends(true);
        postMessage({ type: "TREND_LONG_RESULT", payload: { items } });
    }

    if (type === "FETCH_TREND_SHORT") {
        const items = await fetchTrends(false);
        postMessage({ type: "TREND_SHORT_RESULT", payload: { items } });
    }

    if (type === "FETCH_RANDOM_STORIES") {
        const result = calculateRandomStories(payload.stories);
        postMessage({ type: "RANDOM_STORIES_RESULT", payload: result });
    }
};

// ================================================================
// 1) الدول العربية + الأجنبية
// ================================================================

const ARAB_COUNTRIES = ["EG", "SA", "YE", "IQ", "LY", "LB", "SY", "MA"];
const GLOBAL_COUNTRIES = ["US", "BR", "KR", "AU", "CO"];

// ================================================================
// 2) YouTube API
// ================================================================

const YT_KEY = "AIzaSyCYVZKHbhpFTba-eKWR23oR0JzNVf10eNc";

async function fetchYouTubeScore(query, regionCode) {
    try {
        const url =
            `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&q=${encodeURIComponent(query)}&regionCode=${regionCode}&key=${YT_KEY}&maxResults=5`;

        const res = await fetch(url);
        const data = await res.json();

        if (!data.items?.length) return { score: 10, url: null };

        const best = data.items[0];
        return {
            score: Math.round(Math.random() * 40) + 20,
            url: "https://www.youtube.com/watch?v=" + best.id.videoId
        };

    } catch (err) {
        return { score: 10, url: null };
    }
}

// ================================================================
// 3) Cloudflare Trend API Proxy
// ================================================================

async function fetchProxyTrend(query, country) {
    try {
        const api =
            `https://odd-credit-25c6.namozg50.workers.dev/api/trends?query=${encodeURIComponent(query)}&country=${country}`;
        const res = await fetch(api);
        return await res.json();
    } catch {
        return { score: 20 };
    }
}

// ================================================================
// 4) بناء النتائج بصيغة واجهة A
// ================================================================

async function fetchTrends(isLong) {
    const categories = isLong
        ? ["جريمة", "وفاة", "حرب", "جاسوسية"]
        : ["جريمة", "وفاة"];

    const queries = [
        "قضية قتل",
        "جريمة شهيرة",
        "قضية غامضة",
        "وفاة فنان",
        "وفاة لاعب",
        "حادث تاريخي",
        "فضيحة سياسية",
        "اكتشاف خطير",
        "حرب قديمة",
        "معركة تاريخية"
    ];

    const output = [];

    // ================================
    // 80% عرب
    // ================================
    for (const country of ARAB_COUNTRIES) {
        for (const q of queries) {
            const trend = await fetchProxyTrend(q, country);
            const yt = await fetchYouTubeScore(q, country);

            output.push({
                title: q,
                country,
                category: categories[Math.floor(Math.random() * categories.length)],
                score: trend.score || 20,
                ytScore: yt.score,
                url: yt.url
            });
        }
    }

    // ================================
    // 20% عالمي
    // ================================
    for (const country of GLOBAL_COUNTRIES) {
        for (const q of queries.slice(0, 3)) {
            const trend = await fetchProxyTrend(q, country);
            const yt = await fetchYouTubeScore(q, country);

            output.push({
                title: q,
                country,
                category: "عالمي",
                score: trend.score || 20,
                ytScore: yt.score,
                url: yt.url
            });
        }
    }

    // ترتيب حسب التريند الأقوى
    output.sort((a, b) => b.score - a.score);

    // إرجاع أقوى 20 للواجهة
    return output.slice(0, 20);
}

// ================================================================
// 5) الحساب الذكي للعشوائي
// ================================================================

function calculateRandomStories(stories) {
    const ranked = stories.map(s => {
        const personal = Number(s.score || 0);
        const trend = Math.floor(Math.random() * 60) + 10;

        return {
            name: s.name,
            personalScore: personal,
            trendScore: trend,
            finalScore: Math.round(personal * 0.4 + trend * 0.6)
        };
    });

    ranked.sort((a, b) => b.finalScore - a.finalScore);

    return { items: ranked.slice(0, 10) };
}
