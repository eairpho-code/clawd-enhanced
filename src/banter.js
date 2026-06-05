// Minimal banter module — picks a random quip for the given state
const fs = require("fs");
const path = require("path");

let data = {};

function load(jsonPath) {
  try {
    data = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  } catch (_) {
    data = {};
  }
}

function pick(state) {
  const lines = data[state];
  if (!Array.isArray(lines) || lines.length === 0) return null;
  return lines[Math.floor(Math.random() * lines.length)];
}

module.exports = { load, pick };
