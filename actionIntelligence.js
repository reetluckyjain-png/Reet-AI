const { URL } = require("url");

const SITE_MAP = {
    youtube: "https://www.youtube.com",
    yt: "https://www.youtube.com",
    google: "https://www.google.com",
    gmail: "https://mail.google.com",
    instagram: "https://www.instagram.com",
    insta: "https://www.instagram.com",
    facebook: "https://www.facebook.com",
    fb: "https://www.facebook.com",
    twitter: "https://twitter.com",
    x: "https://twitter.com",
    github: "https://github.com",
    linkedin: "https://www.linkedin.com",
    whatsapp: "https://web.whatsapp.com",
    chatgpt: "https://chat.openai.com"
};

function normalizePlatform(input) {
    if (!input) return "";
    const clean = String(input).toLowerCase().trim();
    return SITE_MAP[clean] ? clean : clean.replace(/[^a-z0-9.-]/g, "");
}

function extractTopicFromMessage(message) {
    if (!message) return "";
    const text = String(message).trim();

    const likeMatch = text.match(/\b(?:i like|i love|i support|my favorite(?: team| player| club)? is)\s+(.+)/i);
    if (likeMatch?.[1]) return likeMatch[1].trim();

    const aboutMatch = text.match(/\b(?:about|of)\s+(.+)/i);
    if (aboutMatch?.[1]) return aboutMatch[1].trim();

    const searchMatch = text.match(/\b(?:search|find|show|look up)\s+(.+)/i);
    if (searchMatch?.[1]) return searchMatch[1].trim();

    return "";
}

function deriveContextTopic(history) {
    if (!Array.isArray(history)) return "";

    for (let i = history.length - 1; i >= 0; i -= 1) {
        const item = history[i];
        if (!item || item.role !== "user") continue;
        const topic = extractTopicFromMessage(item.content);
        if (topic && !isGenericQuery(topic)) {
            return topic;
        }
    }

    return "";
}

function extractFavoriteEntity(memory, query = "") {
    if (!memory || typeof memory !== "object") return "";
    const queryLower = String(query || "").toLowerCase();

    if (memory.preferences && typeof memory.preferences === "object") {
        let best = "";
        let bestScore = -1;

        for (const [key, rawValue] of Object.entries(memory.preferences)) {
            if (!key.startsWith("favorite_")) continue;
            if (typeof rawValue !== "string" || !rawValue.trim()) continue;

            const keyLower = key.toLowerCase();
            let score = 1;

            if (keyLower.includes("_team")) score += 2;
            if (keyLower.includes("_player")) score += 1;
            if (keyLower.includes("_club")) score += 1;
            if (keyLower.includes("f1") && (queryLower.includes("f1") || queryLower.includes("formula 1"))) score += 5;
            if (keyLower.includes("cricket") && queryLower.includes("cricket")) score += 4;
            if (keyLower.includes("football") && (queryLower.includes("football") || queryLower.includes("soccer"))) score += 4;

            if (score > bestScore) {
                best = rawValue.trim();
                bestScore = score;
            }
        }

        if (best) return best;
    }

    if (Array.isArray(memory.facts)) {
        for (const fact of memory.facts) {
            if (typeof fact !== "string") continue;
            const match = fact.match(/\b(?:favorite(?: [a-z0-9\s]+)?(?: team| player| club)? is|i support|i like)\s+(.+)/i);
            if (match?.[1]) return match[1].trim();
        }
    }

    if (Array.isArray(memory.interests) && memory.interests.length) {
        const interest = String(memory.interests[0]).trim();
        if (!interest) return "";
        if (!queryLower.includes(interest.toLowerCase())) return interest;
    }

    return "";
}

function isGenericQuery(query) {
    if (!query) return true;

    const q = String(query).toLowerCase().trim();
    if (!q) return true;

    const genericPatterns = [
        /^highlights?$/,
        /^show highlights?$/,
        /^latest$/,
        /^latest updates?$/,
        /^updates?$/,
        /^news$/,
        /^show me something cool$/,
        /^something cool$/,
        /^show me something cool about\s+.+$/,
        /^tell me something cool(?: about .+)?$/,
        /^(it|that|this)$/
    ];

    return genericPatterns.some((pattern) => pattern.test(q));
}

function enrichActionQuery({ rawQuery, memory, history }) {
    const baseQuery = String(rawQuery || "").trim();
    const favorite = extractFavoriteEntity(memory, baseQuery);
    const contextTopic = deriveContextTopic(history);

    if (!baseQuery) {
        if (contextTopic) return `latest updates about ${contextTopic}`;
        if (favorite) return `latest updates about ${favorite}`;
        return "latest updates";
    }

    let query = baseQuery.replace(/^\s*(search|find|show|look up)\s+/i, "").trim();
    if (favorite) {
        query = query.replace(/my favorite (team|player|club)/gi, favorite);
    }

    if (isGenericQuery(query)) {
        if (/highlight/i.test(query)) {
            if (contextTopic) return `highlights of ${contextTopic}`;
            if (favorite) return `highlights of ${favorite}`;
        }

        if (contextTopic) return `${query} about ${contextTopic}`;
        if (favorite) return `${query} about ${favorite}`;
    }

    const looksLikeUpdateQuery = /\b(highlights?|news|updates?|latest)\b/i.test(query);
    const alreadyScoped = /\b(of|about|for)\b/i.test(query);
    const alreadyContainsFavorite = favorite && query.toLowerCase().includes(favorite.toLowerCase());
    if (favorite && looksLikeUpdateQuery && !alreadyScoped && !alreadyContainsFavorite) {
        if (/highlight/i.test(query)) {
            return `${query} of ${favorite}`;
        }
        return `${query} about ${favorite}`;
    }

    return query;
}

function normalizeEntity(value) {
    return String(value || "").trim().replace(/\s+/g, " ");
}

function collectCandidateEntities(memory, history) {
    const values = [];

    if (memory && typeof memory === "object") {
        if (Array.isArray(memory.interests)) {
            values.push(...memory.interests.map(normalizeEntity).filter(Boolean));
        }

        if (memory.preferences && typeof memory.preferences === "object") {
            for (const [key, rawValue] of Object.entries(memory.preferences)) {
                if (!key.startsWith("favorite_")) continue;
                const clean = normalizeEntity(rawValue);
                if (clean) values.push(clean);
            }
        }
    }

    if (Array.isArray(history)) {
        for (let i = history.length - 1; i >= 0 && i >= history.length - 8; i -= 1) {
            const item = history[i];
            if (!item || item.role !== "user") continue;
            const topic = normalizeEntity(extractTopicFromMessage(item.content));
            if (topic && topic.length <= 40 && !isGenericQuery(topic)) {
                values.push(topic);
            }
        }
    }

    const dedup = [];
    for (const value of values) {
        const lower = value.toLowerCase();
        if (!dedup.some((v) => v.toLowerCase() === lower)) {
            dedup.push(value);
        }
    }
    return dedup;
}

function detectAmbiguity({ rawQuery, memory, history }) {
    const query = String(rawQuery || "").replace(/^\s*(search|find|show|look up)\s+/i, "").trim();
    if (!query) return null;

    const isUpdateLike = /\b(highlights?|news|updates?|latest)\b/i.test(query) || isGenericQuery(query);
    const alreadyScoped = /\b(of|about|for)\b/i.test(query);
    if (!isUpdateLike || alreadyScoped) return null;

    const candidates = collectCandidateEntities(memory, history)
        .filter((entity) => !query.toLowerCase().includes(entity.toLowerCase()));

    if (candidates.length < 2) return null;

    const top = candidates.slice(0, 3);
    return {
        cleanedQuery: query,
        candidates: top,
        prompt: `Do you mean ${top.join(" or ")}?`
    };
}

function getAmbiguityPrompt(input) {
    const result = detectAmbiguity(input);
    return result ? result.prompt : null;
}

function parseSmartChain(message) {
    const text = String(message || "");

    const primary = text.match(/open\s+([a-z0-9.-]+)\s+and\s+(?:search|find|show)\s+(.+)/i);
    if (primary?.[1] && primary?.[2]) {
        return {
            platform: normalizePlatform(primary[1]),
            query: primary[2].trim()
        };
    }

    const secondary = text.match(/open\s+([a-z0-9.-]+).+?search\s+(.+)/i);
    if (secondary?.[1] && secondary?.[2]) {
        return {
            platform: normalizePlatform(secondary[1]),
            query: secondary[2].trim()
        };
    }

    return null;
}

function detectPlatformHint(message, history) {
    const lower = String(message || "").toLowerCase();
    if (lower.includes("youtube") || lower.includes("yt")) return "youtube";
    if (lower.includes("google")) return "google";
    if (lower.includes("github")) return "github";
    if (lower.includes("linkedin")) return "linkedin";

    if (Array.isArray(history)) {
        for (let i = history.length - 1; i >= 0; i -= 1) {
            const item = history[i];
            if (!item || item.role !== "user") continue;
            const content = String(item.content || "").toLowerCase();
            if (content.includes("youtube") || content.includes("yt")) return "youtube";
            if (content.includes("google")) return "google";
        }
    }

    return "google";
}

function buildSearchUrl(platform, query) {
    const encoded = encodeURIComponent(query);

    switch (platform) {
        case "youtube":
        case "yt":
            return `https://www.youtube.com/results?search_query=${encoded}`;
        case "github":
            return `https://github.com/search?q=${encoded}`;
        case "linkedin":
            return `https://www.linkedin.com/search/results/all/?keywords=${encoded}`;
        case "google":
            return `https://www.google.com/search?q=${encoded}`;
        default:
            if (SITE_MAP[platform]) {
                try {
                    const domain = new URL(SITE_MAP[platform]).hostname;
                    return `https://www.google.com/search?q=${encodeURIComponent(`site:${domain} ${query}`)}`;
                } catch {
                    return `https://www.google.com/search?q=${encoded}`;
                }
            }
            return `https://www.google.com/search?q=${encoded}`;
    }
}

function resolveWebsite(input) {
    if (!input) return null;

    let clean = String(input).toLowerCase().trim();
    clean = clean.replace(/(please|can you|open|go to|for me)/g, "").trim();
    clean = clean.replace(/\s+/g, "");

    if (SITE_MAP[clean]) return SITE_MAP[clean];
    if (clean.startsWith("http://") || clean.startsWith("https://")) return clean;
    if (clean.includes(".")) return `https://${clean}`;

    return `https://${clean}.com`;
}

module.exports = {
    SITE_MAP,
    buildSearchUrl,
    detectPlatformHint,
    collectCandidateEntities,
    detectAmbiguity,
    deriveContextTopic,
    enrichActionQuery,
    extractFavoriteEntity,
    getAmbiguityPrompt,
    isGenericQuery,
    parseSmartChain,
    resolveWebsite
};
