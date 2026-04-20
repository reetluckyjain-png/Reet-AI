require("dotenv").config();

const express = require("express");
const cors = require("cors");
const Groq = require("groq-sdk");
const path = require("path");

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

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

// ================= AUTH =================
function checkAuth(req, res, next) {
    if (req.body.key !== process.env.SECRET_KEY) {
        return res.status(403).json({ error: "Unauthorized" });
    }
    next();
}

let chatHistory = [];

// ================= SMART SITE MAP =================
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

    let clean = input.toLowerCase().trim();

    clean = clean.replace(/(please|can you|open|go to|for me)/g, "").trim();
    clean = clean.replace(/\s+/g, "");

    if (SITE_MAP[clean]) return SITE_MAP[clean];
    if (clean.startsWith("http")) return clean;

    return "https://" + clean + ".com";
}

// ================= MEMORY =================
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

    try {
        const res = await groq.chat.completions.create({
            messages: [
                { role: "system", content: "Extract important memory. Return JSON." },
                { role: "user", content: message }
            ],
            model: "llama-3.1-8b-instant"
        });

        return JSON.parse(res.choices[0].message.content);
    } catch {
        return { save: false };
    }
}

// ================= AI INTENT =================
async function detectIntent(message) {
    try {
        const res = await groq.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: `
Return JSON:
{
 "intent": "open | search | add_task | get_tasks | complete_task | delete_task | chat",
 "input": ""
}
`
                },
                { role: "user", content: message }
            ],
            model: "llama-3.1-8b-instant"
        });

        return JSON.parse(res.choices[0].message.content);
    } catch {
        const lower = message.toLowerCase();

        if (lower.includes("open")) return { intent: "open", input: message };
        if (lower.includes("search") || lower.includes("find")) return { intent: "search", input: message };

        return { intent: "chat", input: "" };
    }
}

// ================= AI CHAT =================
async function getAIResponse(message) {
    const memory = formatMemoryForAI(loadMemory());

    chatHistory.push({ role: "user", content: message });
    if (chatHistory.length > 12) chatHistory.shift();

    const chat = await groq.chat.completions.create({
        messages: [
            {
                role: "system",
                content: `Reply JSON only: { "message": "..." }\n${memory}`
            },
            ...chatHistory
        ],
        model: "llama-3.1-8b-instant"
    });

    return chat.choices[0].message.content;
}

// ================= ROUTE =================
app.post("/chat", checkAuth, async (req, res) => {

    const { message } = req.body;
    const lower = message.toLowerCase();

    // ================= SMART CHAINING =================
    if (lower.includes("open") && lower.includes("search")) {

        const openMatch = lower.match(/open\s+([a-z0-9]+)/);
        const searchMatch = message.match(/search\s+(.+)/i);

        const site = openMatch ? openMatch[1] : null;
        const query = searchMatch ? searchMatch[1] : null;

        if (site && query) {

            let url;

            if (site === "youtube" || site === "yt") {
                url = "https://www.youtube.com/results?search_query=" +
                    encodeURIComponent(query);
            } else if (site === "google") {
                url = "https://www.google.com/search?q=" +
                    encodeURIComponent(query);
            } else {
                url = "https://www.google.com/search?q=" +
                    encodeURIComponent(query);
            }

            return res.json({
                type: "action",
                action: "open_website",
                payload: { url }
            });
        }
    }

    // ================= INTENT =================
    const intent = await detectIntent(message);

    // ================= TASKS =================
    if (intent.intent === "add_task") {
        const t = addTask(intent.input);
        return res.json({ type: "chat", reply: `✅ ${t.text}` });
    }

    if (intent.intent === "get_tasks") {
        const tasks = getTasks();
        if (!tasks.length) return res.json({ type: "chat", reply: "📭 No tasks" });

        return res.json({
            type: "chat",
            reply: tasks.map(t => `${t.completed ? "✅" : "🕒"} ${t.id} ${t.text}`).join("\n")
        });
    }

    if (intent.intent === "complete_task") {
        const t = completeTask(intent.input);
        return res.json({ type: "chat", reply: t ? `✅ ${t.text}` : "Not found" });
    }

    if (intent.intent === "delete_task") {
        deleteTask(intent.input);
        return res.json({ type: "chat", reply: "Deleted" });
    }

    // ================= TOOLS =================
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
                url: "https://www.google.com/search?q=" +
                    encodeURIComponent(intent.input || message)
            }
        });
    }

    // ================= MEMORY =================
    const mem = await extractMemory(message);
    let memory = loadMemory();
    memory = updateMemory(memory, mem);
    saveMemory(memory);

    // ================= CHAT =================
    const ai = await getAIResponse(message);

    try {
        const parsed = JSON.parse(ai);
        return res.json({ type: "chat", reply: parsed.message });
    } catch {
        return res.json({ type: "chat", reply: ai });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 http://localhost:${PORT}`);
});