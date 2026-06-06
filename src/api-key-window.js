// API Key Settings — test before save, provider selector
const { BrowserWindow, ipcMain } = require("electron");
const path = require("path");

const isMac = process.platform === "darwin";

function createApiKeyWindow({ saveKey, loadKey, parentWin }) {
  let win = null;

  function open() {
    if (win && !win.isDestroyed()) { win.focus(); return; }

    win = new BrowserWindow({
      width: 400, height: 310, resizable: false,
      minimizable: false, maximizable: false, fullscreenable: false,
      title: "AI API Key",
      ...(isMac ? {} : { autoHideMenuBar: true }),
      webPreferences: {
        preload: path.join(__dirname, "preload-api-key.js"),
        nodeIntegration: false, contextIsolation: true,
      },
    });

    if (parentWin && !parentWin.isDestroyed()) {
      const pb = parentWin.getBounds();
      win.setBounds({ x: Math.round(pb.x + (pb.width - 400) / 2), y: Math.round(pb.y + 100), width: 400, height: 310 });
    }

    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
      *{margin:0;padding:0;box-sizing:border-box}
      body{background:#1e1e2e;color:#cdd6f4;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:20px 24px;-webkit-user-select:none;user-select:none}
      h2{font-size:15px;font-weight:600;margin-bottom:12px;color:#f5f5f5}
      select{width:100%;background:#313244;color:#cdd6f4;border:1px solid rgba(137,180,250,0.3);border-radius:6px;padding:6px 10px;font-size:13px;margin-bottom:10px;font-family:inherit;outline:none}
      input{width:100%;background:#313244;color:#cdd6f4;border:1px solid rgba(137,180,250,0.3);border-radius:6px;padding:8px 10px;font-size:13px;margin-bottom:10px;font-family:inherit;outline:none}
      input:focus,select:focus{border-color:#89b4fa}
      .btns{display:flex;gap:8px;justify-content:flex-end}
      button{padding:6px 16px;border:none;border-radius:6px;font-size:13px;cursor:pointer;font-family:inherit;font-weight:500}
      .test{background:rgba(166,227,161,0.2);color:#a6e3a1;border:1px solid rgba(166,227,161,0.3)}.test:hover{background:rgba(166,227,161,0.3)}
      .save{background:#89b4fa;color:#1e1e2e}.save:hover{background:#a6c9ff}
      .cancel{background:#45475a;color:#cdd6f4}.cancel:hover{background:#585b70}
      .msg{font-size:12px;margin-top:6px;min-height:18px}
      .ok{color:#a6e3a1}.err{color:#f38ba8}
      .note{font-size:11px;color:#6c7086;margin-top:8px}
      button:disabled{opacity:0.4;cursor:default}
    </style></head><body>
    <h2>AI API Key</h2>
    <select id="providerSelect">
      <option value="deepseek">DeepSeek</option>
      <option value="openai">OpenAI</option>
      <option value="anthropic">Anthropic</option>
    </select>
    <input type="password" id="keyInput" placeholder="sk-..." maxlength="64">
    <div class="btns">
      <button class="cancel" id="btnCancel">Cancel</button>
      <button class="test" id="btnTest">Test</button>
      <button class="save" id="btnSave" disabled>Save</button>
    </div>
    <div class="msg" id="msg"></div>
    <div class="note">Test first, then Save. Key stored in Application Support.</div>
    <script src="preload-api-key.js"></script>
    <script>
      const $=id=>document.getElementById(id);
      (async()=>{
        const r=await window.apiKey.load();
        $('keyInput').value=r.key||'';
        $('providerSelect').value=r.provider||'deepseek';
        // If loaded key from config has a test result → it was tested before → enable Save
        if(r.key && r.lastTest && r.lastTest.at) $('btnSave').disabled = false;
        if(r.lastTest) $('msg').textContent=r.lastTest.ok?'Last test: OK':'Last test: '+r.lastTest.error;
      })();
      $('providerSelect').addEventListener('change',()=>{
        window.apiKey.setProvider($('providerSelect').value);
        $('btnSave').disabled = true;
      });
      $('keyInput').addEventListener('input',()=>{
        $('btnSave').disabled = true;
      });
      $('btnTest').addEventListener('click',async()=>{
        const key=$('keyInput').value.trim();
        if(!key){$('msg').className='msg err';$('msg').textContent='Enter a key first';return;}
        $('btnTest').disabled=true;$('btnTest').textContent='…';
        $('msg').className='msg';$('msg').textContent='Testing…';
        const r=await window.apiKey.test(key);
        $('btnTest').textContent='Test';$('btnTest').disabled=false;
        $('btnSave').disabled = false;
        if(r.ok){$('msg').className='msg ok';$('msg').textContent='OK — key works';}
        else{$('msg').className='msg err';$('msg').textContent=r.error||'Test failed';}
      });
      $('btnSave').addEventListener('click',async()=>{
        const v=$('keyInput').value.trim();
        $('btnSave').disabled=true;$('btnSave').textContent='…';
        await window.apiKey.save(v);
        $('btnSave').textContent='Saved';
        $('msg').className='msg ok';$('msg').textContent=v?'Key saved.':'Key cleared — local mode.';
        $('btnSave').disabled=false;
      });
      $('btnCancel').addEventListener('click',()=>window.apiKey.close());
    </script></body></html>`)}`);
    win.on("closed", () => { win = null; });
  }

  // IPC
  ipcMain.handle("apikey:load", () => {
    const { getLastTestResult } = require("./ai/api-client");
    let provider = "deepseek";
    try {
      const userData = require("electron").app.getPath("userData");
      const raw = require("fs").readFileSync(require("path").join(userData, "config.json"), "utf8");
      provider = JSON.parse(raw).provider || "deepseek";
    } catch {}
    return { key: loadKey(), provider, lastTest: getLastTestResult() };
  });
  ipcMain.handle("apikey:set-provider", (_e, prov) => {
    try {
      const userData = require("electron").app.getPath("userData");
      const cfgPath = require("path").join(userData, "config.json");
      const existing = JSON.parse(require("fs").readFileSync(cfgPath, "utf8") || "{}");
      existing.provider = prov;
      require("fs").writeFileSync(cfgPath, JSON.stringify(existing, null, 2), "utf8");
    } catch {}
    return { ok: true };
  });
  ipcMain.handle("apikey:test", async (_e, key) => {
    const { testApiKey, savePendingTestResult } = require("./ai/api-client");
    const result = await testApiKey(key);
    savePendingTestResult(result);
    return result;
  });
  ipcMain.handle("apikey:save", (_e, key) => { saveKey(key); return { ok: true }; });
  ipcMain.on("apikey:close", () => { if (win && !win.isDestroyed()) win.close(); });

  return { open };
}

module.exports = { createApiKeyWindow };
