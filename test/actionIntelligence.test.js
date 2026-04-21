const test = require("node:test");
const assert = require("node:assert/strict");

const {
  enrichActionQuery,
  parseSmartChain,
  buildSearchUrl,
  detectPlatformHint,
  detectAmbiguity,
  getAmbiguityPrompt
} = require("../actionIntelligence");

test("memory-aware query replaces my favorite team", () => {
  const query = enrichActionQuery({
    rawQuery: "search cricket highlights of my favorite team",
    memory: {
      profile: {},
      interests: ["F1"],
      preferences: {},
      facts: ["favorite team is Red Bull"]
    },
    history: []
  });

  assert.equal(query, "cricket highlights of Red Bull");
});

test("context-aware generic highlights query uses recent user context", () => {
  const query = enrichActionQuery({
    rawQuery: "show highlights",
    memory: { profile: {}, interests: [], preferences: {}, facts: [] },
    history: [
      { role: "user", content: "I like Red Bull" },
      { role: "assistant", content: "Noted" },
      { role: "user", content: "show highlights" }
    ]
  });

  assert.equal(query, "highlights of Red Bull");
});

test("smart chain parser detects platform and query", () => {
  const parsed = parseSmartChain("open youtube and search highlights of my favorite team");
  assert.equal(parsed.platform, "youtube");
  assert.equal(parsed.query, "highlights of my favorite team");
});

test("platform-aware URL builder generates youtube search url", () => {
  const url = buildSearchUrl("youtube", "red bull highlights");
  assert.equal(url, "https://www.youtube.com/results?search_query=red%20bull%20highlights");
});

test("google platform search does not inject site filter", () => {
  const url = buildSearchUrl("google", "search cricket highlights of India");
  assert.equal(url, "https://www.google.com/search?q=search%20cricket%20highlights%20of%20India");
});

test("platform hint reads natural language mention", () => {
  const platform = detectPlatformHint("can you show me highlights on youtube", []);
  assert.equal(platform, "youtube");
});

test("favorite team from preferences is used for generic highlights", () => {
  const query = enrichActionQuery({
    rawQuery: "highlights",
    memory: {
      profile: {},
      interests: [],
      preferences: { favorite_team: "India" },
      facts: []
    },
    history: []
  });

  assert.equal(query, "highlights of India");
});

test("action query removes leading command verbs", () => {
  const query = enrichActionQuery({
    rawQuery: "search cricket highlights of India",
    memory: { profile: {}, interests: [], preferences: {}, facts: [] },
    history: []
  });

  assert.equal(query, "cricket highlights of India");
});

test("f1 highlights query expands with favorite f1 team", () => {
  const query = enrichActionQuery({
    rawQuery: "search F1 highlights",
    memory: {
      profile: {},
      interests: ["F1"],
      preferences: { favorite_f1_team: "Red Bull" },
      facts: []
    },
    history: []
  });

  assert.equal(query, "F1 highlights of Red Bull");
});

test("ambiguous generic highlights query asks for clarification", () => {
  const prompt = getAmbiguityPrompt({
    rawQuery: "search highlights",
    memory: {
      profile: {},
      interests: ["India", "Messi"],
      preferences: {},
      facts: []
    },
    history: []
  });

  assert.equal(prompt, "Do you mean India or Messi?");
});

test("ambiguity detector returns candidates and cleaned query", () => {
  const result = detectAmbiguity({
    rawQuery: "search highlights",
    memory: {
      profile: {},
      interests: ["India", "Messi", "F1"],
      preferences: {},
      facts: []
    },
    history: []
  });

  assert.equal(result.cleanedQuery, "highlights");
  assert.deepEqual(result.candidates, ["India", "Messi", "F1"]);
});
