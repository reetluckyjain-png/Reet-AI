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

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;
const MAX_HISTORY = 12;
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

async function extractMemory(message) {
    if (/my name is (.+)/i.test(message)) {
        return { save: true, type: "profile", key: "name", value: message.match(/my name is (.+)/i)[1] };
    }

    if (/i like (.+)/i.test(message)) {
        return { save: true, type: "interest", value: message.match(/i like (.+)/i)[1] };
    }

    if (/i am (.+)/i.test(message)) {
        return { save: true, type: "fact", value: message.match(/i am (.+)/i)[1] };
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

    const addMatch = message.match(/(?:add|create)\s+(?:a\s+)?task\s+(.+)/i);
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

    const openMatch = message.match(/^\s*open\s+(.+)/i);
    if (openMatch?.[1]) {
        return { intent: "open", input: openMatch[1].trim() };
    }

    const searchMatch = message.match(/(?:^|\s)(?:search|find)\s+(.+)/i);
    if (searchMatch?.[1]) {
        return { intent: "search", input: searchMatch[1].trim() };
    }

    return { intent: "chat", input: "" };
}

async function detectIntent(message) {
    const fast = detectIntentFast(message);
    if (fast.intent !== "chat") return fast;
    if (!groq) return fast;

    try {
        const res = await groq.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: `Return strict JSON only:\n{"intent":"open|search|add_task|get_tasks|complete_task|delete_task|chat","input":""}`
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
            input: typeof parsed.input === "string" ? parsed.input : ""
        };
    } catch {
        return fast;
    }
}

async function getAIResponse(message, sessionId) {
    const memory = formatMemoryForAI(loadMemory());
    const history = getHistoryForSession(sessionId);

    history.push({ role: "user", content: message });
    while (history.length > MAX_HISTORY) {
        history.shift();
    }

    if (!groq) {
        const fallback = "Groq API key missing. I can still handle tasks, open, and search commands.";
        history.push({ role: "assistant", content: fallback });
        return fallback;
    }

    const chat = await groq.chat.completions.create({
        messages: [
            {
                role: "system",
                content: `Reply strict JSON only: {"message":"..."}\n${memory}`
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

    history.push({ role: "assistant", content: reply });
    while (history.length > MAX_HISTORY) {
        history.shift();
    }

    return reply;
}

app.post("/chat", checkAuth, async (req, res) => {
    try {
        const message = typeof req.body.message === "string" ? req.body.message.trim() : "";
        if (!message) {
            return res.status(400).json({ error: "message is required" });
        }

        const lower = message.toLowerCase();
        const sessionId = getSessionId(req);

        if (lower.includes("open") && lower.includes("search")) {
            const openMatch = lower.match(/open\s+([a-z0-9.-]+)/);
            const searchMatch = message.match(/search\s+(.+)/i);

            const site = openMatch ? openMatch[1] : null;
            const query = searchMatch ? searchMatch[1] : null;

            if (site && query) {
                const url = (site === "youtube" || site === "yt")
                    ? "https://www.youtube.com/results?search_query=" + encodeURIComponent(query)
                    : "https://www.google.com/search?q=" + encodeURIComponent(query);

                return res.json({
                    type: "action",
                    action: "open_website",
                    payload: { url }
                });
            }
        }

        const intent = await detectIntent(message);

        if (intent.intent === "add_task") {
            const task = addTask(intent.input);
            if (!task) return res.json({ type: "chat", reply: "Please provide task text." });
            return res.json({ type: "chat", reply: `Task added: ${task.id} ${task.text}` });
        }

        if (intent.intent === "get_tasks") {
            const tasks = getTasks();
            if (!tasks.length) return res.json({ type: "chat", reply: "No tasks." });
            return res.json({
                type: "chat",
                reply: tasks.map((t) => `${t.completed ? "[x]" : "[ ]"} ${t.id} ${t.text}`).join("\n")
            });
        }

        if (intent.intent === "complete_task") {
            const task = completeTask(intent.input);
            return res.json({ type: "chat", reply: task ? `Completed: ${task.text}` : "Task not found." });
        }

        if (intent.intent === "delete_task") {
            const deleted = deleteTask(intent.input);
            return res.json({ type: "chat", reply: deleted ? "Task deleted." : "Task not found." });
        }

        if (intent.intent === "open") {
            return res.json({
                type: "action",
                action: "open_website",
                payload: { url: resolveWebsite(intent.input || message) }
            });
        }

        if (intent.intent === "search") {
            return res.json({
                type: "action",
                action: "open_website",
                payload: {
                    url: "https://www.google.com/search?q=" + encodeURIComponent(intent.input || message)
                }
            });
        }

        const mem = await extractMemory(message);
        const updatedMemory = updateMemory(loadMemory(), mem);
        saveMemory(updatedMemory);

        const reply = await getAIResponse(message, sessionId);
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
