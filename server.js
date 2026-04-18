require("dotenv").config();

const express = require("express");
const cors = require("cors");
const Groq = require("groq-sdk");

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3000;

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

// 🔐 AUTH
function checkAuth(req, res, next) {
    if (req.body.key !== process.env.SECRET_KEY) {
        return res.status(403).json({ error: "Unauthorized" });
    }
    next();
}

// 🤖 AI BRAIN (STRICT OUTPUT)
async function getAIResponse(message) {

    const response = await groq.chat.completions.create({
        messages: [
            {
                role: "system",
                content: `
You are Reet AI Agent.

OUTPUT ONLY VALID JSON.

RULES:
- NO text outside JSON
- NO markdown
- NO explanations
- ONE JSON OBJECT ONLY

FORMATS:

CHAT:
{"type":"chat","reply":"short response"}

ACTION:
{"type":"action","action":"open_website","url":"https://example.com"}

{"type":"action","action":"search_google","query":"cricket"}

PLAN:
{"type":"plan","steps":[
  {"action":"open_website","url":"https://www.youtube.com/results?search_query=cricket"}
]}

IMPORTANT:
- If multiple tasks → ALWAYS use PLAN
`
            },
            {
                role: "user",
                content: message
            }
        ],
        model: "llama-3.1-8b-instant",
        temperature: 0.2
    });

    let text = response.choices[0].message.content;

    // 🔥 CLEAN OUTPUT
    text = text.replace(/```json/g, "").replace(/```/g, "").trim();

    return text;
}

// 🧠 SAFE PARSER
function safeParse(text) {
    try {
        return JSON.parse(text);
    } catch {
        return {
            type: "chat",
            reply: "I understood your request but response format failed."
        };
    }
}

// 🚀 API
app.post("/chat", checkAuth, async (req, res) => {

    try {
        const ai = await getAIResponse(req.body.message);
        const parsed = safeParse(ai);

        return res.json(parsed);

    } catch (err) {
        return res.json({
            type: "chat",
            reply: "Server error occurred"
        });
    }
});

// 🟢 START SERVER
app.listen(PORT, () => {
    console.log(`🚀 Reet running on http://localhost:${PORT}`);
});