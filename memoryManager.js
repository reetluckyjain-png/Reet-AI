const fs = require("fs");

const FILE = "memory.json";

// ================= DEFAULT =================
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

// ================= LOAD =================
function loadMemory() {
    try {
        const data = JSON.parse(fs.readFileSync(FILE));
        return ensureStructure(data);
    } catch {
        return getDefaultMemory();
    }
}

// ================= SAVE =================
function saveMemory(data) {
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

// ================= STRUCTURE SAFETY =================
function ensureStructure(memory) {
    const def = getDefaultMemory();

    return {
        profile: memory.profile || def.profile,
        interests: Array.isArray(memory.interests) ? memory.interests : [],
        preferences: memory.preferences || def.preferences,
        facts: Array.isArray(memory.facts) ? memory.facts : []
    };
}

// ================= FORMAT FOR AI =================
function formatMemoryForAI(memory) {
    return `
User Memory:

Name: ${memory.profile.name || "Unknown"}
Age: ${memory.profile.age || "Unknown"}
Location: ${memory.profile.location || "Unknown"}

Interests:
${memory.interests.length ? memory.interests.join(", ") : "None"}

Preferences:
${Object.entries(memory.preferences)
    .map(([k, v]) => `${k}: ${v}`)
    .join(", ")}

Facts:
${memory.facts.length ? memory.facts.join(", ") : "None"}
`;
}

// ================= UPDATE =================
function updateMemory(memory, extracted) {

    if (!extracted || !extracted.save) return memory;

    const type = extracted.type?.toLowerCase();
    const value = extracted.value?.trim();
    const key = extracted.key?.toLowerCase();

    if (!value || value.length < 2) return memory;

    // PROFILE
    if (type === "profile" && key) {
        memory.profile[key] = value;
    }

    // INTEREST
    else if (type === "interest") {

        // split multi values (🔥 upgrade)
        const values = value.split(/,|and/).map(v => v.trim());

        values.forEach(v => {
            if (!memory.interests.some(i => i.toLowerCase() === v.toLowerCase())) {
                memory.interests.push(v);
            }
        });
    }

    // PREFERENCE
    else if (type === "preference" && key) {
        memory.preferences[key] = value;
    }

    // FACT
    else if (type === "fact") {
        if (!memory.facts.some(f => f.toLowerCase() === value.toLowerCase())) {
            memory.facts.push(value);
        }

        // limit size
        if (memory.facts.length > 50) {
            memory.facts.shift();
        }
    }

    return memory;
}

module.exports = {
    loadMemory,
    saveMemory,
    formatMemoryForAI,
    updateMemory
};