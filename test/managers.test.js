const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { updateMemory } = require("../memoryManager");
const { addTask, getTasks, completeTask, deleteTask } = require("../taskManager");

const TASKS_PATH = path.join(__dirname, "..", "tasks.json");

let originalTasks;

test.before(() => {
  try {
    originalTasks = fs.readFileSync(TASKS_PATH, "utf8");
  } catch {
    originalTasks = "[]";
  }
  fs.writeFileSync(TASKS_PATH, "[]", "utf8");
});

test.after(() => {
  fs.writeFileSync(TASKS_PATH, originalTasks, "utf8");
});

test("updateMemory stores deduplicated interests", () => {
  const memory = {
    profile: { name: "", age: "", location: "" },
    interests: ["F1"],
    preferences: { tone: "casual" },
    facts: []
  };

  const updated = updateMemory(memory, {
    save: true,
    type: "interest",
    value: "f1, chess and coding"
  });

  assert.equal(updated.interests.length, 3);
  assert.deepEqual(updated.interests, ["F1", "chess", "coding"]);
});

test("task lifecycle add -> complete -> delete", () => {
  const task = addTask("Write tests");
  assert.ok(task);

  const allTasks = getTasks();
  assert.equal(allTasks.length, 1);
  assert.equal(allTasks[0].text, "Write tests");

  const completed = completeTask(task.id);
  assert.ok(completed);
  assert.equal(completed.completed, true);

  const deleted = deleteTask(task.id);
  assert.equal(deleted, true);
  assert.equal(getTasks().length, 0);
});
