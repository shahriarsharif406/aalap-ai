"use strict";
/* Aalap — front-end logic. Plain JS, no build step, works offline as a PWA. */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ------------------------------------------------------------------ state */
const KEY = "aalap.v1";
const DEFAULTS = {
  lang: "en", name: "", modes: { speech: true, hearing: false, intellect: false, visual: false },
  speed: 1, contrast: false, size: 1, alertName: true,
  custom: [], usage: {}, boards: [], scene: "meal",
  routine: ["brush", "eat", "play", "bath", "sleep"], done: {},
};
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "{}");
    return Object.assign({}, DEFAULTS, s, { modes: Object.assign({}, DEFAULTS.modes, s.modes || {}) });
  } catch (e) { return JSON.parse(JSON.stringify(DEFAULTS)); }
}
let S = load();
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* storage may be blocked */ } }

let view = "talk", AI_ON = false, strip = [], armed = null, armedAt = 0;
let sttOn = false, rec = null, capLines = [], toastTimer = 0, sosTimer = 0, capSize = 1.6;
let pending = null; // photo waiting to be turned into a board

const li = () => Math.max(0, LANGS.findIndex((l) => l.code === S.lang));
const L = () => LANGS[li()];
const t = (k) => { const a = UI[k]; return a ? a[li()] || a[0] : k; };
const wordItem = (id) => ({ emoji: WORDS[id][0], text: WORDS[id][1 + li()] || WORDS[id][1], key: id, g: groupOf(id) });
const joiner = () => (S.lang === "zh" ? "" : " ");
const buzz = (p) => { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* unsupported */ } };

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
  if (!v && AI_ON) return cloudSpeak(text);
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
    const r = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, lang: S.lang }) });
    if (!r.ok) throw new Error("tts");
    const url = URL.createObjectURL(await r.blob());
    if (cloudAudio) cloudAudio.pause();
    cloudAudio = new Audio(url);
    cloudAudio.playbackRate = S.speed;
    cloudAudio.play();
  } catch (e) { toast(t("noVoice")); }
}

function toast(msg, praise) {
  const el = $("#toast");
  el.textContent = msg;
  el.className = "toast show" + (praise ? " praise" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = "toast"), praise ? 1600 : 2800);
}

/* ------------------------------------------------------------------ board data */
function boardItems() {
  let items;
  if (S.scene === "mine") items = S.custom.map((c) => ({ emoji: c.emoji, text: c.text, key: "c:" + c.text, g: "custom" }));
  else if (S.scene.startsWith("ai:")) {
    const b = S.boards.find((x) => x.id === S.scene);
    items = b ? b.items.map((i) => ({ emoji: i.emoji, text: i.text, key: "a:" + i.text, g: "ai" })) : [];
  } else items = (SCENES[S.scene] || SCENES.meal).map(wordItem);
  if (S.scene !== "mine" && S.custom.length && !S.modes.intellect) {
    items = items.concat(S.custom.map((c) => ({ emoji: c.emoji, text: c.text, key: "c:" + c.text, g: "custom" })));
  }
  return S.modes.intellect ? items.slice(0, 6) : items;
}
const coreItems = () => (S.modes.intellect ? CORE.slice(0, 3) : CORE).map(wordItem);

function count(item) {
  S.usage[item.text] = (S.usage[item.text] || 0) + 1;
  save();
}

/* ------------------------------------------------------------------ TALK */
let tiles = [];
function tileHtml(item) {
  tiles.push(item);
  return `<button class="tile g-${item.g}" data-i="${tiles.length - 1}" aria-label="${esc(item.text)}"><span class="em" aria-hidden="true">${esc(item.emoji)}</span><span class="tx">${esc(item.text)}</span></button>`;
}
function sceneChips() {
  const chips = Object.keys(SCENES).map((k) => ({ id: k, label: `${SCENE_EMOJI[k]} ${t("sc_" + k)}` }));
  S.boards.forEach((b) => chips.push({ id: b.id, label: `✨ ${b.name}` }));
  if (S.custom.length) chips.push({ id: "mine", label: `⭐ ${t("myWords")}` });
  return chips.map((c) => `<button class="chip" data-scene="${esc(c.id)}" aria-pressed="${S.scene === c.id}">${esc(c.label)}</button>`).join("");
}
function viewTalk() {
  tiles = [];
  const hint = S.modes.visual ? `<p class="hint" role="note">🔊 ${esc(t("vHint"))}</p>` : "";
  return `<section class="view">
    <div class="chips" role="group">${sceneChips()}</div>
    <div class="strip">
      <div class="strip-items" id="stripItems" aria-live="polite"></div>
      <div class="strip-actions">
        <button class="btn primary" id="speakAll">🔊 ${esc(t("speak"))}</button>
        <div class="row" style="margin:0"><button class="btn small" id="undo">↩ ${esc(t("undo"))}</button><button class="btn small warn" id="clearStrip">✕</button></div>
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
  box.innerHTML = strip.length
    ? strip.map((i) => `<span class="pill"><span class="em">${esc(i.emoji)}</span>${esc(i.text)}</span>`).join("")
    : `<span class="ph">…</span>`;
}
function onTile(item, el) {
  if (S.modes.visual) {
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
    speak(v); S.usage[v] = (S.usage[v] || 0) + 1; save();
    input.value = ""; $("#sugg").innerHTML = "";
  };
  $("#sayBtn").addEventListener("click", say);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") say(); });
  let timer = 0;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => suggest(input.value), 650);
  });
}
async function suggest(text) {
  const box = $("#sugg");
  if (!box) return;
  text = text.trim();
  const local = Object.keys(S.usage).filter((k) => text && k.toLowerCase().startsWith(text.toLowerCase()) && k !== text).sort((a, b) => S.usage[b] - S.usage[a]).slice(0, 4);
  let list = local;
  if (AI_ON && text.length >= 2) {
    try {
      const r = await fetch("/api/phrases", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ context: text, lang: S.lang, lang_name: L().en }) });
      if (r.ok) list = local.concat((await r.json()).phrases || []).slice(0, 7);
    } catch (e) { /* offline: keep local */ }
  }
  if (!$("#sugg")) return;
  $("#sugg").innerHTML = list.map((p) => `<button class="chip" data-say="${esc(p)}">${esc(p)}</button>`).join("");
  $$("[data-say]").forEach((b) => b.addEventListener("click", () => { speak(b.dataset.say); S.usage[b.dataset.say] = (S.usage[b.dataset.say] || 0) + 1; save(); }));
}

/* ------------------------------------------------------------------ SCENE */
function viewScene() {
  const presets = Object.keys(SCENES).map((k) => `<button class="scene-card" data-preset="${k}"><span class="em">${SCENE_EMOJI[k]}</span>${esc(t("sc_" + k))}</button>`).join("");
  const ai = AI_ON
    ? `<div class="drop">
         <div id="preview"></div>
         <label class="btn primary" for="photoIn">📷 ${esc(t("photo"))}</label>
         <input id="photoIn" class="sr" type="file" accept="image/*" capture="environment">
         <textarea id="descIn" placeholder="${esc(t("describe"))}" aria-label="${esc(t("describe"))}"></textarea>
         <button class="btn primary" id="makeBtn">✨ ${esc(t("make"))}</button>
         <div id="aiStatus" role="status"></div>
       </div>
       <div id="aiResult"></div>`
    : `<p class="hint">ℹ️ ${esc(t("aiOff"))}</p>`;
  return `<section class="view">
    <h2>✨ AI</h2>${ai}
    <h2>${esc(t("presets"))}</h2><div class="scenes">${presets}</div>
  </section>`;
}
function downscale(file, max = 1024) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = reject;
    img.src = url;
  });
}
function bindScene() {
  $$("[data-preset]").forEach((b) => b.addEventListener("click", () => { S.scene = b.dataset.preset; save(); go("talk"); }));
  const photo = $("#photoIn");
  if (!photo) return;
  photo.addEventListener("change", async () => {
    const f = photo.files && photo.files[0];
    if (!f) return;
    try {
      pending = await downscale(f);
      $("#preview").innerHTML = `<img src="${pending}" alt="">`;
    } catch (e) { toast(t("aiFail")); }
  });
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
    const r = await fetch("/api/board", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(String(r.status));
    const data = await r.json();
    st.textContent = "";
    $("#aiResult").innerHTML = `<h2>✨ ${esc(data.title)}</h2>
      <div class="grid">${data.items.map((i) => `<div class="tile g-ai"><span class="em">${esc(i.emoji)}</span><span class="tx">${esc(i.text)}</span></div>`).join("")}</div>
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
  } finally {
    const b = $("#makeBtn"); if (b) b.disabled = false;
  }
}

/* ------------------------------------------------------------------ LISTEN */
function emojiHints(text) {
  const i = li(), low = text.toLowerCase(), out = [];
  const tokenCount = {};
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
function paintListenBtn() { const b = $("#sttBtn"); if (b) b.innerHTML = sttOn ? `<span class="rec-dot"></span>${esc(t("listenStop"))}` : `🎧 ${esc(t("listenStart"))}`; }
function paintCaps(interim) {
  const box = $("#caps");
  if (!box) return;
  const lines = capLines.map((l) => `<p class="cap">${esc(l.text)}<span class="ems">${l.ems.join(" ")}</span></p>`);
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
function allPickable() {
  return Object.keys(WORDS).map(wordItem).concat(S.custom.map((c) => ({ emoji: c.emoji, text: c.text, key: "c:" + c.text, g: "custom" })));
}
function stepItem(key) {
  if (WORDS[key]) return wordItem(key);
  const c = S.custom.find((x) => "c:" + x.text === key);
  return c ? { emoji: c.emoji, text: c.text, key, g: "custom" } : null;
}
function viewRoutine() {
  const steps = S.routine.map(stepItem).filter(Boolean);
  const cur = steps.find((s) => !S.done[s.key]);
  const next = cur ? steps.slice(steps.indexOf(cur) + 1).find((s) => !S.done[s.key]) : null;
  const box = (label, s, cls) => `<div class="box ${cls}"><small>${esc(label)}</small>${s ? `<span class="em">${esc(s.emoji)}</span><b>${esc(s.text)}</b>` : `<span class="em">—</span>`}</div>`;
  const banner = steps.length ? (cur ? `<div class="now">${box(t("first"), cur, "first")}<span class="arrow" aria-hidden="true">➜</span>${box(t("then"), next, "")}</div>` : `<div class="card" style="text-align:center;font-size:1.4rem">🎉 ${esc(t("allDone"))}</div>`) : "";
  return `<section class="view">
    ${banner}
    <ul class="steps">${steps.map((s, i) => `<li class="step ${S.done[s.key] ? "done" : ""}">
      <button class="check" data-done="${esc(s.key)}" aria-pressed="${!!S.done[s.key]}" aria-label="${esc(s.text)}">${S.done[s.key] ? "✓" : ""}</button>
      <span class="em">${esc(s.emoji)}</span><span class="tx">${esc(s.text)}</span>
      <button class="btn small" data-up="${i}" aria-label="↑">↑</button>
      <button class="btn small warn" data-del="${i}" aria-label="✕">✕</button></li>`).join("")}</ul>
    <div class="row"><button class="btn primary" id="addStep">＋ ${esc(t("addStep"))}</button><button class="btn" id="newDay">🔄 ${esc(t("newDay"))}</button></div>
  </section>`;
}
function bindRoutine() {
  $$("[data-done]").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.done, was = !!S.done[k];
    if (was) delete S.done[k]; else { S.done[k] = 1; const s = stepItem(k); speak(s ? t("praise") : ""); toast("🌟 " + t("praise"), true); buzz(30); }
    save(); render();
  }));
  $$("[data-up]").forEach((b) => b.addEventListener("click", () => { const i = +b.dataset.up; if (i > 0) { [S.routine[i - 1], S.routine[i]] = [S.routine[i], S.routine[i - 1]]; save(); render(); } }));
  $$("[data-del]").forEach((b) => b.addEventListener("click", () => { S.routine.splice(+b.dataset.del, 1); save(); render(); }));
  $("#newDay").addEventListener("click", () => { S.done = {}; save(); render(); });
  $("#addStep").addEventListener("click", () => openPicker((item) => { if (!S.routine.includes(item.key)) S.routine.push(item.key); save(); render(); }));
}
function openPicker(cb) {
  const dlg = $("#picker"), grid = $("#pickerGrid");
  const items = allPickable();
  grid.innerHTML = items.map((it, i) => `<button class="tile g-${it.g}" data-p="${i}"><span class="em">${esc(it.emoji)}</span><span class="tx">${esc(it.text)}</span></button>`).join("");
  $$("[data-p]", grid).forEach((b) => b.addEventListener("click", () => { cb(items[+b.dataset.p]); dlg.close(); }));
  if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
}

/* ------------------------------------------------------------------ CAREGIVER */
function viewCare() {
  const m = S.modes;
  const modeBox = (k, label, icon) => `<label class="mode"><input type="checkbox" data-mode="${k}" ${m[k] ? "checked" : ""}><span>${icon} ${esc(label)}</span></label>`;
  const top = Object.entries(S.usage).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const max = top.length ? top[0][1] : 1;
  return `<section class="view form">
    <div class="card form">
      <h2 style="margin:0">${esc(t("profile"))}</h2>
      <div class="field"><label for="nameIn">${esc(t("name"))}</label><input id="nameIn" type="text" value="${esc(S.name)}" autocomplete="off"></div>
      <div class="field"><span class="lbl">${esc(t("modes"))}</span><div class="modes">
        ${modeBox("speech", t("mSpeech"), "🗣️")}${modeBox("hearing", t("mHearing"), "👂")}${modeBox("intellect", t("mIntellect"), "🧩")}${modeBox("visual", t("mVisual"), "👁️")}
      </div></div>
      <div class="field"><label for="speedIn">${esc(t("speed"))}</label><input id="speedIn" type="range" min="0.5" max="1.5" step="0.1" value="${S.speed}"></div>
      <div class="field"><label for="sizeIn">${esc(t("size"))}</label><input id="sizeIn" type="range" min="0.8" max="1.5" step="0.1" value="${S.size}"></div>
      <label class="toggle"><input id="hcIn" type="checkbox" ${S.contrast ? "checked" : ""}> ${esc(t("contrast"))}</label>
      <label class="toggle"><input id="alertIn" type="checkbox" ${S.alertName ? "checked" : ""}> ${esc(t("nameAlert"))}</label>
    </div>
    <div class="card form">
      <h2 style="margin:0">⭐ ${esc(t("addBtn"))}</h2>
      <div class="two"><input id="cEmoji" type="text" value="😀" maxlength="4" aria-label="emoji"><input id="cText" type="text" placeholder="${esc(t("label"))}" aria-label="${esc(t("label"))}"><button class="btn primary" id="cAdd">${esc(t("add"))}</button></div>
      <ul class="list">${S.custom.map((c, i) => `<li><span class="em" style="font-size:1.6rem">${esc(c.emoji)}</span><span class="tx">${esc(c.text)}</span><button class="btn small warn" data-cdel="${i}" aria-label="✕">✕</button></li>`).join("") || `<li class="tx" style="color:var(--muted)">${esc(t("empty"))}</li>`}</ul>
    </div>
    <div class="card">
      <h2 style="margin:0 0 8px">📊 ${esc(t("top"))}</h2>
      <ul class="list">${top.map(([k, v]) => `<li><span class="tx">${esc(k)}</span><div class="bar"><i style="width:${Math.round((v / max) * 100)}%"></i></div><b>${v}</b></li>`).join("") || `<li class="tx" style="color:var(--muted)">${esc(t("empty"))}</li>`}</ul>
    </div>
    <div class="row">
      <button class="btn" id="expBtn">⬇ ${esc(t("export"))}</button>
      <label class="btn" for="impIn">⬆ ${esc(t("import"))}</label><input id="impIn" class="sr" type="file" accept="application/json">
      <button class="btn warn" id="resetBtn">${esc(t("reset"))}</button>
    </div>
    <p class="hint">🔒 ${esc(t("privacy"))}</p>
  </section>`;
}
function bindCare() {
  $$("[data-mode]").forEach((c) => c.addEventListener("change", () => { S.modes[c.dataset.mode] = c.checked; save(); applySettings(); }));
  $("#nameIn").addEventListener("input", (e) => { S.name = e.target.value.trim(); save(); });
  $("#speedIn").addEventListener("input", (e) => { S.speed = +e.target.value; save(); });
  $("#speedIn").addEventListener("change", () => speak(S.name || t("praise")));
  $("#sizeIn").addEventListener("input", (e) => { S.size = +e.target.value; save(); applySettings(); });
  $("#hcIn").addEventListener("change", (e) => { S.contrast = e.target.checked; save(); applySettings(); });
  $("#alertIn").addEventListener("change", (e) => { S.alertName = e.target.checked; save(); });
  $("#cAdd").addEventListener("click", () => {
    const text = $("#cText").value.trim(), emoji = $("#cEmoji").value.trim() || "💬";
    if (!text) return;
    S.custom.push({ emoji, text: text.slice(0, 70) }); save(); render();
  });
  $$("[data-cdel]").forEach((b) => b.addEventListener("click", () => { S.custom.splice(+b.dataset.cdel, 1); save(); render(); }));
  $("#expBtn").addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(S, null, 2)], { type: "application/json" }));
    a.download = "aalap-profile.json"; a.click();
  });
  $("#impIn").addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { S = Object.assign({}, DEFAULTS, JSON.parse(await f.text())); S.modes = Object.assign({}, DEFAULTS.modes, S.modes); save(); applyAll(); } catch (err) { toast("⚠️"); }
  });
  $("#resetBtn").addEventListener("click", () => { if (confirm("Reset?")) { S = JSON.parse(JSON.stringify(DEFAULTS)); save(); strip = []; applyAll(); } });
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
function applySettings() {
  const root = document.documentElement;
  const visual = S.modes.visual;
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
  $("#sosBtn").textContent = "🆘 " + t("sos");
  $("#sosBtn").setAttribute("aria-label", t("sos"));
  warnedVoice = false;
  applySettings();
  render();
}

/* SOS */
function startSos() {
  const msg = (S.name ? S.name + ": " : "") + t("sosSay");
  $("#sosSay").textContent = msg;
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
  if (S.modes.hearing && !S.modes.speech) view = "listen";
  applyAll();
  try {
    const r = await fetch("/api/health", { cache: "no-store" });
    AI_ON = r.ok && !!(await r.json()).ai;
  } catch (e) { AI_ON = false; }
  if (view === "scene") render();
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("/sw.js").catch(() => {});
}
boot();
