require("dotenv").config();

const express = require("express");
const cors = require("cors");
const Groq = require("groq-sdk");
const fs = require("fs");

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3000;

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

// auth
function checkAuth(req, res, next) {
    if (req.body.key !== process.env.SECRET_KEY) {
        return res.status(403).json({ error: "Unauthorized" });
    }
    next();
}

// memory
function loadMemory() {
    try {
        return JSON.parse(fs.readFileSync("memory.json"));
    } catch {
        return [];
    }
}

function saveMemory(data) {
    fs.writeFileSync("memory.json", JSON.stringify(data, null, 2));
}

let chatHistory = [];

// memory extraction
async function extractImportantMemory(message) {
    try {
        const chat = await groq.chat.completions.create({
            messages: [
                {
                    role: "system",
                    content: `
Extract important personal info.

Return ONLY JSON:
{
  "save": true,
  "memory": "..."
}
OR
{
  "save": false
}
`
                },
                { role: "user", content: message }
            ],
            model: "llama-3.1-8b-instant"
        });

        return JSON.parse(chat.choices[0].message.content);

    } catch {
        return { save: false };
    }
}

// AI response (HUMAN STYLE)
async function getAIResponse(message) {
    const memory = loadMemory().join("\n");

    chatHistory.push({ role: "user", content: message });
    if (chatHistory.length > 12) chatHistory.shift();

    const chat = await groq.chat.completions.create({
        messages: [
            {
                role: "system",
                content: `
You are Reet — a natural, friendly AI assistant.

PERSONALITY:
- Speak like a real human friend
- Casual, warm, slightly emotional
- Use contractions (I'm, you're, don't)
- Keep replies short unless needed
- NEVER sound robotic
- NEVER say "As an AI"

MEMORY:
${memory}

RULES:
- ONLY return JSON
- NO extra text

FORMAT:

CHAT:
{
  "type": "chat",
  "message": "natural human response"
}

ACTION:
{
  "type": "action",
  "action": "open_website",
  "payload": {
    "url": "https://example.com"
  }
}
`
            },
            ...chatHistory
        ],
        model: "llama-3.1-8b-instant"
    });

    return chat.choices[0].message.content;
}

// main route
app.post("/chat", checkAuth, async (req, res) => {
    const { message } = req.body;

    const mem = await extractImportantMemory(message);

    if (mem.save && mem.memory) {
        let data = loadMemory();
        if (!data.includes(mem.memory)) {
            data.push(mem.memory);
            saveMemory(data);
        }
    }

    const aiResponse = await getAIResponse(message);

    let finalResponse;

    try {
        const parsed = JSON.parse(aiResponse);

        if (parsed.type === "action") {
            finalResponse = {
                type: "action",
                action: parsed.action,
                payload: parsed.payload || {}
            };
        } else {
            finalResponse = {
                type: "chat",
                reply: parsed.message
            };
        }

    } catch {
        finalResponse = {
            type: "chat",
            reply: aiResponse
        };
    }

    return res.json(finalResponse);
});

app.listen(PORT, () => {
    console.log(`Reet AI running on http://localhost:${PORT}`);
});