const GAME_POLICY = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; connect-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'";

export function sandboxDocument(html, channel) {
  const config = JSON.stringify(channel).replace(/</g, "\\u003c");
  const bridge = [
    "(function(){",
    "const channel=" + config + ";let seq=0;const waiting=new Map();",
    "function call(type,key,value){return new Promise((resolve,reject)=>{",
    "const id=String(++seq);const timer=setTimeout(()=>{waiting.delete(id);reject(new Error('Storage is unavailable'));},4000);",
    "waiting.set(id,{resolve,reject,timer});parent.postMessage({channel,id,type,key,value},'*');});}",
    "Object.defineProperty(window,'PocketBase',{value:Object.freeze({load:(key='progress')=>call('load',key),save:(key,value)=>call('save',key,value)})});",
    "addEventListener('message',e=>{if(e.source!==parent||!e.data||e.data.channel!==channel)return;",
    "if(e.data.type==='visibility'){dispatchEvent(new CustomEvent('pocket:visibility',{detail:{hidden:e.data.hidden}}));return;}",
    "const p=waiting.get(e.data.id);if(!p)return;clearTimeout(p.timer);waiting.delete(e.data.id);e.data.error?p.reject(new Error(e.data.error)):p.resolve(e.data.value);});",
    "addEventListener('error',()=>parent.postMessage({channel,type:'game-error'},'*'));",
    "addEventListener('unhandledrejection',()=>parent.postMessage({channel,type:'game-error'},'*'));",
    "})();"
  ].join("");
  return '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' + GAME_POLICY +
    '"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>html,body{margin:0;min-height:100%;overscroll-behavior:none}*{box-sizing:border-box}</style><script>' +
    bridge + "</script></head><body>" + html + "</body></html>";
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("pocket-base-progress", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("saves");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Device storage is unavailable."));
  });
}
async function storage(gameId, key, value, write) {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("saves", write ? "readwrite" : "readonly");
      const store = tx.objectStore("saves");
      const request = write ? store.put(value, gameId + ":" + key) : store.get(gameId + ":" + key);
      tx.oncomplete = () => resolve(write ? null : (request.result ?? null));
      tx.onerror = () => reject(new Error("Device storage is full or unavailable."));
      tx.onabort = () => reject(new Error("Device storage is unavailable."));
    });
  } finally { db.close(); }
}

export function attachGameBridge(frame, gameId, channel, onError = () => {}) {
  let pending = 0;
  const handler = async event => {
    if (event.source !== frame.contentWindow || !event.data || event.data.channel !== channel) return;
    const { type, id, key, value } = event.data;
    if (type === "game-error") { onError(); return; }
    if (!["load", "save"].includes(type) || typeof id !== "string" || id.length > 40) return;
    const respond = data => frame.contentWindow?.postMessage({ channel, id, ...data }, "*");
    if (!/^[a-z0-9_-]{1,24}$/i.test(key || "") || !["progress", "score", "settings"].includes(key))
      return respond({ error: "Use progress, score, or settings as the save key." });
    if (pending >= 8) return respond({ error: "Please wait for the last save." });
    pending++;
    try {
      if (type === "save" && (JSON.stringify(value) || "").length > 16_384) throw new Error("This save is too large.");
      const result = await storage(gameId, key, value, type === "save");
      respond({ value: result });
    } catch { respond({ error: "This device couldn't save your progress." }); }
    finally { pending--; }
  };
  const visibility = () => frame.contentWindow?.postMessage({ channel, type: "visibility", hidden: document.hidden }, "*");
  window.addEventListener("message", handler);
  document.addEventListener("visibilitychange", visibility);
  return () => { window.removeEventListener("message", handler); document.removeEventListener("visibilitychange", visibility); };
}
