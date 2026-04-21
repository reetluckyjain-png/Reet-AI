require("dotenv").config();

const express = require("express");
const cors = require("cors");
const Groq = require("groq-sdk");
const crypto = require("crypto");

const {
    loadMemory,
    saveMemory,
    formatMemoryForAI,
    updateMemory
} = require("./memoryManager");

const {
    addTask,
    getTasks,
    completeTask,
    deleteTask
} = require("./taskManager");

const {
    buildSearchUrl,
    detectAmbiguity,
    detectPlatformHint,
    enrichActionQuery,
    parseSmartChain,
    resolveWebsite
} = require("./actionIntelligence");

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;
const MAX_HISTORY = 14;
const INTENTS = new Set([
    "open",
    "search",
    "add_task",
    "get_tasks",
    "complete_task",
    "delete_task",
    "chat"
]);

const hasGroqKey = Boolean(process.env.GROQ_API_KEY);
const groq = hasGroqKey
    ? new Groq({ apiKey: process.env.GROQ_API_KEY })
    : null;

const sessionHistory = new Map();
const pendingClarifications = new Map();

function checkAuth(req, res, next) {
    const secretKey = (process.env.SECRET_KEY || "").trim();
    if (!secretKey) return next();

    const fromHeader = typeof req.headers["x-api-key"] === "string"
        ? req.headers["x-api-key"]
        : "";
    const fromBody = typeof req.body.key === "string" ? req.body.key : "";
    const providedKey = (fromHeader || fromBody).trim();

    if (providedKey !== secretKey) {
        return res.status(403).json({ error: "Unauthorized" });
    }

    return next();
}

function getSessionId(req) {
    const fromHeader = typeof req.headers["x-client-id"] === "string"
        ? req.headers["x-client-id"]
        : "";
    const fromBody = typeof req.body.clientId === "string"
        ? req.body.clientId
        : "";
    const raw = (fromHeader || fromBody).trim();

    if (!raw) return "default";
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(raw)) return "default";
    return raw;
}

function getHistoryForSession(sessionId) {
    if (!sessionHistory.has(sessionId)) {
        sessionHistory.set(sessionId, []);
    }
    return sessionHistory.get(sessionId);
}

function pushSessionMessage(sessionId, role, content) {
    const history = getHistoryForSession(sessionId);
    history.push({ role, content: String(content || "") });
    while (history.length > MAX_HISTORY) {
        history.shift();
    }
}

function parseJsonFromModel(rawText) {
    if (typeof rawText !== "string") return null;

    const trimmed = rawText.trim();
    if (!trimmed) return null;

    const withoutCodeFence = trimmed
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/, "");

    try {
        return JSON.parse(withoutCodeFence);
    } catch {
        return null;
    }
}

function extractMemoryFromRules(message) {
    if (/my name is (.+)/i.test(message)) {
        return { save: true, type: "profile", key: "name", value: message.match(/my name is (.+)/i)[1] };
    }

    if (/my favou?rite\s+([a-z0-9\s]+?)\s+(team|player|club)\s+is\s+(.+)/i.test(message)) {
        const match = message.match(/my favou?rite\s+([a-z0-9\s]+?)\s+(team|player|club)\s+is\s+(.+)/i);
        const qualifier = match[1].trim().replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase();
        const subject = match[2].toLowerCase();
        return {
            save: true,
            type: "preference",
            key: `favorite_${qualifier}_${subject}`,
            value: match[3].trim()
        };
    }

    if (/my favou?rite (team|player|club) is (.+)/i.test(message)) {
        const match = message.match(/my favou?rite (team|player|club) is (.+)/i);
        return {
            save: true,
            type: "preference",
            key: `favorite_${match[1].toLowerCase()}`,
            value: match[2].trim()
        };
    }

    if (/i(?:\s+also)?\s+like\s+(.+)/i.test(message)) {
        return { save: true, type: "interest", value: message.match(/i(?:\s+also)?\s+like\s+(.+)/i)[1] };
    }

    if (/i\s+love\s+(.+)/i.test(message)) {
        return { save: true, type: "interest", value: message.match(/i\s+love\s+(.+)/i)[1] };
    }

    if (/i support (.+)/i.test(message)) {
        return { save: true, type: "preference", key: "favorite_team", value: message.match(/i support (.+)/i)[1] };
    }

    if (/i am (.+)/i.test(message)) {
        return { save: true, type: "fact", value: message.match(/i am (.+)/i)[1] };
    }

    return { save: false };
}

async function extractMemory(message) {
    const fromRules = extractMemoryFromRules(message);
    if (fromRules.save) {
        return fromRules;
    }

    if (!groq) {
        return { save: false };
    }

    try {
        const res = await groq.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: `Return strict JSON only. Format:\n{"save": boolean, "type": "profile|interest|preference|fact", "key": "", "value": ""}\nIf nothing useful: {"save": false}`
                },
                { role: "user", content: message }
            ],
            model: "llama-3.1-8b-instant"
        });

        const parsed = parseJsonFromModel(res.choices[0].message.content);
        if (!parsed || typeof parsed !== "object") return { save: false };
        return parsed;
    } catch {
        return { save: false };
    }
}

function detectIntentFast(message) {
    const lower = message.toLowerCase().trim();

    if (/^(show|list|get)\s+(my\s+)?tasks/.test(lower) || lower === "tasks") {
        return { intent: "get_tasks", input: "" };
    }

    const addMatch = message.match(/(?:add|create|remember)\s+(?:a\s+)?task\s+(.+)/i);
    if (addMatch?.[1]) {
        return { intent: "add_task", input: addMatch[1].trim() };
    }

    const completeMatch = message.match(/(?:complete|finish|done)\s+(?:task\s*)?([a-z0-9_-]+)/i);
    if (completeMatch?.[1]) {
        return { intent: "complete_task", input: completeMatch[1].trim() };
    }

    const deleteMatch = message.match(/(?:delete|remove)\s+(?:task\s*)?([a-z0-9_-]+)/i);
    if (deleteMatch?.[1]) {
        return { intent: "delete_task", input: deleteMatch[1].trim() };
    }

    const chainMatch = parseSmartChain(message);
    if (chainMatch) {
        return { intent: "search", input: chainMatch.query };
    }

    const openMatch = message.match(/^\s*open\s+(.+)/i);
    if (openMatch?.[1]) {
        return { intent: "open", input: openMatch[1].trim() };
    }

    const searchMatch = message.match(/(?:^|\s)(?:search|find|look up)\s+(.+)/i);
    if (searchMatch?.[1]) {
        return { intent: "search", input: searchMatch[1].trim() };
    }

    const naturalSearchPattern = /(show me|something cool|highlights|latest|updates|news|what's new|whats new|tell me about)/i;
    if (naturalSearchPattern.test(message)) {
        return { intent: "search", input: message };
    }

    return { intent: "chat", input: "" };
}

async function detectIntent(message) {
    const fast = detectIntentFast(message);
    if (!groq) return fast;

    try {
        const res = await groq.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: `Return strict JSON only:\n{"intent":"open|search|add_task|get_tasks|complete_task|delete_task|chat","input":""}\nClassify natural requests like \"show me something cool about cricket\" as search.`
                },
                { role: "user", content: message }
            ],
            model: "llama-3.1-8b-instant"
        });

        const parsed = parseJsonFromModel(res.choices[0].message.content);
        if (!parsed || typeof parsed !== "object") return fast;
        if (!INTENTS.has(parsed.intent)) return fast;

        return {
            intent: parsed.intent,
            input: typeof parsed.input === "string" && parsed.input.trim()
                ? parsed.input.trim()
                : fast.input
        };
    } catch {
        return fast;
    }
}

async function getAIResponse(sessionId) {
    const memory = formatMemoryForAI(loadMemory());
    const history = getHistoryForSession(sessionId);

    if (!groq) {
        const fallback = "Groq API key missing. I can still handle tasks, open, and search commands.";
        pushSessionMessage(sessionId, "assistant", fallback);
        return fallback;
    }

    const chat = await groq.chat.completions.create({
        messages: [
            {
                role: "system",
                content: `You are Reet, the user's personal AI friend: warm, sharp, concise, and practical.
Keep replies natural and helpful. Be encouraging without hype.
Use memory and recent chat context to personalize responses.
If uncertain, ask a brief clarifying question.
Never claim external actions were completed unless the app actually executes them.
Reply strict JSON only: {"message":"..."}\n${memory}`
            },
            ...history
        ],
        model: "llama-3.1-8b-instant"
    });

    const raw = chat.choices[0].message.content;
    const parsed = parseJsonFromModel(raw);
    const reply = parsed?.message && typeof parsed.message === "string"
        ? parsed.message
        : String(raw || "");

    pushSessionMessage(sessionId, "assistant", reply);
    return reply;
}

function buildScopedQuery(baseQuery, choice) {
    if (/highlight/i.test(baseQuery)) {
        return `${baseQuery} of ${choice}`;
    }
    return `${baseQuery} about ${choice}`;
}

function buildSmartActionResponse({ message, sessionId, explicitQuery, explicitPlatform, skipAmbiguity = false }) {
    const memory = loadMemory();
    const history = getHistoryForSession(sessionId);

    const chain = parseSmartChain(message);
    const platform = explicitPlatform || chain?.platform || detectPlatformHint(message, history);
    const rawQuery = explicitQuery || chain?.query || message;
    if (!skipAmbiguity) {
        const ambiguity = detectAmbiguity({
            rawQuery,
            memory,
            history
        });
        if (ambiguity) {
            pendingClarifications.set(sessionId, {
                platform,
                cleanedQuery: ambiguity.cleanedQuery,
                candidates: ambiguity.candidates
            });
            pushSessionMessage(sessionId, "assistant", ambiguity.prompt);
            return { type: "chat", reply: ambiguity.prompt };
        }
    }

    const enrichedQuery = enrichActionQuery({
        rawQuery,
        memory,
        history
    });

    const url = buildSearchUrl(platform, enrichedQuery);
    pushSessionMessage(sessionId, "assistant", `Action: search ${enrichedQuery} on ${platform}`);

    return {
        type: "action",
        action: "open_website",
        payload: { url, query: enrichedQuery, platform }
    };
}

app.post("/chat", checkAuth, async (req, res) => {
    try {
        const message = typeof req.body.message === "string" ? req.body.message.trim() : "";
        if (!message) {
            return res.status(400).json({ error: "message is required" });
        }

        const sessionId = getSessionId(req);
        pushSessionMessage(sessionId, "user", message);

        const pending = pendingClarifications.get(sessionId);
        if (pending) {
            const lower = message.toLowerCase();
            if (/\b(cancel|never mind|nevermind|stop)\b/i.test(lower)) {
                pendingClarifications.delete(sessionId);
                const reply = "Okay, I cancelled that search.";
                pushSessionMessage(sessionId, "assistant", reply);
                return res.json({ type: "chat", reply });
            }

            const match = pending.candidates.find((candidate) => {
                const c = candidate.toLowerCase();
                return lower === c || lower.includes(c);
            });

            if (match) {
                pendingClarifications.delete(sessionId);
                const scopedQuery = buildScopedQuery(pending.cleanedQuery, match);
                return res.json(buildSmartActionResponse({
                    message,
                    sessionId,
                    explicitQuery: scopedQuery,
                    explicitPlatform: pending.platform,
                    skipAmbiguity: true
                }));
            }

            if (message.split(/\s+/).length <= 5) {
                const reply = `Please pick one: ${pending.candidates.join(" or ")}.`;
                pushSessionMessage(sessionId, "assistant", reply);
                return res.json({ type: "chat", reply });
            }
        }

        const memoryFromRules = extractMemoryFromRules(message);
        if (memoryFromRules.save) {
            const updatedMemory = updateMemory(loadMemory(), memoryFromRules);
            saveMemory(updatedMemory);
            pendingClarifications.delete(sessionId);

            const reply = memoryFromRules.key
                ? `Got it. I will remember your ${memoryFromRules.key.replace(/_/g, " ")} as ${memoryFromRules.value}.`
                : `Got it. I will remember: ${memoryFromRules.value}.`;
            pushSessionMessage(sessionId, "assistant", reply);
            return res.json({ type: "chat", reply });
        }

        const chain = parseSmartChain(message);
        if (chain) {
            return res.json(buildSmartActionResponse({
                message,
                sessionId,
                explicitQuery: chain.query,
                explicitPlatform: chain.platform
            }));
        }

        const intent = await detectIntent(message);

        if (intent.intent === "add_task") {
            const task = addTask(intent.input);
            if (!task) return res.json({ type: "chat", reply: "Please provide task text." });
            const reply = `Task added: ${task.id} ${task.text}`;
            pushSessionMessage(sessionId, "assistant", reply);
            return res.json({ type: "chat", reply });
        }

        if (intent.intent === "get_tasks") {
            const tasks = getTasks();
            const reply = tasks.length
                ? tasks.map((t) => `${t.completed ? "[x]" : "[ ]"} ${t.id} ${t.text}`).join("\n")
                : "No tasks.";
            pushSessionMessage(sessionId, "assistant", reply);
            return res.json({ type: "chat", reply });
        }

        if (intent.intent === "complete_task") {
            const task = completeTask(intent.input);
            const reply = task ? `Completed: ${task.text}` : "Task not found.";
            pushSessionMessage(sessionId, "assistant", reply);
            return res.json({ type: "chat", reply });
        }

        if (intent.intent === "delete_task") {
            const deleted = deleteTask(intent.input);
            const reply = deleted ? "Task deleted." : "Task not found.";
            pushSessionMessage(sessionId, "assistant", reply);
            return res.json({ type: "chat", reply });
        }

        if (intent.intent === "search") {
            return res.json(buildSmartActionResponse({
                message,
                sessionId,
                explicitQuery: intent.input || message
            }));
        }

        if (intent.intent === "open") {
            const looksLikeSearch = /\b(search|find|look up|highlights|news|updates|something cool)\b/i.test(intent.input || message);
            if (looksLikeSearch) {
                return res.json(buildSmartActionResponse({
                    message,
                    sessionId,
                    explicitQuery: intent.input || message
                }));
            }

            const url = resolveWebsite(intent.input || message);
            pushSessionMessage(sessionId, "assistant", `Action: open ${url}`);
            return res.json({
                type: "action",
                action: "open_website",
                payload: { url }
            });
        }

        const mem = await extractMemory(message);
        const updatedMemory = updateMemory(loadMemory(), mem);
        saveMemory(updatedMemory);

        const reply = await getAIResponse(sessionId);
        return res.json({ type: "chat", reply });
    } catch (error) {
        const requestId = crypto.randomUUID();
        console.error(`[${requestId}] /chat failed`, error);
        return res.status(500).json({ error: "Internal server error", requestId });
    }
});

app.get("/health", (_req, res) => {
    res.json({ ok: true });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
