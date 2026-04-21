const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "memory.json");

function getDefaultMemory() {
    return {
        profile: {
            name: "",
            age: "",
            location: ""
        },
        interests: [],
        preferences: {
            tone: "casual"
        },
        facts: []
    };
}

function loadMemory() {
    try {
        const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
        return ensureStructure(data);
    } catch {
        return getDefaultMemory();
    }
}

function saveMemory(data) {
    fs.writeFileSync(FILE, JSON.stringify(ensureStructure(data), null, 2), "utf8");
}

function ensureStructure(memory) {
    const def = getDefaultMemory();
    const safeMemory = memory && typeof memory === "object" ? memory : {};

    return {
        profile: {
            ...def.profile,
            ...(safeMemory.profile && typeof safeMemory.profile === "object" ? safeMemory.profile : {})
        },
        interests: Array.isArray(safeMemory.interests) ? safeMemory.interests : [],
        preferences: {
            ...def.preferences,
            ...(safeMemory.preferences && typeof safeMemory.preferences === "object" ? safeMemory.preferences : {})
        },
        facts: Array.isArray(safeMemory.facts) ? safeMemory.facts : []
    };
}

function formatMemoryForAI(memory) {
    return `\nUser Memory:\n\nName: ${memory.profile.name || "Unknown"}\nAge: ${memory.profile.age || "Unknown"}\nLocation: ${memory.profile.location || "Unknown"}\n\nInterests:\n${memory.interests.length ? memory.interests.join(", ") : "None"}\n\nPreferences:\n${Object.entries(memory.preferences)
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ")}\n\nFacts:\n${memory.facts.length ? memory.facts.join(", ") : "None"}\n`;
}

function updateMemory(memory, extracted) {
    const safeMemory = ensureStructure(memory);
    if (!extracted || !extracted.save) return safeMemory;

    const type = typeof extracted.type === "string" ? extracted.type.toLowerCase() : "";
    const value = typeof extracted.value === "string" ? extracted.value.trim() : "";
    const key = typeof extracted.key === "string" ? extracted.key.toLowerCase() : "";

    if (!value || value.length < 2) return safeMemory;

    if (type === "profile" && key && Object.prototype.hasOwnProperty.call(safeMemory.profile, key)) {
        safeMemory.profile[key] = value;
    } else if (type === "interest") {
        const values = value
            .split(/,|\band\b/i)
            .map((v) => v.trim())
            .filter(Boolean);

        for (const entry of values) {
            if (!safeMemory.interests.some((i) => i.toLowerCase() === entry.toLowerCase())) {
                safeMemory.interests.push(entry);
            }
        }

        if (safeMemory.interests.length > 50) {
            safeMemory.interests = safeMemory.interests.slice(-50);
        }
    } else if (type === "preference" && key) {
        safeMemory.preferences[key] = value;
    } else if (type === "fact") {
        if (!safeMemory.facts.some((f) => f.toLowerCase() === value.toLowerCase())) {
            safeMemory.facts.push(value);
        }

        if (safeMemory.facts.length > 50) {
            safeMemory.facts.shift();
        }
    }

    return safeMemory;
}

module.exports = {
    loadMemory,
    saveMemory,
    formatMemoryForAI,
    updateMemory
};
