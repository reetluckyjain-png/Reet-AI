const fs = require("fs");

const FILE = "tasks.json";

// LOAD TASKS
function loadTasks() {
    try {
        return JSON.parse(fs.readFileSync(FILE));
    } catch {
        return [];
    }
}

// SAVE TASKS
function saveTasks(tasks) {
    fs.writeFileSync(FILE, JSON.stringify(tasks, null, 2));
}

// ADD TASK
function addTask(text) {
    const tasks = loadTasks();

    const newTask = {
        id: Date.now(),
        text,
        completed: false,
        createdAt: new Date().toISOString()
    };

    tasks.push(newTask);
    saveTasks(tasks);

    return newTask;
}

// GET ALL TASKS
function getTasks() {
    return loadTasks();
}

// COMPLETE TASK
function completeTask(id) {
    const tasks = loadTasks();

    const task = tasks.find(t => t.id == id);
    if (task) task.completed = true;

    saveTasks(tasks);
    return task;
}

// DELETE TASK
function deleteTask(id) {
    let tasks = loadTasks();
    tasks = tasks.filter(t => t.id != id);
    saveTasks(tasks);
}

module.exports = {
    addTask,
    getTasks,
    completeTask,
    deleteTask
};
