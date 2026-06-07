// afterPack hook — remove empty .lproj dirs before codesign
// fixes "code has no resources but signature indicates they must be present"
const fs = require("fs");
const path = require("path");

exports.default = async function (context) {
  const resourcesPath = path.join(context.appOutDir, context.packager.appInfo.productName + ".app", "Contents", "Resources");
  if (!fs.existsSync(resourcesPath)) return;

  const entries = fs.readdirSync(resourcesPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.endsWith(".lproj")) continue;
    const dirPath = path.join(resourcesPath, entry.name);
    const files = fs.readdirSync(dirPath).filter(f => f !== "." && f !== "..");
    if (files.length === 0) {
      fs.rmdirSync(dirPath);
      console.log(`afterPack: removed empty ${entry.name}`);
    }
  }
};
