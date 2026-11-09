"use strict";
/* Aalap — front-end logic. Plain JS, no build step, works offline as a PWA. */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ------------------------------------------------------------------ pictograms (Twemoji, CC-BY 4.0) */
const cps = (e) => { const a = Array.from(e).map((c) => c.codePointAt(0).toString(16)); return (a.includes("200d") ? a : a.filter((c) => c !== "fe0f")).join("-"); };
const pic = (e) => `<img class="pic" src="pict/${cps(e)}.svg" alt="" draggable="false" data-e="${esc(e)}">`;
document.addEventListener("error", (ev) => {
  const t = ev.target;
  if (t && t.tagName === "IMG" && t.dataset && t.dataset.e) t.replaceWith(document.createTextNode(t.dataset.e));
}, true);

/* ------------------------------------------------------------------ state */
const KEY = "aalap.v1";
const DEFAULTS = {
  lang: "en", name: "", onboarded: false, theme: "auto",
  modes: { speech: true, hearing: false, intellect: false, visual: false, switch: false },
  speed: 1, contrast: false, size: 1, alertName: true, scanMs: 1500, apiKey: "",
  custom: [], usage: {}, seen: {}, boards: [], scene: "meal",
  routine: ["brush", "eat", "play", "bath", "sleep"], done: {},
};
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "{}");
    if (!s.lang) { const nl = String(navigator.language || "en").slice(0, 2).toLowerCase(); if (LANGS.some((l) => l.code === nl)) s.lang = nl; }
    return Object.assign({}, DEFAULTS, s, { modes: Object.assign({}, DEFAULTS.modes, s.modes || {}) });
  } catch (e) { return JSON.parse(JSON.stringify(DEFAULTS)); }
}
let S = load();
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* storage may be blocked */ } }

let view = "talk", SERVER_AI = false, strip = [], armed = null, armedAt = 0;
let sttOn = false, rec = null, capLines = [], toastTimer = 0, sosTimer = 0, capSize = 1.6;
let pending = null, camStream = null;
const aiOn = () => SERVER_AI || !!S.apiKey;

const li = () => Math.max(0, LANGS.findIndex((l) => l.code === S.lang));
const L = () => LANGS[li()];
const t = (k) => { const a = UI[k]; return a ? a[li()] || a[0] : k; };
const wordItem = (id) => ({ emoji: WORDS[id][0], text: WORDS[id][1 + li()] || WORDS[id][1], key: id, g: groupOf(id) });
const joiner = () => (S.lang === "zh" ? "" : " ");
const buzz = (p) => { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* unsupported */ } };
const bucket = () => Math.floor(new Date().getHours() / 6);

/* ------------------------------------------------------------------ voice */
let voices = [];
function loadVoices() { try { voices = speechSynthesis.getVoices(); } catch (e) { voices = []; } }
if ("speechSynthesis" in window) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }
let warnedVoice = false;

function findVoice() {
  const tag = L().tts.toLowerCase();
  return voices.find((v) => v.lang.replace("_", "-").toLowerCase() === tag) ||
         voices.find((v) => v.lang.toLowerCase().startsWith(L().code));
}
function speak(text, rate) {
  if (!text) return;
  const v = findVoice();
  if (!v && aiOn()) return cloudSpeak(text);
  if (!("speechSynthesis" in window)) return;
  if (!v && voices.length && !warnedVoice) { warnedVoice = true; toast(t("noVoice")); }
  const u = new SpeechSynthesisUtterance(text);
  u.lang = L().tts;
  if (v) u.voice = v;
  u.rate = (rate || S.speed) * (S.modes.intellect ? 0.9 : 1);
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}
let cloudAudio = null;
async function cloudSpeak(text) {
  try {
    const blob = await aiTts(text);
    const url = URL.createObjectURL(blob);
    if (cloudAudio) cloudAudio.pause();
    cloudAudio = new Audio(url);
    cloudAudio.playbackRate = S.speed;
    await cloudAudio.play();
  } catch (e) { toast(t("noVoice")); }
}
function toast(msg, praise) {
  const el = $("#toast");
  el.textContent = msg;
  el.className = "toast show" + (praise ? " praise" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = "toast"), praise ? 1600 : 2800);
}

/* ------------------------------------------------------------------ AI (server first, or the user's own Gemini key) */
const GEM = "https://generativelanguage.googleapis.com/v1beta/models/";
const GEM_TEXT = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-flash-latest", "gemini-2.5-flash"];
const GEM_TTS = ["gemini-3.1-flash-tts-preview", "gemini-3.8-flash-tts", "gemini-2.5-flash-preview-tts"];
async function gem(model, payload) {
  let status = 0;
  for (const m of model === "tts" ? GEM_TTS : GEM_TEXT) {
    const r = await fetch(GEM + m + ":generateContent", { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": S.apiKey }, body: JSON.stringify(payload) });
    if (r.ok) return r.json();
    status = r.status;
    if (![400, 404, 429, 503].includes(status)) break;
  }
  throw new Error("gemini " + status);
}
const gemText = (d) => d.candidates[0].content.parts[0].text;
const parseJson = (s) => JSON.parse(s.trim().replace(/^```(?:json)?|```$/gm, "").trim());
function cleanItems(items, limit) {
  const out = [], seen = new Set();
  (Array.isArray(items) ? items : []).forEach((it) => {
    if (!it || typeof it !== "object") return;
    const text = String(it.text || "").trim().slice(0, 70);
    const emoji = String(it.emoji || "").trim().slice(0, 8) || "💬";
    if (!text || seen.has(text.toLowerCase()) || out.length >= limit) return;
    seen.add(text.toLowerCase());
    out.push({ emoji, text });
  });
  return out;
}
async function aiBoard(body) {
  if (SERVER_AI) {
    const r = await fetch("/api/board", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) { let d = ""; try { d = (await r.json()).detail || ""; } catch (e) {} throw new Error(r.status + " " + String(d).slice(0, 140)); }
    return r.json();
  }
  const simple = body.modes.includes("intellect"), count = simple ? 8 : 14;
  const style = simple ? "Use only very simple, concrete words a young child with an intellectual disability can understand." : "Use short, natural first-person phrases a child would really say.";
  let prompt = "You help non-speaking children with disabilities communicate (AAC). Look at the scene and create a communication board for exactly this place and moment. " +
    `Return ${count} tiles. Each tile has one emoji and a short phrase (max 6 words) written in ${body.lang_name}. ${style} ` +
    "Cover requests, objects that are actually visible, actions, feelings and one safety/help phrase. Never include anything unsafe or inappropriate for children. Also return a short board title in the same language.";
  if (body.text) prompt += "\nCaregiver description of the place: " + body.text;
  const parts = [{ text: prompt }];
  if (body.image) parts.push({ inline_data: { mime_type: body.mime || "image/jpeg", data: body.image } });
  const item = { type: "OBJECT", properties: { emoji: { type: "STRING" }, text: { type: "STRING" } }, required: ["emoji", "text"] };
  const d = await gem("text", { contents: [{ parts }], generationConfig: { responseMimeType: "application/json", temperature: 0.4, responseSchema: { type: "OBJECT", properties: { title: { type: "STRING" }, items: { type: "ARRAY", items: item } }, required: ["title", "items"] } } });
  const obj = parseJson(gemText(d));
  const items = cleanItems(obj.items, count + 2);
  if (items.length < 3) throw new Error("empty board");
  return { title: String(obj.title || "").trim().slice(0, 40) || items[0].text, items };
}
async function aiPhrases(context) {
  if (SERVER_AI) {
    const r = await fetch("/api/phrases", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ context, lang: S.lang, lang_name: L().en }) });
    if (!r.ok) throw new Error(String(r.status));
    return (await r.json()).phrases || [];
  }
  const prompt = `A child who cannot speak is typing to communicate. They typed: "${context}".\nSuggest 6 short, complete sentences in ${L().en} (max 8 words each) that they most likely want to say. Child-friendly and safe. Return JSON: {"phrases": ["..."]}.`;
  const d = await gem("text", { contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", temperature: 0.5, responseSchema: { type: "OBJECT", properties: { phrases: { type: "ARRAY", items: { type: "STRING" } } }, required: ["phrases"] } } });
  return (parseJson(gemText(d)).phrases || []).map((p) => String(p).trim().slice(0, 80)).filter(Boolean).slice(0, 6);
}
function pcmToWav(b64) {
  const bin = atob(b64), n = bin.length, buf = new ArrayBuffer(44 + n), v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + n, true); w(8, "WAVEfmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 24000, true); v.setUint32(28, 48000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) v.setUint8(44 + i, bin.charCodeAt(i));
  return new Blob([buf], { type: "audio/wav" });
}
async function aiTts(text) {
  if (SERVER_AI) {
    const r = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, lang: S.lang }) });
    if (!r.ok) throw new Error("tts");
    return r.blob();
  }
  const d = await gem("tts", { contents: [{ parts: [{ text }] }], generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } } } });
  return pcmToWav(d.candidates[0].content.parts[0].inlineData.data);
}

/* ------------------------------------------------------------------ board data */
const customItems = () => S.custom.map((c) => ({ emoji: c.emoji, text: c.text, key: "c:" + c.text, g: "custom" }));
function forYouItems() {
  const b = bucket();
  return Object.entries(S.seen).map(([k, r]) => ({ k, r, score: r.n + 4 * (r.h ? r.h[b] : 0) })).sort((a, c) => c.score - a.score).slice(0, 12)
    .map((x) => ({ emoji: x.r.e || "💬", text: x.k, key: "s:" + x.k, g: "act" }));
}
function boardName() {
  if (S.scene === "mine") return t("myWords");
  if (S.scene === "foryou") return t("forYou");
  if (S.scene.startsWith("ai:")) { const b = S.boards.find((x) => x.id === S.scene); return b ? b.name : "Aalap"; }
  return t("sc_" + S.scene);
}
function boardItems() {
  let items;
  if (S.scene === "mine") items = customItems();
  else if (S.scene === "foryou") items = forYouItems();
  else if (S.scene.startsWith("ai:")) {
    const b = S.boards.find((x) => x.id === S.scene);
    items = b ? b.items.map((i) => ({ emoji: i.emoji, text: i.text, key: "a:" + i.text, g: "ai" })) : [];
  } else items = (SCENES[S.scene] || SCENES.meal).map(wordItem);
  if (!["mine", "foryou"].includes(S.scene) && S.custom.length && !S.modes.intellect) items = items.concat(customItems());
  return S.modes.intellect ? items.slice(0, 6) : items;
}
const coreItems = () => (S.modes.intellect ? CORE.slice(0, 3) : CORE).map(wordItem);
function count(item) {
  const k = item.text;
  const r = S.seen[k] || (S.seen[k] = { e: item.emoji, n: 0, h: [0, 0, 0, 0] });
  r.n++; r.h[bucket()]++;
  S.usage[k] = (S.usage[k] || 0) + 1;
  const keys = Object.keys(S.seen);
  if (keys.length > 120) { keys.sort((a, b) => S.seen[a].n - S.seen[b].n).slice(0, keys.length - 120).forEach((x) => { delete S.seen[x]; delete S.usage[x]; }); }
  save();
}

/* ------------------------------------------------------------------ TALK */
let tiles = [];
function tileHtml(item) {
  tiles.push(item);
  return `<button class="tile g-${item.g}" data-i="${tiles.length - 1}" aria-label="${esc(item.text)}">${pic(item.emoji)}<span class="tx">${esc(item.text)}</span></button>`;
}
function sceneChips() {
  const chips = [];
  if (Object.keys(S.seen).length >= 3) chips.push({ id: "foryou", label: `${pic("⏰")} ${esc(t("forYou"))}` });
  Object.keys(SCENES).forEach((k) => chips.push({ id: k, label: `${pic(SCENE_EMOJI[k])} ${esc(t("sc_" + k))}` }));
  S.boards.forEach((b) => chips.push({ id: b.id, label: `${pic("✨")} ${esc(b.name)}` }));
  if (S.custom.length) chips.push({ id: "mine", label: `${pic("⭐")} ${esc(t("myWords"))}` });
  return chips.map((c) => `<button class="chip" data-scene="${esc(c.id)}" aria-pressed="${S.scene === c.id}">${c.label}</button>`).join("") +
    `<button class="chip" id="shareBtn" type="button">${pic("🔗")} ${esc(t("share"))}</button>`;
}
function viewTalk() {
  tiles = [];
  const hint = S.modes.visual ? `<p class="hint" role="note">${pic("🔊")} ${esc(t("vHint"))}</p>` : "";
  return `<section class="view">
    <div class="chips" role="group">${sceneChips()}</div>
    <div class="strip">
      <div class="strip-items" id="stripItems" aria-live="polite"></div>
      <div class="strip-actions">
        <button class="btn primary" id="speakAll">${pic("🔊")} ${esc(t("speak"))}</button>
        <div class="row" style="margin:0"><button class="btn small" id="undo">↩ ${esc(t("undo"))}</button><button class="btn small warn" id="clearStrip" aria-label="${esc(t("clear"))}">✕</button></div>
      </div>
    </div>
    ${hint}
    <div class="say"><input id="sayInput" type="text" enterkeyhint="send" placeholder="${esc(t("typeHint"))}" aria-label="${esc(t("typeHint"))}"><button class="btn primary" id="sayBtn" aria-label="${esc(t("speak"))}">▶</button></div>
    <div class="sugg" id="sugg"></div>
    <div class="grid core">${coreItems().map(tileHtml).join("")}</div>
    <div class="grid" style="margin-top:12px">${boardItems().map(tileHtml).join("")}</div>
  </section>`;
}
function paintStrip() {
  const box = $("#stripItems");
  if (!box) return;
  box.innerHTML = strip.length ? strip.map((i) => `<span class="pill">${pic(i.emoji)}${esc(i.text)}</span>`).join("") : `<span class="ph">…</span>`;
}
function onTile(item, el) {
  if (S.modes.visual && !S.modes.switch) {
    if (armed !== item.key || Date.now() - armedAt > 6000) {
      armed = item.key; armedAt = Date.now();
      $$(".armed").forEach((e) => e.classList.remove("armed"));
      el.classList.add("armed");
      speak(item.text);
      return;
    }
    armed = null; el.classList.remove("armed");
  } else speak(item.text);
  strip.push(item);
  count(item);
  buzz(15);
  paintStrip();
  if (S.modes.intellect) toast("⭐ " + t("praise"), true);
}
function bindTalk() {
  paintStrip();
  $$(".tile").forEach((b) => b.addEventListener("click", () => onTile(tiles[+b.dataset.i], b)));
  $$("[data-scene]").forEach((b) => b.addEventListener("click", () => { S.scene = b.dataset.scene; save(); render(); }));
  $("#shareBtn").addEventListener("click", openShare);
  $("#speakAll").addEventListener("click", () => {
    if (!strip.length) return;
    speak(strip.map((i) => i.text).join(joiner()));
    if (S.modes.intellect) toast("🌟 " + t("praise"), true);
  });
  $("#undo").addEventListener("click", () => { strip.pop(); paintStrip(); });
  $("#clearStrip").addEventListener("click", () => { strip = []; paintStrip(); });
  const input = $("#sayInput");
  const say = () => {
    const v = input.value.trim();
    if (!v) return;
    speak(v);
    const r = S.seen[v] || (S.seen[v] = { e: "💬", n: 0, h: [0, 0, 0, 0] });
    r.n++; r.h[bucket()]++; S.usage[v] = (S.usage[v] || 0) + 1; save();
    input.value = ""; $("#sugg").innerHTML = "";
  };
  $("#sayBtn").addEventListener("click", say);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") say(); });
  let timer = 0;
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => suggest(input.value), 650); });
  startScan();
}
async function suggest(text) {
  text = text.trim();
  const local = Object.keys(S.usage).filter((k) => text && k.toLowerCase().startsWith(text.toLowerCase()) && k !== text).sort((a, b) => S.usage[b] - S.usage[a]).slice(0, 4);
  let list = local;
  if (aiOn() && text.length >= 2) {
    try { list = local.concat(await aiPhrases(text)).slice(0, 7); } catch (e) { /* offline: keep local */ }
  }
  const box = $("#sugg");
  if (!box) return;
  box.innerHTML = list.map((p) => `<button class="chip" data-say="${esc(p)}">${esc(p)}</button>`).join("");
  $$("[data-say]", box).forEach((b) => b.addEventListener("click", () => { speak(b.dataset.say); S.usage[b.dataset.say] = (S.usage[b.dataset.say] || 0) + 1; save(); }));
}

/* ---- switch scanning (one-button access) */
let scanTimer = 0, scanIdx = -1, scanTargets = [];
function scanKey(e) {
  if (!scanTimer) return;
  if ((e.key === " " || e.key === "Enter") && !/INPUT|TEXTAREA|SELECT/.test((e.target.tagName || ""))) { e.preventDefault(); e.stopPropagation(); if (e.type === "keydown") selectScan(); }
}
function scanStep() {
  if (scanTargets[scanIdx]) scanTargets[scanIdx].classList.remove("scan");
  scanIdx = (scanIdx + 1) % scanTargets.length;
  const el = scanTargets[scanIdx];
  if (!el) return;
  el.classList.add("scan");
  try { el.scrollIntoView({ block: "nearest", behavior: "smooth" }); } catch (e) { /* old browsers */ }
  if (S.modes.visual) { const x = el.querySelector(".tx"); speak(x ? x.textContent : el.textContent.trim()); }
}
function stopScan() {
  clearInterval(scanTimer); scanTimer = 0;
  $$(".scan").forEach((e) => e.classList.remove("scan"));
  const b = $("#scanSel"); if (b) b.remove();
  document.removeEventListener("keydown", scanKey, true);
  document.removeEventListener("keyup", scanKey, true);
}
function startScan() {
  stopScan();
  if (!S.modes.switch || view !== "talk") return;
  scanTargets = $$("#app .tile, #speakAll, #undo, #clearStrip");
  scanIdx = -1;
  scanStep();
  scanTimer = setInterval(scanStep, S.scanMs);
  const btn = document.createElement("button");
  btn.id = "scanSel"; btn.className = "scan-sel"; btn.type = "button"; btn.textContent = "● " + t("scanSelect");
  btn.addEventListener("click", selectScan);
  document.body.appendChild(btn);
  document.addEventListener("keydown", scanKey, true);
  document.addEventListener("keyup", scanKey, true);
}
function selectScan() {
  const el = scanTargets[scanIdx];
  if (el) el.click();
  clearInterval(scanTimer);
  if (el) el.classList.remove("scan");
  scanIdx = -1;
  scanStep();
  scanTimer = setInterval(scanStep, S.scanMs);
}

/* ---- share a board as a link / QR code */
const b64url = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/"))));
function shareUrl() {
  let items = boardItems().map((i) => [i.emoji, i.text]);
  const base = new URL("app.html", location.href).href.split("#")[0];
  let url;
  do { url = base + "#b=" + b64url(JSON.stringify({ v: 1, l: S.lang, n: boardName(), i: items })); items = items.slice(0, -1); } while (url.length > 1700 && items.length > 3);
  return url;
}
function openShare() {
  const url = shareUrl(), dlg = $("#shareDlg");
  let qrHtml = "";
  try { const q = qrcode(0, "L"); q.addData(url); q.make(); qrHtml = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); } catch (e) { qrHtml = ""; }
  $("#shareBody").innerHTML = `<h2>${pic("🔗")} ${esc(boardName())}</h2><div class="qr">${qrHtml}</div><p class="hint">${esc(t("shareHint"))}</p><div class="row" style="justify-content:center"><button class="btn primary" id="copyLink">${esc(t("copyLink"))}</button><button class="btn" id="obfBtn" title="Open Board Format">⬇ .obf</button></div>`;
  $("#obfBtn").addEventListener("click", exportObf);
  $("#copyLink").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(url); toast(t("copied")); } catch (e) { window.prompt(t("copyLink"), url); }
  });
  if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
}
/* ---- Open Board Format (openboardformat.org) export / import: interoperable with Cboard, CoughDrop, etc. */
function boardToObf() {
  const items = boardItems(), cols = Math.min(4, Math.max(2, items.length)), rows = Math.ceil(items.length / cols);
  const base = new URL("pict/", location.href).href;
  const order = []; for (let r = 0; r < rows; r++) order.push(items.slice(r * cols, (r + 1) * cols).map((_, c) => "b" + (r * cols + c)).concat(Array(cols).fill(null)).slice(0, cols));
  return {
    format: "open-board-0.1", id: "aalap-" + Date.now(), locale: S.lang, name: boardName(), description_html: "Made with Aalap",
    license: { type: "CC-BY", copyright_notice_url: "https://creativecommons.org/licenses/by/4.0/", author_name: "Aalap (pictograms: Twemoji)" },
    grid: { rows, columns: cols, order },
    buttons: items.map((it, i) => ({ id: "b" + i, label: it.text, vocalization: it.text, image_id: "i" + i })),
    images: items.map((it, i) => ({ id: "i" + i, url: base + cps(it.emoji) + ".svg", content_type: "image/svg+xml", width: 72, height: 72 })),
  };
}
function exportObf() {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(boardToObf(), null, 2)], { type: "application/json" }));
  a.download = "aalap-board.obf"; a.click();
}
function obfToItems(o) {
  const img = {}; (o.images || []).forEach((i) => (img[i.id] = i));
  const fromUrl = (u) => { const m = /\/([0-9a-f-]+)\.svg/i.exec(u || ""); try { return m ? String.fromCodePoint(...m[1].split("-").map((h) => parseInt(h, 16))) : "💬"; } catch (e) { return "💬"; } };
  return (o.buttons || []).slice(0, 24).map((b) => ({ emoji: fromUrl((img[b.image_id] || {}).url), text: String(b.vocalization || b.label || "").slice(0, 70) })).filter((b) => b.text);
}
function importObf(o) {
  const items = obfToItems(o); if (!items.length) return false;
  const lang = String(o.locale || "").slice(0, 2); if (LANGS.some((l) => l.code === lang)) S.lang = lang;
  const id = "ai:" + Date.now();
  S.boards.push({ id, name: String(o.name || "Board").slice(0, 40), items }); if (S.boards.length > 8) S.boards.shift();
  S.scene = id; save(); return true;
}
function importFromHash() {
  const m = /^#b=([\w-]+)$/.exec(location.hash);
  if (!m) return false;
  try {
    const o = JSON.parse(unb64url(m[1]));
    const items = (Array.isArray(o.i) ? o.i : []).slice(0, 24).map((p) => ({ emoji: String(p[0] || "💬").slice(0, 8), text: String(p[1] || "").slice(0, 70) })).filter((p) => p.text);
    if (items.length < 1) return false;
    if (LANGS.some((l) => l.code === o.l)) S.lang = o.l;
    const id = "ai:" + Date.now();
    S.boards.push({ id, name: String(o.n || "Aalap").slice(0, 40), items });
    if (S.boards.length > 8) S.boards.shift();
    S.scene = id; S.onboarded = true; save();
    history.replaceState(null, "", location.pathname + location.search);
    return true;
  } catch (e) { return false; }
}

/* ------------------------------------------------------------------ SCENE */
function viewScene() {
  const presets = Object.keys(SCENES).map((k) => `<button class="scene-card" data-preset="${k}">${pic(SCENE_EMOJI[k])}${esc(t("sc_" + k))}</button>`).join("");
  const canCam = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  const ai = aiOn()
    ? `<div class="drop">
         <video id="cam" playsinline muted hidden></video>
         <div id="preview"></div>
         <div class="row" style="justify-content:center;margin:0">
           ${canCam ? `<button class="btn primary" id="camBtn" type="button">${pic("📷")} ${esc(t("camera"))}</button><button class="btn primary" id="snapBtn" type="button" hidden>${pic("📸")} ${esc(t("snap"))}</button>` : ""}
           <label class="btn" for="photoIn">🖼️ ${esc(t("gallery"))}</label>
         </div>
         <input id="photoIn" class="sr" type="file" accept="image/*" capture="environment">
         <textarea id="descIn" placeholder="${esc(t("describe"))}" aria-label="${esc(t("describe"))}"></textarea>
         <button class="btn primary" id="makeBtn">${pic("✨")} ${esc(t("make"))}</button>
         <div id="aiStatus" role="status"></div>
       </div>
       <div id="aiResult"></div>`
    : `<div class="card"><p class="hint" style="margin:0">ℹ️ ${esc(t("aiOff"))}<br>${esc(t("aiKeyHint"))}</p></div>`;
  const ex = [["school", "🏫"], ["health", "🏥"], ["outing", "🚌"]].map(([k, e]) => `<button class="ex" data-ex="${k}" type="button"><span class="ph-img" aria-hidden="true">${pic(e)}<small>📷</small></span><span class="ex-arrow" aria-hidden="true">→</span><span class="ex-tiles" aria-hidden="true">${SCENES[k].slice(0, 4).map((w) => pic(WORDS[w][0])).join("")}</span><b>${esc(t("sc_" + k))}</b></button>`).join("");
  return `<section class="view">
    <h2>${pic("✨")} AI</h2>${ai}
    <h2>${esc(t("example"))}</h2><p class="hint">${esc(t("exampleHint"))}</p><div class="exs">${ex}</div>
    <h2>${esc(t("presets"))}</h2><div class="scenes">${presets}</div>
  </section>`;
}
function downscale(src, max = 1024) {
  return new Promise((resolve, reject) => {
    const draw = (img, w, h) => {
      const k = Math.min(1, max / Math.max(w, h)), c = document.createElement("canvas");
      c.width = Math.round(w * k); c.height = Math.round(h * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", 0.82));
    };
    if (src instanceof HTMLVideoElement) return draw(src, src.videoWidth, src.videoHeight);
    const img = new Image(), url = URL.createObjectURL(src);
    img.onload = () => { draw(img, img.width, img.height); URL.revokeObjectURL(url); };
    img.onerror = reject;
    img.src = url;
  });
}
function stopCam() { if (camStream) { camStream.getTracks().forEach((x) => x.stop()); camStream = null; } }
function showShot() { $("#preview").innerHTML = `<img class="shot" src="${pending}" alt="">`; }
function bindScene() {
  $$("[data-ex]").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.ex, id = "ai:" + Date.now();
    S.boards.push({ id, name: t("sc_" + k), items: SCENES[k].map((w) => ({ emoji: WORDS[w][0], text: WORDS[w][1 + li()] || WORDS[w][1] })) });
    if (S.boards.length > 8) S.boards.shift();
    S.scene = id; save(); go("talk");
  }));
  $$("[data-preset]").forEach((b) => b.addEventListener("click", () => { S.scene = b.dataset.preset; save(); go("talk"); }));
  const photo = $("#photoIn");
  if (!photo) return;
  photo.addEventListener("change", async () => {
    const f = photo.files && photo.files[0];
    if (!f) return;
    try { stopCam(); const v = $("#cam"); v.hidden = true; pending = await downscale(f); showShot(); } catch (e) { toast(t("aiFail")); }
  });
  const camBtn = $("#camBtn");
  if (camBtn) {
    camBtn.addEventListener("click", async () => {
      try {
        camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        const v = $("#cam"); v.srcObject = camStream; v.hidden = false; await v.play();
        $("#preview").innerHTML = ""; camBtn.hidden = true; $("#snapBtn").hidden = false;
      } catch (e) { toast("📷 ✕"); }
    });
    $("#snapBtn").addEventListener("click", async () => {
      const v = $("#cam");
      try { pending = await downscale(v); showShot(); } catch (e) { toast(t("aiFail")); }
      stopCam(); v.hidden = true; $("#snapBtn").hidden = true; camBtn.hidden = false;
    });
  }
  $("#makeBtn").addEventListener("click", makeBoard);
}
async function makeBoard() {
  const text = $("#descIn").value.trim();
  if (!pending && !text) return;
  const st = $("#aiStatus");
  st.innerHTML = `<span class="spinner"></span>${esc(t("working"))}`;
  $("#makeBtn").disabled = true;
  try {
    const body = { lang: S.lang, lang_name: L().en, modes: Object.keys(S.modes).filter((m) => S.modes[m]), text: text || null };
    if (pending) { body.image = pending.split(",")[1]; body.mime = "image/jpeg"; }
    const data = await aiBoard(body);
    st.textContent = "";
    $("#aiResult").innerHTML = `<h2>${pic("✨")} ${esc(data.title)}</h2>
      <div class="grid">${data.items.map((i) => `<div class="tile g-ai">${pic(i.emoji)}<span class="tx">${esc(i.text)}</span></div>`).join("")}</div>
      <div class="row"><button class="btn primary" id="useBoard">✅ ${esc(t("useBoard"))}</button></div>`;
    $("#useBoard").addEventListener("click", () => {
      const id = "ai:" + Date.now();
      S.boards.push({ id, name: data.title, items: data.items });
      if (S.boards.length > 8) S.boards.shift();
      S.scene = id; save(); pending = null; go("talk");
    });
    speak(data.title);
  } catch (e) {
    st.textContent = "⚠️ " + t("aiFail");
    const why = String((e && e.message) || "").trim();
    if (why) { const sm = document.createElement("small"); sm.style.display = "block"; sm.style.opacity = ".7"; sm.textContent = why; st.appendChild(sm); }
  } finally {
    const b = $("#makeBtn"); if (b) b.disabled = false;
  }
}

/* ------------------------------------------------------------------ LISTEN */
function emojiHints(text) {
  const i = li(), low = text.toLowerCase(), out = [], tokenCount = {};
  Object.values(WORDS).forEach((w) => new Set((w[1 + i] || "").toLowerCase().split(/[\s,.!?'’]+/).filter((x) => x.length >= 3)).forEach((tk) => (tokenCount[tk] = (tokenCount[tk] || 0) + 1)));
  for (const id in WORDS) {
    const w = WORDS[id], label = (w[1 + i] || "").toLowerCase();
    let hit = label.length >= 2 && low.includes(label);
    if (!hit && S.lang !== "zh") hit = label.split(/[\s,.!?'’]+/).some((tk) => tk.length >= 3 && tokenCount[tk] === 1 && new RegExp("(^|[\\s,.!?])" + tk.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "($|[\\s,.!?])", "i").test(low));
    if (hit && !out.includes(w[0])) out.push(w[0]);
    if (out.length >= 3) break;
  }
  return out;
}
function viewListen() {
  return `<section class="view">
    <div class="row">
      <button class="btn primary" id="sttBtn"></button>
      <button class="btn small" id="capMinus" aria-label="${esc(t("textSize"))} −">A−</button>
      <button class="btn small" id="capPlus" aria-label="${esc(t("textSize"))} +">A+</button>
      <button class="btn small warn" id="capClear">${esc(t("clear"))}</button>
    </div>
    <div class="caps" id="caps" aria-live="polite" style="--capsize:${capSize}rem"></div>
  </section>`;
}
function paintListenBtn() { const b = $("#sttBtn"); if (b) b.innerHTML = sttOn ? `<span class="rec-dot"></span>${esc(t("listenStop"))}` : `${pic("🎧")} ${esc(t("listenStart"))}`; }
function paintCaps(interim) {
  const box = $("#caps");
  if (!box) return;
  const lines = capLines.map((l) => `<p class="cap">${esc(l.text)}<span class="ems">${l.ems.map(pic).join(" ")}</span></p>`);
  if (interim) lines.push(`<p class="cap interim">${esc(interim)}</p>`);
  box.innerHTML = lines.length ? lines.join("") : `<p class="cap cap-empty">${esc(t("listenHint"))}</p>`;
  box.scrollTop = box.scrollHeight;
}
function addLine(text) {
  if (!text) return;
  capLines.push({ text, ems: emojiHints(text) });
  if (capLines.length > 40) capLines.shift();
  if (S.alertName && S.name && text.toLowerCase().includes(S.name.toLowerCase())) {
    buzz([250, 100, 250, 100, 400]);
    const box = $("#caps"); if (box) { box.classList.remove("flash"); void box.offsetWidth; box.classList.add("flash"); }
  }
  paintCaps();
}
function toggleStt() {
  if (sttOn) { sttOn = false; try { rec.stop(); } catch (e) { /* already stopped */ } paintListenBtn(); return; }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast(t("noStt")); return; }
  rec = new SR();
  rec.lang = L().tts; rec.continuous = true; rec.interimResults = true;
  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) addLine(r[0].transcript.trim()); else interim += r[0].transcript;
    }
    paintCaps(interim);
  };
  rec.onend = () => { if (sttOn) { try { rec.start(); } catch (e) { /* busy */ } } };
  rec.onerror = (ev) => { if (ev.error === "not-allowed" || ev.error === "service-not-allowed") { sttOn = false; paintListenBtn(); toast("🎤 ✕"); } };
  sttOn = true;
  try { rec.start(); } catch (e) { sttOn = false; }
  paintListenBtn();
}
function bindListen() {
  paintListenBtn(); paintCaps();
  $("#sttBtn").addEventListener("click", toggleStt);
  const size = (d) => { capSize = Math.min(4, Math.max(1, capSize + d)); const c = $("#caps"); if (c) c.style.setProperty("--capsize", capSize + "rem"); };
  $("#capPlus").addEventListener("click", () => size(0.3));
  $("#capMinus").addEventListener("click", () => size(-0.3));
  $("#capClear").addEventListener("click", () => { capLines = []; paintCaps(); });
}

/* ------------------------------------------------------------------ ROUTINE */
const allPickable = () => Object.keys(WORDS).map(wordItem).concat(customItems());
function stepItem(key) {
  if (WORDS[key]) return wordItem(key);
  const c = S.custom.find((x) => "c:" + x.text === key);
  return c ? { emoji: c.emoji, text: c.text, key, g: "custom" } : null;
}
function viewRoutine() {
  const steps = S.routine.map(stepItem).filter(Boolean);
  const cur = steps.find((s) => !S.done[s.key]);
  const next = cur ? steps.slice(steps.indexOf(cur) + 1).find((s) => !S.done[s.key]) : null;
  const box = (label, s, cls) => `<div class="box ${cls}"><small>${esc(label)}</small>${s ? `${pic(s.emoji)}<b>${esc(s.text)}</b>` : `<span>—</span>`}</div>`;
  const banner = steps.length ? (cur ? `<div class="now">${box(t("first"), cur, "first")}<span class="arrow" aria-hidden="true">➜</span>${box(t("then"), next, "")}</div>` : `<div class="card" style="text-align:center;font-size:1.4rem">${pic("🎉")} ${esc(t("allDone"))}</div>`) : "";
  return `<section class="view">
    ${banner}
    <ul class="steps">${steps.map((s, i) => `<li class="step ${S.done[s.key] ? "done" : ""}">
      <button class="check" data-done="${esc(s.key)}" aria-pressed="${!!S.done[s.key]}" aria-label="${esc(s.text)}">${S.done[s.key] ? "✓" : ""}</button>
      ${pic(s.emoji)}<span class="tx">${esc(s.text)}</span>
      <button class="btn small" data-up="${i}" aria-label="↑">↑</button>
      <button class="btn small warn" data-del="${i}" aria-label="✕">✕</button></li>`).join("")}</ul>
    <div class="row"><button class="btn primary" id="addStep">＋ ${esc(t("addStep"))}</button><button class="btn" id="newDay">🔄 ${esc(t("newDay"))}</button></div>
  </section>`;
}
function bindRoutine() {
  $$("[data-done]").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.done;
    if (S.done[k]) delete S.done[k]; else { S.done[k] = 1; speak(t("praise")); toast("🌟 " + t("praise"), true); buzz(30); }
    save(); render();
  }));
  $$("[data-up]").forEach((b) => b.addEventListener("click", () => { const i = +b.dataset.up; if (i > 0) { [S.routine[i - 1], S.routine[i]] = [S.routine[i], S.routine[i - 1]]; save(); render(); } }));
  $$("[data-del]").forEach((b) => b.addEventListener("click", () => { S.routine.splice(+b.dataset.del, 1); save(); render(); }));
  $("#newDay").addEventListener("click", () => { S.done = {}; save(); render(); });
  $("#addStep").addEventListener("click", () => openPicker((item) => { if (!S.routine.includes(item.key)) S.routine.push(item.key); save(); render(); }));
}
function openPicker(cb) {
  const dlg = $("#picker"), grid = $("#pickerGrid"), items = allPickable();
  grid.innerHTML = items.map((it, i) => `<button class="tile g-${it.g}" data-p="${i}">${pic(it.emoji)}<span class="tx">${esc(it.text)}</span></button>`).join("");
  $$("[data-p]", grid).forEach((b) => b.addEventListener("click", () => { cb(items[+b.dataset.p]); dlg.close(); }));
  if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
}

/* ------------------------------------------------------------------ CAREGIVER */
function viewCare() {
  const m = S.modes;
  const modeBox = (k, label, icon) => `<label class="mode"><input type="checkbox" data-mode="${k}" ${m[k] ? "checked" : ""}><span>${pic(icon)} ${esc(label)}</span></label>`;
  const top = Object.entries(S.usage).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const max = top.length ? top[0][1] : 1;
  const seg = (name, opts) => `<div class="seg" role="group">${opts.map(([v, label]) => `<button type="button" data-${name}="${v}" aria-pressed="${S[name] === v}">${esc(label)}</button>`).join("")}</div>`;
  return `<section class="view form">
    <div class="card form">
      <h2 style="margin:0">${esc(t("profile"))}</h2>
      <div class="field"><label for="nameIn">${esc(t("name"))}</label><input id="nameIn" type="text" value="${esc(S.name)}" autocomplete="off"></div>
      <div class="field"><span class="lbl">${esc(t("modes"))}</span><div class="modes">
        ${modeBox("speech", t("mSpeech"), "🗣️")}${modeBox("hearing", t("mHearing"), "👂")}${modeBox("intellect", t("mIntellect"), "🧩")}${modeBox("visual", t("mVisual"), "👁️")}${modeBox("switch", t("mSwitch"), "🔘")}
      </div></div>
      <div class="field"><label for="speedIn">${esc(t("speed"))}</label><input id="speedIn" type="range" min="0.5" max="1.5" step="0.1" value="${S.speed}"></div>
      <div class="field"><label for="sizeIn">${esc(t("size"))}</label><input id="sizeIn" type="range" min="0.8" max="1.5" step="0.1" value="${S.size}"></div>
      ${m.switch ? `<div class="field"><label for="scanIn">${esc(t("scanSpeed"))}</label><input id="scanIn" type="range" min="700" max="3500" step="100" value="${S.scanMs}" style="direction:ltr"></div>` : ""}
      <label class="toggle"><input id="hcIn" type="checkbox" ${S.contrast ? "checked" : ""}> ${esc(t("contrast"))}</label>
      <label class="toggle"><input id="alertIn" type="checkbox" ${S.alertName ? "checked" : ""}> ${esc(t("nameAlert"))}</label>
      <div class="field"><span class="lbl">${esc(t("theme"))}</span>${seg("theme", [["auto", t("themeAuto")], ["light", t("themeLight")], ["dark", t("themeDark")]])}</div>
    </div>
    <div class="card form">
      <h2 style="margin:0">${pic("⭐")} ${esc(t("addBtn"))}</h2>
      <div class="two"><input id="cEmoji" type="text" value="😀" maxlength="4" aria-label="emoji"><input id="cText" type="text" placeholder="${esc(t("label"))}" aria-label="${esc(t("label"))}"><button class="btn primary" id="cAdd">${esc(t("add"))}</button></div>
      <ul class="list">${S.custom.map((c, i) => `<li>${pic(c.emoji)}<span class="tx">${esc(c.text)}</span><button class="btn small warn" data-cdel="${i}" aria-label="✕">✕</button></li>`).join("") || `<li class="tx" style="color:var(--muted)">${esc(t("empty"))}</li>`}</ul>
    </div>
    <div class="card form">
      <h2 style="margin:0">${pic("✨")} AI ${aiOn() ? "· " + esc(t("aiOn")) : ""}</h2>
      <div class="field"><label for="keyIn">${esc(t("apiKey"))}</label><input id="keyIn" type="password" autocomplete="off" spellcheck="false" value="${esc(S.apiKey)}" placeholder="AIza…"></div>
      <p class="hint" style="margin:0"><a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a></p>
    </div>
    <div class="card">
      <h2 style="margin:0 0 8px">${pic("📊")} ${esc(t("top"))}</h2>
      <ul class="list">${top.map(([k, v]) => `<li><span class="tx">${esc(k)}</span><div class="bar"><i style="width:${Math.round((v / max) * 100)}%"></i></div><b>${v}</b></li>`).join("") || `<li class="tx" style="color:var(--muted)">${esc(t("empty"))}</li>`}</ul>
    </div>
    <div class="row">
      <button class="btn" id="expBtn">⬇ ${esc(t("export"))}</button>
      <label class="btn" for="impIn">⬆ ${esc(t("import"))}</label><input id="impIn" class="sr" type="file" accept="application/json,.json,.obf">
      <button class="btn warn" id="resetBtn">${esc(t("reset"))}</button>
    </div>
    <p class="hint">${pic("🔒")} ${esc(t("privacy"))}</p>
    <p class="hint">Pictograms: Twemoji © Twitter, Inc. and other contributors, CC-BY 4.0.</p>
  </section>`;
}
function bindCare() {
  $$("[data-mode]").forEach((c) => c.addEventListener("change", () => { S.modes[c.dataset.mode] = c.checked; save(); applySettings(); if (c.dataset.mode === "switch") render(); }));
  $$("[data-theme]").forEach((b) => b.addEventListener("click", () => { S.theme = b.dataset.theme; save(); applySettings(); render(); }));
  $("#nameIn").addEventListener("input", (e) => { S.name = e.target.value.trim(); save(); });
  $("#speedIn").addEventListener("input", (e) => { S.speed = +e.target.value; save(); });
  $("#speedIn").addEventListener("change", () => speak(S.name || t("praise")));
  $("#sizeIn").addEventListener("input", (e) => { S.size = +e.target.value; save(); applySettings(); });
  const scan = $("#scanIn"); if (scan) scan.addEventListener("input", (e) => { S.scanMs = +e.target.value; save(); });
  $("#hcIn").addEventListener("change", (e) => { S.contrast = e.target.checked; save(); applySettings(); });
  $("#alertIn").addEventListener("change", (e) => { S.alertName = e.target.checked; save(); });
  $("#keyIn").addEventListener("change", (e) => { S.apiKey = e.target.value.trim(); save(); render(); });
  $("#cAdd").addEventListener("click", () => {
    const text = $("#cText").value.trim(), emoji = $("#cEmoji").value.trim() || "💬";
    if (!text) return;
    S.custom.push({ emoji, text: text.slice(0, 70) }); save(); render();
  });
  $$("[data-cdel]").forEach((b) => b.addEventListener("click", () => { S.custom.splice(+b.dataset.cdel, 1); save(); render(); }));
  $("#expBtn").addEventListener("click", () => {
    const copy = Object.assign({}, S); delete copy.apiKey;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(copy, null, 2)], { type: "application/json" }));
    a.download = "aalap-profile.json"; a.click();
  });
  $("#impIn").addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { const j = JSON.parse(await f.text()); if (j && /^open-board/.test(j.format || "")) { if (importObf(j)) { applyAll(); toast("✓"); } else toast("⚠️"); return; } const key = S.apiKey; S = Object.assign({}, DEFAULTS, j, { apiKey: key }); S.modes = Object.assign({}, DEFAULTS.modes, S.modes); save(); applyAll(); } catch (err) { toast("⚠️"); }
  });
  $("#resetBtn").addEventListener("click", () => { if (confirm("Reset?")) { S = JSON.parse(JSON.stringify(DEFAULTS)); S.onboarded = true; save(); strip = []; applyAll(); } });
}

/* ------------------------------------------------------------------ onboarding */
let obStep = 0;
function showOnboard() {
  $("#onboard").hidden = false;
  $$("header.top, main, nav.tabs, #sosBtn").forEach((e) => (e.inert = true));
  paintOnboard();
}
function closeOnboard() {
  S.onboarded = true; save();
  $("#onboard").hidden = true;
  $$("header.top, main, nav.tabs, #sosBtn").forEach((e) => (e.inert = false));
  applyAll();
}
function paintOnboard() {
  const dots = `<div class="ob-dots" aria-hidden="true">${[0, 1, 2].map((i) => `<i class="${i <= obStep ? "on" : ""}"></i>`).join("")}</div>`;
  let body = "";
  if (obStep === 0) body = `<img class="ob-logo" src="icon.svg" alt=""><h1 id="obTitle">${esc(t("ob1"))}</h1><div class="langgrid">${LANGS.map((l) => `<button type="button" data-ol="${l.code}" aria-pressed="${l.code === S.lang}">${esc(l.name)}</button>`).join("")}</div>`;
  if (obStep === 1) body = `<h1 id="obTitle">${esc(t("ob2"))}</h1>
    <div class="field"><label for="obName">${esc(t("name"))}</label><input id="obName" type="text" value="${esc(S.name)}" autocomplete="off"></div>
    <div class="modes">${[["speech", "mSpeech", "🗣️"], ["hearing", "mHearing", "👂"], ["intellect", "mIntellect", "🧩"], ["visual", "mVisual", "👁️"], ["switch", "mSwitch", "🔘"]].map(([k, key, ic]) => `<label class="mode"><input type="checkbox" data-om="${k}" ${S.modes[k] ? "checked" : ""}><span>${pic(ic)} ${esc(t(key))}</span></label>`).join("")}</div>`;
  if (obStep === 2) body = `<div style="font-size:3.5rem">${pic("🎉")}</div><h1 id="obTitle">${esc(t("ob3"))}</h1><p class="lead" style="margin:0">${esc(t("ob3d"))}</p>`;
  const nav = `<div class="row" style="justify-content:space-between;margin:0">
    ${obStep > 0 ? `<button class="btn" id="obBack">←</button>` : `<button class="btn" id="obSkip">${esc(t("skip"))}</button>`}
    <button class="btn primary" id="obNext">${esc(obStep === 2 ? t("start") : t("next"))}</button></div>`;
  const el = $("#onboard");
  el.innerHTML = `<div class="ob-card" tabindex="-1">${dots}${body}${nav}</div>`;
  $$("[data-ol]", el).forEach((b) => b.addEventListener("click", () => { S.lang = b.dataset.ol; save(); const l = L(); document.documentElement.lang = l.code; document.documentElement.dir = l.rtl ? "rtl" : "ltr"; paintOnboard(); }));
  $$("[data-om]", el).forEach((c) => c.addEventListener("change", () => { S.modes[c.dataset.om] = c.checked; save(); }));
  const nm = $("#obName", el); if (nm) nm.addEventListener("input", () => { S.name = nm.value.trim(); save(); });
  const back = $("#obBack", el); if (back) back.addEventListener("click", () => { obStep--; paintOnboard(); });
  const skip = $("#obSkip", el); if (skip) skip.addEventListener("click", closeOnboard);
  $("#obNext", el).addEventListener("click", () => { if (obStep === 2) { closeOnboard(); view = "scene"; render(); } else { obStep++; paintOnboard(); } });
  const first = $("h1", el) || el; if (first) { first.setAttribute("tabindex", "-1"); first.focus({ preventScroll: true }); }
}

/* ------------------------------------------------------------------ shell */
const ICONS = {
  talk: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
  scene: '<rect x="3" y="6" width="18" height="14" rx="3"/><circle cx="12" cy="13" r="3.5"/><path d="M8 6l1.5-2h5L16 6"/>',
  listen: '<path d="M4 14v-2a8 8 0 0116 0v2"/><rect x="3" y="14" width="4" height="6" rx="2"/><rect x="17" y="14" width="4" height="6" rx="2"/>',
  routine: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9l2 2 3-3M8 15h8"/>',
  care: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-4 3-6 7-6s7 2 7 6"/>',
};
const VIEWS = { talk: [viewTalk, bindTalk], scene: [viewScene, bindScene], listen: [viewListen, bindListen], routine: [viewRoutine, bindRoutine], care: [viewCare, bindCare] };

function paintTabs() {
  $("#tabs").innerHTML = Object.keys(VIEWS).map((k) => `<button data-tab="${k}" ${view === k ? 'aria-current="page"' : ""}><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[k]}</svg>${esc(t(k))}</button>`).join("");
  $$("[data-tab]").forEach((b) => b.addEventListener("click", () => go(b.dataset.tab)));
}
function render() {
  stopScan(); stopCam();
  const [mk, bind] = VIEWS[view];
  $("#app").innerHTML = mk();
  bind();
  paintTabs();
}
function go(v) {
  view = v;
  render();
  window.scrollTo({ top: 0 });
  if (S.modes.visual) speak(t(v));
}
function applyTheme() {
  const dark = S.theme === "dark" || (S.theme === "auto" && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  const m = $("meta[name=theme-color]"); if (m) m.content = dark ? "#0e0b24" : "#4b32e8";
}
function applySettings() {
  const root = document.documentElement, visual = S.modes.visual;
  applyTheme();
  root.classList.toggle("hc", S.contrast || visual);
  root.classList.toggle("m-intellect", S.modes.intellect);
  root.classList.toggle("m-visual", visual);
  root.style.setProperty("--scale", String(visual ? Math.max(S.size, 1.2) : S.size));
}
function applyAll() {
  const l = L();
  document.documentElement.lang = l.code;
  document.documentElement.dir = l.rtl ? "rtl" : "ltr";
  $("#langSel").innerHTML = LANGS.map((x) => `<option value="${x.code}" ${x.code === S.lang ? "selected" : ""}>${esc(x.name)}</option>`).join("");
  $("#langLbl").textContent = t("lang");
  $("#tag").textContent = t("tag");
  $("#sosBtn").innerHTML = pic("🆘") + " " + esc(t("sos"));
  $("#sosBtn").setAttribute("aria-label", t("sos"));
  warnedVoice = false;
  applySettings();
  render();
}

/* SOS */
function startSos() {
  $("#sosSay").textContent = (S.name ? S.name + ": " : "") + t("sosSay");
  $("#sosStop").textContent = t("sosStop");
  $("#sosOverlay").hidden = false;
  const loop = () => { speak(t("sosSay"), 1); buzz([400, 150, 400, 150, 400]); };
  loop();
  clearInterval(sosTimer);
  sosTimer = setInterval(loop, 5000);
}
function stopSos() {
  $("#sosOverlay").hidden = true;
  clearInterval(sosTimer);
  try { speechSynthesis.cancel(); } catch (e) { /* none */ }
  buzz(0);
}

/* ------------------------------------------------------------------ boot */
async function boot() {
  $("#langSel").addEventListener("change", (e) => { S.lang = e.target.value; save(); strip = []; applyAll(); });
  $("#sosBtn").addEventListener("click", startSos);
  $("#sosOverlay").addEventListener("click", stopSos);
  if (window.matchMedia) { try { matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme); } catch (e) { /* old Safari */ } }
  const imported = importFromHash();
  if (S.modes.hearing && !S.modes.speech) view = "listen";
  applyAll();
  if (imported) toast(t("imported"));
  else if (!S.onboarded) showOnboard();
  try {
    const r = await fetch("/api/health", { cache: "no-store" });
    SERVER_AI = r.ok && !!(await r.json()).ai;
  } catch (e) { SERVER_AI = false; }
  if (view === "scene") render();
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").catch(() => {});
}
boot();
