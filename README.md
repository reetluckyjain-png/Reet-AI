# Reet-AI

AI assistant app with:
- Chat endpoint (`/chat`)
- Structured memory (`memory.json`)
- Task management (`tasks.json`)
- Action intents (`open`, `search`, smart open+search chain)
- Memory-aware action enrichment (favorite team/player context)
- Ambiguity clarification (`Do you mean India or Messi?`)
- Session-based conversation context

## Setup

1. Install dependencies:
   `npm install`
2. Configure `.env`:
   - `PORT=3000`
   - `GROQ_API_KEY=...` (optional for AI chat/memory extraction)
   - `SECRET_KEY=...` (optional auth)
3. Run:
   `npm start`

## Auth

If `SECRET_KEY` is set, frontend must send it in `x-api-key` header.
The UI stores this key in browser local storage.

## Test

Run:
`npm test`
