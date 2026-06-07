// afterSign hook — re-sign .app with proper CodeResources manifest
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

exports.default = async function (context) {
  const dir = context.appOutDir;
  if (!dir || !fs.existsSync(dir)) return;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const appEntry = entries.find(e => e.isDirectory() && e.name.endsWith(".app"));
  if (!appEntry) { console.log("afterSign: no .app in", dir); return; }

  const appPath = path.join(dir, appEntry.name);
  console.log("afterSign: re-signing", appPath);
  try {
    execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: "pipe" });
    console.log("afterSign: re-sign OK");
  } catch (e) {
    console.error("afterSign: re-sign failed");
  }
};
