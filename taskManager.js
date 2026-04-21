const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "tasks.json");

function loadTasks() {
    try {
        const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
        return Array.isArray(data) ? data : [];
    } catch {
        return [];
    }
}

function saveTasks(tasks) {
    fs.writeFileSync(FILE, JSON.stringify(tasks, null, 2), "utf8");
}

function normalizeTaskText(text) {
    return typeof text === "string" ? text.trim() : "";
}

function normalizeTaskId(id) {
    if (id === null || id === undefined) return "";
    return String(id).trim();
}

function addTask(text) {
    const cleanText = normalizeTaskText(text);
    if (!cleanText) return null;

    const tasks = loadTasks();

    const newTask = {
        id: Date.now(),
        text: cleanText,
        completed: false,
        createdAt: new Date().toISOString()
    };

    tasks.push(newTask);
    saveTasks(tasks);

    return newTask;
}

function getTasks() {
    return loadTasks();
}

function completeTask(id) {
    const normalizedId = normalizeTaskId(id);
    if (!normalizedId) return null;

    const tasks = loadTasks();
    const task = tasks.find((t) => String(t.id) === normalizedId);
    if (!task) return null;

    task.completed = true;
    saveTasks(tasks);
    return task;
}

function deleteTask(id) {
    const normalizedId = normalizeTaskId(id);
    if (!normalizedId) return false;

    const tasks = loadTasks();
    const filtered = tasks.filter((t) => String(t.id) !== normalizedId);

    if (filtered.length === tasks.length) {
        return false;
    }

    saveTasks(filtered);
    return true;
}

module.exports = {
    addTask,
    getTasks,
    completeTask,
    deleteTask
};
