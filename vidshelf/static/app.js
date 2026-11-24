/* VidShelf front-end (vanilla JS, no build step) */
"use strict";

const $app = document.getElementById("app");
let serverCaps = {};
let typingSearch = false;   // 검색어 입력 때문에 화면을 다시 그리는 중인지

/** 검색어를 입력하던 중에만 검색창에 커서를 되돌림 (탭을 열 때 키보드가 저절로 뜨지 않게) */
function keepTypingFocus(input) {
  if (!typingSearch) return;
  typingSearch = false;
  input.focus({ preventScroll: true });
  const n = input.value.length;
  try { input.setSelectionRange(n, n); } catch (e) {}
}   // 서버가 지원하는 기능 (안드로이드 앱: MEGA, 사람 프로필 등)

// ---------------------------------------------------------------- helpers
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

// ---------------------------------------------------------------- 아이콘 (둥근 선 한 벌)
// .b 몸통(켜지면 통째로 칠함) · .k 몸통 안 무늬(켜지면 뚫림) · .fk 뚫린 무늬를 칠로 · .d 늘 칠하는 점·삼각형 · .tp 재생 삼각형(꺼짐 = 칠, 켜짐 = 뚫림)
const ICONS = (() => {
  const gear = () => {
    const n = 8, ro = 9.3, ri = 7.2, P = (Math.PI * 2) / n, pts = [];
    for (let k = 0; k < n; k++) {
      const a = k * P - Math.PI / 2;
      [[a - 0.17 * P, ro], [a + 0.17 * P, ro], [a + 0.31 * P, ri], [a + 0.69 * P, ri]].forEach(([t, r]) => pts.push([12 + r * Math.cos(t), 12 + r * Math.sin(t)]));
    }
    return `<path class="b" d="M${pts.map((p) => p.map((v) => v.toFixed(2)).join(" ")).join("L")}z"/><circle class="k" cx="12" cy="12" r="2.8"/>`;
  };
  const P3 = [3.5, 9.8, 16.1];
  const WALL = [[3.5, 3.5, 9.6], [15.3, 3.5, 5.2], [3.5, 13.1, 5.2], [10.9, 13.1, 9.6]];
  const PHOTO = '<rect class="b" x="3.5" y="4.5" width="17" height="15" rx="3.2"/><circle class="k fk" cx="9" cy="9.6" r="1.6"/><path class="k" d="M20.5 15.2l-4-3.9a1.6 1.6 0 0 0-2.2 0L6.2 19.4"/>';
  const FOLDER = '<path class="b" d="M3.5 7.4c0-1.1.9-1.9 1.9-1.9h3.7c.5 0 1 .2 1.3.6l1.4 1.6h6.8c1.1 0 1.9.9 1.9 1.9v8.2c0 1.1-.9 1.9-1.9 1.9H5.4c-1.1 0-1.9-.9-1.9-1.9z"/>';
  const SPEAKER = '<path class="b" d="M4 9.8v4.4c0 .7.5 1.2 1.2 1.2h2.5l4.2 3.5c.6.5 1.6.1 1.6-.8V5.9c0-.9-1-1.3-1.6-.8L7.7 8.6H5.2C4.5 8.6 4 9.1 4 9.8z"/>';
  const CHECK = '<path class="k" d="M8.2 12.3l2.6 2.6 5-5.2"/>';
  return {
    home: '<path class="b" d="M4 10.4 10.6 5a2.2 2.2 0 0 1 2.8 0L20 10.4V18.6a2 2 0 0 1-2 2h-3.2v-4.4a2.8 2.8 0 0 0-5.6 0v4.4H6a2 2 0 0 1-2-2z"/>',
    media: '<path d="M7.5 3.8h9.7a3.3 3.3 0 0 1 3.3 3.3v8.4"/><rect class="b" x="3.5" y="7.3" width="13.6" height="12.9" rx="3.2"/><path class="tp" d="M8.03 11.5Q8.03 10.75 8.69 11.11L12.78 13.39Q13.43 13.75 12.78 14.11L8.69 16.39Q8.03 16.75 8.03 16z"/>',
    shorts: '<rect class="b" x="5.8" y="2.6" width="12.4" height="18.8" rx="3.6"/><path class="tp" d="M9.56 9.45Q9.56 8.7 10.22 9.07L14.71 11.63Q15.36 12 14.71 12.37L10.22 14.93Q9.56 15.3 9.56 14.55z"/>',
    explore: '<circle class="b" cx="12" cy="12" r="8.8"/><path class="k fk" d="M15.6 8.4 13.4 13.4 8.4 15.6 10.6 10.6z"/>',
    apps: '<rect class="b" x="3.5" y="3.5" width="6.6" height="6.6" rx="2.2"/><rect class="b" x="13.9" y="3.5" width="6.6" height="6.6" rx="2.2"/><rect class="b" x="3.5" y="13.9" width="6.6" height="6.6" rx="2.2"/><rect class="b" x="13.9" y="13.9" width="6.6" height="6.6" rx="2.2"/>',
    search: '<circle cx="10.8" cy="10.8" r="6.6"/><path d="M15.8 15.8 20.3 20.3"/>',
    filter: '<path d="M3.5 7.5h6.7M19.8 7.5h.7M3.5 16.5h.7M13.8 16.5h6.7"/><circle class="b" cx="15" cy="7.5" r="2.3"/><circle class="b" cx="9" cy="16.5" r="2.3"/>',
    viewList: '<rect class="d" x="3.5" y="3.5" width="17" height="9" rx="1.8"/><rect class="d" x="3.5" y="14.6" width="17" height="2.2" rx="1.1"/><rect class="d" x="3.5" y="18.3" width="10.5" height="2.2" rx="1.1"/>',
    viewWall: WALL.map(([x, y, w]) => `<rect class="d" x="${x}" y="${y}" width="${w}" height="7.4" rx="1.8"/>`).join(""),
    viewGrid: P3.flatMap((y) => P3.map((x) => `<rect class="d" x="${x}" y="${y}" width="4.4" height="4.4" rx="1.3"/>`)).join(""),
    sort: '<path d="M7.5 19.5V4.5M4 8l3.5-3.5L11 8M16.5 4.5v15M13 16l3.5 3.5L20 16"/>',
    shuffle: '<path d="M3.5 7.5h2.7c2.1 0 3.4 1 4.5 2.8l2.6 4.2c1.1 1.8 2.4 2.8 4.5 2.8h2.7M3.5 16.5h2.7c1.2 0 2.1-.3 2.9-1M14.4 8.5c.8-.7 1.7-1 2.9-1h2.7M17.8 5l2.5 2.5-2.5 2.5M17.8 14.5l2.5 2.5-2.5 2.5"/>',
    history: '<path d="M4.2 12.5a7.8 7.8 0 1 0 2.3-6"/><path d="M4 3.8v3.7h3.7M12 8v4.3l2.8 1.8"/>',
    star: '<path class="b" d="M11.1 3.9c.4-.8 1.4-.8 1.8 0l1.9 3.9 4.3.6c.8.1 1.2 1.1.6 1.7l-3.1 3 .7 4.3c.1.9-.8 1.5-1.5 1.1L12 16.5l-3.8 2c-.7.4-1.6-.2-1.5-1.1l.7-4.3-3.1-3c-.6-.6-.3-1.6.6-1.7l4.3-.6z"/>',
    close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    up: '<path d="M6 14.5 12 8.5l6 6"/>',
    down: '<path d="M6 9.5l6 6 6-6"/>',
    next: '<path d="M9.5 5.5 16 12l-6.5 6.5"/>',
    back: '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
    heart: '<path class="b" d="M12 20s-7.6-4.5-8.9-9.4C2.3 7.4 4.3 4.6 7.3 4.6c1.9 0 3.4 1 4.7 2.8 1.3-1.8 2.8-2.8 4.7-2.8 3 0 5 2.8 4.2 6C19.6 15.5 12 20 12 20z"/>',
    tag: '<path class="b" d="M3.8 11.9V5.3c0-.8.7-1.5 1.5-1.5h6.6c.4 0 .8.2 1.1.4l7.2 7.2c.6.6.6 1.5 0 2.1l-6.6 6.6c-.6.6-1.5.6-2.1 0l-7.2-7.2c-.3-.3-.5-.7-.5-1z"/><circle class="k fk" cx="8.4" cy="8.4" r="1.4"/>',
    person: '<circle class="b" cx="12" cy="8" r="3.8"/><path class="b" d="M4.9 19.6c.7-3.4 3.6-5.3 7.1-5.3s6.4 1.9 7.1 5.3c.1.6-.3 1-.9 1H5.8c-.6 0-1-.4-.9-1z"/>',
    people: '<circle class="b" cx="9" cy="8.3" r="3.4"/><path class="b" d="M2.9 19.4c.6-3 3-4.7 6.1-4.7s5.5 1.7 6.1 4.7c.1.6-.3 1-.9 1H3.8c-.6 0-1-.4-.9-1z"/><path d="M15.4 4.9a3.4 3.4 0 0 1 0 6.8M17.6 14.9c2 .6 3.3 2.1 3.6 4.5"/>',
    bookmark: '<path class="b" d="M6.5 5.2c0-.9.7-1.7 1.7-1.7h7.6c.9 0 1.7.7 1.7 1.7v14.6c0 .5-.6.8-1 .5L12 16.8l-4.5 3.5c-.4.3-1 0-1-.5z"/>',
    more: '<circle class="d" cx="5.5" cy="12" r="1.8"/><circle class="d" cx="12" cy="12" r="1.8"/><circle class="d" cx="18.5" cy="12" r="1.8"/>',
    edit: '<path class="b" d="M15.2 4.6a2 2 0 0 1 2.8 0l1.4 1.4a2 2 0 0 1 0 2.8L9.5 18.7 4.5 19.5l.8-5z"/><path class="k" d="M13.3 6.5l4.2 4.2"/>',
    image: PHOTO,
    photos: PHOTO,
    frame: '<path d="M4 8.5V6.2C4 5 5 4 6.2 4h2.3M15.5 4h2.3C19 4 20 5 20 6.2v2.3M20 15.5v2.3c0 1.2-1 2.2-2.2 2.2h-2.3M8.5 20H6.2C5 20 4 19 4 17.8v-2.3"/><circle class="b" cx="12" cy="12" r="3.3"/>',
    download: '<path d="M12 4v10.5M7.6 10.3 12 14.7l4.4-4.4M5 19.5h14"/>',
    calendar: '<rect class="b" x="3.8" y="5" width="16.4" height="15.2" rx="3.2"/><path class="k" d="M3.8 10h16.4"/><path d="M8.2 3v3.6M15.8 3v3.6"/>',
    done: '<circle class="b" cx="12" cy="12" r="8.8"/>' + CHECK,
    select: '<rect class="b" x="4" y="4" width="16" height="16" rx="4.5"/>' + CHECK,
    trash: '<path d="M4.5 7h15M9.6 7V5.3c0-.7.6-1.3 1.3-1.3h2.2c.7 0 1.3.6 1.3 1.3V7"/><path class="b" d="M6.5 7l.9 11.4c.1 1.2 1 2.1 2.2 2.1h4.8c1.2 0 2.1-.9 2.2-2.1L17.5 7z"/><path class="k" d="M10.3 11v5.3M13.7 11v5.3"/>',
    undo: '<path d="M8.8 13.8 4.5 9.5l4.3-4.3"/><path d="M4.5 9.5h9.8a5.2 5.2 0 0 1 0 10.4h-3.3"/>',
    pin: '<path class="b" d="M9 3.5h6c.6 0 1 .4 1 1s-.4 1-1 1h-.5v3.3l2.7 2.9c.2.2.3.5.3.8v1.1c0 .6-.4 1-1 1H7.5c-.6 0-1-.4-1-1v-1.1c0-.3.1-.6.3-.8l2.7-2.9V5.5H9c-.6 0-1-.4-1-1s.4-1 1-1z"/><path d="M12 14.6v5.9"/>',
    play: '<path class="d" d="M7.2 5.6v12.8c0 1 1.1 1.6 1.9 1l10-6.4c.8-.5.8-1.6 0-2.1l-10-6.4c-.8-.5-1.9.1-1.9 1.1z"/>',
    pause: '<rect class="d" x="5.8" y="4.8" width="4.4" height="14.4" rx="1.6"/><rect class="d" x="13.8" y="4.8" width="4.4" height="14.4" rx="1.6"/>',
    prev: '<path d="M6 5.5v13"/><path class="d" d="M18.5 6.6v10.8c0 .9-1 1.4-1.7.9l-7.6-5.4c-.6-.4-.6-1.3 0-1.8l7.6-5.4c.7-.5 1.7 0 1.7.9z"/>',
    nextv: '<path d="M18 5.5v13"/><path class="d" d="M5.5 6.6v10.8c0 .9 1 1.4 1.7.9l7.6-5.4c.6-.4.6-1.3 0-1.8L7.2 5.7c-.7-.5-1.7 0-1.7.9z"/>',
    rew10: '<path d="M12 5.2A7.8 7.8 0 1 1 4.67 10.33"/><path d="M14.3 2.9 12 5.2l2.3 2.3"/><text x="12" y="15.4" text-anchor="middle">10</text>',
    fwd10: '<path d="M12 5.2A7.8 7.8 0 1 0 19.33 10.33"/><path d="M9.7 2.9 12 5.2 9.7 7.5"/><text x="12" y="15.4" text-anchor="middle">10</text>',
    speed: '<path class="d" d="M3.5 7.3v9.4c0 .8.9 1.3 1.6.8l6.2-4.7c.5-.4.5-1.2 0-1.6L5.1 6.5c-.7-.5-1.6 0-1.6.8zM12.5 7.3v9.4c0 .8.9 1.3 1.6.8l6.2-4.7c.5-.4.5-1.2 0-1.6l-6.2-4.7c-.7-.5-1.6 0-1.6.8z"/>',
    full: '<path d="M4 9V6.4C4 5.1 5.1 4 6.4 4H9M15 4h2.6C18.9 4 20 5.1 20 6.4V9M20 15v2.6c0 1.3-1.1 2.4-2.4 2.4H15M9 20H6.4C5.1 20 4 18.9 4 17.6V15"/>',
    external: '<path d="M10.5 5.5H7a3 3 0 0 0-3 3V17a3 3 0 0 0 3 3h8.5a3 3 0 0 0 3-3v-3.5"/><path d="M14 4h6v6M20 4l-8.3 8.3"/>',
    sound: SPEAKER + '<path d="M16.6 9.2a4 4 0 0 1 0 5.6M19.2 6.6a7.6 7.6 0 0 1 0 10.8"/>',
    mute: SPEAKER + '<path d="M16.8 9.6l4.8 4.8M21.6 9.6l-4.8 4.8"/>',
    info: '<circle class="b" cx="12" cy="12" r="8.8"/><path class="k" d="M12 11.2v5"/><circle class="d kd" cx="12" cy="7.9" r="1.2"/>',
    tidy: '<path class="b" d="M10 3.5c.6 4.1 2.4 5.9 6.5 6.5-4.1.6-5.9 2.4-6.5 6.5-.6-4.1-2.4-5.9-6.5-6.5 4.1-.6 5.9-2.4 6.5-6.5z"/><path class="b" d="M17.5 14c.3 2 1.2 2.9 3.2 3.2-2 .3-2.9 1.2-3.2 3.2-.3-2-1.2-2.9-3.2-3.2 2-.3 2.9-1.2 3.2-3.2z"/>',
    stats: '<rect class="b" x="3.5" y="3.5" width="17" height="17" rx="3.5"/><path class="k" d="M7.5 15.8l3.2-3.6 2.8 2.2 3.4-4.6"/>',
    dup: '<path d="M8.3 4h8.2A3.5 3.5 0 0 1 20 7.5v8.2"/><rect class="b" x="4" y="8" width="12" height="12" rx="3"/><path class="k" d="M7.5 12.6h5M7.5 15.6h5"/>',
    hidden: '<path d="M9.3 6.1c.9-.4 1.7-.6 2.7-.6 5.6 0 9 6.5 9 6.5s-.7 1.4-2.1 2.9M14.7 18c-.8.3-1.7.5-2.7.5-5.6 0-9-6.5-9-6.5s.7-1.4 2.1-2.9"/><path d="M4 4l16 16"/>',
    eye: '<path class="b" d="M3 12s3.4-6.5 9-6.5 9 6.5 9 6.5-3.4 6.5-9 6.5S3 12 3 12z"/><circle class="k fk" cx="12" cy="12" r="2.6"/>',
    folder: FOLDER,
    folderUp: FOLDER + '<path class="k" d="M12 16.2v-5M9.7 13.3 12 11l2.3 2.3"/>',
    cloud: '<path class="b" d="M7.2 18.5h10a3.9 3.9 0 0 0 .6-7.7 5.9 5.9 0 0 0-11.3-1.3 4.5 4.5 0 0 0 .7 9z"/>',
    device: '<rect class="b" x="6.3" y="2.8" width="11.4" height="18.4" rx="3.2"/><path class="k" d="M10.5 18h3"/>',
    gear: gear(),
    theme: '<circle cx="12" cy="12" r="8.8"/><path class="d" d="M12 3.2a8.8 8.8 0 0 1 0 17.6z"/>',
    backup: '<rect class="b" x="3.5" y="3.5" width="17" height="3.8" rx="1.6"/><path class="b" d="M5 11h14v7c0 1.4-1.1 2.5-2.5 2.5h-9C6.1 20.5 5 19.4 5 18z"/><path class="k" d="M12 18.2v-4.4M9.9 15.8 12 13.7l2.1 2.1"/>',
    lock: '<rect class="b" x="4.8" y="10.3" width="14.4" height="10.2" rx="3"/><path d="M8.2 10.3V7.8a3.8 3.8 0 0 1 7.6 0v2.5"/><path class="k" d="M12 14.4v2"/>',
    warn: '<path class="b" d="M10.4 4.6c.7-1.2 2.5-1.2 3.2 0l7 12.2c.7 1.2-.2 2.7-1.6 2.7H5c-1.4 0-2.3-1.5-1.6-2.7z"/><path class="k" d="M12 9.6v4"/><circle class="d kd" cx="12" cy="16.4" r="1.1"/>',
    doc: '<path class="b" d="M7 3.5h6.4c.5 0 1 .2 1.3.5l3.8 3.8c.3.3.5.8.5 1.3v9.9c0 1.1-.9 2-2 2H7c-1.1 0-2-.9-2-2v-13.5c0-1.1.9-2 2-2z"/><path class="k" d="M13.5 3.7V7c0 .8.6 1.5 1.5 1.5h3.3M8.5 13h7M8.5 16.5h4.5"/>',
    music: '<path d="M9 17.5V6.4c0-.5.3-.9.8-1l8.4-1.7c.6-.1 1.2.3 1.2 1v10.8"/><circle class="b" cx="6.6" cy="17.5" r="2.5"/><circle class="b" cx="17" cy="15.5" r="2.5"/>',
    trophy: '<path class="b" d="M7.5 4h9v5.6a4.5 4.5 0 0 1-9 0z"/><path d="M7.5 6.2H5.6A1.6 1.6 0 0 0 4 7.8c0 2.1 1.6 3.7 3.9 3.8M16.5 6.2h1.9A1.6 1.6 0 0 1 20 7.8c0 2.1-1.6 3.7-3.9 3.8M12 14.1v3.1"/><rect class="b" x="8.5" y="17.2" width="7" height="3.3" rx="1.3"/>',
    camera: '<path class="b" d="M4 8.7c0-1 .8-1.8 1.8-1.8h2l1.2-1.8c.3-.4.8-.7 1.3-.7h3.4c.5 0 1 .3 1.3.7l1.2 1.8h2c1 0 1.8.8 1.8 1.8v9c0 1-.8 1.8-1.8 1.8H5.8c-1 0-1.8-.8-1.8-1.8z"/><circle class="k" cx="12" cy="13" r="3.2"/>',
  };
})();
/** 아이콘 하나 (cls: "in" 글자 옆에 작게, "filled" 통째로 칠한 모양, "x" 칩의 지우기) */
function ico(name, cls) {
  const sp = document.createElement("span");
  sp.innerHTML = `<svg class="ico${cls ? " " + cls : ""}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ""}</svg>`;
  return sp.firstChild;
}

async function api(path, opts = {}) {
  const init = { method: opts.method || "GET", headers: {} };
  if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body);
    init.headers["Content-Type"] = "application/json";
  }
  const r = await fetch("/api/" + path, init);
  if (r.status === 401) { renderLogin(); throw new Error("login required"); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || r.statusText);
  return data;
}

function fmtDur(s) {
  s = Math.max(0, Math.round(s || 0));
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  const p = (n) => String(n).padStart(2, "0");
  return hh ? `${hh}:${p(mm)}:${p(ss)}` : `${mm}:${p(ss)}`;
}
function fmtSize(b) {
  if (!b) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return `${b.toFixed(i > 1 ? 1 : 0)} ${u[i]}`;
}
function resLabel(w, hgt) {
  const m = Math.min(w || 0, hgt || 0) || hgt;
  if (!m) return "";
  if (m >= 2100) return "4K"; if (m >= 1400) return "1440p"; if (m >= 1000) return "1080p";
  if (m >= 700) return "720p"; if (m >= 460) return "480p"; return `${m}p`;
}
/** "3일 전" 처럼 */
function timeAgo(ts) {
  if (!ts) return "";
  const d = Date.now() / 1000 - ts;
  if (d < 60) return "방금";
  if (d < 3600) return `${Math.floor(d / 60)}분 전`;
  if (d < 86400) return `${Math.floor(d / 3600)}시간 전`;
  if (d < 86400 * 30) return `${Math.floor(d / 86400)}일 전`;
  if (d < 86400 * 365) return `${Math.floor(d / 86400 / 30)}개월 전`;
  return `${Math.floor(d / 86400 / 365)}년 전`;
}
function fmtDate(ts) { return ts ? new Date(ts * 1000).toLocaleString("ko-KR") : "-"; }
/** 알림 팝업. action 이 있으면 [되돌리기] 같은 버튼이 함께 나오고 조금 더 오래 보임 */
function toast(msg, action) {
  const t = document.getElementById("toast");
  t.replaceChildren(h("span", {}, msg));
  if (action) t.append(h("button", { class: "toast-act", onclick: () => { t.hidden = true; clearTimeout(toast._t); action.fn(); } }, action.label));
  t.classList.toggle("has-act", !!action);
  t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), action ? 5500 : 2600);
}
function thumbUrl(id, n = 0, ver = "") { return `/thumbs/${id}/${n}.jpg?v=${ver}`; }
function parseHash() {
  const raw = location.hash.slice(1) || "/";
  const [path, qs] = raw.split("?");
  return { path, params: new URLSearchParams(qs || "") };
}
const TAB_GROUP = { videos: "media", photos: "media", media: "media", tags: "explore", performers: "explore", settings: "library", library: "library", cloud: "library" };
const SOURCE_LABEL = { mega: "MEGA", icloud: "iCloud", local: "이 기기" };
function setTab(name) {
  const t = TAB_GROUP[name] || name;   // 사진·사람·태그·설정은 ‘보관함’ 탭 안에 있음
  const prev = document.querySelector(".topbar .tabs a.on");
  let changed = false;
  document.querySelectorAll(".tabs a").forEach((a) => { const on = a.dataset.tab === t; if (on !== a.classList.contains("on")) changed = true; a.classList.toggle("on", on); });
  placeTabBlob(!!prev && changed, prev);
}
/** 하단 바의 원: 고른 탭으로 통통 튀며 옮겨 감 (멀리 갈수록 잠깐 옆으로 늘어났다 돌아옴) */
function placeTabBlob(animate, prev) {
  const nav = document.querySelector(".topbar .tabs");
  const blob = nav && nav.querySelector(".tab-blob");
  if (!blob) return;
  const on = nav.querySelector("a.on");
  if (!on || !on.offsetWidth) { blob.classList.add("off"); return; }
  const x = on.offsetLeft + on.offsetWidth / 2;
  const first = blob.classList.contains("off") || !blob.dataset.placed;
  blob.classList.remove("off");
  if (!animate || first) {
    blob.classList.add("still"); blob.style.setProperty("--tx", x + "px");
    void blob.offsetWidth; blob.classList.remove("still"); blob.dataset.placed = "1";
    return;
  }
  if (prev && prev.offsetWidth) {
    const d = Math.abs(x - (prev.offsetLeft + prev.offsetWidth / 2));
    blob.style.setProperty("--tw", Math.min(46 + d * 0.35, 92) + "px");
    clearTimeout(blob._w); blob._w = setTimeout(() => blob.style.setProperty("--tw", "46px"), 170);
  }
  blob.style.setProperty("--tx", x + "px");
}
window.addEventListener("resize", () => placeTabBlob(false));
(function tabBar() {
  const nav = document.querySelector(".topbar .tabs");
  const blob = nav && nav.querySelector(".tab-blob");
  if (!blob) return;
  const buzz = () => { try { if (window.VidShelfApp && VidShelfApp.haptic) VidShelfApp.haptic(); } catch (e) {} };
  let dragEnded = false;
  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest(".tabs a[data-tab]");
    if (!a) return;
    if (dragEnded) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    buzz();
    // 지금 탭을 한 번 더 누르면 원이 꾹 눌렸다 펴지며 맨 위로 (숏폼은 새로 섞어 보여 줌)
    if (a.classList.contains("on") && currentRootTab() === a.dataset.tab && a.dataset.tab !== "shorts") {
      e.preventDefault(); e.stopImmediatePropagation();
      blob.classList.remove("press"); void blob.offsetWidth; blob.classList.add("press");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, true);
  // 바 위를 옆으로 훑으면 원이 손가락을 따라오고, 놓으면 가장 가까운 탭으로
  let down = null, dragging = false;
  const center = (a) => a.offsetLeft + a.offsetWidth / 2;
  const nearest = (x) => [...nav.querySelectorAll("a[data-tab]")].reduce((b, a) => (!b || Math.abs(center(a) - x) < Math.abs(center(b) - x) ? a : b), null);
  nav.addEventListener("pointerdown", (e) => {
    if (document.body.classList.contains("selecting")) return;
    down = { x: e.clientX, y: e.clientY }; dragging = false;
  });
  nav.addEventListener("pointermove", (e) => {
    if (!down) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    if (!dragging) {
      if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy)) return;
      dragging = true; blob.classList.add("drag");
      try { nav.setPointerCapture(e.pointerId); } catch (er) {}
    }
    const r = nav.getBoundingClientRect(), x = Math.max(26, Math.min(r.width - 26, e.clientX - r.left));
    blob.style.setProperty("--tx", x + "px");
    const n = nearest(x);
    nav.querySelectorAll("a[data-tab]").forEach((a) => a.classList.toggle("near", a === n));
  });
  const end = () => {
    if (dragging) {
      const n = nearest(parseFloat(blob.style.getPropertyValue("--tx")) || 0);
      blob.classList.remove("drag");
      nav.querySelectorAll("a.near").forEach((a) => a.classList.remove("near"));
      dragEnded = true;
      setTimeout(() => { dragEnded = false; if (n && !n.classList.contains("on")) n.click(); else placeTabBlob(true); }, 0);
    }
    down = null; dragging = false;
  };
  nav.addEventListener("pointerup", end);
  nav.addEventListener("pointercancel", end);
})();

// ---------------------------------------------------------------- 테마 (시스템 / 라이트 / 다크)
function themePref() { try { return localStorage.getItem("vs-theme") || "system"; } catch (e) { return "system"; } }
function systemDark() {
  try { return window.VidShelfApp ? VidShelfApp.isSystemDark() : matchMedia("(prefers-color-scheme: dark)").matches; }
  catch (e) { return false; }
}
function applyTheme() {
  const pref = themePref();
  const dark = pref === "dark" || (pref === "system" && systemDark());
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? "#111214" : "#EFEDE8";
  try { if (window.VidShelfApp) VidShelfApp.setDark(dark); } catch (e) {}   // 앱의 상태 표시줄 색도 맞춤
}
function setThemePref(p) { try { localStorage.setItem("vs-theme", p); } catch (e) {} applyTheme(); }
window.onSystemTheme = () => applyTheme();

// 영상을 열 때 그 화면의 영상 순서를 기억 (영상 화면의 이전·다음 버튼용)
document.addEventListener("click", (e) => {
  const a = e.target.closest && e.target.closest('a[href^="#/v/"]');
  if (!a || !$app.contains(a)) return;
  const ids = [];
  $app.querySelectorAll('a[href^="#/v/"]').forEach((x) => { const id = (x.getAttribute("href").match(/^#\/v\/(\d+)/) || [])[1]; if (id && !ids.includes(id)) ids.push(id); });
  try { sessionStorage.setItem("vs_queue", JSON.stringify(ids)); } catch (er) {}
}, true);

// 하단 ‘미디어’ 버튼을 직접 누르면 맨 위부터
document.addEventListener("click", (e) => {
  const a = e.target.closest && e.target.closest('.tabs a[data-tab="media"]');
  if (a) Object.keys(scrollMemory).forEach((k) => { if (k.startsWith("#/media")) delete scrollMemory[k]; });
}, true);

// 숏폼 버튼을 누를 때마다 새 순서로 (이미 숏폼을 보고 있어도)
document.addEventListener("click", (e) => {
  const a = e.target.closest && e.target.closest('.tabs a[data-tab="shorts"]');
  if (!a) return;
  e.preventDefault();
  location.hash = "#/shorts?s=" + (Date.now() % 1000000);
});   // 앱이 시스템 다크 모드 변경을 알려 줌
try { matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme); } catch (e) {}
applyTheme();

/** 막대를 끌어서 재생 위치를 옮기고, 끄는 동안 그 위치의 장면을 미리 보여 줌.
 *  미리보기는 같은 영상을 보이지 않게 하나 더 열어 그 위치로 옮긴 뒤 그림으로 그림 (기기·MEGA·iCloud 모두). */
function attachScrub(track, fill, { duration, onSeek, previewSrc, onDrag, maxBox }) {
  track.classList.add("seekbar");
  const canvas = h("canvas", { width: 176, height: 99 });
  let bubbleW = 176;
  const label = h("span", { class: "scrub-time" });
  const bubble = h("div", { class: "scrub-bubble", "aria-hidden": "true" }, canvas, label);
  track.append(bubble);
  let pv = null, want = null, busy = false, dragging = false, lastT = 0;
  const draw = () => {
    if (!pv || !pv.videoWidth) return;
    // 영상과 같은 화면비로, 정해진 상자 안에 들어가는 크기
    const box = (maxBox && maxBox()) || { w: 176, h: 220 };
    const ratio = pv.videoWidth / pv.videoHeight;
    let w = Math.min(box.w, box.h * ratio), hgt = w / ratio;
    w = Math.round(w); hgt = Math.round(hgt);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(hgt * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(hgt * dpr); }
    canvas.style.width = w + "px"; canvas.style.height = hgt + "px";
    bubbleW = w;
    try { canvas.getContext("2d").drawImage(pv, 0, 0, canvas.width, canvas.height); bubble.classList.add("has-img"); } catch (e) {}
  };
  const seekPreview = (t) => {
    const src = previewSrc && previewSrc();
    if (!src) return;
    if (!pv) {
      pv = document.createElement("video");
      pv.muted = true; pv.preload = "auto"; pv.playsInline = true; pv.src = src;
      pv.addEventListener("seeked", () => { busy = false; draw(); if (want != null && Math.abs(want - pv.currentTime) > 0.5) { const t2 = want; want = null; seekPreview(t2); } });
      pv.addEventListener("loadeddata", draw);
    }
    if (busy) { want = t; return; }   // 앞의 장면을 그리는 중이면 마지막 위치만 기억
    busy = true; want = null;
    try { pv.currentTime = t; } catch (e) { busy = false; }
    setTimeout(() => { busy = false; }, 1500);
  };
  const at = (clientX) => {
    const r = track.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const d = duration() || 0;
    return { f, t: f * d, x: f * r.width, w: r.width };
  };
  const move = (clientX) => {
    const { f, t, x, w } = at(clientX);
    lastT = t;
    fill.style.width = `${f * 100}%`;
    label.textContent = fmtDur(t);
    const half = bubbleW / 2 + 4;
    bubble.style.left = `${Math.min(w - half, Math.max(half, x))}px`;
    seekPreview(t);
    if (onDrag) onDrag(t);
  };
  track.addEventListener("pointerdown", (e) => {
    if (!(duration() > 0)) return;
    e.preventDefault(); e.stopPropagation();
    dragging = true;
    try { track.setPointerCapture(e.pointerId); } catch (er) {}
    track.classList.add("dragging");
    move(e.clientX);
  });
  track.addEventListener("pointermove", (e) => { if (dragging) { e.preventDefault(); move(e.clientX); } });
  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    track.classList.remove("dragging");
    bubble.classList.remove("has-img");
    onSeek(lastT);
  };
  track.addEventListener("pointerup", end);
  track.addEventListener("pointercancel", end);
  track.addEventListener("click", (e) => e.stopPropagation());
  return { isDragging: () => dragging };
}

/** 화면을 못 불러왔을 때: 무슨 일인지 + 다시 시도 / 뒤로 */
function errorView(e, retry) {
  const msg = String((e && e.message) || e || "");
  const nf = /not found|404|찾을 수 없/.test(msg);
  return h("div", { class: "empty err-view" },
    h("p", { class: "err-title" }, nf ? "찾을 수 없습니다" : "불러오지 못했습니다"),
    h("p", { class: "meta" }, nf ? "지워졌거나 다른 곳으로 옮겨졌을 수 있습니다." : msg || "잠시 후 다시 시도해 주세요."),
    h("div", { class: "row", style: "justify-content:center" },
      h("button", { class: "btn primary", onclick: () => (retry ? retry() : route()) }, "다시 시도"),
      history.length > 1 ? h("button", { class: "btn", onclick: () => history.back() }, "뒤로") : null));
}

/** 칸의 ♥ 표시를 바로 바꿈 (목록을 다시 그리지 않고) */
function markFav(el, on) {
  let mark = el.querySelector(".sq-fav, .badge.fav");
  if (on && !mark) { mark = h("span", { class: "sq-fav", "aria-label": "즐겨찾기" }, ico("heart", "filled")); (el.querySelector(".yt-thumb, .tile-img, .thumb") || el).append(mark); }
  if (!on && mark) mark.remove();
}

/** 최근에 붙인 태그 (이 기기에 기억, 최대 12개) */
function recentTags() { try { return JSON.parse(localStorage.getItem("vs-recent-tags") || "[]"); } catch (e) { return []; } }
function rememberTags(names) {
  try {
    const list = recentTags().filter((n) => !names.includes(n));
    localStorage.setItem("vs-recent-tags", JSON.stringify([...names, ...list].slice(0, 12)));
  } catch (e) {}
}

/** 그림 색 따라가기: 썸네일의 대표 색을 뽑아 그 화면의 바탕 빛·강조색으로 */
async function tintFromImage(src) {
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    const N = 24, c = document.createElement("canvas");
    c.width = N; c.height = N;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, 0, 0, N, N);
    const d = g.getImageData(0, 0, N, N).data;
    let r = 0, gg = 0, b = 0, w = 0;
    for (let i = 0; i < d.length; i += 4) {   // 선명하고 너무 어둡거나 밝지 않은 색일수록 무게를 크게
      const R = d[i] / 255, G = d[i + 1] / 255, B = d[i + 2] / 255;
      const mx = Math.max(R, G, B), mn = Math.min(R, G, B), l = (mx + mn) / 2;
      const sat = mx === mn ? 0 : (mx - mn) / (1 - Math.abs(2 * l - 1));
      const wt = sat * sat * Math.max(0, 1 - Math.abs(l - 0.5) * 1.7) + 0.002;
      r += R * wt; gg += G * wt; b += B * wt; w += wt;
    }
    if (w < 0.05) return null;   // 거의 흑백인 그림
    return [r / w, gg / w, b / w];
  } catch (e) { return null; }
}
/** 썸네일 아래쪽 1/3 의 평균 색을 보기 좋은 밝기로 맞춰서 "r g b" */
function ambientOf(img) {
  try {
    const W = 16, H = 16, c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, 0, 0, W, H);
    const d = g.getImageData(0, Math.floor(H * 0.6), W, H - Math.floor(H * 0.6)).data;
    let r = 0, gg = 0, b = 0, w = 0;
    for (let i = 0; i < d.length; i += 4) {
      const R = d[i] / 255, G = d[i + 1] / 255, B = d[i + 2] / 255;
      const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
      const wt = 0.25 + (mx - mn);   // 색이 있는 픽셀을 조금 더
      r += R * wt; gg += G * wt; b += B * wt; w += wt;
    }
    if (!w) return null;
    let [hh, s, l] = rgbToHsl([r / w, gg / w, b / w]);
    const dark = document.documentElement.dataset.theme === "dark";
    s = Math.min(0.75, s * 1.25);
    l = dark ? Math.min(0.5, Math.max(0.28, l)) : Math.min(0.62, Math.max(0.4, l));
    return hslRgbTriplet(hh, s, l);
  } catch (e) { return null; }
}
function rgbToHsl([r, g, b]) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const dd = mx - mn, s = l > 0.5 ? dd / (2 - mx - mn) : dd / (mx + mn);
  const hh = mx === r ? (g - b) / dd + (g < b ? 6 : 0) : mx === g ? (b - r) / dd + 2 : (r - g) / dd + 4;
  return [hh * 60, s, l];
}
const hslCss = (hh, s, l) => `hsl(${Math.round(hh)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
function hslRgbTriplet(hh, s, l) {   // "r g b" (rgb(var(--tint) / .3) 에 쓰임)
  const k = (n) => (n + hh / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return `${f(0)} ${f(8)} ${f(4)}`;
}
function setTint(rgb) {
  if (!rgb) { clearTint(); return; }
  let [hh, s] = rgbToHsl(rgb);
  s = Math.min(0.85, Math.max(0.4, s));
  const dark = document.documentElement.dataset.theme === "dark";
  const b = document.body;
  if (!document.getElementById("tintbg")) b.prepend(h("div", { id: "tintbg", "aria-hidden": "true" }));
  b.style.setProperty("--tint", hslRgbTriplet(hh, s, dark ? 0.45 : 0.62));
  b.style.setProperty("--accent", hslCss(hh, s, dark ? 0.72 : 0.4));
  b.style.setProperty("--accent-ink", dark ? "#121316" : "#ffffff");
  b.classList.add("tinted");
}
function clearTint() {
  const b = document.body;
  b.classList.remove("tinted");
  ["--tint", "--accent", "--accent-ink"].forEach((k) => b.style.removeProperty(k));
}
/** 지금 화면이 그대로일 때만 물들이기 (그 사이 다른 화면으로 갔으면 무시) */
function tintPage(src) {
  if (!src) return;
  const at = location.hash;
  tintFromImage(src).then((rgb) => { if (location.hash === at) setTint(rgb); });
}

const autoNextOn = () => { try { return localStorage.getItem("vs-autonext") !== "0"; } catch (e) { return true; } };

/** 영상을 꾹 누르고 있는 동안 2배속 (손을 떼면 원래 속도) */
function holdFast(box, video) {
  const badge = h("div", { class: "fast-badge", hidden: true }, "2배속 ▶▶");
  box.append(badge);
  let timer = null, on = false, sx = 0, sy = 0, prevRate = 1, suppress = false;
  box.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1 || e.target.closest("button, a, input, .seekbar, .vp-track, .sbar-wrap, .serr")) return;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (video.paused) return;
      on = true; prevRate = video.playbackRate || 1; video.playbackRate = 2; badge.hidden = false;
      try { if (window.VidShelfApp && VidShelfApp.haptic) VidShelfApp.haptic(); else if (navigator.vibrate) navigator.vibrate(15); } catch (er) {}
    }, 450);
  }, { passive: true });
  box.addEventListener("touchmove", (e) => { if (timer && !on && Math.hypot(e.touches[0].clientX - sx, e.touches[0].clientY - sy) > 12) { clearTimeout(timer); timer = null; } }, { passive: true });
  const end = () => {
    clearTimeout(timer); timer = null;
    if (!on) return;
    on = false; video.playbackRate = prevRate; badge.hidden = true;
    suppress = true; setTimeout(() => { suppress = false; }, 400);   // 손을 뗄 때 생기는 ‘누르기’는 무시
  };
  box.addEventListener("touchend", end); box.addEventListener("touchcancel", end);
  box.addEventListener("click", (e) => { if (suppress) { e.stopImmediatePropagation(); e.preventDefault(); suppress = false; } }, true);
  box.addEventListener("contextmenu", (e) => e.preventDefault());
}

/** 목록을 불러오는 동안 보여 줄 회색 틀 */
function skeletonList(mode) {
  if (mode === "wall") {
    const ws = [1.5, 0.75, 1.33, 1, 0.75, 1.78, 1, 1.33, 0.8, 1.5, 1, 0.75];
    return h("div", { class: "mcontent skeleton" }, h("div", { class: "wall" }, ...ws.map((r) => h("div", { class: "tile sk", style: `flex:${r} 1 ${Math.round(r * wallHeight())}px` }, h("div", { class: "tile-img sk-box", style: `aspect-ratio:${r}` })))));
  }
  return h("div", { class: "mcontent skeleton" }, h("div", { class: "ytfeed" }, ...[0, 1, 2].map(() => h("div", { class: "yt sk" },
    h("div", { class: "yt-thumb sk-box", style: "aspect-ratio:16/9" }),
    h("div", { class: "yt-info" }, h("span", { class: "yt-av sk-box" }), h("div", { class: "yt-text" }, h("div", { class: "sk-line", style: "width:70%" }), h("div", { class: "sk-line", style: "width:40%" })))))));
}

/** 빠른 스크롤 막대: 오른쪽 끝을 잡고 끌면 날짜(이름순이면 첫 글자)를 보여 주며 빠르게 이동 */
function attachFastScroll(getLabel) {
  const bubble = h("div", { class: "fs-bubble", hidden: true });
  const thumb = h("div", { class: "fs-thumb" });
  const bar = h("div", { class: "fs-bar", "aria-hidden": "true" }, thumb, bubble);
  document.body.append(bar);
  let hideT = null, dragging = false;
  const range = () => Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
  const top0 = () => 90, track = () => window.innerHeight - 90 - 210;   // 위 제목·아래 버튼 줄과 메뉴를 피한 구간
  const place = () => { thumb.style.transform = `translateY(${top0() + (window.scrollY / range()) * track()}px)`; };
  const label = () => { const t = getLabel(); bubble.hidden = !t; if (t) bubble.textContent = t; bubble.style.transform = thumb.style.transform; };
  const show = () => {
    if (document.documentElement.scrollHeight < window.innerHeight * 3) return;   // 짧은 목록에는 안 보임
    bar.classList.add("on"); place();
    clearTimeout(hideT); if (!dragging) hideT = setTimeout(() => bar.classList.remove("on"), 1300);
  };
  const onScroll = () => { show(); if (dragging) label(); };
  window.addEventListener("scroll", onScroll, { passive: true });
  thumb.addEventListener("touchstart", (e) => { e.stopPropagation(); dragging = true; bar.classList.add("dragging"); clearTimeout(hideT); label(); }, { passive: true });
  thumb.addEventListener("touchmove", (e) => {
    if (!dragging) return;
    e.preventDefault(); e.stopPropagation();
    const f = Math.min(1, Math.max(0, (e.touches[0].clientY - top0() - 24) / track()));
    window.scrollTo({ top: f * range(), behavior: "instant" });
    place(); label();
  }, { passive: false });
  const end = () => { if (!dragging) return; dragging = false; bar.classList.remove("dragging"); bubble.hidden = true; hideT = setTimeout(() => bar.classList.remove("on"), 1300); };
  thumb.addEventListener("touchend", end); thumb.addEventListener("touchcancel", end);
  return () => { window.removeEventListener("scroll", onScroll); bar.remove(); };
}
/** 아래쪽 버튼 줄: 내려 볼 때는 숨고, 조금이라도 위로 올리면 다시 나옴 */
function attachDockHide() {
  let last = window.scrollY, acc = 0;
  const on = () => {
    const y = window.scrollY, d = y - last; last = y;
    if (y < 80) { acc = 0; document.body.classList.remove("dock-down"); return; }
    acc = Math.sign(d) === Math.sign(acc) ? acc + d : d;
    if (acc > 24) document.body.classList.add("dock-down");
    else if (acc < -12) document.body.classList.remove("dock-down");
  };
  window.addEventListener("scroll", on, { passive: true });
  return () => { window.removeEventListener("scroll", on); document.body.classList.remove("dock-down"); };
}

/** 화면 가운데에 있는 칸의 날짜 */
function labelAtCenter() {
  const y = window.innerHeight / 2;
  let el = null;
  for (const x of [window.innerWidth / 2, window.innerWidth / 4, (window.innerWidth * 3) / 4]) { const t = document.elementFromPoint(x, y); el = t && t.closest("[data-when], [data-letter]"); if (el) break; }
  if (!el) return "";
  if (el.dataset.letter != null) return el.dataset.letter || "";
  const ts = +el.dataset.when;
  if (!ts) return "";
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
}

/** 영상을 받아 오는 동안(클라우드 등) 가운데에 도는 로딩 표시 */
function attachLoading(video, box) {
  const sp = h("div", { class: "vloading", hidden: true, "aria-label": "불러오는 중" }, h("i"));
  box.append(sp);
  let t = null;
  const on = () => { clearTimeout(t); t = setTimeout(() => { sp.hidden = false; }, 250); };   // 잠깐 멈칫하는 정도는 표시 안 함
  const off = () => { clearTimeout(t); sp.hidden = true; };
  video.addEventListener("loadstart", () => { if (video.getAttribute("src") && (video.autoplay || !video.paused || video.preload === "auto")) on(); });
  video.addEventListener("waiting", on);
  video.addEventListener("seeking", on);
  ["playing", "canplay", "seeked", "pause", "error", "emptied"].forEach((ev) => video.addEventListener(ev, off));
  video.addEventListener("play", () => { if (video.readyState < 3) on(); });
  return sp;
}

/** 영상 칸을 꾹 누르면 그 자리에서 소리 없이 미리보기 재생 (손을 떼도 계속, 화면에서 벗어나면 멈춤) */
let holdPreviewCur = null;
const holdPreviewWatch = "IntersectionObserver" in window ? new IntersectionObserver((ents) => ents.forEach((e) => {
  if (!e.isIntersecting && holdPreviewCur && holdPreviewCur.cell === e.target) stopHoldPreview();
}), { threshold: 0 }) : null;
function stopHoldPreview() {
  const c = holdPreviewCur;
  if (!c) return;
  holdPreviewCur = null;
  if (holdPreviewWatch) holdPreviewWatch.unobserve(c.cell);
  c.cell.classList.remove("previewing");
  c.video.pause(); c.video.removeAttribute("src"); c.video.load(); c.video.remove();
}
function holdPreview(cell, it) {
  let timer = null, sx = 0, sy = 0, fired = false;
  const cancel = () => { clearTimeout(timer); timer = null; };
  const start = () => {
    stopHoldPreview();
    const thumb = cell.querySelector(".yt-thumb, .thumb, .tile-img") || cell;
    const video = h("video", { class: "hold-preview", muted: true, playsinline: true, loop: true, preload: "auto" });
    video.muted = true;
    video.addEventListener("loadedmetadata", () => {   // 처음은 보통 밋밋해서 조금 들어간 곳부터
      const d = video.duration;
      if (isFinite(d) && d > 20) { try { video.currentTime = d * 0.15; } catch (e) {} }
    }, { once: true });
    video.addEventListener("playing", () => cell.classList.add("previewing"), { once: true });
    video.src = `/media/${it.id}`;
    thumb.append(video);
    video.play().catch(() => {});
    holdPreviewCur = { cell, video };
    if (holdPreviewWatch) holdPreviewWatch.observe(cell);
    try { if (window.VidShelfApp && VidShelfApp.haptic) VidShelfApp.haptic(); else if (navigator.vibrate) navigator.vibrate(18); } catch (e) {}
  };
  cell.addEventListener("touchstart", (e) => {
    fired = false; sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    timer = setTimeout(() => { timer = null; fired = true; start(); }, 420);
  }, { passive: true });
  cell.addEventListener("touchmove", (e) => { if (timer && Math.hypot(e.touches[0].clientX - sx, e.touches[0].clientY - sy) > 10) cancel(); }, { passive: true });
  cell.addEventListener("touchend", (e) => { cancel(); if (fired) e.preventDefault(); });   // 꾹 누른 뒤 손을 떼도 영상이 열리지 않게
  cell.addEventListener("touchcancel", cancel);
  cell.addEventListener("contextmenu", (e) => e.preventDefault());
  cell.addEventListener("click", (e) => { if (fired) { e.preventDefault(); e.stopImmediatePropagation(); fired = false; } }, true);
  return cell;
}

/** 웹 화면이 재생하지 못하는 형식(MKV·HEVC 등)을 앱 내장 플레이어로. 앱이 아니면 false */
const hasNativePlayer = () => !!(window.VidShelfApp && VidShelfApp.playNative);
function playNative(v, pos) {
  if (!hasNativePlayer()) return false;
  try { VidShelfApp.playNative(String(v.id), v.title || "", pos || 0); return true; } catch (e) { return false; }
}
/** 내장 플레이어를 닫으면 본 위치를 저장 */
window.onNativePlayerClosed = (id, pos) => {
  if (pos > 0) api(`videos/${id}/progress`, { method: "POST", body: { pos } }).catch(() => {});
  if (window.__nativeClosed) window.__nativeClosed(id, pos);
};

/** 창 윗부분(손잡이·제목)을 잡고 아래로 끌어내리면 닫힘 */
function dragToClose(sheet, shade, close) {
  let sy = null, dy = 0, t0 = 0;
  const handle = (t) => t.closest(".sheet-grip, .sheet-head") && !t.closest("button, input, a");
  sheet.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1 || !handle(e.target)) { sy = null; return; }
    sy = e.touches[0].clientY; dy = 0; t0 = Date.now();
    sheet.style.animation = "none";   // 올라오는 효과가 남아 있으면 손가락을 따라오지 않음
    sheet.style.transition = "none";
  }, { passive: true });
  sheet.addEventListener("touchmove", (e) => {
    if (sy == null) return;
    e.preventDefault();
    dy = Math.max(0, e.touches[0].clientY - sy);
    sheet.style.transform = `translateY(${dy}px)`;
    shade.style.opacity = String(Math.max(0, 1 - dy / (sheet.offsetHeight || 1)));
  }, { passive: false });
  const end = () => {
    if (sy == null) return;
    sy = null;
    const v = dy / Math.max(1, Date.now() - t0);
    sheet.style.transition = "transform .22s cubic-bezier(.3,.7,.3,1)";
    if (dy > Math.min(140, sheet.offsetHeight * 0.3) || (v > 0.6 && dy > 30)) {
      sheet.classList.add("dragged");
      sheet.style.transform = "translateY(100%)";
      shade.style.transition = "opacity .22s ease"; shade.style.opacity = "0";
      close();
    } else {
      sheet.style.transform = "";
      shade.style.opacity = "";
    }
  };
  sheet.addEventListener("touchend", end);
  sheet.addEventListener("touchcancel", end);
}

/** 아래에서 올라오는 창 (뒤로 가기로 닫힘). 돌려주는 close() 로 닫음 */
function openSheet(title, body, foot) {
  const sheet = h("section", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": title },
    h("div", { class: "sheet-grip", "aria-hidden": "true" }),
    h("div", { class: "sheet-head" }, h("h2", {}, title), h("button", { class: "round-btn", "aria-label": "닫기", onclick: () => close() }, icon("close"))),
    h("div", { class: "sheet-body" }, ...body.filter(Boolean)),
    foot ? h("div", { class: "sheet-foot" }, ...foot) : null);
  const shade = h("div", { class: "sheet-shade", onclick: () => close() });
  let closed = false, after = null;
  const sheetId = Math.random();
  const onPop = () => {
    if (closed || (history.state && history.state.sheet === sheetId)) return;   // 위에 겹친 다른 창이 닫힌 것
    closed = true;
    window.removeEventListener("popstate", onPop);
    sheet.classList.add("out"); shade.classList.add("out");
    setTimeout(() => { sheet.remove(); shade.remove(); document.body.style.overflow = ""; }, 220);
    if (after) setTimeout(after, 0);
  };
  function close(then) { if (closed) return; after = then || null; history.back(); }
  dragToClose(sheet, shade, () => close());
  document.body.append(shade, sheet);
  document.body.style.overflow = "hidden";
  history.pushState({ sheet: sheetId }, "");
  window.addEventListener("popstate", onPop);
  return close;
}

/** 길게 누르면 즐겨찾기 추가/해제 (기기 파일은 갤러리 즐겨찾기에도 반영) */
function longPressFav(el, it) {
  let timer = null, sx = 0, sy = 0, fired = false;
  const cancel = () => { clearTimeout(timer); timer = null; };
  el.addEventListener("touchstart", (e) => {
    fired = false; sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    timer = setTimeout(async () => {
      timer = null; fired = true;
      try { navigator.vibrate && navigator.vibrate(18); } catch (er) {}
      const fav = !it.favorite;
      try {
        await api(`${it.kind === "photo" ? "photos" : "videos"}/${it.id}`, { method: "PATCH", body: { favorite: fav } });
        it.favorite = fav ? 1 : 0;
        let mark = el.querySelector(".sq-fav, .badge.fav");
        if (fav && !mark) { mark = h("span", { class: "sq-fav", "aria-label": "즐겨찾기" }, ico("heart", "filled")); (el.querySelector(".tile-img, .thumb") || el).append(mark); }
        if (!fav && mark) mark.remove();
        el.classList.remove("fav-pop"); void el.offsetWidth; el.classList.add("fav-pop");
        toast(fav ? "즐겨찾기에 넣었습니다" : "즐겨찾기에서 뺐습니다");
      } catch (er) { toast(er.message); }
    }, 520);
  }, { passive: true });
  el.addEventListener("touchmove", (e) => { if (timer && Math.hypot(e.touches[0].clientX - sx, e.touches[0].clientY - sy) > 10) cancel(); }, { passive: true });
  el.addEventListener("touchend", cancel);
  el.addEventListener("touchcancel", cancel);
  el.addEventListener("contextmenu", (e) => e.preventDefault());
  el.addEventListener("click", (e) => { if (fired) { e.preventDefault(); e.stopImmediatePropagation(); fired = false; } }, true);   // 길게 누른 뒤에는 열지 않음
  return el;
}

/** 목록 끝이 화면에 가까워지면 다음 목록을 자동으로 불러옴 (‘더 보기’ 버튼 대신) */
function autoMore(moreEl, loadNext) {
  const mark = h("div", { class: "auto-more", "aria-hidden": "true" }, h("i", { class: "spin" }));
  moreEl.replaceChildren(mark);
  const io = new IntersectionObserver((ents) => {
    if (!ents.some((e) => e.isIntersecting)) return;
    io.disconnect();
    loadNext();
  }, { rootMargin: "900px 0px" });
  io.observe(mark);
}

// ---------------------------------------------------------------- job status bar
let lastPending = -1;
async function pollStatus() {
  try {
    const s = await api("status");
    const bar = document.getElementById("jobbar");
    const busy = s.scanning || s.thumb_pending > 0;
    bar.hidden = !busy;
    if (busy) {
      const txt = s.scanning
        ? (s.scan_found || s.scan_new ? `스캔 중… ${s.scan_found}개 발견, 새 영상 ${s.scan_new}개 · ${s.scan_current || ""}` : (s.scan_current || "작업 중…"))
        : `미리보기 생성 중… 남은 영상 ${s.thumb_pending}개 · ${s.thumb_current || ""}`;
      bar.replaceChildren(h("i", { class: "spin" }), h("span", {}, txt));
    }
    // 썸네일이 새로 만들어졌으면 비어 있는 카드 이미지를 다시 불러옴
    if (lastPending !== -1 && s.thumb_pending !== lastPending) refreshMissingThumbs();
    lastPending = s.thumb_pending;
    setTimeout(pollStatus, busy ? 1500 : 6000);
  } catch (e) {
    setTimeout(pollStatus, 8000);
  }
}
function refreshMissingThumbs() {
  document.querySelectorAll("img[data-retry]").forEach((img) => {
    img.src = img.dataset.retry + "&r=" + Date.now();
  });
}

// ---------------------------------------------------------------- router
window.addEventListener("hashchange", route);
let pageCleanup = null;   // 화면을 떠날 때 정리할 일 (숏폼 영상 멈추기 등)
/** 화면이 바뀔 때 살짝 떠오르며 나타나게 */
function pageIn() {
  if (window.__noPageIn) { window.__noPageIn = false; return; }   // 밀어서 넘어온 경우는 따로 움직임
  const dir = window.__slideDir;   // 밀어서 넘긴 경우 그 방향에서 들어옴
  window.__slideDir = 0;
  $app.classList.remove("page-in", "slide-l", "slide-r");
  void $app.offsetWidth;   // 애니메이션 다시 시작
  $app.classList.add(dir > 0 ? "slide-l" : dir < 0 ? "slide-r" : "page-in");
}
// 새 화면이 다 그려진 뒤에 들어오는 움직임을 줌 (route 끝에서). 예전 화면에 움직임을 주면 깜빡임
/** 하단 탭 버튼을 누르면: 예전 화면을 살짝 감추고, 새 화면이 그려지면 탭 방향에서 들어옴 */
document.addEventListener("click", (e) => {
  const a = e.target.closest && e.target.closest(".tabs a[data-tab]");
  if (!a || document.body.classList.contains("selecting")) return;
  const from = TAB_ORDER.indexOf(currentRootTab() || TAB_GROUP[parseHash().path.slice(1)] || ""), to = TAB_ORDER.indexOf(a.dataset.tab);
  if (to < 0 || (from === to && currentRootTab())) return;
  if (a.getAttribute("href") === location.hash) return;
  window.__tabNav = from < 0 ? 1 : Math.sign(to - from) || 1;
  $app.classList.remove("tab-in", "page-in", "slide-l", "slide-r");
  $app.classList.add("tab-out");
  setTimeout(() => { if ($app.classList.contains("tab-out")) { $app.classList.remove("tab-out"); window.__tabNav = 0; } }, 2500);   // 혹시 화면이 안 바뀌어도 가려진 채로 남지 않게
}, true);
function tabIn(dir) {
  $app.classList.remove("tab-out", "page-in", "slide-l", "slide-r", "tab-in");
  $app.style.setProperty("--tab-dx", `${dir * 26}px`);
  void $app.offsetWidth;
  $app.classList.add("tab-in");
  clearTimeout(tabIn._t); tabIn._t = setTimeout(() => $app.classList.remove("tab-in"), 600);
}

if ("scrollRestoration" in history) history.scrollRestoration = "manual";
function endRestore() {
  clearTimeout(window.__restoreGuard);
  if (!$app.classList.contains("restoring")) return;
  $app.style.minHeight = "";
  $app.classList.remove("restoring");
}
/** 화면별 스크롤 위치 기억 (영상을 보고 뒤로 오면 보던 곳에서 이어서) */
const scrollMemory = {};
let lastHash = location.hash;
async function route(ev) {
  const nav = ev instanceof HashChangeEvent;
  if (lastHash && /^#\/(media|photos|explore)?(\?|$)/.test(lastHash)) scrollMemory[lastHash] = { y: window.scrollY, pages: window.__mediaPages || 1, at: Date.now() };
  lastHash = location.hash;
  window.__mediaSwipe = null; window.__mediaSwipeTarget = null;
  stopHoldPreview();
  clearTint();
  const { path, params } = parseHash();
  stopPlayer();
  if (pageCleanup) { try { pageCleanup(); } catch (e) {} pageCleanup = null; }
  if (window.__fsCleanup) { try { window.__fsCleanup(); } catch (e) {} window.__fsCleanup = null; }
  document.body.classList.remove("shorts-mode", "nav-hidden");
  const mem = scrollMemory[location.hash];
  if (mem && mem.y > 0) {   // 돌아온 화면: 맨 위로 갔다가 내려오지 않도록, 가린 채로 그 위치에 먼저 가 있음
    $app.classList.add("restoring");
    $app.style.minHeight = `${mem.y + window.innerHeight}px`;
    window.scrollTo({ top: mem.y, behavior: "instant" });
    clearTimeout(window.__restoreGuard);
    window.__restoreGuard = setTimeout(endRestore, 4000);   // 혹시 못 불러와도 화면이 계속 가려지지 않게
  } else {
    endRestore();
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  try {
    let m;
    if (path === "/home" || (path === "/" && !location.hash)) return await renderHome();
    if (path === "/" || path === "") return await renderMedia(params, "video");
    if ((m = path.match(/^\/v\/(\d+)$/))) return await renderVideo(+m[1], params);
    if (path === "/tags") { location.replace("#/explore?t=tags"); return; }   // 예전 목록 화면 → 탐색 탭
    if (path === "/performers") { location.replace("#/explore"); return; }
    if (path === "/performer") return await renderPerformer(+params.get("id"));
    if (path === "/settings") return await renderSettings({ section: params.get("section") });
    if (path === "/mega" || path === "/cloud" || path === "/icloud" || path === "/cup") { location.replace("#/library"); return; }   // 뺀 기능 (클라우드 · 최애 월드컵)
    if (path === "/photos") return await renderMedia(params, "photo");
    if (path === "/shorts") return await renderShorts(params);
    if (path === "/library") return await renderLibraryHub();
    if (path === "/stats") return await renderStats();
    if (path === "/explore") return await renderExplore(params);
    if (path === "/search") return await renderSearch(params);
    if (path === "/setup") return await renderSetup();
    if (path === "/media") return await renderMedia(params, params.get("type") || "all");
    if (path === "/duplicates") return await renderDuplicates();
    if (path === "/hidden") return await renderHidden();
    location.hash = "#/";
  } catch (e) {
    if (e.message !== "login required") $app.replaceChildren(errorView(e));
  } finally {
    if (tabSwipePending) finishTabSwipe();   // 밀어서 넘어온 경우 새 화면이 옆에서 들어옴
    else if (window.__tabNav) { const d = window.__tabNav; window.__tabNav = 0; tabIn(d); }
    else if (nav) pageIn();
    $app.classList.remove("tab-out");
  }
}

// ---------------------------------------------------------------- library
const SORT_OPTIONS = [
  ["added", "추가한 날짜"], ["title", "제목"], ["duration", "길이"], ["size", "파일 크기"],
  ["rating", "별점"], ["plays", "재생 횟수"], ["played", "최근 재생"], ["mtime", "파일 날짜"],
  ["resolution", "해상도"], ["random", "무작위"],
];

function libHash(params) {
  const s = params.toString();
  return "#/" + (s ? "?" + s : "");
}

async function renderLibrary(params) {
  setTab("videos");
  const sort = params.get("sort") || "added";
  const order = params.get("order") || (sort === "title" ? "asc" : "desc");
  const update = (changes) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) (v == null || v === "") ? p.delete(k) : p.set(k, v);
    location.hash = libHash(p);
  };

  // 활성 필터(태그/사람) 이름 표시
  const filterChips = [];
  for (const [key, ep] of [["tag", "tags"], ["performer", "performers"]]) {
    for (const id of params.getAll(key)) {
      const e = await api(`${ep}/${id}`).catch(() => ({ name: "#" + id }));
      filterChips.push(h("span", { class: "chip on" }, key === "tag" ? "# " + e.name : [ico("person", "in"), e.name],
        h("button", { title: "필터 해제", onclick: () => {
          const p = new URLSearchParams(params);
          const rest = p.getAll(key).filter((x) => x !== id);
          p.delete(key); rest.forEach((x) => p.append(key, x));
          location.hash = libHash(p);
        } }, ico("close", "x"))));
    }
  }

  let searchTimer;
  const search = h("input", { type: "search", class: "search", placeholder: "제목, 태그, 사람, 경로 검색",
    value: params.get("q") || "",
    oninput: (e) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { typingSearch = true; update({ q: e.target.value }); }, 400); } });
  const sortSel = h("select", { onchange: (e) => update({ sort: e.target.value, order: null }) },
    SORT_OPTIONS.map(([v, l]) => h("option", { value: v, selected: v === sort }, l)));
  const orderBtn = h("button", { class: "btn", title: "정렬 방향", hidden: sort === "random",
    onclick: () => update({ order: order === "asc" ? "desc" : "asc" }) }, order === "asc" ? "↑ 오름차순" : "↓ 내림차순");
  const toggles = [
    ["fav", "즐겨찾기"], ["unwatched", "안 본 영상"], ["missing", "찾을 수 없는 파일"],
  ].map(([k, l]) => h("button", { class: "chip" + (params.get(k) === "1" ? " on" : ""),
    onclick: () => update({ [k]: params.get(k) === "1" ? null : "1" }) }, l));
  const reshuffle = sort === "random" ? h("button", { class: "btn", onclick: () => update({ seed: Date.now() % 100000 }) }, ico("shuffle", "in"), "섞기") : null;

  const countEl = h("span", { class: "meta" });
  const mode = viewMode("videos");
  const grid = h("div", { class: mode === "wall" ? "wall" : "grid" });
  const moreWrap = h("div", { class: "more" });
  $app.replaceChildren(
    h("div", { class: "toolbar" }, mediaSeg("video")),
    h("div", { class: "toolbar" }, search, sortSel, orderBtn, reshuffle, modeToggle("videos", () => route())),
    h("div", { class: "toolbar" }, h("div", { class: "chips" }, toggles, filterChips), countEl),
    grid, moreWrap);

  let page = 1;
  const base = new URLSearchParams(params);
  base.set("sort", sort); base.set("order", order);
  if (sort === "random" && !base.get("seed")) base.set("seed", "7");

  async function load() {
    base.set("page", page);
    const data = await api("videos?" + base.toString());
    countEl.textContent = `${data.total.toLocaleString()}개`;
    if (page === 1 && data.total === 0) {
      const st = await api("settings");
      grid.replaceWith(h("div", { class: "empty" },
        st.library_paths.length
          ? (params.toString() ? "조건에 맞는 영상이 없습니다." : "영상이 아직 없습니다. 스캔이 끝날 때까지 기다리거나 설정에서 스캔을 실행하세요.")
          : h("div", {}, h("p", {}, "아직 라이브러리 폴더가 없습니다."),
              h("a", { class: "btn primary", href: "#/settings" }, "폴더 추가하러 가기"))));
      return;
    }
    data.items.forEach((v) => grid.append(mode === "wall" ? videoTile(v) : videoCard(v)));
    const shown = (page - 1) * data.per + data.items.length;
    moreWrap.replaceChildren(shown < data.total
      ? (autoMore(moreWrap, () => { page++; load(); }), moreWrap.firstChild)
      : "");
  }
  await load();
  keepTypingFocus(search);
}

// ---------------------------------------------------------------- 미디어 탭: 전체 / 동영상 / 사진
function mediaSeg(cur) {
  return h("div", { class: "seg media-seg", role: "tablist", "aria-label": "미디어 종류" },
    h("a", { class: cur === "all" ? "on" : "", href: "#/media", role: "tab", "aria-selected": cur === "all" ? "true" : "false" }, "전체"),
    h("a", { class: cur === "video" ? "on" : "", href: "#/", role: "tab", "aria-selected": cur === "video" ? "true" : "false" }, "동영상"),
    serverCaps.photos === false ? null : h("a", { class: cur === "photo" ? "on" : "", href: "#/photos", role: "tab", "aria-selected": cur === "photo" ? "true" : "false" }, "사진"));
}

const MEDIA_SORTS = [["added", "추가한 날짜"], ["title", "이름"], ["size", "파일 크기"], ["rating", "별점"], ["random", "무작위"]];
const VIDEO_SORTS = [["duration", "길이"], ["plays", "재생 횟수"], ["played", "최근 재생"]];
const FILTER_KEYS = ["q", "performer", "tag", "fav", "unwatched", "xperformer", "xtag", "dur", "when", "res", "rating", "unorganized", "folder"];
/** 갤러리처럼 폴더(앨범) 목록. 잠깐 기억해 두고 다시 씀 */
let albumsCache = null, albumsAt = 0;
async function getAlbums() {
  if (albumsCache && Date.now() - albumsAt < 60_000) return albumsCache;
  albumsCache = await api("albums").catch(() => albumsCache || []);
  albumsAt = Date.now();
  return albumsCache;
}
const folderName = (path) => { const t = (path || "").replace(/\/+$/, ""); return t ? t.slice(t.lastIndexOf("/") + 1) : "내장 메모리"; };
const folderHref = (path) => "#/media?folder=" + encodeURIComponent(path);
/** 폴더 칸: 대표 그림 + 이름 + 개수 */
function albumCard(a) {
  const c = a.cover;
  const src = !c ? null : c.kind === "photo" ? hdSrc(`/photothumb/${c.id}.jpg`) : c.thumbs > 0 ? hdSrc(thumbUrl(c.id, 0, c.thumbs)) : null;
  const img = src ? h("img", { src, loading: "lazy", alt: "" }) : null;
  if (img) img.onerror = () => img.replaceWith(ico("folder"));
  const n = [a.videos ? `영상 ${a.videos.toLocaleString()}` : "", a.photos ? `사진 ${a.photos.toLocaleString()}` : ""].filter(Boolean).join(" · ");
  return h("a", { class: "album", href: folderHref(a.path), title: a.path },
    h("span", { class: "album-cov" }, img || ico("folder"), a.source && a.source !== "local" ? h("span", { class: "album-src" }, ico("cloud")) : null),
    h("b", {}, a.name), h("span", { class: "meta" }, n));
}
/** 범위 조건 (주소에는 알아보기 쉬운 이름으로, 서버에는 숫자로) */
const RANGE_OPTS = {
  dur: [["s", "1분 미만", 0, 60], ["m", "1~5분", 60, 300], ["l", "5~20분", 300, 1200], ["xl", "20분 이상", 1200, 0]],
  when: [["7", "최근 7일"], ["30", "최근 30일"], ["365", "최근 1년"]],
  res: [["720", "720p 이상"], ["1080", "1080p 이상"], ["2160", "4K"]],
  rating: [["3", "★3 이상"], ["4", "★4 이상"], ["5", "★5"]],
};
const rangeLabel = (k, v) => ((RANGE_OPTS[k] || []).find((x) => x[0] === v) || [0, v])[1];
/** 화면 주소의 조건 → 서버에 보낼 조건 */
function toServerParams(p) {
  const out = new URLSearchParams(p);
  const d = RANGE_OPTS.dur.find((x) => x[0] === out.get("dur"));
  if (d) { if (d[2]) out.set("min_dur", d[2]); if (d[3]) out.set("max_dur", d[3]); }
  if (out.get("when")) out.set("from", String(Math.floor(Date.now() / 1000) - (+out.get("when")) * 86400));
  if (out.get("res")) out.set("min_h", out.get("res"));
  if (out.get("rating")) out.set("min_rating", out.get("rating"));
  ["dur", "when", "res", "rating"].forEach((k) => out.delete(k));
  return out;
}

/** 좌우로 밀기 감지 (가로로 넘기는 줄·입력칸에서 시작한 경우는 무시). dir: +1 = 다음(왼쪽으로 밂), -1 = 이전 */
function onSwipe(el, cb) {
  let sx = null, sy = null, t0 = 0;
  el.addEventListener("touchstart", (e) => {
    const tgt = e.target;
    if (e.touches.length !== 1 || tgt.closest("input, textarea, select, .shelf-row, .pick-people, .framestrip, .viewer, .sheet, video")) { sx = null; return; }
    for (let n = tgt; n && n !== el; n = n.parentElement) {   // 가로로 스크롤되는 곳은 그 스크롤에 맡김
      if (n.scrollWidth > n.clientWidth + 4 && getComputedStyle(n).overflowX !== "visible" && getComputedStyle(n).overflowX !== "hidden") { sx = null; return; }
    }
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; t0 = Date.now();
  }, { passive: true });
  el.addEventListener("touchend", (e) => {
    if (sx == null) return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    sx = null;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6 && Date.now() - t0 < 700) cb(dx < 0 ? 1 : -1);
  }, { passive: true });
}

// ---------------------------------------------------------------- 하단 탭 사이를 좌우로 밀어 이동 (갤러리처럼 손가락을 따라옴)
const TAB_ORDER = ["home", "media", "shorts", "explore", "library"];
const TAB_HASH = { home: "#/home", media: "#/media", shorts: () => "#/shorts?s=" + (Date.now() % 1000000), explore: "#/explore", library: "#/library" };
/** 지금 화면이 하단 탭의 첫 화면이면 그 탭 이름 (영상 화면·설정 등에서는 밀기 없음) */
function currentRootTab() {
  const p = parseHash().path;
  if (p === "/home" || (p === "/" && !location.hash)) return "home";
  if (p === "/media" || p === "/" || p === "/photos") return "media";
  if (p === "/shorts") return "shorts";
  if (p === "/explore") return "explore";
  if (p === "/library") return "library";
  return null;
}
let tabSwipePending = 0;
function finishTabSwipe() {
  if (!tabSwipePending) return;
  const dir = tabSwipePending;
  tabSwipePending = 0;
  window.__noPageIn = false;
  // 화면 전체(#app)를 움직이면 아래 고정 버튼 줄이 엉뚱한 곳에 갔다가 튀므로, 안쪽 내용만 움직임
  $app.style.transition = "none";
  $app.style.transform = "";
  $app.style.opacity = "";
  tabIn(dir * 3);
}
(function tabSwipe() {
  let sx = 0, sy = 0, t0 = 0, mode = null, from = null, dx = 0, moving = null;
  const W = () => window.innerWidth;
  const blocked = (tgt) => {
    if (tgt.closest("input, textarea, select, .sheet, .viewer, .modal, .seekbar, .swipe-wrap")) return true;
    for (let n = tgt; n && n !== document.body; n = n.parentElement) {   // 가로로 스크롤되는 줄은 그 줄이 먼저
      if (n.scrollWidth > n.clientWidth + 4) { const ox = getComputedStyle(n).overflowX; if (ox === "auto" || ox === "scroll") return true; }
    }
    return false;
  };
  document.addEventListener("touchstart", (e) => {
    mode = null; from = null;
    if (e.touches.length !== 1 || tabSwipePending) return;
    from = currentRootTab();
    if (!from || !$app.contains(e.target) || blocked(e.target)) { from = null; return; }
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; t0 = Date.now(); dx = 0;
  }, { passive: true });
  document.addEventListener("touchmove", (e) => {
    if (!from) return;
    const x = e.touches[0].clientX - sx, y = e.touches[0].clientY - sy;
    if (!mode) {
      if (Math.abs(x) < 10 && Math.abs(y) < 10) return;
      mode = Math.abs(x) > Math.abs(y) * 1.2 ? "h" : "v";   // 처음 움직인 방향으로 고정
      if (mode === "v") { from = null; return; }
      $app.style.transition = "none";
    }
    e.preventDefault();
    const i = TAB_ORDER.indexOf(from);
    const inner = window.__mediaSwipeTarget ? window.__mediaSwipeTarget(x < 0 ? 1 : -1) : null;   // 미디어 탭: 전체·동영상·사진 사이면 목록만 움직임
    if ((inner || $app) !== moving) {
      if (moving) { moving.style.transform = ""; moving.style.opacity = ""; }
      $app.style.transform = ""; $app.style.opacity = "";
      moving = inner || $app;
      moving.style.transition = "none";
    }
    const edge = !inner && ((x > 0 && i === 0) || (x < 0 && i === TAB_ORDER.length - 1));
    dx = edge ? x * 0.25 : x;   // 처음·마지막 탭에서는 살짝만 끌림
    moving.style.transform = `translateX(${dx}px)`;
    moving.style.opacity = String(1 - Math.min(0.35, Math.abs(dx) / W() * 0.5));
  }, { passive: false });
  // 화면이 손가락 동작을 중간에 가져가면(세로 스크롤 등) 제자리로 돌려놓음
  document.addEventListener("touchcancel", () => {
    if (!from || mode !== "h") { from = null; return; }
    from = null;
    if (moving && moving !== $app) { moving.style.transform = ""; moving.style.opacity = ""; }
    moving = null;
    $app.style.transition = "transform .22s cubic-bezier(.3,.7,.3,1), opacity .22s ease";
    $app.style.transform = "";
    $app.style.opacity = "";
    setTimeout(() => { $app.style.transition = ""; }, 240);
  });
  document.addEventListener("touchend", () => {
    if (!from || mode !== "h") { from = null; return; }
    const i = TAB_ORDER.indexOf(from);
    const v = Math.abs(dx) / Math.max(1, Date.now() - t0);   // 빠르게 튕기면 짧게 밀어도 넘어감
    const dir = dx < 0 ? 1 : -1;
    const target = TAB_ORDER[i + dir];
    const far = Math.abs(dx) > W() * 0.28 || (v > 0.5 && Math.abs(dx) > 40);
    from = null;
    $app.style.transition = "transform .22s cubic-bezier(.3,.7,.3,1), opacity .22s ease";
    const mv = moving; moving = null;
    if (mv && mv !== $app) {   // 미디어 탭 안에서 전체 ↔ 동영상 ↔ 사진: 목록만 밀려 나가고 새 목록이 들어옴
      mv.style.transition = "transform .2s cubic-bezier(.3,.7,.3,1), opacity .2s ease";
      if (far && window.__mediaSwipe) {
        mv.style.transform = `translateX(${-dir * W() * 0.5}px)`; mv.style.opacity = "0";
        setTimeout(() => window.__mediaSwipe(dir), 120);
      } else {
        mv.style.transform = ""; mv.style.opacity = "";
        setTimeout(() => { mv.style.transition = ""; }, 220);
      }
      return;
    }
    if (target && (Math.abs(dx) > W() * 0.28 || (v > 0.5 && Math.abs(dx) > 40))) {
      $app.style.transform = `translateX(${-dir * W()}px)`;   // 끝까지 밀려 나감
      $app.style.opacity = "0";
      tabSwipePending = dir;
      setTimeout(() => {
        const hash = typeof TAB_HASH[target] === "function" ? TAB_HASH[target]() : TAB_HASH[target];
        window.__noPageIn = true;
        location.hash = hash;
      }, 200);
    } else {
      $app.style.transform = "";   // 제자리로
      $app.style.opacity = "";
      setTimeout(() => { $app.style.transition = ""; }, 240);
    }
  });
})();

/** 같은 탭 안 다른 모드로 이동 (밀어서 넘길 때 그 방향으로 들어오게) */
function slideTo(hash, dir) {
  window.__slideDir = dir;
  location.hash = hash;
}

/** 선택 모드: 길게 누르면 선택, 이어서 누르면 더 고르기, 고른 항목을 한꺼번에 수정.
 *  opts: holder(위쪽 막대 자리), refresh(바뀐 뒤 다시 그리기), performers, tags */
function makeSelection(opts) {
// ---- 선택 모드: 길게 누르면 선택, 이어서 누르면 더 고르기, 고른 항목을 한꺼번에 수정
const selected = new Map();   // "kind:id" → 항목
const keyOf = (it) => `${it.kind}:${it.id}`;
const cells = new Map();      // "kind:id" → 칸
const selCount = h("b");
const selBar = h("div", { class: "sel-bar", hidden: true },
  h("button", { class: "round-btn", "aria-label": "선택 취소", onclick: () => endSelect() }, icon("close")),
  h("span", { class: "sel-count" }, selCount, "개 선택"),
  h("button", { class: "btn sm", onclick: () => { cells.forEach((el, k) => { if (!selected.has(k)) toggleSel(el._item, el); }); } }, "모두 선택"));
const act = (label, name, fn) => h("button", { class: "sel-act", onclick: fn }, ico(name), label);
const actBar = h("div", { class: "sel-actions", hidden: true },
  act("태그", "tag", () => editLinks("tags")),
  act("사람", "person", () => editLinks("performers")),
  act("날짜", "calendar", () => editDate()),
  act("즐겨찾기", "heart", () => editFav()),
  act("정리 완료", "done", () => applyBatch({ organized: true }, "{n}개를 정리 완료로 표시했습니다")),
  act("삭제", "trash", () => editDelete()));
opts.holder.append(selBar);   // 아래 버튼 막대는 움직임 효과가 걸린 화면 밖(body)에 붙여야 화면 맨 아래에 고정됨
let selecting = false;
function onSelPop() { if (selecting) endSelect(false, true, true); }
function startSelect() {
  selecting = true;
  selected.clear();
  history.pushState({ vsSel: true }, "");   // 뒤로 가기를 누르면 이전 화면이 아니라 선택 모드만 끝남
  window.addEventListener("popstate", onSelPop);
  document.body.classList.add("selecting");
  if (!actBar.isConnected) document.body.append(actBar);
  selBar.hidden = false; actBar.hidden = false;
  pageCleanup = () => endSelect(true);
}
function endSelect(silent, animate, fromPop) {
  if (!selecting && !fromPop) return;
  selecting = false;
  window.removeEventListener("popstate", onSelPop);
  if (!fromPop && !silent && history.state && history.state.vsSel) history.back();   // 넣어 둔 기록을 정리
  selected.clear();
  cells.forEach((el) => el.classList.remove("sel"));
  document.body.classList.remove("selecting");
  const finish = () => { selBar.hidden = true; actBar.hidden = true; actBar.remove(); selBar.classList.remove("leaving"); actBar.classList.remove("leaving"); };
  if (animate) {   // 막대들이 부드럽게 사라지고 원래 버튼·하단 메뉴가 돌아옴
    selBar.classList.add("leaving"); actBar.classList.add("leaving");
    setTimeout(finish, 220);
  } else finish();
  if (!silent) pageCleanup = null;
}
function toggleSel(it, el) {
  const k = keyOf(it);
  if (selected.has(k)) { selected.delete(k); el.classList.remove("sel"); } else { selected.set(k, it); el.classList.add("sel"); }
  selCount.textContent = selected.size;
  if (!selected.size) { endSelect(false, true); return; }   // 하나도 안 남으면 선택 모드 끝
}
function selectable(el, it, peek) {   // peek: 유튜브식 보기에서만 꾹 누르면 미리보기 카드, 그 밖에는 바로 선택 모드
  el._item = it;
  cells.set(keyOf(it), el);
  if (selected.has(keyOf(it))) el.classList.add("sel");
  let timer = null, sx = 0, sy = 0, fired = false;
  const cancel = () => { clearTimeout(timer); timer = null; };
  el.addEventListener("touchstart", (e) => {
    fired = false; sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    if (selecting) return;
    timer = setTimeout(() => {   // 길게 누르면 미리보기 카드 (여기서 바로 정리하거나 ‘선택’으로 여러 개 고르기)
      timer = null; fired = true;
      try { if (window.VidShelfApp && VidShelfApp.haptic) VidShelfApp.haptic(); else if (navigator.vibrate) navigator.vibrate(18); } catch (er) {}
      if (peek) openPeek(it, el); else { startSelect(); toggleSel(it, el); }
    }, 450);
  }, { passive: true });
  el.addEventListener("touchmove", (e) => { if (timer && Math.hypot(e.touches[0].clientX - sx, e.touches[0].clientY - sy) > 10) cancel(); }, { passive: true });
  el.addEventListener("touchend", cancel);
  el.addEventListener("touchcancel", cancel);
  el.addEventListener("contextmenu", (e) => { e.preventDefault(); if (!selecting && !fired) { fired = true; if (peek) openPeek(it, el); else { startSelect(); toggleSel(it, el); } } });
  el._unfire = () => { fired = false; };   // 미리보기 카드의 ‘열기’가 막히지 않게
  el.addEventListener("click", (e) => {   // 선택 모드에서는 열지 않고 고르기
    if (fired) { e.preventDefault(); e.stopImmediatePropagation(); fired = false; return; }
    if (selecting) { e.preventDefault(); e.stopImmediatePropagation(); toggleSel(it, el); }
  }, true);
  return el;
}
const selItems = () => [...selected.values()].map((it) => ({ kind: it.kind, id: it.id }));
async function applyBatch(body, msg, quiet) {   // quiet: 한 개만 바꾼 경우 목록을 다시 그리지 않음 (보던 위치 유지)
  try {
    if (body.add_tags) rememberTags(body.add_tags);
    const r = await api("batch", { method: "POST", body: { items: selItems(), ...body } });
    toast(msg.replace("{n}", r.updated), r.undo && r.undo.length ? { label: "되돌리기", fn: async () => {   // 방금 바꾼 것을 원래대로
      try { await api("batch/restore", { method: "POST", body: { undo: r.undo } }); toast("되돌렸습니다"); if (!quiet) opts.refresh(); } catch (e) { toast(e.message); }
    } } : null);
    endSelect();
    if (!selecting) selected.clear();   // 미리보기 카드에서 한 개만 고친 경우
    if (!quiet) opts.refresh();
  } catch (e) { toast(e.message); }
}

/** 태그·사람: 선택한 항목에 붙은 것은 빼고, 새로 넣을 것은 추가 */
async function editLinks(field) {
  const label = field === "tags" ? "태그" : "출연한 사람";
  const info = await api("batch/info", { method: "POST", body: { items: selItems() } }).catch(() => null);
  if (!info) return;
  const remove = new Set(), add = new Set();
  const curBox = h("div", { class: "chips" });
  const drawCur = () => curBox.replaceChildren(...(info[field].length ? info[field].map((t) => {
    const off = remove.has(t.id);
    return h("button", { class: "chip" + (off ? " struck" : ""), "aria-pressed": off ? "true" : "false",
      onclick: () => { off ? remove.delete(t.id) : remove.add(t.id); drawCur(); } },
      (field === "tags" ? "#" : "") + t.name, h("span", { class: "meta" }, ` ${t.count}/${info.total}`), off ? ico("close", "in") : null);
  }) : [h("span", { class: "meta" }, `선택한 항목에 붙은 ${label}이(가) 없습니다.`)]));
  const all = (field === "tags" ? opts.tags : opts.performers) || [];
  const addBox = h("div", { class: "chips" });
  const drawAdd = () => addBox.replaceChildren(...[...add].map((n) => h("span", { class: "chip on" }, (field === "tags" ? "#" : "") + n,
    h("button", { "aria-label": `${n} 빼기`, onclick: () => { add.delete(n); drawAdd(); } }, ico("close", "x")))));
  const listId = "dl-batch-" + field;
  const input = h("input", { type: "text", list: listId, placeholder: `추가할 ${label} 이름 (Enter)`, "aria-label": `추가할 ${label}` });
  const addName = () => { input.value.split(",").map((x) => x.trim()).filter(Boolean).forEach((n) => add.add(n)); input.value = ""; drawAdd(); };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addName(); } });
  const quick = all.slice().sort((a, b) => ((b.count || 0) + (b.photo_count || 0)) - ((a.count || 0) + (a.photo_count || 0))).slice(0, 12)
    .map((t) => h("button", { class: "chip", onclick: () => { add.add(t.name); drawAdd(); } }, "+ " + (field === "tags" ? "#" : "") + t.name));
  drawCur(); drawAdd();
  const close = openSheet(`${label} 한꺼번에 고치기 · ${selected.size}개`, [
    h("div", { class: "sheet-sec" }, h("h3", {}, `붙어 있는 ${label} (누르면 빼기)`), curBox),
    h("div", { class: "sheet-sec" }, h("h3", {}, `추가할 ${label}`), addBox, h("div", { class: "taginput" }, input, h("button", { class: "btn", onclick: addName }, "추가")),
      h("datalist", { id: listId }, all.map((t) => h("option", { value: t.name }))),
      quick.length ? h("div", { class: "chips", style: "margin-top:4px" }, ...quick) : null),
  ], [
    h("button", { class: "btn", onclick: () => close() }, "취소"),
    h("button", { class: "btn primary sheet-go", onclick: () => {
      if (input.value.trim()) addName();
      if (!add.size && !remove.size) { close(); return; }
      close(() => applyBatch({ ["add_" + field]: [...add], ["remove_" + field]: [...remove] }, `${label}${field === "tags" ? "를" : "을"} {n}개 항목에 반영했습니다`));
    } }, "적용"),
  ]);
}

/** 날짜: 선택한 항목의 날짜를 한꺼번에 바꾸기 (정렬·사진 정보에 쓰임) */
function editDate() {
  const first = [...selected.values()][0] || {};
  const ts = first.taken || first.added_at || Date.now() / 1000;
  const d = new Date(ts * 1000), pad = (n) => String(n).padStart(2, "0");
  const input = h("input", { type: "datetime-local", value: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`, "aria-label": "날짜와 시간" });
  const close = openSheet(`날짜 바꾸기 · ${selected.size}개`, [
    h("p", { class: "meta", style: "margin:0" }, "고른 사진·영상의 날짜를 아래 날짜로 바꿉니다. ‘추가한 날짜’ 정렬과 사진의 촬영 날짜에 쓰입니다. 파일 자체는 바뀌지 않습니다."),
    input,
    h("button", { class: "btn", onclick: () => close(() => applyBatch({ date: 0 }, "{n}개 항목을 원래 날짜로 되돌렸습니다")) }, "원래 날짜로 되돌리기"),
  ], [
    h("button", { class: "btn", onclick: () => close() }, "취소"),
    h("button", { class: "btn primary sheet-go", onclick: () => {
      const t = new Date(input.value).getTime();
      if (!t) { toast("날짜를 고르세요"); return; }
      close(() => applyBatch({ date: Math.round(t / 1000) }, "{n}개 항목의 날짜를 바꿨습니다"));
    } }, "적용"),
  ]);
}

function editFav() {
  const allFav = [...selected.values()].every((it) => it.favorite);
  const close = openSheet(`즐겨찾기 · ${selected.size}개`, [
    h("p", { class: "meta", style: "margin:0" }, "기기 사진·영상은 갤러리 즐겨찾기에도 반영됩니다."),
  ], [
    h("button", { class: "btn", onclick: () => close(() => applyBatch({ favorite: false }, "{n}개를 즐겨찾기에서 뺐습니다")) }, "즐겨찾기에서 빼기"),
    h("button", { class: "btn primary sheet-go", onclick: () => close(() => applyBatch({ favorite: true }, "{n}개를 즐겨찾기에 넣었습니다")) }, ico("heart", "in"), allFav ? "이미 모두 즐겨찾기" : "즐겨찾기에 넣기"),
  ]);
}

/** 삭제: 기기 파일은 휴지통으로 옮기거나 영구 삭제 (안드로이드가 한 번 확인), 클라우드 항목은 목록에서 숨김 */
function editDelete() {
  const list = [...selected.values()];
  const cloud = list.filter((it) => it.source && it.source !== "local").length;
  const reloadSoon = () => {   // 확인 창을 닫고 돌아오면 목록을 새로 고침
    const onVis = () => { if (document.visibilityState === "visible") { document.removeEventListener("visibilitychange", onVis); setTimeout(() => opts.refresh(), 600); } };
    document.addEventListener("visibilitychange", onVis);
    setTimeout(() => opts.refresh(), 2500);
  };
  const run = async (mode) => {
    try {
      const r = await api("batch", { method: "POST", body: { items: selItems(), delete: mode } });
      if (cloud === list.length) {   // 클라우드 항목만: 목록에서 숨긴 것이라 되돌릴 수 있음
        toast(`${list.length}개를 목록에서 숨겼습니다`, { label: "되돌리기", fn: async () => {
          try { await api("batch/restore", { method: "POST", body: { undo: r.undo } }); toast("되돌렸습니다"); opts.refresh(); } catch (e) { toast(e.message); }
        } });
        endSelect(); opts.refresh();
        return;
      }
      toast(mode === "trash" ? "휴지통으로 옮깁니다. 확인 창에서 허용하세요." : "영구 삭제합니다. 확인 창에서 허용하세요.");
      endSelect(); reloadSoon();
    } catch (e) { toast(e.message); }
  };
  const close = openSheet(`삭제 · ${list.length}개`, [
    h("p", { class: "meta", style: "margin:0" }, "휴대폰의 실제 파일을 지웁니다. 안드로이드가 한 번 더 확인합니다."),
    h("button", { class: "del-opt", onclick: () => close(() => run("trash")) },
      h("b", {}, "휴지통으로 옮기기"), h("span", { class: "meta" }, "갤러리 휴지통에서 약 30일 동안 되살릴 수 있습니다.")),
    h("button", { class: "del-opt danger", onclick: () => { if (confirm(`${list.length}개를 영구 삭제할까요? 되돌릴 수 없습니다.`)) close(() => run("delete")); } },
      h("b", {}, "영구 삭제"), h("span", { class: "meta" }, "바로 지워지고 되돌릴 수 없습니다.")),
    cloud ? h("p", { class: "meta", style: "margin:0" }, `MEGA·iCloud 항목 ${cloud}개는 공유 링크라 지울 수 없어서, 이 앱 목록에서만 숨깁니다 (설정 → 정리 → 숨긴 영상에서 되돌릴 수 있음).`) : null,
  ], [h("button", { class: "btn", style: "grid-column: 1 / -1", onclick: () => close() }, "취소")]);
}

  // ---- 미리보기 카드: 꾹 누르면 작게 재생되고, 그 자리에서 즐겨찾기·태그·사람·정리 완료
  function openPeek(it, el) {
    const ph = it.kind === "photo";
    const one = () => { selected.clear(); selected.set(keyOf(it), it); };   // 아래 기능들은 ‘고른 항목’에 적용되므로 이 하나만 고른 것으로
    const media = ph ? h("img", { src: `/photo/${it.id}`, alt: "" })
      : h("video", { src: `/media/${it.id}`, muted: true, autoplay: true, loop: true, playsinline: true, poster: it.thumbs > 0 ? thumbUrl(it.id, 0, it.thumbs) : null });
    if (!ph) {
      media.muted = true;
      media.addEventListener("loadedmetadata", () => { if (isFinite(media.duration) && media.duration > 20) { try { media.currentTime = media.duration * 0.15; } catch (e) {} } }, { once: true });
    }
    const qa = (name, label, fn, on) => h("button", { class: "peek-act" + (on ? " on" : ""), onclick: fn }, h("i", { "aria-hidden": "true" }, ico(name)), label);
    const recent = recentTags().slice(0, 8);
    const close = openSheet(it.title || (ph ? "사진" : "영상"), [
      h("div", { class: "peek-media" + (ph ? " photo" : "") }, media,
        !ph ? h("span", { class: "peek-note" }, ico("play", "in"), "미리보기 · 소리 없음") : null),
      h("div", { class: "peek-acts" },
        qa("heart", it.favorite ? "즐겨찾기 빼기" : "즐겨찾기", () => close(() => { one(); applyBatch({ favorite: !it.favorite }, it.favorite ? "즐겨찾기에서 뺐습니다" : "즐겨찾기에 넣었습니다", true); it.favorite = it.favorite ? 0 : 1; markFav(el, it.favorite); }), !!it.favorite),
        qa("tag", "태그", () => close(() => { one(); editLinks("tags"); })),
        qa("person", "사람", () => close(() => { one(); editLinks("performers"); })),
        qa("done", "정리 완료", () => close(() => { one(); applyBatch({ organized: true }, "정리 완료로 표시했습니다", true); if (opts.onOrganized) opts.onOrganized(el.closest(".swipe-wrap") || el); })),
        qa("select", "선택", () => close(() => { startSelect(); toggleSel(it, el); })),
        qa("play", "열기", () => close(() => { if (ph) { if (el._unfire) el._unfire(); el.dispatchEvent(new MouseEvent("click", { bubbles: true })); } else location.hash = `#/v/${it.id}`; }))),
      recent.length ? h("div", { class: "sheet-sec" }, h("h3", {}, "최근 쓴 태그 · 누르면 바로 붙음"),
        h("div", { class: "chips" }, ...recent.map((n) => h("button", { class: "chip dashed", onclick: () => close(() => { one(); applyBatch({ add_tags: [n] }, `#${n} 태그를 붙였습니다`, true); }) }, "+ #" + n)))) : null,
    ]);
  }

  // ---- 목록에서 옆으로 밀기: 오른쪽 = 즐겨찾기, 왼쪽 = 정리 완료
  function swipeActions(cell, it) {
    const under = h("div", { class: "swipe-under", "aria-hidden": "true" }, h("span", { class: "su-fav" }, ico("heart", "in filled"), "즐겨찾기"), h("span", { class: "su-done" }, ico("done", "in"), "정리 완료"));
    const wrap = h("div", { class: "swipe-wrap" }, under, cell);
    let sx = 0, sy = 0, dx = 0, mode = null, moved = false;
    wrap.addEventListener("touchstart", (e) => { if (selecting || e.touches.length !== 1) { mode = "x"; return; } sx = e.touches[0].clientX; sy = e.touches[0].clientY; dx = 0; mode = null; moved = false; }, { passive: true });
    wrap.addEventListener("touchmove", (e) => {
      if (mode === "x" || mode === "v") return;
      const x = e.touches[0].clientX - sx, y = e.touches[0].clientY - sy;
      if (!mode) { if (Math.abs(x) < 10 && Math.abs(y) < 10) return; mode = Math.abs(x) > Math.abs(y) * 1.4 ? "h" : "v"; if (mode === "v") return; cell.style.transition = "none"; }
      e.preventDefault();
      moved = true;
      dx = Math.max(-130, Math.min(130, x));
      wrap.classList.toggle("to-fav", dx > 0); wrap.classList.toggle("to-done", dx < 0);
      wrap.classList.toggle("armed", Math.abs(dx) > 80);
      cell.style.transform = `translateX(${dx}px)`;
    }, { passive: false });
    const end = () => {
      if (mode !== "h") return;
      mode = null;
      cell.style.transition = "transform .25s cubic-bezier(.2,.8,.2,1)";
      cell.style.transform = "";
      wrap.classList.remove("armed");
      if (Math.abs(dx) > 80) {
        try { if (window.VidShelfApp && VidShelfApp.haptic) VidShelfApp.haptic(); } catch (e) {}
        selected.clear(); selected.set(keyOf(it), it);
        if (dx > 0) { applyBatch({ favorite: !it.favorite }, it.favorite ? "즐겨찾기에서 뺐습니다" : "즐겨찾기에 넣었습니다", true); it.favorite = it.favorite ? 0 : 1; markFav(cell, it.favorite); }
        else {
          applyBatch({ organized: true }, "정리 완료로 표시했습니다", true);
          if (opts.onOrganized) opts.onOrganized(wrap);
        }
      }
    };
    wrap.addEventListener("touchend", end); wrap.addEventListener("touchcancel", end);
    wrap.addEventListener("click", (e) => { if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; } }, true);
    return wrap;
  }

  return { selectable, swipeActions, cells, endSelect, isSelecting: () => selecting };
}

/** 미디어 탭 (1번 시안: 필터 시트). type = all | video | photo
 *  종류·보기 방식·필터를 바꿀 때는 화면 전체가 아니라 목록 부분만 바꿉니다. */
async function renderMedia(params0, type0) {
  setTab("media");
  if (!Object.keys(serverCaps).length) serverCaps = await api("settings").catch(() => ({}));
  const TYPES = serverCaps.photos === false ? ["all", "video"] : ["all", "video", "photo"];
  let params = new URLSearchParams(params0);
  params.delete("type");
  let type = TYPES.includes(type0) ? type0 : "all";
  if (parseHash().path === "/media" && location.hash.replace(/\/$/, "") === "#/media" && !scrollMemory[location.hash]) {   // 아무 조건 없이 열면 기본 필터
    const def = (await api("saved_filters").catch(() => [])).find((f) => f.default);
    if (def) {
      params = new URLSearchParams(def.params || ""); params.delete("type");
      if (params.get("sort") === "random") params.set("seed", String(Math.floor(Math.random() * 1e6)));   // 무작위면 열 때마다 새로 섞음
      type = TYPES.includes(def.type) ? def.type : "all";
      const p = new URLSearchParams(params); if (type !== "all") p.set("type", type);
      history.replaceState(history.state, "", "#/media" + (p.toString() ? "?" + p : ""));
      lastHash = location.hash;
    }
  }

  const [performers, tags] = await Promise.all([api("performers").catch(() => []), api("tags").catch(() => [])]);
  const perfName = (id) => (performers.find((x) => String(x.id) === String(id)) || { name: "#" + id }).name;
  const tagName = (id) => (tags.find((x) => String(x.id) === String(id)) || { name: "" + id }).name;
  const sortOf = () => params.get("sort") || "added";
  const orderOf = () => params.get("order") || (sortOf() === "title" ? "asc" : "desc");
  const nFilters = () => FILTER_KEYS.reduce((n, k) => n + params.getAll(k).filter(Boolean).length, 0);
  const urlFor = () => { const p = new URLSearchParams(params); if (type !== "all") p.set("type", type); return "#/media" + (p.toString() ? "?" + p : ""); };

  window.__mediaSwipeTarget = (dir) => {   // 옆 종류가 있으면 지금 목록(움직일 부분)을 돌려줌
    if (document.body.classList.contains("selecting")) return null;
    const i = TYPES.indexOf(type) + dir;
    try { return i >= 0 && i < TYPES.length ? content.firstElementChild : null; } catch (e) { return null; }
  };
  window.__mediaSwipe = (dir) => {   // 좌우로 밀기: 전체 ↔ 동영상 ↔ 사진 (끝에서는 옆 탭으로)
    if (document.body.classList.contains("selecting")) return true;
    const i = TYPES.indexOf(type) + dir;
    if (i < 0 || i >= TYPES.length) return false;
    window.scrollTo({ top: 0, behavior: "instant" });
    update({ t: TYPES[i], anim: dir > 0 ? "left" : "right" });
    return true;
  };
  const restore = scrollMemory[location.hash];   // 영상을 보고 돌아온 경우: 보던 곳까지 다시 불러와 그 위치로
  delete scrollMemory[location.hash];

  /** 상태를 바꾸고 필요한 부분만 다시 그림. anim: "left" | "right" | "fade" */
  function update({ p, t, anim }) {
    if (p) params = p;
    if (t) { type = t; if (type !== "video") params.delete("unwatched"); }
    history.replaceState(history.state, "", urlFor());   // 주소만 바꾸고 화면 전체는 다시 그리지 않음
    lastHash = location.hash;
    drawHeader();
    drawContent(anim || "fade");
  }

  // ---- 머리말
  const countLine = h("div", { class: "meta" }, "…");
  const viewBtn = h("button", { class: "round-btn" });
  const filterBtn = h("button", { class: "filter-btn", onclick: () => openFilterSheet() });
  const typeCounts = { video: h("span"), photo: h("span") };
  const LABELS = { all: "전체", video: "동영상", photo: "사진" };
  const segBtns = TYPES.map((t) => h("button", { role: "tab", onclick: () => t !== type && update({ t, anim: TYPES.indexOf(t) > TYPES.indexOf(type) ? "left" : "right" }) },
    LABELS[t], typeCounts[t] ? " " : null, typeCounts[t] || null));
  const segInd = h("span", { class: "type-ind", "aria-hidden": "true", style: `width: calc((100% - 6px) / ${TYPES.length})` });
  const typeSeg = h("div", { class: "type-seg", role: "tablist", "aria-label": "미디어 종류" }, segInd, ...segBtns);
  const chipsBox = h("div", { class: "fchips" });
  const content = h("div", { class: "mcontent-wrap" });
  const selHolder = h("div"), actHolder = h("div");   // 선택 모드 막대 자리
  const sel = makeSelection({ holder: selHolder, refresh: () => update({ anim: "fade" }), performers, tags,
    onOrganized: (wrap) => { if (params.get("unorganized") === "1") { wrap.classList.add("gone"); setTimeout(() => wrap.remove(), 280); } } });
  const { selectable, cells } = sel;
  const mediaTab = parseHash().path === "/media";   // 미디어 탭의 목록 보기는 꾹 누르면 미리보기, 태그·사람으로 들어온 목록은 선택

  function drawHeader() {
    const mode = viewMode("media") === "wall" ? "wall" : "feed";
    viewBtn.hidden = type === "photo";   // 사진은 항상 이미지 벽
    viewBtn.setAttribute("aria-label", mode === "wall" ? "목록으로 보기" : "이미지 벽으로 보기");
    viewBtn.title = viewBtn.getAttribute("aria-label");
    viewBtn.replaceChildren(ico(mode === "wall" ? "viewList" : "viewWall"));
    filterBtn.replaceChildren(ico("filter"));
    filterBtn.append("필터", nFilters() ? h("span", { class: "fbadge" }, nFilters()) : "");
    segBtns.forEach((b, i) => { const on = TYPES[i] === type; b.classList.toggle("on", on); b.setAttribute("aria-selected", on ? "true" : "false"); });
    segInd.style.transform = `translateX(${TYPES.indexOf(type) * 100}%)`;   // 선택 표시가 미끄러지듯 이동
    drawChips();
  }

  // ---- 걸린 필터
  function drawChips() {
    const without = (key, val) => { const p = new URLSearchParams(params); const rest = p.getAll(key).filter((x) => x !== val); p.delete(key); rest.forEach((x) => p.append(key, x)); update({ p }); };
    const chips = [];
    if (params.get("q")) chips.push(h("span", { class: "fchip" }, `“${params.get("q")}”`, h("button", { "aria-label": "검색어 지우기", onclick: () => without("q", params.get("q")) }, ico("close", "x"))));
    for (const id of params.getAll("performer")) {
      const pf = performers.find((x) => String(x.id) === id) || {};
      chips.push(h("span", { class: "fchip" }, h("span", { class: "fc-av" }, entityCover(pf, "")), perfName(id), h("button", { "aria-label": `${perfName(id)} 필터 해제`, onclick: () => without("performer", id) }, ico("close", "x"))));
    }
    for (const id of params.getAll("tag")) chips.push(h("span", { class: "fchip" }, "#" + tagName(id), h("button", { "aria-label": `${tagName(id)} 필터 해제`, onclick: () => without("tag", id) }, ico("close", "x"))));
    if (params.get("fav") === "1") chips.push(h("span", { class: "fchip" }, ico("heart", "in filled"), "즐겨찾기", h("button", { "aria-label": "즐겨찾기 필터 해제", onclick: () => without("fav", "1") }, ico("close", "x"))));
    if (params.get("unwatched") === "1") chips.push(h("span", { class: "fchip" }, "안 본 영상", h("button", { "aria-label": "안 본 영상 필터 해제", onclick: () => without("unwatched", "1") }, ico("close", "x"))));
    for (const id of params.getAll("xperformer")) chips.push(h("span", { class: "fchip ex" }, "− " + perfName(id), h("button", { "aria-label": `${perfName(id)} 빼기 해제`, onclick: () => without("xperformer", id) }, ico("close", "x"))));
    for (const id of params.getAll("xtag")) chips.push(h("span", { class: "fchip ex" }, "− #" + tagName(id), h("button", { "aria-label": `${tagName(id)} 빼기 해제`, onclick: () => without("xtag", id) }, ico("close", "x"))));
    for (const k of ["dur", "when", "res", "rating"]) if (params.get(k)) chips.push(h("span", { class: "fchip" }, rangeLabel(k, params.get(k)), h("button", { "aria-label": "조건 해제", onclick: () => without(k, params.get(k)) }, ico("close", "x"))));
    for (const f of params.getAll("folder")) chips.push(h("span", { class: "fchip" }, ico("folder", "in"), folderName(f), h("button", { "aria-label": `${folderName(f)} 폴더 필터 해제`, onclick: () => without("folder", f) }, ico("close", "x"))));
    if (params.get("unorganized") === "1") chips.push(h("span", { class: "fchip" }, "정리 안 된 항목", h("button", { "aria-label": "정리 안 된 항목 필터 해제", onclick: () => without("unorganized", "1") }, ico("close", "x"))));
    if (chips.length > 1) chips.push(h("button", { class: "fclear", onclick: () => { const p = new URLSearchParams(params); FILTER_KEYS.forEach((k) => p.delete(k)); update({ p }); } }, "모두 지우기"));
    chipsBox.replaceChildren(...chips);
    chipsBox.hidden = !chips.length;
  }

  viewBtn.onclick = () => {
    try { localStorage.setItem("vs-mode-media", viewMode("media") === "wall" ? "feed" : "wall"); } catch (e) {}
    update({ anim: "fade" });
  };

  $app.replaceChildren(h("div", { class: "media docked" },
    h("div", { class: "home-head media-title" }, h("div", {}, countLine, h("h1", {}, "미디어"))),
    h("div", { class: "media-bar" },   // 스크롤해도 위에 떠 있는 버튼들
      h("div", { class: "media-bar-row" }, typeSeg, viewBtn, filterBtn),
      selHolder,
      chipsBox),
    content, actHolder));


  api("media?type=video&per=1").then((d) => (typeCounts.video.textContent = d.total.toLocaleString())).catch(() => {});
  if (TYPES.includes("photo")) api("media?type=photo&per=1").then((d) => (typeCounts.photo.textContent = d.total.toLocaleString())).catch(() => {});

  // ---- 목록 (이 부분만 바뀜)
  let token = 0;
  async function drawContent(anim) {
    const my = ++token;
    const mode = type === "photo" || viewMode("media") === "wall" ? "wall" : "feed", sort = sortOf(), order = orderOf();
    const sortLabel = (MEDIA_SORTS.concat(VIDEO_SORTS).find(([v]) => v === sort) || [0, "추가한 날짜"])[1];
    const grid = h("div", { class: mode === "wall" ? "wall" : "ytfeed" });
    const more = h("div", { class: "more" });
    const box = h("div", { class: "mcontent in-" + anim }, grid, more);
    const photos = [], fitStrips = new Set();
    let page = 1;
    let restoring = anim === "none" && restore && restore.y > 0 ? restore : null;
    const base = toServerParams(params);
    base.set("type", type); base.set("sort", sort); base.set("order", order); base.set("per", "60");
    if (sort === "random" && !base.get("seed")) base.set("seed", "7");
    cells.clear();
    const old = content.firstElementChild;
    if (old && !old.classList.contains("skeleton")) { old.style.minHeight = old.offsetHeight + "px"; old.classList.add("leaving"); }   // 새 목록이 오기 전까지 높이 유지(깜빡임 방지)
    else content.replaceChildren(skeletonList(mode));   // 처음 열 때: 빈 화면 대신 칸 모양 회색 틀
    async function load() {
      base.set("page", page);
      let d;
      try { d = await api("media?" + base.toString()); } catch (e) {
        if (my !== token) return;
        if (page === 1) content.replaceChildren(errorView(e, () => drawContent("fade")));   // 회색 틀만 남지 않게
        else more.replaceChildren(h("button", { class: "btn", onclick: () => load() }, "다시 불러오기"));
        return;
      }
      if (my !== token) return;   // 그 사이 다른 전환이 시작됨
      if (page === 1) content.replaceChildren(box);
      countLine.textContent = `${d.total.toLocaleString()}개 · ${sortLabel}${sort === "random" ? "" : order === "asc" ? " ↑" : ""}`;
      if (page === 1 && !d.total) {
        grid.replaceWith(h("div", { class: "empty" }, nFilters() ? "조건에 맞는 항목이 없습니다." : type === "photo" ? "사진이 없습니다." : type === "video" ? "영상이 없습니다." : "영상과 사진이 아직 없습니다."));
        return;
      }
      for (const it of d.items) {
        placeItem(it);
        const cell = grid.lastElementChild;   // 날짜 표시용 (빠른 스크롤 막대). 사진 줄은 첫 사진 날짜
        if (cell && !cell.dataset.when) cell.dataset.when = String((sort === "taken" ? it.taken : null) || it.added_at || it.taken || 0);
        if (cell && sort === "title") cell.dataset.letter = (it.title || "").trim().slice(0, 1).toUpperCase();
      }
      function placeItem(it) {
        if (it.kind === "photo") {
          const i = photos.length;
          photos.push(it);
          const cell = photoCell(it, "wall", () => openViewer(photos, i));
          if (mode === "wall") grid.append(selectable(cell, it));
          else {   // 목록 보기: 이어지는 사진들은 이미지 벽처럼 줄지어 보여 줌
            let run = grid.lastElementChild;   // 목록 보기: 이어지는 사진은 옆으로 넘겨 보는 한 줄로
            if (!run || !run.classList.contains("photo-strip")) { run = h("div", { class: "photo-strip" }); grid.append(run); }
            run.append(selectable(cell, it, true));
            fitStrips.add(run);
          }
        } else if (mode === "wall") {
          grid.append(selectable(videoTile(it), it));
        } else {
          grid.append(sel.swipeActions(selectable(ytCell(it, null), it, true), it));   // 목록 보기: 꾹 누르면 미리보기 카드, 옆으로 밀면 즐겨찾기·정리 완료
        }
      }
      fitStrips.forEach(fitStrip);
      const shown = (page - 1) * d.per + d.items.length;
      window.__mediaPages = page;
      if (restoring && page < restoring.pages && shown < d.total) { page++; return load(); }   // 기억한 만큼 미리 불러옴
      if (restoring) { const y = restoring.y; restoring = null; window.scrollTo({ top: y, behavior: "instant" }); requestAnimationFrame(() => { window.scrollTo({ top: y, behavior: "instant" }); endRestore(); }); }
      if (shown < d.total) autoMore(more, () => { page++; load(); }); else more.replaceChildren();
    }
    await load();
  }

  /** 유튜브처럼: 큰 썸네일 + 아래에 사람 동그라미·제목·한 줄 정보 */
  function ytCell(it, open) {
    const isPhoto = it.kind === "photo";
    const src = hdSrc(isPhoto ? `/photothumb/${it.id}.jpg` : it.thumbs > 0 ? thumbUrl(it.id, 0, it.thumbs) : null);
    const img = h("img", { loading: "lazy", alt: "", src, hidden: !src });
    if (!isPhoto && !(it.thumbs > 0)) img.dataset.retry = thumbUrl(it.id, 0, "x") + "&s=1080";
    img.onload = () => {
      img.hidden = false;
      if (!known && img.naturalWidth) img.parentElement.style.aspectRatio = img.naturalWidth / img.naturalHeight;
      const card = img.closest(".yt"), amb = ambientOf(img);   // 유튜브 은은한 빛처럼: 썸네일 아래쪽 색이 설명 칸으로 번짐
      if (card && amb) { card.style.setProperty("--amb", amb); card.classList.add("amb"); }
    };
    img.onerror = () => (img.hidden = true);
    // 원래 비율 그대로 (모르면 이미지를 받아 본 뒤 맞춤)
    const known = it.width > 0 && it.height > 0;
    const ratio = known ? it.width / it.height : 16 / 9;
    const pname = (it.performers || [])[0];
    const pf = pname ? performers.find((x) => x.name === pname) : null;
    const when = timeAgo(isPhoto ? it.taken || it.added_at : it.added_at);
    const sub = [(it.performers || []).join(", "), isPhoto ? "사진" : "", when].filter(Boolean).join(" · ");
    const res = !isPhoto ? resLabel(it.width, it.height) : "";
    const kids = [
      h("div", { class: "yt-thumb", style: `aspect-ratio:${ratio}` }, img,
        !isPhoto && (it.duration || res) ? h("span", { class: "yt-badges" },   // 화질 · 길이를 같은 검은 상자로
          res ? h("span", { class: "badge" }, res) : null, it.duration ? h("span", { class: "badge" }, fmtDur(it.duration)) : null) : null,
        it.favorite ? h("span", { class: "sq-fav", "aria-label": "즐겨찾기" }, ico("heart", "filled")) : null,
        !isPhoto && it.resume_pos > 5 && it.duration ? h("div", { class: "progress", style: `width:${Math.min(100, (it.resume_pos / it.duration) * 100)}%` }) : null),
      h("div", { class: "yt-info" },
        h("span", { class: "yt-av" }, pf ? entityCover(pf, pname.slice(0, 1)) : pname ? h("span", {}, pname.slice(0, 1)) : ico(isPhoto ? "image" : "play")),
        h("div", { class: "yt-text" }, h("div", { class: "yt-title" }, it.title || ""), h("div", { class: "meta" }, sub))),
    ];
    return isPhoto ? h("button", { class: "yt", onclick: open, "aria-label": it.title || "사진" }, ...kids)
      : h("a", { class: "yt", href: `#/v/${it.id}`, "aria-label": it.title || "영상" }, ...kids);
  }

  /** 정사각형 칸: 영상은 ▶ 길이, 즐겨찾기는 ♥ */
  function sqCell(it, open) {
    const isPhoto = it.kind === "photo";
    const src = isPhoto ? `/photothumb/${it.id}.jpg` : it.thumbs > 0 ? thumbUrl(it.id, 0, it.thumbs) : null;
    const img = h("img", { loading: "lazy", alt: it.title || "", src, hidden: !src });
    if (!isPhoto && !(it.thumbs > 0)) img.dataset.retry = thumbUrl(it.id, 0, "x");
    img.onload = () => (img.hidden = false);
    img.onerror = () => (img.hidden = true);
    const kids = [img,
      !isPhoto ? h("span", { class: "sq-dur" }, ico("play", "in"), it.duration ? fmtDur(it.duration) : "") : null,
      it.favorite ? h("span", { class: "sq-fav", "aria-label": "즐겨찾기" }, ico("heart", "filled")) : null];
    return isPhoto
      ? h("button", { class: "sq", onclick: open, "aria-label": it.title || "사진" }, ...kids)
      : h("a", { class: "sq", href: `#/v/${it.id}`, "aria-label": it.title || "영상" }, ...kids);
  }

  // ---- 필터 시트: 검색 · 사람 · 태그 · 정렬 · 즐겨찾기
  function openFilterSheet() {
    const sort = sortOf(), order = orderOf();
    const draft = {
      q: params.get("q") || "", performer: new Set(params.getAll("performer")), tag: new Set(params.getAll("tag")),
      xperformer: new Set(params.getAll("xperformer")), xtag: new Set(params.getAll("xtag")), folder: new Set(params.getAll("folder")),
      sort, order, fav: params.get("fav") === "1", unwatched: params.get("unwatched") === "1", unorganized: params.get("unorganized") === "1",
      dur: params.get("dur") || "", when: params.get("when") || "", res: params.get("res") || "", rating: params.get("rating") || "",
    };
    const toParams = () => {
      const p = new URLSearchParams();
      if (draft.q.trim()) p.set("q", draft.q.trim());
      draft.performer.forEach((x) => p.append("performer", x));
      draft.tag.forEach((x) => p.append("tag", x));
      draft.xperformer.forEach((x) => p.append("xperformer", x));
      draft.xtag.forEach((x) => p.append("xtag", x));
      draft.folder.forEach((x) => p.append("folder", x));
      for (const k of ["dur", "when", "res", "rating"]) if (draft[k] && !(k === "dur" && type === "photo")) p.set(k, draft[k]);
      if (draft.unorganized) p.set("unorganized", "1");
      if (draft.sort !== "added") p.set("sort", draft.sort);
      if (draft.order !== (draft.sort === "title" ? "asc" : "desc")) p.set("order", draft.order);
      if (draft.fav) p.set("fav", "1");
      if (draft.unwatched && type === "video") p.set("unwatched", "1");
      return p;
    };
    const resultBtn = h("button", { class: "btn primary sheet-go", onclick: () => close(true) }, "결과 보기");
    let countTimer;
    const refreshCount = () => {
      clearTimeout(countTimer);
      countTimer = setTimeout(async () => {
        const p = toServerParams(toParams()); p.set("type", type); p.set("per", "1");
        try { const d = await api("media?" + p); resultBtn.textContent = `${d.total.toLocaleString()}개 보기`; } catch (e) {}
      }, 250);
    };
    // 검색 도우미: 비어 있을 때는 최근 검색어, 글자를 치면 사람·태그 이름 추천 (누르면 그 사람·태그로 거름)
    const suggest = h("div", { class: "chips search-suggest", hidden: true });
    const recentQ = () => { try { return JSON.parse(localStorage.getItem("vs-recent-q") || "[]"); } catch (e) { return []; } };
    const drawSuggest = () => {
      const q = draft.q.trim().toLowerCase();
      let chips = [];
      if (!q) {
        const rq = recentQ();
        if (rq.length) chips = [h("span", { class: "meta ss-title" }, "최근 검색"),
          ...rq.map((w) => h("button", { class: "chip", onclick: () => { draft.q = w; search.value = w; refreshCount(); drawSuggest(); } }, ico("history", "in"), w)),
          h("button", { class: "linkbtn", onclick: () => { try { localStorage.removeItem("vs-recent-q"); } catch (e) {} drawSuggest(); } }, "지우기")];
      } else {
        const ps = performers.filter((pf) => pf.name.toLowerCase().includes(q) && !draft.performer.has(String(pf.id))).slice(0, 6);
        const ts = tags.filter((t) => t.name.toLowerCase().includes(q) && !draft.tag.has(String(t.id))).slice(0, 6);
        const pick = (fn) => () => { fn(); draft.q = ""; search.value = ""; drawPeople(); drawTags(); refreshCount(); drawSuggest(); };
        chips = [...ps.map((pf) => h("button", { class: "chip ss-person", onclick: pick(() => draft.performer.add(String(pf.id))) },
            h("span", { class: "fc-av" }, entityCover(pf, pf.name.slice(0, 1))), pf.name)),
          ...ts.map((t) => h("button", { class: "chip", onclick: pick(() => draft.tag.add(String(t.id))) }, "#" + t.name))];
        if (chips.length) chips.unshift(h("span", { class: "meta ss-title" }, "이 사람·태그로 거르기"));
      }
      suggest.replaceChildren(...chips);
      suggest.hidden = !chips.length;
    };
    const search = h("input", { type: "search", placeholder: "제목, 사람, 폴더 검색", value: draft.q, "aria-label": "검색어",
      oninput: (e) => { draft.q = e.target.value; refreshCount(); drawSuggest(); },
      onfocus: () => drawSuggest(),
      onkeydown: (e) => { if (e.key === "Enter") { e.preventDefault(); close(true); } } });

    const people = performers.filter((pf) => pf.count || pf.photo_count).sort((a, b) => (b.count + (b.photo_count || 0)) - (a.count + (a.photo_count || 0)));
    let peopleAll = false;
    const peopleBox = h("div");
    const drawPeople = () => {
      const list = peopleAll ? people : people.slice(0, 12);
      peopleBox.className = peopleAll ? "pick-people wrap" : "pick-people";
      peopleBox.replaceChildren(...list.map((pf) => {
        const id = String(pf.id), on = draft.performer.has(id), ex = draft.xperformer.has(id);
        return h("button", { class: "pick-person" + (on ? " on" : "") + (ex ? " ex" : ""), "aria-pressed": on ? "true" : ex ? "mixed" : "false", title: "누를 때마다: 포함 → 빼기 → 해제",
          onclick: () => { if (on) { draft.performer.delete(id); draft.xperformer.add(id); } else if (ex) draft.xperformer.delete(id); else draft.performer.add(id); drawPeople(); refreshCount(); } },
          h("span", { class: "pf-avatar" }, entityCover(pf, pf.name.slice(0, 1))), h("span", { class: "nm" }, pf.name));
      }));
    };
    const peopleMore = people.length > 12 ? h("button", { class: "linkbtn", onclick: (e) => { peopleAll = !peopleAll; e.target.textContent = peopleAll ? "접기" : "모두 보기"; drawPeople(); } }, "모두 보기") : null;

    const tagList = tags.filter((t) => t.count || t.photo_count).sort((a, b) => (b.count + (b.photo_count || 0)) - (a.count + (a.photo_count || 0)));
    let tagsAll = false;
    const tagBox = h("div", { class: "chips" });
    const drawTags = () => {
      const list = tagsAll ? tagList : tagList.slice(0, 10);
      tagBox.replaceChildren(...list.map((t) => {
        const id = String(t.id), on = draft.tag.has(id), ex = draft.xtag.has(id);
        return h("button", { class: "chip" + (on ? " on" : "") + (ex ? " ex" : ""), "aria-pressed": on ? "true" : ex ? "mixed" : "false",
          onclick: () => { if (on) { draft.tag.delete(id); draft.xtag.add(id); } else if (ex) draft.xtag.delete(id); else draft.tag.add(id); drawTags(); refreshCount(); } }, (ex ? "− #" : "#") + t.name);
      }), ...(!tagsAll && tagList.length > 10 ? [h("button", { class: "chip dashed", onclick: () => { tagsAll = true; drawTags(); } }, `+${tagList.length - 10}`)] : []));
    };

    // 폴더: 갤러리의 앨범처럼 (여러 개 고르면 그중 아무 폴더에나 있는 것)
    const folderBox = h("div", { class: "chips" });
    const folderSec = h("div", { class: "sheet-sec", hidden: true }, h("h3", {}, "폴더"), folderBox);
    let folderList = [], foldersAll = false;
    const drawFolders = () => {
      const chosen = folderList.filter((a) => draft.folder.has(a.path)), rest = folderList.filter((a) => !draft.folder.has(a.path));
      const list = foldersAll ? chosen.concat(rest) : chosen.concat(rest.slice(0, Math.max(0, 10 - chosen.length)));
      folderBox.replaceChildren(...list.map((a) => {
        const on = draft.folder.has(a.path);
        return h("button", { class: "chip" + (on ? " on" : ""), "aria-pressed": on ? "true" : "false", title: a.path,
          onclick: () => { if (on) draft.folder.delete(a.path); else draft.folder.add(a.path); drawFolders(); refreshCount(); } }, ico("folder", "in"), a.name);
      }), ...(!foldersAll && folderList.length > list.length ? [h("button", { class: "chip dashed", onclick: () => { foldersAll = true; drawFolders(); } }, `+${folderList.length - list.length}`)] : []));
    };
    getAlbums().then((l) => { folderList = [...l].sort((a, b) => (b.videos + b.photos) - (a.videos + a.photos)); folderSec.hidden = !folderList.length; drawFolders(); });

    const sortBox = h("div", { class: "chips" });
    const drawSort = () => sortBox.replaceChildren(...MEDIA_SORTS.concat(type === "video" ? VIDEO_SORTS : []).map(([v, l]) => {
      const on = draft.sort === v;
      return h("button", { class: "chip" + (on ? " sel" : ""), "aria-pressed": on ? "true" : "false", onclick: () => {
        if (on && v !== "random") draft.order = draft.order === "asc" ? "desc" : "asc";
        else { draft.sort = v; draft.order = v === "title" ? "asc" : "desc"; }
        drawSort(); refreshCount();
      } }, l + (on && v !== "random" ? (draft.order === "asc" ? " ↑" : " ↓") : ""));
    }));

    const rangeSec = (label, key) => {   // 한 가지만 고르는 범위 조건 (다시 누르면 해제)
      const box = h("div", { class: "chips" });
      const draw = () => box.replaceChildren(...RANGE_OPTS[key].map(([v, l]) => h("button", { class: "chip" + (draft[key] === v ? " sel" : ""), "aria-pressed": draft[key] === v ? "true" : "false",
        onclick: () => { draft[key] = draft[key] === v ? "" : v; draw(); refreshCount(); } }, l)));
      draw(); rangeDraws.push(draw);
      return h("div", { class: "sheet-sec" }, h("h3", {}, label), box);
    };
    const rangeDraws = [];
    const toggle = (label, key) => {
      const sw = h("button", { class: "switch" + (draft[key] ? " on" : ""), role: "switch", "aria-checked": draft[key] ? "true" : "false", "aria-label": label,
        onclick: () => { draft[key] = !draft[key]; sw.classList.toggle("on", draft[key]); sw.setAttribute("aria-checked", draft[key] ? "true" : "false"); refreshCount(); } });
      return h("div", { class: "sheet-row" }, h("span", {}, label), sw);
    };

    // 저장된 필터: 지금 고른 조건에 이름을 붙여 두고, 누르면 바로 적용 (길게 누르면 삭제)
    const savedBox = h("div", { class: "chips saved-filters" });
    const nameIn = h("input", { type: "text", placeholder: "필터 이름 (예: 공연 즐겨찾기)", maxlength: "40", "aria-label": "필터 이름" });
    const saveRow = h("div", { class: "taginput", hidden: true }, nameIn,
      h("button", { class: "btn primary", onclick: async () => {
        const name = nameIn.value.trim();
        if (!name) { nameIn.focus(); return; }
        try {
          savedFilters = await api("saved_filters", { method: "POST", body: { name, type, params: toParams().toString() } });
          nameIn.value = ""; saveRow.hidden = true; drawSaved();
          toast(`‘${name}’ 필터를 저장했습니다`);
        } catch (e) { toast(e.message); }
      } }, "저장"));
    nameIn.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); saveRow.querySelector("button").click(); } };
    let savedFilters = [];
    const TYPE_LABEL = { all: "전체", video: "동영상", photo: "사진" };
    function drawSaved() {
      const chips = savedFilters.map((f) => {
        const chip = h("button", { class: "chip saved" + (f.default ? " is-default" : ""), title: "누르면 적용 · 길게 누르면 기본 필터 지정·삭제" },
          f.default ? h("span", { class: "sf-star", "aria-label": "기본 필터" }, ico("star", "filled")) : null,
          h("span", {}, f.name), f.type && f.type !== "all" ? h("small", {}, TYPE_LABEL[f.type] || "") : null);
        let timer = null, long = false;
        chip.addEventListener("touchstart", () => { long = false; timer = setTimeout(() => {
          long = true;
          try { navigator.vibrate && navigator.vibrate(18); } catch (e) {}
          const closeOpts = openSheet(`‘${f.name}’ 필터`, [
            h("button", { class: "del-opt", onclick: () => closeOpts(async () => {
              savedFilters = await api(`saved_filters/${f.id}/default`, { method: "POST", body: { on: !f.default } }).catch(() => savedFilters);
              toast(f.default ? "기본 필터를 해제했습니다" : `‘${f.name}’을(를) 기본 필터로 정했습니다. 미디어 탭을 열면 이 조건으로 보입니다.`);
              drawSaved();
            }) }, h("b", {}, ico("star", "in"), f.default ? "기본 필터 해제" : "기본 필터로 지정"),
              h("span", { class: "meta" }, f.default ? "미디어 탭을 열면 조건 없이 전체가 보입니다." : "미디어 탭을 열 때마다 이 조건이 자동으로 걸립니다.")),
            h("button", { class: "del-opt", onclick: () => closeOpts(async () => {
              savedFilters = await api(`saved_filters/${f.id}/home`, { method: "POST", body: { on: !f.home } }).catch(() => savedFilters);
              toast(f.home ? "홈에서 뺐습니다" : `‘${f.name}’ 줄을 홈에 넣었습니다`);
              drawSaved();
            }) }, h("b", {}, ico("pin", "in"), f.home ? "홈에서 빼기" : "홈에 줄로 표시"),
              h("span", { class: "meta" }, f.home ? "홈 화면에서 이 필터 줄을 없앱니다." : "홈 화면에 이 조건의 영상·사진이 한 줄로 나옵니다.")),
            h("button", { class: "del-opt danger", onclick: () => closeOpts(async () => {
              savedFilters = await api(`saved_filters/${f.id}`, { method: "DELETE" }).catch(() => savedFilters);
              drawSaved();
            }) }, h("b", {}, "삭제"), h("span", { class: "meta" }, "저장한 필터만 지워지고 영상·사진은 그대로입니다.")),
          ], [h("button", { class: "btn", style: "grid-column: 1 / -1", onclick: () => closeOpts() }, "취소")]);
        }, 550); }, { passive: true });
        const stop = () => clearTimeout(timer);
        chip.addEventListener("touchend", stop); chip.addEventListener("touchmove", stop);
        chip.addEventListener("contextmenu", (e) => e.preventDefault());
        chip.onclick = () => {
          if (long) return;
          pendingType = TYPES.includes(f.type) ? f.type : "all";
          close(new URLSearchParams(f.params || ""));
        };
        return chip;
      });
      savedBox.replaceChildren(...chips,
        h("button", { class: "chip add", onclick: () => { saveRow.hidden = !saveRow.hidden; if (!saveRow.hidden) nameIn.focus(); } }, ico("plus", "in"), "지금 조건 저장"),
        ...(savedFilters.length ? [h("p", { class: "meta sf-hint" }, "길게 누르면 기본 필터로 정하거나 지울 수 있습니다. 기본 필터는 미디어 탭을 열 때 자동으로 걸립니다.")] : []));
    }
    api("saved_filters").then((l) => { savedFilters = l; drawSaved(); }).catch(() => {});
    drawSaved();

    const sheet = h("section", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": "필터" },
      h("div", { class: "sheet-grip", "aria-hidden": "true" }),
      h("div", { class: "sheet-head" }, h("h2", {}, "필터"), h("button", { class: "round-btn", "aria-label": "닫기", onclick: () => close(false) }, icon("close"))),
      h("div", { class: "sheet-body" },
        h("label", { class: "sheet-search" }, ico("search"), search),
        suggest,
        h("div", { class: "sheet-sec" }, h("h3", {}, "저장된 필터"), savedBox, saveRow),
        people.length ? h("div", { class: "sheet-sec" }, h("div", { class: "sheet-sec-head" }, h("h3", {}, "사람"), peopleMore), peopleBox) : null,
        tagList.length ? h("div", { class: "sheet-sec" }, h("h3", {}, "태그"), tagBox) : null,
        h("p", { class: "meta tri-hint" }, "사람·태그는 한 번 누르면 포함, 한 번 더 누르면 빼기(−), 또 누르면 해제됩니다."),
        folderSec,
        h("div", { class: "sheet-sec" }, h("h3", {}, "정렬"), sortBox),
        type === "photo" ? null : rangeSec("길이", "dur"),
        rangeSec("날짜", "when"),
        rangeSec("화질", "res"),
        rangeSec("별점", "rating"),
        toggle("즐겨찾기만 보기", "fav"),
        type === "video" ? toggle("안 본 영상만", "unwatched") : null,
        toggle("정리 안 된 항목만 (사람·태그 없음)", "unorganized")),
      h("div", { class: "sheet-foot" },
        h("button", { class: "btn", onclick: () => {
          draft.q = ""; search.value = ""; draft.performer.clear(); draft.tag.clear(); draft.fav = false; draft.unwatched = false;
          draft.xperformer.clear(); draft.xtag.clear(); draft.folder.clear(); draft.unorganized = false; draft.dur = draft.when = draft.res = draft.rating = "";
          rangeDraws.forEach((f) => f());
          draft.sort = "added"; draft.order = "desc";
          sheet.querySelectorAll(".switch").forEach((x) => { x.classList.remove("on"); x.setAttribute("aria-checked", "false"); });
          drawPeople(); drawTags(); drawFolders(); drawSort(); refreshCount();
        } }, "초기화"),
        resultBtn));
    const shade = h("div", { class: "sheet-shade", onclick: () => close(false) });
    let closed = false, pending = null, pendingType = null;
    function close(apply) {   // 닫기는 ‘뒤로’로 처리하고, 적용할 필터는 닫힌 뒤에 반영 (apply 가 조건이면 그 조건으로)
      if (closed) return;
      pending = apply instanceof URLSearchParams ? apply : apply ? toParams() : null;
      const q = pending && pending.get("q");
      if (q) { try { const rq = JSON.parse(localStorage.getItem("vs-recent-q") || "[]").filter((w) => w !== q); rq.unshift(q); localStorage.setItem("vs-recent-q", JSON.stringify(rq.slice(0, 8))); } catch (e) {} }
      history.back();
    }
    const sheetId = Math.random();
    const onPop = () => {
      if (closed || (history.state && history.state.sheet === sheetId)) return;   // 위에 겹친 다른 창이 닫힌 것
      closed = true;
      window.removeEventListener("popstate", onPop);
      sheet.classList.add("out"); shade.classList.add("out");
      setTimeout(() => { sheet.remove(); shade.remove(); document.body.style.overflow = ""; }, 220);
      if (pending) setTimeout(() => update({ p: pending, t: pendingType || undefined, anim: "fade" }), 0);
    };
    drawPeople(); drawTags(); drawSort(); refreshCount();
    dragToClose(sheet, shade, () => close(false));
    document.body.append(shade, sheet);
    document.body.style.overflow = "hidden";
    history.pushState({ sheet: sheetId }, "");   // 휴대폰 뒤로 가기로 닫힘
    window.addEventListener("popstate", onPop);
  }

  drawHeader();
  const offFs = attachFastScroll(() => (["added", "taken", "title"].includes(sortOf()) ? labelAtCenter() : ""));
  const offDock = () => {};   // 아래 버튼 줄은 스크롤해도 늘 보임
  window.__fsCleanup = () => { offFs(); offDock(); };
  await drawContent("none");
}

// ---------------------------------------------------------------- 보기 방식 (그리드 / 이미지 벽)
function viewMode(kind) {
  const def = kind === "media" ? "wall" : "grid";   // 미디어 탭은 이미지 벽이 기본
  try { return localStorage.getItem("vs-mode-" + kind) || def; } catch (e) { return def; }
}
function modeToggle(kind, onChange) {
  const cur = viewMode(kind);
  const set = (m) => { try { localStorage.setItem("vs-mode-" + kind, m); } catch (e) {} onChange(); };
  return h("div", { class: "seg", role: "group", "aria-label": "보기 방식" },
    h("button", { class: cur === "grid" ? "on" : "", onclick: () => set("grid") }, ico("viewGrid", "in"), "그리드"),
    h("button", { class: cur === "wall" ? "on" : "", onclick: () => set("wall") }, ico("viewWall", "in"), "이미지 벽"));
}
const wallHeight = () => (window.innerWidth < 560 ? 110 : 180);

/** 이미지 벽 한 칸: 원래 비율을 유지하고 아래에 사람 이름을 표시 */
/** 크게 보이는 칸용 큰 미리보기 주소 (화질 깨짐 방지) */
const hdSrc = (src, size = 1080) => !src ? src : src + (src.includes("?") ? "&" : "?") + "s=" + size;

function wallTile({ href, onclick, src, ratio, badges, performers }) {
  src = hdSrc(src);
  let r = ratio > 0 ? Math.min(3, Math.max(0.4, ratio)) : 1;
  const box = h("div", { class: "tile-img", style: `aspect-ratio:${r}` });
  const tile = h(href ? "a" : "div", { class: "tile", href, onclick, "data-r": r, style: `flex:${r} 1 ${Math.round(r * wallHeight())}px` }, box,
    h("div", { class: "tile-cap" + (performers && performers.length ? " has" : "") }, performers && performers.length ? performers.join(", ") : "\u00a0"));
  if (src) {
    const img = h("img", { src, loading: "lazy", alt: "" });
    img.onload = () => {
      if (!(ratio > 0) && img.naturalWidth) {   // 비율을 모르면 이미지를 받아 본 뒤 맞춤
        r = Math.min(3, Math.max(0.4, img.naturalWidth / img.naturalHeight));
        box.style.aspectRatio = r; tile.style.flex = `${r} 1 ${Math.round(r * wallHeight())}px`;
        tile.dataset.r = r;
        const strip = tile.closest(".photo-strip"); if (strip) fitStrip(strip);
      }
    };
    img.onerror = () => (img.hidden = true);
    box.append(img);
  }
  (badges || []).forEach((b) => b && box.append(b));
  return tile;
}

/** 목록 보기의 사진 한 줄: 다 합쳐도 화면 폭보다 좁으면 키워서 양옆을 꽉 채움 (넓으면 옆으로 넘겨 보기) */
const STRIP_MAX = 420;
function fitStrip(strip) {
  const tiles = [...strip.querySelectorAll(".tile")];
  if (!tiles.length || !strip.isConnected) return;
  const cs = getComputedStyle(strip);
  const W = strip.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const gaps = 4 * (tiles.length - 1), R = tiles.reduce((a, t) => a + (+t.dataset.r || 1), 0);
  if (W <= 0) return;
  if ((W - gaps) / R < 140) {   /* 너무 많아서 줄이면 작아지는 줄만 옆으로 넘겨 보기 */ strip.classList.remove("fit"); strip.style.removeProperty("--sh"); tiles.forEach((t) => t.style.removeProperty("flex")); return; }
  strip.classList.add("fit");
  strip.style.setProperty("--sh", Math.round(Math.min(STRIP_MAX, (W - gaps) / R)) + "px");
  tiles.forEach((t) => t.style.setProperty("flex", `${t.dataset.r || 1} 1 0px`, "important"));
}
window.addEventListener("resize", () => document.querySelectorAll(".photo-strip").forEach(fitStrip));

function videoTile(v) {
  return wallTile({
    href: `#/v/${v.id}`, src: v.thumbs > 0 ? thumbUrl(v.id, 0, v.thumbs) : null,
    ratio: v.width && v.height ? v.width / v.height : 0, performers: v.performers,   // 모르면 썸네일의 실제 비율을 씀
    badges: [v.duration ? h("span", { class: "badge dur" }, fmtDur(v.duration)) : null, v.favorite ? h("span", { class: "badge fav" }, ico("heart", "filled")) : null],
  });
}

// ---------------------------------------------------------------- 사진
const PHOTO_SORTS = [["taken", "촬영 날짜"], ["added", "추가한 날짜"], ["title", "이름"], ["size", "파일 크기"], ["rating", "별점"], ["random", "무작위"]];

async function renderPhotos(params) {
  setTab("photos");
  const sort = params.get("sort") || "taken";
  const order = params.get("order") || (sort === "title" ? "asc" : "desc");
  const update = (changes) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) (v == null || v === "") ? p.delete(k) : p.set(k, v);
    location.hash = "#/photos" + (p.toString() ? "?" + p : "");
  };
  const chips = [];
  for (const id of params.getAll("performer")) {
    const e = await api(`performers/${id}`).catch(() => ({ name: "#" + id }));
    chips.push(h("span", { class: "chip on" }, e.name, h("button", { title: "필터 해제", onclick: () => update({ performer: null }) }, ico("close", "x"))));
  }
  for (const id of params.getAll("tag")) {
    const e = await api(`tags/${id}`).catch(() => ({ name: "" + id }));
    chips.push(h("span", { class: "chip on" }, "# " + e.name, h("button", { title: "필터 해제", onclick: () => update({ tag: null }) }, ico("close", "x"))));
  }
  let t;
  const search = h("input", { type: "search", class: "search", placeholder: "이름, 사람, 폴더 검색", value: params.get("q") || "",
    oninput: (e) => { clearTimeout(t); t = setTimeout(() => { typingSearch = true; update({ q: e.target.value }); }, 400); } });
  const sortSel = h("select", { "aria-label": "정렬", onchange: (e) => update({ sort: e.target.value, order: null }) },
    PHOTO_SORTS.map(([v, l]) => h("option", { value: v, selected: v === sort }, l)));
  const orderBtn = sort === "random" ? h("button", { class: "btn", onclick: () => update({ seed: Date.now() % 100000 }) }, ico("shuffle", "in"), "섞기")
    : h("button", { class: "btn", onclick: () => update({ order: order === "asc" ? "desc" : "asc" }) }, order === "asc" ? "↑ 오름차순" : "↓ 내림차순");
  const fav = h("button", { class: "chip" + (params.get("fav") === "1" ? " on" : ""), onclick: () => update({ fav: params.get("fav") === "1" ? null : "1" }) }, ico("heart", "in"), "즐겨찾기");
  const mode = viewMode("photos");
  const count = h("span", { class: "meta" });
  const grid = h("div", { class: mode === "wall" ? "wall" : "pgrid" });
  const more = h("div", { class: "more" });
  $app.replaceChildren(h("div", {},
    h("div", { class: "toolbar" }, mediaSeg("photo")),
    h("div", { class: "toolbar" }, search, sortSel, orderBtn, modeToggle("photos", () => route())),
    h("div", { class: "toolbar" }, h("div", { class: "chips" }, fav, chips), count),
    grid, more));

  const items = [];
  let page = 1;
  const base = new URLSearchParams(params);
  base.set("sort", sort); base.set("order", order); base.set("per", "90");
  async function load() {
    base.set("page", page);
    const data = await api("photos?" + base.toString());
    count.textContent = `${data.total.toLocaleString()}장`;
    if (page === 1 && !data.total) {
      grid.replaceWith(h("div", { class: "empty" }, params.toString() ? "조건에 맞는 사진이 없습니다." : "사진이 없습니다. 설정의 영상 폴더(DCIM, Download 등)와 MEGA 폴더의 사진이 여기에 나옵니다."));
      return;
    }
    for (const p of data.items) {
      const i = items.length;
      items.push(p);
      grid.append(photoCell(p, mode, () => openViewer(items, i)));
    }
    const shown = (page - 1) * data.per + data.items.length;
    if (shown < data.total) autoMore(more, () => { page++; load(); }); else more.replaceChildren();
  }
  keepTypingFocus(search);
  await load();
}

function photoCell(p, mode, open) {
  if (mode === "wall") {
    const t = wallTile({ onclick: open, src: `/photothumb/${p.id}.jpg`, ratio: p.width && p.height ? p.width / p.height : 0,
      performers: p.performers, badges: [p.favorite ? h("span", { class: "badge fav" }, ico("heart", "filled")) : null] });
    t.dataset.pid = p.id;   // 사진 보기를 닫으면 마지막으로 본 사진 칸으로
    return t;
  }
  const img = h("img", { src: `/photothumb/${p.id}.jpg`, loading: "lazy", alt: "" });
  img.onerror = () => (img.hidden = true);
  return h("div", { class: "pcard", onclick: open },
    h("div", { class: "thumb" }, img, p.favorite ? h("span", { class: "badge fav" }, ico("heart", "filled")) : null),
    h("div", { class: "title", title: p.title }, p.title),
    p.performers.length ? h("div", { class: "sub" }, p.performers.join(", ")) : null);
}

const ICON_ALIAS = { prev: "back" };
function icon(name) { return ico(ICON_ALIAS[name] || name); }

/** 사진 크게 보기: 세로 화면에서는 가로를 꽉 채우고, 아래로 내리면 사진 정보. 좌우로 밀어 넘기기. */
async function openViewer(items, start) {
  let i = start, closed = false, cur = null, editing = false;
  const [allPerformers, allTags] = await Promise.all([api("performers").catch(() => []), api("tags").catch(() => [])]);
  const tagInput = h("input", { type: "text", list: "dl-viewer-tag", placeholder: "태그 추가 (Enter)" });
  const img = h("img", { alt: "" });
  const counter = h("span", { class: "count" });
  const favBtn = h("button", { class: "vbtn", "aria-label": "즐겨찾기" }, icon("heart"));
  const info = h("div", { class: "vinfo" });
  const input = h("input", { type: "text", list: "dl-viewer-perf", placeholder: "출연한 사람 추가 (Enter)" });
  const prevBtn = h("button", { onclick: () => slide(-1) }, icon("prev"), "이전");
  const nextBtn = h("button", { onclick: () => slide(1) }, "다음", icon("next"));
  const close = () => {
    if (closed) return;
    closed = true; el.remove(); document.body.style.overflow = "";
    try { if (window.VidShelfApp && VidShelfApp.immersive) VidShelfApp.immersive(false); } catch (er) {}
    applyTheme();   // 사진 보기 동안 검게 했던 위아래 막대를 원래 색으로
    document.removeEventListener("keydown", onKey); window.removeEventListener("popstate", onPop);
    // 목록으로 돌아가면 마지막으로 본 사진 칸이 화면에 보이게
    const p = items[i], cell = p && document.querySelector(`[data-pid="${p.id}"]`);
    if (cell) {
      const r = cell.getBoundingClientRect();
      if (r.top < 70 || r.bottom > window.innerHeight - 150) cell.scrollIntoView({ block: "center", inline: "nearest" });
      cell.classList.remove("just-seen"); void cell.offsetWidth; cell.classList.add("just-seen");
    }
  };
  const onPop = () => close();
  const onKey = (e) => {
    if (document.activeElement === input || document.activeElement === tagInput) return;
    if (e.key === "ArrowLeft") slide(-1);
    else if (e.key === "ArrowRight") slide(1);
    else if (e.key === "Escape") history.back();
  };
  async function save(patch) {
    cur = await api(`photos/${cur.id}`, { method: "PATCH", body: patch });
    items[i].favorite = cur.favorite; items[i].performers = cur.performers; items[i].rating = cur.rating;
    draw();
  }
  function draw() {
    favBtn.classList.toggle("fav", !!cur.favorite);
    const taken = cur.taken ? new Date(cur.taken * 1000).toLocaleString("ko-KR") : "-";
    const rows = [["촬영", taken], ["해상도", cur.width ? `${cur.width} × ${cur.height}` : "-"], ["크기", fmtSize(cur.size)],
      ["폴더", cur.folder || "-"], ["출처", SOURCE_LABEL[cur.source] || "이 기기"]];
    info.replaceChildren(
      h("h2", {}, cur.filename || cur.title),
      h("dl", {}, ...rows.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)])),
      h("div", { class: "row", style: "justify-content:space-between" },
        h("div", { class: "stars" + (editing ? "" : " ro") }, ...[1, 2, 3, 4, 5].map((n) =>
          editing ? h("button", { class: n <= (cur.rating || 0) ? "on" : "", title: `${n}점`, onclick: () => save({ rating: cur.rating === n ? 0 : n }) }, ico("star"))
            : n <= (cur.rating || 0) ? h("span", { class: "on" }, ico("star", "filled")) : null)),
        h("button", { class: "btn sm" + (editing ? " primary" : ""), onclick: () => { editing = !editing; draw(); } }, editing ? "완료" : [ico("edit", "in"), "수정"])),
      h("span", { class: "meta" }, "출연한 사람"),
      h("div", { class: "chips" }, ...(cur.performer_refs.length ? cur.performer_refs.map((p) => editing
        ? h("span", { class: "chip" }, p.name,
            h("button", { "aria-label": `${p.name} 제거`, onclick: () => save({ performers: cur.performer_refs.filter((x) => x.id !== p.id).map((x) => x.name) }) }, ico("close", "x")))
        : h("button", { class: "chip", onclick: () => { close(); location.hash = `#/performer?id=${p.id}`; } }, p.name))
        : [h("span", { class: "meta" }, editing ? "출연한 사람 없음 — 아래에 이름을 입력하세요" : "출연한 사람 없음")])),
      ...(editing ? [input] : []),
      h("span", { class: "meta" }, "태그"),
      h("div", { class: "chips" }, ...((cur.tags || []).length ? cur.tags.map((t) => editing
        ? h("span", { class: "chip" }, "# " + t.name,
            h("button", { "aria-label": `${t.name} 제거`, onclick: () => save({ tags: cur.tags.filter((x) => x.id !== t.id).map((x) => x.name) }) }, ico("close", "x")))
        : h("button", { class: "chip", onclick: () => { close(); location.hash = `#/photos?tag=${t.id}`; } }, "# " + t.name))
        : [h("span", { class: "meta" }, "태그 없음")])),
      ...(editing ? [tagInput] : []),
      h("div", { class: "vnav" }, prevBtn, nextBtn),
      h("datalist", { id: "dl-viewer-perf" }, allPerformers.map((p) => h("option", { value: p.name }))),
      h("datalist", { id: "dl-viewer-tag" }, allTags.map((t) => h("option", { value: t.name }))));
    prevBtn.disabled = i === 0; nextBtn.disabled = i === items.length - 1;
  }
  // ---- 갤러리처럼 넘기기: [이전 | 지금 | 다음] 세 칸. 넘긴 뒤에는 칸 자체를 돌려 끼워서(그림을 다시 받지 않음) 이전 사진이 다시 보이지 않음
  let slots = [0, 1, 2].map(() => h("div", { class: "vslot" }, h("img", { alt: "", draggable: "false" })));
  const track = h("div", { class: "vtrack" }, ...slots);
  const setX = (px, animate) => {
    track.style.transition = animate ? "transform .3s cubic-bezier(.2,.8,.2,1)" : "none";
    track.style.transform = `translateX(calc(-33.3333% + ${px}px))`;
  };
  const fillSlot = (slot, k) => {
    const im = slot.firstChild, p = items[k];
    slot.style.visibility = p ? "visible" : "hidden";
    const src = p ? `/photo/${p.id}` : "";
    if (im.dataset.for !== src) {
      im.dataset.for = src;
      // 원본을 못 보여 주면(드문 형식 등) 큰 미리보기로 대신
      im.onerror = () => { if (p && im.dataset.for === src && !im.dataset.fb) { im.dataset.fb = "1"; im.src = `/photothumb/${p.id}.jpg?s=1600`; } };
      delete im.dataset.fb;
      if (src) im.src = src; else im.removeAttribute("src");
    }
  };
  const fillSlots = () => [i - 1, i, i + 1].forEach((k, j) => fillSlot(slots[j], k));
  // 확대·축소 (두 손가락 벌리기, 두 번 탭) — 지금 사진에만
  let zoom = 1, zx = 0, zy = 0;
  const curImg = () => slots[1].firstChild;
  const applyZoom = (animate) => {
    const im = curImg();
    im.style.transition = animate ? "transform .25s cubic-bezier(.2,.8,.2,1)" : "none";
    im.style.transform = zoom > 1 ? `translate(${zx}px, ${zy}px) scale(${zoom})` : "";
    el.classList.toggle("zoomed", zoom > 1);
  };
  const clampPan = () => {
    const im = curImg(), r = stage.getBoundingClientRect();
    const w = im.offsetWidth * zoom, hgt = im.offsetHeight * zoom;
    const mx = Math.max(0, (w - r.width) / 2), my = Math.max(0, (hgt - r.height) / 2);
    zx = Math.min(mx, Math.max(-mx, zx)); zy = Math.min(my, Math.max(-my, zy));
  };
  const resetZoom = (animate) => { zoom = 1; zx = 0; zy = 0; applyZoom(animate); };
  async function show(n) {
    if (n < 0 || n >= items.length) return;
    i = n;
    fillSlots();
    setX(0, false);
    counter.textContent = `${i + 1} / ${items.length}`;
    if (items[i + 2]) new Image().src = `/photo/${items[i + 2].id}`;   // 그다음 사진도 미리 받기
    const d = await api(`photos/${items[n].id}`);
    if (i === n) { cur = d; draw(); }
  }
  let sliding = false;
  function slide(dir) {   // 버튼·화살표·밀기: 옆 사진이 미끄러져 들어옴
    const n = i + dir;
    if (sliding || n < 0 || n >= items.length) { setX(0, true); return; }
    sliding = true;
    resetZoom(false);
    setX(-dir * stage.clientWidth, true);
    setTimeout(() => {
      // 칸 돌려 끼우기: 다음으로 갔으면 맨 앞 칸을 맨 뒤로 (그 칸에만 새 사진)
      if (dir > 0) { const s0 = slots.shift(); slots.push(s0); track.append(s0); }
      else { const s2 = slots.pop(); slots.unshift(s2); track.prepend(s2); }
      sliding = false;
      show(n);
    }, 300);
  }
  favBtn.onclick = () => cur && save({ favorite: !cur.favorite });
  tagInput.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !tagInput.value.trim()) return;
    const names = (cur.tags || []).map((x) => x.name).concat(tagInput.value.split(",").map((x) => x.trim()).filter(Boolean));
    tagInput.value = ""; save({ tags: names });
  });
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !input.value.trim()) return;
    const names = cur.performer_refs.map((x) => x.name).concat(input.value.split(",").map((x) => x.trim()).filter(Boolean));
    input.value = ""; save({ performers: names });
  });
  const stage = h("div", { class: "stage" }, track);
  // 손가락 동작: 사진뿐 아니라 아래 정보 부분에서 밀어도 넘어감 (세로로 움직이면 스크롤)
  let sx = null, sy = null, t0 = 0, lock = null, dx = 0;
  let pinch = null, pan = null, lastTap = 0, tapTimer = null, full = false, pull = 0;
  const fullBtn = h("button", { class: "vbtn", "aria-label": "전체 화면으로 보기" }, ico("full"));
  const setFull = (on) => {
    full = on;
    el.classList.toggle("full", on);
    if (on) el.scrollTo({ top: 0 });
    fullBtn.setAttribute("aria-label", on ? "전체 화면 끝내기" : "전체 화면으로 보기");
    try { if (window.VidShelfApp && VidShelfApp.immersive) VidShelfApp.immersive(on); } catch (er) {}   // 휴대폰 위아래 막대도 숨김
  };
  fullBtn.onclick = () => setFull(!full);
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const onStart = (e) => {
    if (e.target.closest("input, textarea, select, .vtop")) { sx = null; return; }
    const inStage = stage.contains(e.target);
    if (e.touches.length === 2 && inStage) {   // 두 손가락: 확대·축소
      sx = null;
      const r = stage.getBoundingClientRect();
      pinch = { d: dist(e.touches), z: zoom, zx, zy, cx: (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left - r.width / 2, cy: (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top - r.height / 2 };
      return;
    }
    if (e.touches.length !== 1 || sliding) { sx = null; return; }
    if (zoom > 1 && inStage) { pan = { x: e.touches[0].clientX, y: e.touches[0].clientY, zx, zy }; sx = null; return; }   // 확대 중: 끌어서 이동
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; t0 = Date.now(); lock = null; dx = 0;
  };
  const onMove = (e) => {
    if (pinch && e.touches.length === 2) {
      e.preventDefault();
      const z = Math.min(5, Math.max(1, pinch.z * dist(e.touches) / pinch.d));
      const k = z / pinch.z;   // 두 손가락 가운데를 기준으로 커짐
      zoom = z; zx = pinch.cx - (pinch.cx - pinch.zx) * k; zy = pinch.cy - (pinch.cy - pinch.zy) * k;
      clampPan(); applyZoom(false);
      return;
    }
    if (pan && e.touches.length === 1) {
      e.preventDefault();
      zx = pan.zx + (e.touches[0].clientX - pan.x); zy = pan.zy + (e.touches[0].clientY - pan.y);
      clampPan(); applyZoom(false);
      return;
    }
    if (sx == null) return;
    const x = e.touches[0].clientX - sx, y = e.touches[0].clientY - sy;
    if (!lock) {
      if (Math.abs(x) < 8 && Math.abs(y) < 8) return;
      lock = Math.abs(x) > Math.abs(y) * 1.2 ? "h" : "v";
      // 맨 위(또는 전체 화면)에서 아래로 쓸면 닫기
      if (lock === "v" && y > 0 && zoom === 1 && (full || el.scrollTop <= 0)) { lock = "d"; el.style.transition = "none"; }
    }
    if (lock === "d") {
      if (e.cancelable) e.preventDefault();
      pull = Math.max(0, y);
      el.style.transform = `translateY(${pull}px) scale(${1 - Math.min(0.12, pull / 2500)})`;
      el.style.opacity = String(1 - Math.min(0.55, pull / 700));
      return;
    }
    if (lock !== "h") return;
    e.preventDefault();
    const edge = (x > 0 && i === 0) || (x < 0 && i === items.length - 1);
    dx = edge ? x * 0.3 : x;   // 처음·마지막 사진에서는 살짝만 끌림
    setX(dx, false);
  };
  const onEnd = (e) => {
    if (pinch) { if (e.touches.length < 2) { pinch = null; if (zoom < 1.05) resetZoom(true); } return; }
    if (pan) { pan = null; return; }
    if (sx == null) return;
    if (lock === "d") {   // 아래로 쓸기: 충분히 내렸으면 닫고, 아니면 제자리로
      sx = null;
      const fast = pull / Math.max(1, Date.now() - t0) > 0.5;
      el.style.transition = "transform .22s cubic-bezier(.2,.8,.2,1), opacity .22s ease";
      if (pull > 110 || (fast && pull > 40)) {
        el.style.transform = "translateY(60%) scale(.9)"; el.style.opacity = "0";
        setTimeout(() => history.back(), 180);
      } else { el.style.transform = ""; el.style.opacity = ""; }
      pull = 0;
      return;
    }
    if (lock !== "h") {   // 움직이지 않은 짧은 탭: 한 번 = 전체 화면 켜고 끄기, 두 번 = 확대/원래대로
      if (!lock && stage.contains(e.target) && Date.now() - t0 < 250) {
        const now = Date.now();
        clearTimeout(tapTimer);
        if (now - lastTap >= 300) tapTimer = setTimeout(() => { if (zoom === 1 && !closed) setFull(!full); }, 300);
        if (now - lastTap < 300) {
          lastTap = 0;
          if (zoom > 1) resetZoom(true);
          else {
            const r = stage.getBoundingClientRect();
            const px = sx - r.left - r.width / 2, py = sy - r.top - r.height / 2;
            zoom = 2.5; zx = -px * 1.5; zy = -py * 1.5; clampPan(); applyZoom(true);
          }
        } else lastTap = now;
      }
      sx = null; return;
    }
    sx = null;
    const fast = Math.abs(dx) / Math.max(1, Date.now() - t0) > 0.45;
    if (Math.abs(dx) > stage.clientWidth * 0.22 || (fast && Math.abs(dx) > 30)) slide(dx < 0 ? 1 : -1);
    else setX(0, true);   // 제자리로
  };
  const el = h("div", { class: "viewer", role: "dialog", "aria-modal": "true" },
    h("div", { class: "vtop" }, h("button", { class: "vbtn", "aria-label": "닫기", onclick: () => history.back() }, icon("close")), counter, fullBtn, favBtn),
    stage, info);
  el.addEventListener("touchstart", onStart, { passive: true });
  el.addEventListener("touchmove", onMove, { passive: false });
  el.addEventListener("touchend", onEnd);
  el.addEventListener("touchcancel", onEnd);
  document.body.append(el);
  document.body.style.overflow = "hidden";
  try { if (window.VidShelfApp) VidShelfApp.setDark(true); } catch (er) {}   // 사진 보기는 검은 바탕이라 위아래 막대도 검게
  history.pushState({ viewer: true }, "");   // 휴대폰 뒤로 가기로 닫히게
  window.addEventListener("popstate", onPop);
  document.addEventListener("keydown", onKey);
  show(i);
}

function videoCard(v) {
  const img = h("img", { loading: "lazy", alt: "" });
  const noimg = h("div", { class: "noimg" }, "미리보기 준비 중");
  if (v.thumbs > 0) { img.src = hdSrc(thumbUrl(v.id, 0, v.thumbs)); noimg.hidden = true; }
  else { img.hidden = true; img.dataset.retry = thumbUrl(v.id, 0, "x"); }
  img.onload = () => { img.hidden = false; noimg.hidden = true; delete img.dataset.retry; };
  img.onerror = () => { img.hidden = true; noimg.hidden = false; };

  const nFrames = Math.max(0, (v.thumbs || 0) - 1);
  const scrub = h("div", { class: "scrub" }, Array.from({ length: nFrames }, () => h("i")));
  const thumb = h("div", { class: "thumb" }, img, noimg,
    resLabel(v.width, v.height) ? h("span", { class: "badge res" }, resLabel(v.width, v.height)) : null,
    v.favorite ? h("span", { class: "badge fav" }, ico("heart", "filled")) : null,
    v.duration ? h("span", { class: "badge dur" }, fmtDur(v.duration)) : null,
    v.resume_pos > 5 && v.duration ? h("div", { class: "progress", style: `width:${Math.min(100, (v.resume_pos / v.duration) * 100)}%` }) : null,
    scrub);

  // 마우스를 올리고 좌우로 움직이면 영상 여러 지점 미리보기
  if (nFrames > 0) {
    const show = (i) => {
      img.src = thumbUrl(v.id, i + 1, v.thumbs);
      scrub.querySelectorAll("i").forEach((el, j) => el.classList.toggle("on", j === i));
    };
    thumb.addEventListener("pointermove", (e) => {
      if (e.pointerType !== "mouse") return;
      const r = thumb.getBoundingClientRect();
      show(Math.min(nFrames - 1, Math.floor(((e.clientX - r.left) / r.width) * nFrames)));
    });
    thumb.addEventListener("pointerleave", () => { img.src = thumbUrl(v.id, 0, v.thumbs); });
  }
  return h("a", { class: "card", href: `#/v/${v.id}` }, thumb,
    h("div", { class: "title", title: v.title }, v.title),
    h("div", { class: "sub" },
      v.rating ? h("span", { class: "stars-mini", "aria-label": `별점 ${v.rating}` }, Array.from({ length: v.rating }, () => ico("star", "filled"))) : null,
      v.play_count ? h("span", {}, `${v.play_count}회 재생`) : null,
      h("span", {}, fmtSize(v.size))));
}

// ---------------------------------------------------------------- video page
let player = null, progressTimer = null;
function stopPlayer() {
  clearInterval(progressTimer);
  if (player) { player.pause(); player.removeAttribute("src"); player.load(); player = null; }
}

async function renderVideo(id, params) {
  setTab("videos");
  let v = await api(`videos/${id}`);
  const [allTags, allPerformers] = await Promise.all([api("tags"), api("performers")]);

  // --- player (직접 재생 / 호환 모드)
  const canTranscode = v.can_transcode !== false;
  let mode = v.direct_play || !canTranscode ? "direct" : "transcode";
  let offset = 0;           // 호환 모드에서 스트림 시작 지점
  let counted = false;
  const video = h("video", { playsinline: true, preload: "metadata", poster: v.thumbs ? thumbUrl(v.id, 0, v.thumbs) : null });
  player = video;
  const seek = h("input", { type: "range", min: 0, max: Math.floor(v.duration || 0), step: 1, value: 0 });
  const seekLabel = h("span", { class: "meta" }, "0:00");
  const seekRow = h("div", { class: "seekrow", hidden: mode !== "transcode" }, seek, seekLabel);
  const modeNote = h("span");
  const modeBtn = h("button", { class: "btn sm", onclick: () => {
    const t = currentTime();
    setMode(mode === "direct" ? "transcode" : "direct", t, !video.paused);
  } });

  const currentTime = () => (mode === "transcode" ? offset : 0) + (video.currentTime || 0);
  let onAutoplayBlocked = () => {};   // 자동 재생이 막히면 조작부를 보여 줌 (아래에서 정함)
  function setMode(m, t = 0, autoplay = false) {
    mode = m;
    if (m === "direct") {
      offset = 0;
      video.src = `/media/${v.id}`;
      video.addEventListener("loadedmetadata", () => { if (t) video.currentTime = t; }, { once: true });
    } else {
      offset = Math.max(0, Math.floor(t));
      video.src = `/transcode/${v.id}?t=${offset}`;
    }
    seekRow.hidden = m !== "transcode";
    modeNote.textContent = m === "direct" ? "원본 재생" : "호환 모드 (실시간 변환 · 아래 막대로 이동)";
    modeBtn.textContent = m === "direct" ? "재생이 안 되면: 호환 모드" : "원본으로 재생";
    if (autoplay) video.play().catch(() => onAutoplayBlocked());
  }
  function seekTo(t, play = true) {
    if (mode === "transcode") setMode("transcode", t, play);
    else { video.currentTime = t; if (play) video.play().catch(() => {}); }
  }
  seek.addEventListener("input", () => (seekLabel.textContent = fmtDur(+seek.value)));
  seek.addEventListener("change", () => seekTo(+seek.value));
  video.addEventListener("timeupdate", () => {
    if (mode === "transcode" && document.activeElement !== seek) {
      seek.value = Math.floor(currentTime()); seekLabel.textContent = `${fmtDur(currentTime())} / ${fmtDur(v.duration)}`;
    }
  });
  video.addEventListener("loadedmetadata", () => {
    // MEGA 영상처럼 길이를 모르는 경우 재생하면서 알게 된 길이를 저장
    const body = {};
    if (!v.duration && mode === "direct" && isFinite(video.duration) && video.duration > 0) {
      v.duration = video.duration; seek.max = Math.floor(v.duration); body.duration = v.duration;
    }
    if (!v.width && video.videoWidth) {   // 실제 해상도를 기억해 이미지 벽 비율에 사용
      v.width = video.videoWidth; v.height = video.videoHeight; body.width = v.width; body.height = v.height;
    }
    if (Object.keys(body).length) api(`videos/${v.id}/progress`, { method: "POST", body: { pos: video.currentTime || 0, ...body } }).catch(() => {});
  });
  video.addEventListener("play", () => {
    if (!counted) { counted = true; api(`videos/${v.id}/play`, { method: "POST" }).catch(() => {}); }
  });
  window.__nativeClosed = (id, pos) => { if (String(id) === String(v.id) && pos > 0) { try { video.currentTime = pos; } catch (e) {} } };
  const goNative = (why) => {
    if (!hasNativePlayer()) { toast(why); return; }
    toast("이 형식은 앱 플레이어로 재생합니다");
    playNative(v, currentTime());
  };
  video.addEventListener("error", () => {
    if (mode === "direct" && video.error && !canTranscode) {
      goNative("이 영상 형식은 브라우저에서 재생할 수 없습니다");
    } else if (mode === "direct" && video.error) {
      toast("이 형식은 바로 재생할 수 없어 호환 모드로 전환합니다");
      setMode("transcode", 0, true);
    }
  });
  let watchedSecs = 0, lastTick = null;   // 실제로 본 시간 (통계용)
  video.addEventListener("timeupdate", () => {
    const t = video.currentTime;
    if (lastTick != null && !video.paused) { const d = t - lastTick; if (d > 0 && d < 2) watchedSecs += d; }
    lastTick = t;
  });
  video.addEventListener("seeking", () => { lastTick = null; });
  const saveProgress = () => {
    const t = currentTime();
    if (t > 0) api(`videos/${v.id}/progress`, { method: "POST", body: { pos: t > v.duration - 10 ? 0 : t } }).catch(() => {});
    if (watchedSecs >= 1) { const sec = Math.round(watchedSecs); watchedSecs = 0; api(`videos/${v.id}/watched`, { method: "POST", body: { secs: sec } }).catch(() => {}); }
  };
  video.addEventListener("pause", saveProgress);
  progressTimer = setInterval(() => { if (!video.paused) saveProgress(); }, 10000);

  const startAt = params.get("t") != null ? +params.get("t") : 0;
  setMode(mode, startAt, true);   // 영상을 누르고 들어오면 바로 재생
  const resume = v.resume_pos > 5 && !params.get("t")
    ? h("button", { class: "btn sm", onclick: (e) => { e.target.remove(); seekTo(v.resume_pos); } }, ico("play", "in"), `${fmtDur(v.resume_pos)}부터 이어보기`)
    : null;

  // --- 재생 조작부: 처음에는 아무것도 가리지 않고, 화면을 누르면 나타났다가 잠시 뒤 사라짐
  const svgIco = (name) => ico(name);
  const PLAY = "play", PAUSE = "pause";
  const centerBtn = h("button", { class: "vp-center", "aria-label": "재생/일시정지" });
  const playBtn = h("button", { class: "vp-btn", "aria-label": "재생/일시정지" });
  const timeEl = h("span", { class: "vp-time" }, "0:00");
  const fill = h("div", { class: "vp-fill" });
  const track = h("div", { class: "vp-track" }, h("div", { class: "vp-rail" }, fill));
  const fsBtn = h("button", { class: "vp-btn", "aria-label": "전체 화면" }, svgIco("full"));
  const remainEl = h("span", { class: "vp-time" }, "");
  // 이전·다음 영상: 영상을 연 목록의 순서대로
  let queue = [];
  try { queue = JSON.parse(sessionStorage.getItem("vs_queue") || "[]"); } catch (e) {}
  const qi = queue.indexOf(String(v.id));
  const prevId = qi > 0 ? queue[qi - 1] : null, nextId = qi >= 0 && qi < queue.length - 1 ? queue[qi + 1] : null;
  const goVideo = (id) => { if (id) location.replace(`#/v/${id}`); };   // 뒤로 가기는 목록으로 바로 돌아가도록 기록을 바꿈
  const prevBtn = h("button", { class: "vp-skip", "aria-label": "이전 영상", disabled: !prevId, onclick: (e) => { e.stopPropagation(); goVideo(prevId); } },
    svgIco("prev"));
  const nextBtn = h("button", { class: "vp-skip", "aria-label": "다음 영상", disabled: !nextId, onclick: (e) => { e.stopPropagation(); goVideo(nextId); } },
    svgIco("nextv"));
  // 연속 재생: 영상이 끝나면 목록의 다음 영상으로 (몇 초 기다리는 동안 취소 가능)
  const upNext = h("div", { class: "vp-upnext", hidden: true });
  let upTimer = null;
  const cancelUpNext = () => { clearInterval(upTimer); upTimer = null; upNext.hidden = true; };
  video.addEventListener("ended", () => {
    if (!nextId || !autoNextOn()) return;
    let n = 5;
    const label = h("span", {}, `${n}초 뒤 다음 영상`);
    upNext.replaceChildren(label,
      h("button", { class: "btn sm primary", onclick: (e) => { e.stopPropagation(); cancelUpNext(); goVideo(nextId); } }, "지금 보기"),
      h("button", { class: "btn sm", onclick: (e) => { e.stopPropagation(); cancelUpNext(); } }, "취소"));
    upNext.hidden = false;
    upTimer = setInterval(() => {
      n--;
      if (n <= 0) { cancelUpNext(); goVideo(nextId); return; }
      label.textContent = `${n}초 뒤 다음 영상`;
    }, 1000);
  });
  video.addEventListener("play", cancelUpNext);
  const ui = h("div", { class: "vp-ui" }, fsBtn,
    h("div", { class: "vp-mid" }, prevBtn, centerBtn, nextBtn),
    h("div", { class: "vp-times" }, timeEl, remainEl));
  // 재생 막대는 항상 영상 바닥에 있고 바로 끌어서 옮길 수 있음
  const playerBox = h("div", { class: "player vp" }, video, ui, track, upNext);
  attachLoading(video, playerBox);
  holdFast(playerBox, video);
  if (v.thumbs > 0) tintPage(thumbUrl(v.id, 0, v.thumbs));   // 이 영상의 색으로 화면을 물들임
  const dur = () => v.duration || (isFinite(video.duration) ? video.duration : 0);
  const drawPlay = () => {
    const d = video.paused ? PLAY : PAUSE;
    centerBtn.replaceChildren(svgIco(d)); playBtn.replaceChildren(svgIco(d));
    playerBox.classList.toggle("paused", video.paused);
  };
  let hideTimer;
  const showUi = (stay) => {
    playerBox.classList.add("ui-on");
    clearTimeout(hideTimer);
    if (!stay && !video.paused) hideTimer = setTimeout(() => { if (!scrub.isDragging()) playerBox.classList.remove("ui-on"); }, 2800);
  };
  const togglePlay = () => { if (video.paused) video.play().catch(() => {}); else video.pause(); showUi(); };
  centerBtn.onclick = (e) => { e.stopPropagation(); togglePlay(); };
  playBtn.onclick = (e) => { e.stopPropagation(); togglePlay(); };
  fsBtn.onclick = (e) => {
    e.stopPropagation();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (playerBox.requestFullscreen) playerBox.requestFullscreen().catch(() => video.webkitEnterFullscreen && video.webkitEnterFullscreen());
    else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
  };
  // 한 번 누르면 조작부 보이기/숨기기, 왼쪽·오른쪽을 두 번 빠르게 누르면 10초 뒤로/앞으로 (유튜브처럼)
  let tapTimer = null, lastTapAt = 0, lastSide = 0, seekStack = 0, stackTimer = null;
  const ripple = h("div", { class: "vp-ripple", "aria-hidden": "true" });
  playerBox.append(ripple);
  const toggleUi = () => { if (playerBox.classList.contains("ui-on")) { playerBox.classList.remove("ui-on"); clearTimeout(hideTimer); } else showUi(); };
  playerBox.addEventListener("click", (e) => {
    if (e.target.closest("button, .vp-track")) return;
    const r = playerBox.getBoundingClientRect(), x = (e.clientX - r.left) / r.width;
    const side = x < 0.38 ? -1 : x > 0.62 ? 1 : 0;
    const now = Date.now();
    if (side && side === lastSide && now - lastTapAt < 320) {   // 두 번째 탭 (계속 두드리면 10초씩 더)
      clearTimeout(tapTimer); tapTimer = null;
      lastTapAt = now;
      const d = dur();
      const t = Math.min(Math.max(0, currentTime() + side * 10), d ? d - 0.5 : Infinity);
      seekTo(t, !video.paused);
      seekStack += 10;
      ripple.className = "vp-ripple show " + (side > 0 ? "right" : "left");
      ripple.textContent = (side > 0 ? "" : "« ") + `${seekStack}초` + (side > 0 ? " »" : "");
      clearTimeout(stackTimer);
      stackTimer = setTimeout(() => { seekStack = 0; ripple.className = "vp-ripple"; }, 650);
      return;
    }
    lastTapAt = now; lastSide = side;
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => { tapTimer = null; toggleUi(); }, side ? 260 : 0);
  });
  video.addEventListener("play", () => { drawPlay(); if (playerBox.classList.contains("ui-on")) showUi(); });
  video.addEventListener("pause", () => { drawPlay(); showUi(true); });
  video.addEventListener("timeupdate", () => {
    if (scrub.isDragging()) return;
    const d = dur(), t = currentTime();
    const pct = d ? `${Math.min(100, (t / d) * 100)}%` : "0";
    fill.style.width = pct;
    timeEl.textContent = fmtDur(t);
    remainEl.textContent = d ? "-" + fmtDur(Math.max(0, d - t)) : "";
  });
  const scrub = attachScrub(track, fill, {
    duration: dur,
    onSeek: (t) => { seekTo(t, !video.paused); showUi(); },
    previewSrc: () => (mode === "direct" ? `/media/${v.id}` : null),
    maxBox: () => {   // 가운데 재생/일시정지 버튼을 가리지 않는 높이까지만
      const H = playerBox.clientHeight, mid = playerBox.querySelector(".vp-mid");
      const midBottom = mid ? mid.getBoundingClientRect().bottom - playerBox.getBoundingClientRect().top : H / 2 + 27;
      return { w: 176, h: Math.max(34, H - 26 - 10 - midBottom - 6) };
    },
    onDrag: (t) => { showUi(true); timeEl.textContent = fmtDur(t); remainEl.textContent = "-" + fmtDur(Math.max(0, dur() - t)); },
  });
  drawPlay();
  onAutoplayBlocked = () => { drawPlay(); showUi(true); };

  // --- 아래 정보: 평소에는 간단히, ‘수정’을 누르면 고칠 수 있게
  let editing = false;
  const infoBox = h("div", { class: "vinfo-box" });
  async function save(patch) {
    v = Object.assign(v, await api(`videos/${v.id}`, { method: "PATCH", body: patch }));
    drawInfo();
  }
  const setEditing = (on) => {
    editing = on;
    infoBox.classList.add("swapping");   // 보기 ↔ 수정 전환할 때만 살짝 움직임
    drawInfo();
    setTimeout(() => infoBox.classList.remove("swapping"), 400);
  };

  // 장면 (누르면 그 지점으로)
  const nFrames = Math.max(0, (v.thumbs || 0) - 1);
  const frames = nFrames ? h("div", { class: "framestrip" }, Array.from({ length: nFrames }, (_, i) => {
    const t = v.duration * ((i + 1 - 0.5) / nFrames);
    return h("img", { src: thumbUrl(v.id, i + 1, v.thumbs), loading: "lazy", title: fmtDur(t), onclick: () => seekTo(t) });
  })) : null;

  const favBtn = () => h("button", { class: "favbtn" + (v.favorite ? " on" : ""), onclick: () => save({ favorite: !v.favorite }) }, ico("heart", v.favorite ? "in filled" : "in"), "즐겨찾기");
  const dlBtn = () => v.source === "mega" || v.source === "icloud" ? h("a", { class: "btn sm", href: `/media/${v.id}?dl=1` }, "휴대폰에 저장")
    : v.can_delete === false ? null : h("a", { class: "btn sm", href: `/media/${v.id}`, download: v.filename }, "다운로드");
  const addMarker = async (titleIn) => {
    v.markers = await api(`videos/${v.id}/markers`, { method: "POST", body: { seconds: currentTime(), title: titleIn ? titleIn.value.trim() : "" } });
    toast(`${fmtDur(currentTime())} 북마크를 추가했습니다`); drawInfo();
  };

  function readView() {
    const stat = (big, small) => h("div", {}, h("b", {}, big), h("span", {}, small));
    const shotAt = v.taken || v.added_at;   // 찍은 날 (없으면 추가한 날)
    const people = v.performers.map((p) => {
      const info = allPerformers.find((x) => x.id === p.id) || {};
      const a = info.birthdate && shotAt ? ageAt(info.birthdate, shotAt) : null;
      return h("div", { class: "vperson" },
      h("span", { class: "av", "aria-hidden": "true" }, p.name.slice(0, 1)),
      h("span", { class: "nm" }, p.name, a != null ? h("span", { class: "shot-age" }, ` · 촬영 당시 만 ${a}세`) : null),
      h("a", { class: "pf", href: `#/performer?id=${p.id}` }, "프로필"));
    });
    const tags = v.tags.map((t) => h("a", { class: "chip", href: `#/?tag=${t.id}` }, "#" + t.name));
    // 영상 바로 아래 큰 버튼 줄: 누르면 작은 창에서 바로 고침 (‘수정’ 화면을 거치지 않음)
    const vact = (name, label, fn, on) => h("button", { class: "vact" + (on ? " on" : ""), onclick: fn }, h("i", { "aria-hidden": "true" }, ico(name)), label);
    const actRow = h("div", { class: "vacts" },
      vact("heart", "즐겨찾기", () => save({ favorite: !v.favorite }), !!v.favorite),
      vact("tag", "태그", () => quickLinks("tags")),
      vact("person", "사람", () => quickLinks("performers")),
      vact("bookmark", "북마크", () => addMarker(null)),
      vact("edit", "수정", () => setEditing(true)));   // 제목·별점·썸네일·메모·북마크 정리
    return [
      actRow,
      h("div", { class: "vcard" },
        h("div", { class: "vhead" },
          h("h1", { class: "vtitle" }, v.title),
          null),
        h("div", { class: "vstats" },
          stat(v.duration ? fmtDur(v.duration) : "-", "길이"),
          stat(resLabel(v.width, v.height) || "-", "화질"),
          stat(v.rating ? "★" + v.rating : "-", "별점"),
          stat(`${v.play_count || 0}회`, "재생")),
        ...people,
        tags.length ? h("div", { class: "chips" }, ...tags) : null),
      h("div", { class: "actions", style: "margin-top:12px" }, dlBtn(),
        h("span", { class: "meta" }, (v.source !== "local" ? SOURCE_LABEL[v.source] + " · " : "") + fmtSize(v.size))),
      v.details ? h("p", { class: "vmemo" }, v.details) : null,
      v.markers.length ? h("div", { class: "vmarks" }, v.markers.map((m) =>
        h("button", { onclick: () => seekTo(m.seconds) }, h("b", {}, fmtDur(m.seconds)), h("span", {}, m.title || "북마크")))) : null,
      frames ? h("div", { class: "panel", style: "margin-top:14px" }, h("h3", {}, "장면"), frames) : null,
    ];
  }

  /** 태그·사람 바로 고치기 (작은 창) */
  function quickLinks(field) {
    const isTag = field === "tags", label = isTag ? "태그" : "출연한 사람";
    const all = isTag ? allTags : allPerformers;
    const box = h("div", { class: "sheet-body-inner" });
    const input = h("input", { type: "text", list: "dl-q-" + field, placeholder: `${label} 이름 입력 (Enter)`, "aria-label": `${label} 추가`, id: "quick-" + field });
    const add = async (names) => {
      names = names.map((x) => x.trim()).filter(Boolean);
      if (!names.length) return;
      if (isTag) rememberTags(names);
      await save({ [field]: v[field].map((t) => t.name).concat(names) });
      input.value = ""; draw();
    };
    const draw = () => {
      const cur = v[field];
      const curNames = new Set(cur.map((t) => t.name));
      const sugg = (isTag ? recentTags().map((n) => ({ name: n })) : allPerformers.slice().sort((a, b) => (b.count || 0) - (a.count || 0)))
        .filter((t) => !curNames.has(t.name)).slice(0, 10);
      box.replaceChildren(
        h("div", { class: "chips" }, ...(cur.length ? cur.map((t) => h("span", { class: "chip" }, (isTag ? "#" : "") + t.name,
          h("button", { "aria-label": `${t.name} 빼기`, onclick: async () => { await save({ [field]: cur.filter((x) => x.id !== t.id).map((x) => x.name) }); draw(); } }, ico("close", "x"))))
          : [h("span", { class: "meta" }, `아직 ${label}이(가) 없습니다`)])),
        h("div", { class: "taginput" }, input, h("button", { class: "btn primary", onclick: () => add(input.value.split(",")) }, "추가")),
        sugg.length ? h("div", { class: "sheet-sec" }, h("h3", {}, isTag ? "최근 쓴 태그" : "자주 나오는 사람"),
          h("div", { class: "chips" }, ...sugg.map((t) => h("button", { class: "chip dashed", onclick: () => add([t.name]) }, "+ " + (isTag ? "#" : "") + t.name)))) : null,
        h("datalist", { id: "dl-q-" + field }, all.map((t) => h("option", { value: t.name }))));
    };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(input.value.split(",")); } });
    draw();
    openSheet(isTag ? "태그" : "출연한 사람", [box]);
  }
  function editView() {
    const titleIn = h("input", { type: "text", value: v.title, onchange: (e) => save({ title: e.target.value.trim() || v.title }) });
    const stars = h("div", { class: "stars" }, ...[1, 2, 3, 4, 5].map((n) =>
      h("button", { class: n <= v.rating ? "on" : "", title: `${n}점`, onclick: () => save({ rating: v.rating === n ? 0 : n }) }, ico("star"))));
    const editor = (field, all, label, prefix) => {
      const listId = "dl-" + field;
      const input = h("input", { type: "text", list: listId, placeholder: `${label} 추가 (Enter)` });
      const add = () => {
        const names = input.value.split(",").map((x) => x.trim()).filter(Boolean);
        if (names.length) save({ [field]: v[field].map((t) => t.name).concat(names) });
      };
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });
      return h("div", { class: "panel" }, h("h3", {}, label),
        h("div", { class: "chips" }, ...(v[field].length ? v[field].map((t) => h("span", { class: "chip" }, prefix + t.name,
          h("button", { title: "제거", "aria-label": `${t.name} 제거`, onclick: () => save({ [field]: v[field].filter((x) => x.id !== t.id).map((x) => x.name) }) }, ico("close", "x"))))
          : [h("span", { class: "meta" }, "없음")])),
        h("div", { class: "taginput" }, input, h("button", { class: "btn", onclick: add }, "추가")),
        h("datalist", { id: listId }, all.map((t) => h("option", { value: t.name }))));
    };
    const markerTitle = h("input", { type: "text", placeholder: "북마크 이름 (선택)" });
    const markers = h("ul", { class: "markers" }, ...(v.markers.length ? v.markers.map((m) => h("li", {},
      h("button", { class: "btn sm t", onclick: () => seekTo(m.seconds) }, fmtDur(m.seconds)),
      h("span", { class: "mt" }, m.title || ""),
      h("button", { class: "btn sm danger", title: "삭제", onclick: async () => {
        await api(`markers/${m.id}`, { method: "DELETE" });
        v.markers = v.markers.filter((x) => x.id !== m.id); drawInfo();
      } }, ico("close", "x")))) : [h("li", { class: "meta" }, "북마크가 없습니다.")]));
    const details = h("textarea", { rows: 3, placeholder: "메모", onchange: (e) => save({ details: e.target.value }) });
    details.value = v.details || "";
    const info = h("dl", { class: "info" },
      ...[["파일", v.filename], ["폴더", v.folder], ["길이", fmtDur(v.duration)],
        ["해상도", v.width ? `${v.width}×${v.height} (${resLabel(v.width, v.height)})` : "-"],
        ["코덱", [v.vcodec, v.acodec].filter(Boolean).join(" / ") || "-"],
        ["프레임", v.fps ? `${v.fps} fps` : "-"], ["비트레이트", v.bitrate ? `${(v.bitrate / 1e6).toFixed(1)} Mbps` : "-"],
        ["크기", fmtSize(v.size)], ["재생", `${v.play_count}회 · 마지막 ${fmtDate(v.last_played)}`],
        ["추가", fmtDate(v.added_at)]].flatMap(([k, val]) => [h("dt", {}, k), h("dd", {}, val)]));
    const removeBtn = h("button", { class: "btn danger sm", onclick: async () => {
      if (!confirm("라이브러리에서 이 영상을 제거할까요?\n(파일은 지우지 않습니다. 다음 스캔 때 다시 추가될 수 있습니다)")) return;
      await api(`videos/${v.id}`, { method: "DELETE" }); toast("제거했습니다"); history.back();
    } }, "라이브러리에서 제거");
    const deleteFileBtn = v.can_delete === false ? null : h("button", { class: "btn danger sm", onclick: async () => {
      if (!confirm(`파일을 휴대폰에서 완전히 삭제합니다.\n${v.filename}\n\n되돌릴 수 없습니다. 계속할까요?`)) return;
      await api(`videos/${v.id}?file=1`, { method: "DELETE" }); toast("파일을 삭제했습니다"); location.hash = "#/";
    } }, "파일 삭제");
    const coverBtn = h("button", { class: "btn sm", onclick: async () => {   // 지금 보이는 장면을 썸네일로
      if (!video.videoWidth) { toast("영상이 재생되기 시작한 뒤에 눌러 주세요"); return; }
      const w = Math.min(1280, video.videoWidth), hh = Math.round((w * video.videoHeight) / video.videoWidth);
      const cv = h("canvas", { width: w, height: hh });
      try {
        cv.getContext("2d").drawImage(video, 0, 0, w, hh);
        await api(`videos/${v.id}/cover`, { method: "POST", body: { image: cv.toDataURL("image/jpeg", 0.88) } });
        video.poster = cv.toDataURL("image/jpeg", 0.6);
        toast(`${fmtDur(currentTime())} 장면을 썸네일로 정했습니다`);
      } catch (e) { toast("썸네일을 만들지 못했습니다: " + e.message); }
    } }, ico("frame", "in"), "지금 장면을 썸네일로");
    const coverFile = h("input", { type: "file", accept: "image/*", hidden: true });
    coverFile.onchange = async () => {   // 기기의 사진으로 썸네일 정하기
      const f = coverFile.files && coverFile.files[0];
      coverFile.value = "";
      if (!f) return;
      try {
        const url = URL.createObjectURL(f);
        const img = await new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => no(new Error("사진을 열 수 없습니다")); im.src = url; });
        const w = Math.min(1280, img.naturalWidth), hh = Math.round((w * img.naturalHeight) / img.naturalWidth);
        const cv = h("canvas", { width: w, height: hh });
        cv.getContext("2d").drawImage(img, 0, 0, w, hh);
        URL.revokeObjectURL(url);
        await api(`videos/${v.id}/cover`, { method: "POST", body: { image: cv.toDataURL("image/jpeg", 0.88) } });
        video.poster = cv.toDataURL("image/jpeg", 0.6);
        toast("고른 사진을 썸네일로 정했습니다");
      } catch (e) { toast("썸네일을 바꾸지 못했습니다: " + e.message); }
    };
    const coverPickBtn = h("button", { class: "btn sm", onclick: () => coverFile.click() }, ico("camera", "in"), "기기 사진으로");
    const coverResetBtn = h("button", { class: "btn sm", onclick: async () => {
      await api(`videos/${v.id}/cover`, { method: "DELETE" }); toast("기본 썸네일로 되돌렸습니다");
    } }, "기본 썸네일로");
    const regenBtn = h("button", { class: "btn sm", onclick: async () => {
      await api(`videos/${v.id}/thumbs`, { method: "POST" }); toast("미리보기를 다시 만듭니다");
    } }, "미리보기 다시 만들기");
    return [
      h("div", { class: "vhead" }, h("h2", { style: "margin:0;font-size:17px" }, "영상 정보 수정"),
        h("button", { class: "btn sm primary", onclick: () => setEditing(false) }, "완료")),
      h("div", { class: "panel" }, h("h3", {}, "썸네일"),
        h("p", { class: "meta", style: "margin-top:0" }, "영상을 원하는 장면에서 멈춘 뒤 누르거나, 기기에 있는 사진을 고르세요. 목록과 홈에 썸네일로 나옵니다."),
        h("div", { class: "row" }, coverBtn, coverPickBtn, coverResetBtn, coverFile)),
      h("div", { class: "panel" }, h("h3", {}, "제목"), titleIn,
        h("div", { class: "actions", style: "margin-top:10px" }, stars, favBtn())),
      editor("performers", allPerformers, "출연한 사람", ""),
      editor("tags", allTags, "태그", "# "),
      h("div", { class: "panel" }, h("h3", {}, "북마크"), markers,
        h("div", { class: "taginput" }, markerTitle, h("button", { class: "btn", onclick: () => addMarker(markerTitle) }, "현재 위치 추가"))),
      h("div", { class: "panel" }, h("h3", {}, "메모"), details),
      h("div", { class: "panel" }, h("h3", {}, "파일 정보"), info,
        h("div", { class: "row", style: "margin-top:12px" }, regenBtn, removeBtn, deleteFileBtn)),
    ];
  }
  function drawInfo() { infoBox.replaceChildren(...(editing ? editView() : readView()).filter(Boolean)); }

  const moreBox = h("div", { class: "watch-more" });
  $app.replaceChildren(h("div", { class: "watch1" },
    playerBox,
    seekRow,
    h("div", { class: "player-note" }, canTranscode ? modeNote : null, canTranscode ? modeBtn : null, resume),
    infoBox, moreBox));
  drawInfo();
  // 이 영상에 나온 사람의 다른 영상 (사람마다 한 줄, 최대 두 사람)
  (v.performers || []).slice(0, 2).forEach(async (pf) => {
    try {
      const d = await api(`videos?performer=${pf.id}&sort=random&seed=${v.id}&per=13`);
      const others = (d.items || []).filter((x) => x.id !== v.id).slice(0, 12);
      if (!others.length || !moreBox.isConnected) return;
      const row = shelf(`${pf.name}의 다른 영상`, `#/performer?id=${pf.id}`, "vids");
      row.fill(others.map((x) => videoCard(x)));
      moreBox.append(row.sec);
    } catch (e) {}
  });
}

// ---------------------------------------------------------------- tags / performers
function entityCover(e, fallback) {
  const src = e.cover ? thumbUrl(e.cover, 0, "c") : e.photo_cover ? `/photothumb/${e.photo_cover}.jpg` : null;
  if (!src) return h("div", { class: "noimg" }, fallback);
  const img = h("img", { src, loading: "lazy", alt: "" });
  img.onerror = () => { img.replaceWith(h("div", { class: "noimg" }, fallback)); };
  return img;
}


// ---------------------------------------------------------------- settings
/** 설정 아이콘 (선 그림) */
const SET_ALIAS = { display: "theme", broom: "tidy" };
const SET_TINT = { trophy: 4, theme: 1, folder: 4, cloud: 3, heart: 2, tidy: 5, backup: 3, lock: 4, info: 1, gear: 1, history: 1, stats: 5, dup: 4, hidden: 2 };
function setIcon(name) {
  const n = SET_ALIAS[name] || name;
  return h("span", { class: "set-ico t" + (SET_TINT[n] || 1) }, ico(n));
}

/** 설정: 첫 화면은 항목 목록, 항목을 누르면 그 항목만 보이는 화면 */
async function renderSettings(opts = {}) {
  setTab("settings");
  const section = opts.section !== undefined ? opts.section : parseHash().params.get("section");
  const reload = () => renderSettings({ section });
  const [st, status] = await Promise.all([api("settings"), api("status")]);
  const c = status.counts || {};
  const themeName = { system: "시스템 설정", light: "라이트", dark: "다크" }[themePref()] || "시스템 설정";

  const SECTIONS = [
    { group: "일반", items: [
      { id: "display", icon: "display", title: "화면과 재생", sub: `${themeName} · 연속 재생 ${autoNextOn() ? "켬" : "끔"}` },
      { id: "library", icon: "folder", title: "라이브러리와 미디어 폴더", sub: `영상 ${(c.total || 0).toLocaleString()}개 · ${st.library_all ? "휴대폰 전체" : `폴더 ${st.library_paths.length}개`}` },
      st.fav_sync !== undefined ? { id: "favorites", icon: "heart", title: "즐겨찾기 연동", sub: st.fav_sync ? (st.manage_media ? "갤러리와 연동 · 바로 반영" : "갤러리와 연동") : "앱 안에서만" } : null,
    ] },
    { group: "관리", items: [
      { id: "cleanup", icon: "broom", title: "정리", sub: [c.missing ? `찾을 수 없는 파일 ${c.missing}` : "", st.hidden_count ? `숨긴 영상 ${st.hidden_count}` : ""].filter(Boolean).join(" · ") || "중복 영상 · 숨긴 영상" },
      st.backup ? { id: "backup", icon: "backup", title: "백업 / 복원", sub: "정보를 파일로 저장하고 되살리기" } : null,
      st.platform === "android" ? null : { id: "security", icon: "lock", title: "비밀번호", sub: st.password_set ? "비밀번호 있음" : "비밀번호 없음" },   // 안드로이드 앱은 이 폰 안에서만 열려서 필요 없음
      st.platform === "android" ? null : { id: "system", icon: "info", title: "시스템", sub: "데이터 폴더 · ffmpeg" },
    ] },
  ];

  // ---- 첫 화면: 항목 목록
  if (!section) {
    $app.replaceChildren(h("div", { class: "settings" },
      h("div", { class: "home-head" }, h("div", {}, h("div", { class: "meta" }, "VidShelf"), h("h1", {}, "설정"))),
      ...SECTIONS.map((g) => h("section", { class: "set-group" },
        h("h2", { class: "set-group-title" }, g.group),
        h("div", { class: "lib-list set-list" }, g.items.filter(Boolean).map((it) =>
          h("a", { href: `#/settings?section=${it.id}` }, setIcon(it.icon),
            h("div", { class: "set-text" }, h("div", { class: "set-title" }, it.title), h("div", { class: "meta" }, it.sub)),
            h("span", { class: "chev", "aria-hidden": "true" }, ico("next"))))))),
      h("p", { class: "meta about-line" }, "VidShelf · ", h("a", { href: "https://yeezyismygoat-pixel.github.io/ClaudeRep/vidshelf/privacy/", target: "_blank", rel: "noopener" }, "개인정보처리방침"),
        " · 모든 정보는 이 휴대폰 안에만 저장됩니다")));
    return;
  }

  // ---- 하위 화면
  const info = SECTIONS.flatMap((g) => g.items).find((x) => x && x.id === section) || { title: "설정" };
  const page = (...kids) => $app.replaceChildren(h("div", { class: "settings sub" + (kids.filter(Boolean).length === 1 ? " solo" : "") },
    h("a", { class: "btn sm back-btn", href: "#/settings" }, ico("back", "in"), "설정"),
    h("h1", { class: "set-page-title" }, info.title),
    ...kids.filter(Boolean)));

  if (section === "display") {
    const sw = h("button", { class: "switch" + (autoNextOn() ? " on" : ""), role: "switch", "aria-checked": autoNextOn() ? "true" : "false", "aria-label": "연속 재생",
      onclick: () => { const on = !autoNextOn(); try { localStorage.setItem("vs-autonext", on ? "1" : "0"); } catch (e) {} sw.classList.toggle("on", on); sw.setAttribute("aria-checked", on ? "true" : "false"); } });
    return page(themePanel(), h("div", { class: "panel" }, h("h3", {}, "재생"),
      h("div", { class: "sheet-row" }, h("span", {}, "연속 재생", h("br"), h("span", { class: "meta" }, "영상이 끝나면 보던 목록의 다음 영상을 이어서 재생합니다")), sw)));
  }
  if (section === "favorites") return page(favSyncPanel(st));
  if (section === "backup") return page(backupPanel());

  if (section === "library") {
    const paths = st.library_paths.map((p) => p.path);
    const savePaths = async (list) => { await api("settings", { method: "PUT", body: { library_paths: list } }); reload(); };
    const setAll = async (on) => { await api("settings", { method: "PUT", body: { library_all: on } }); reload(); };
    const pathList = h("ul", { class: "pathlist" }, st.library_paths.length ? st.library_paths.map((p) =>
      h("li", {}, h("span", { class: "p" }, p.path, !p.exists ? h("div", { class: "warn" }, "폴더를 찾을 수 없습니다 (저장소 권한을 확인하세요)") : null),
        h("button", { class: "btn sm danger", onclick: () => savePaths(paths.filter((x) => x !== p.path)) }, "제거")))
      : h("li", { class: "meta" }, "아직 추가된 폴더가 없습니다."));
    const suggestions = st.suggestions.length ? h("div", { style: "margin-top:12px" }, h("p", { class: "meta" }, "빠르게 추가:"),
      h("div", { class: "chips" }, st.suggestions.map((sg) =>
        h("button", { class: "chip", onclick: () => savePaths(paths.concat([sg])) }, "+ " + sg.replace(/\/+$/, "").split("/").slice(-1)[0])))) : null;
    const manual = h("input", { type: "text", placeholder: "직접 입력: " + (st.example_path || "/storage/emulated/0/Movies") });
    return page(
      h("div", { class: "panel" }, h("h3", {}, "한눈에"),
        h("div", { class: "stats" },
          h("div", { class: "stat" }, h("b", {}, (c.total || 0).toLocaleString()), h("span", {}, "영상")),
          h("div", { class: "stat" }, h("b", {}, fmtSize(c.bytes)), h("span", {}, "전체 크기")),
          h("div", { class: "stat" }, h("b", {}, (c.seconds || 0) >= 3600 ? ((c.seconds / 3600).toFixed(1) + "시간") : fmtDur(c.seconds)), h("span", {}, "전체 길이")),
          h("div", { class: "stat" }, h("b", {}, c.favorites || 0), h("span", {}, "즐겨찾기")))),
      h("div", { class: "panel" }, h("h3", {}, "미디어 폴더"),
        h("div", { class: "seg lib-mode", role: "group", "aria-label": "가져올 범위" },
          h("button", { class: st.library_all ? "on" : "", onclick: () => setAll(true) }, ico("device", "in"), "휴대폰 전체"),
          h("button", { class: st.library_all ? "" : "on", onclick: () => setAll(false) }, ico("folder", "in"), "고른 폴더만")),
        st.library_all ? h("p", { class: "meta" }, "카메라, 다운로드, 메신저 등 휴대폰에 있는 모든 사진과 영상을 가져옵니다.") : null,
        st.library_all ? null : h("p", { class: "meta", style: "margin-top:0" }, "아래 폴더의 사진과 영상만 가져옵니다. ‘폴더 목록에서 고르기’에서 사진·영상이 있는 폴더를 한눈에 고를 수 있습니다."),
        st.library_all ? null : pathList,
        h("div", { class: "row" },
          st.library_all ? null : h("a", { class: "btn", href: "#/setup" }, ico("folder", "in"), "폴더 목록에서 고르기"),
          st.library_all ? null : h("button", { class: "btn", onclick: () => folderPicker((p) => savePaths(paths.concat([p]))) }, "직접 찾아보기"),
          h("button", { class: "btn primary", disabled: status.scanning || (!paths.length && !st.library_all), onclick: async () => {
            await api("scan", { method: "POST" }); toast("스캔을 시작했습니다"); setTimeout(reload, 800);
          } }, status.scanning ? "스캔 중…" : "지금 스캔")),
        st.library_all ? null : h("div", { class: "taginput" }, manual, h("button", { class: "btn", onclick: () => manual.value.trim() && savePaths(paths.concat([manual.value.trim()])) }, "추가")),
        st.library_all ? null : suggestions,
        status.last_scan ? h("p", { class: "meta" }, `마지막 스캔: ${fmtDate(status.last_scan)}`) : null));
  }

  if (section === "cleanup") {
    const row = (title, sub, action) => h("div", { class: "clean-row" }, h("div", {}, h("div", { class: "set-title" }, title), h("div", { class: "meta" }, sub)), action);
    return page(h("div", { class: "panel" },
      row("찾을 수 없는 파일", `${c.missing || 0}개 · 옮겨졌거나 삭제된 파일의 기록`,
        h("button", { class: "btn sm", disabled: !c.missing, onclick: async () => {
          const r = await api("cleanup", { method: "POST" }); toast(`${r.removed}개를 정리했습니다`); reload();
        } }, "지우기")),
      st.duplicates ? row("중복 영상·사진", "여러 폴더에 같은 영상·사진이 있는지 찾기", h("a", { class: "btn sm", href: "#/duplicates" }, "찾기")) : null,
      st.hidden_count !== undefined ? row("숨긴 영상", `${st.hidden_count}개 · 라이브러리에서 제거했거나 중복이라 숨긴 영상`, h("a", { class: "btn sm", href: "#/hidden" }, "보기")) : null));
  }

  if (section === "security") {
    const pw = h("input", { type: "password", placeholder: st.password_set ? "새 비밀번호 (비우면 해제)" : "비밀번호", autocomplete: "new-password", "aria-label": "비밀번호" });
    return page(
      h("div", { class: "panel" }, h("h3", {}, "비밀번호"),
        h("p", { class: "meta", style: "margin-top:0" }, st.password_set ? "비밀번호가 설정되어 있습니다. 같은 Wi-Fi 의 다른 기기에서 접속할 때 필요합니다." : "비밀번호가 없습니다. 다른 기기에서 접속하려면 먼저 정하세요."),
        h("div", { class: "taginput" }, pw, h("button", { class: "btn", onclick: async () => {
          await api("settings", { method: "PUT", body: { password: pw.value } });
          toast(pw.value ? "비밀번호를 설정했습니다" : "비밀번호를 해제했습니다");
          const au = await api("auth").catch(() => ({ ok: false }));
          if (au.ok) reload(); else renderLogin();
        } }, "저장"))),
      null);
  }

  if (section === "system") {
    return page(h("div", { class: "panel" },
      h("dl", { class: "info" },
        h("dt", {}, "데이터 폴더"), h("dd", {}, st.data_dir),
        h("dt", {}, "ffmpeg"), h("dd", {}, st.ffmpeg ? "사용 가능" : "없음 — pkg install ffmpeg"),
        h("dt", {}, "ffprobe"), h("dd", {}, st.ffprobe ? "사용 가능" : "없음 — pkg install ffmpeg"))));
  }
  location.hash = "#/settings";
}

// ---------------------------------------------------------------- 사람 프로필
/** 그 날(초 단위 시각) 기준 만 나이 */
function ageAt(birth, ts) {
  const b = new Date(birth + "T00:00:00"), n = new Date(ts * 1000);
  if (isNaN(b) || isNaN(n) || n < b) return null;
  let a = n.getFullYear() - b.getFullYear();
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--;
  return a;
}
function age(birth) {
  const b = new Date(birth + "T00:00:00"), n = new Date();
  if (isNaN(b)) return "?";
  let a = n.getFullYear() - b.getFullYear();
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--;
  return a;
}

async function renderPerformer(id) {
  setTab("performers");
  const p = await api(`performers/${id}`);
  const hasInfo = p.group !== undefined;   // 안드로이드 앱만 사람 정보(그룹·생일 등)를 저장
  const editing = parseHash().params.get("edit") === "1";
  const setEdit = (on) => { location.hash = `#/performer?id=${id}` + (on ? "&edit=1" : ""); };

  // --- 대표 이미지 + 이름 + 정보
  const avatar = h("div", { class: "pf-avatar" }, ico("person"));
  let avatarSet = false;   // 처음 정한 그림만 씀 (직접 고른 대표 사진이 먼저)
  const setAvatar = (src) => {
    if (!src || avatarSet) return;
    avatarSet = true;
    tintPage(src);   // 이 사람의 대표 그림 색으로 화면을 물들임
    const img = h("img", { src, alt: "" });
    img.onload = () => avatar.replaceChildren(img);
  };
  const facts = [];
  if (hasInfo) {
    if (p.aliases) facts.push(["다른 이름", p.aliases]);
    if (p.group) facts.push(["그룹", p.group]);
    if (p.real_name) facts.push(["본명", p.real_name]);
    if (p.birthdate) facts.push(["생년월일", `${p.birthdate} (만 ${age(p.birthdate)}세)`]);
    if (p.height) facts.push(["키", `${p.height}cm`]);
  }
  const counts = h("p", { class: "meta", style: "margin:4px 0 0" });
  const editBtn = h("button", { class: "btn sm" + (editing ? " primary" : ""), onclick: () => setEdit(!editing) }, editing ? "수정 닫기" : [ico("edit", "in"), "수정"]);
  const shuffleBtn = h("button", { class: "btn sm primary", onclick: async () => {   // 이 사람 영상만 무작위로 이어서
    try {
      const d = await api(`videos?performer=${id}&sort=random&seed=${Date.now() % 100000}&per=200`);
      if (!d.items.length) { toast("이 사람이 나온 영상이 없습니다"); return; }
      sessionStorage.setItem("vs_queue", JSON.stringify(d.items.map((x) => String(x.id))));
      location.hash = `#/v/${d.items[0].id}`;
    } catch (e) { toast(e.message); }
  } }, ico("play", "in"), "무작위 재생");
  const head = h("div", { class: "panel pf-head" }, avatar,
    h("div", { class: "pf-main" },
      h("div", { class: "row", style: "justify-content:space-between;flex-wrap:nowrap;align-items:flex-start" },
        h("h2", { class: "pf-name" }, p.name), editBtn),
      counts,
      h("div", { class: "row", style: "margin:8px 0 2px" }, shuffleBtn),
      facts.length ? h("dl", { class: "info pf-facts" }, ...facts.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)]))
        : hasInfo ? h("p", { class: "meta" }, "등록된 정보가 없습니다. ‘수정’에서 직접 입력할 수 있습니다.") : null,
      null));

  // --- 수정 (이름 변경 · 정보 · 삭제)
  let editPanel = null;
  if (editing) {
    const nameIn = h("input", { type: "text", id: "pf-name", value: p.name });
    const field = (key, label, placeholder, type = "text") =>
      [h("dt", {}, h("label", { for: `pf-${key}` }, label)), h("dd", {}, h("input", { type, id: `pf-${key}`, value: p[key] || "", placeholder }))];
    const val = (k) => document.getElementById(`pf-${k}`).value.trim();
    const form = h("dl", { class: "info", style: "align-items:center;font-size:15px" },
      h("dt", {}, h("label", { for: "pf-name" }, "이름")), h("dd", {}, nameIn),
      ...(hasInfo ? [...field("aliases", "다른 이름", "예: 영문 이름, 예명 (쉼표로)"), ...field("group", "그룹", "예: 하츠투하츠"), ...field("real_name", "본명", "예: 홍길동"),
        ...field("birthdate", "생년월일", "", "date"), ...field("height", "키 (cm)", "예: 165", "number")] : []));
    const saveBtn = h("button", { class: "btn primary", onclick: async (ev) => {
      ev.currentTarget.disabled = true;
      try {
        const name = nameIn.value.trim();
        if (!name) { toast("이름을 입력하세요"); ev.currentTarget.disabled = false; return; }
        let newId = id;
        if (hasInfo) await api(`performers/${id}`, { method: "PATCH", body: { info: { aliases: val("aliases"), group: val("group"), real_name: val("real_name"), birthdate: val("birthdate"), height: val("height") } } });
        if (name !== p.name) {
          if (!confirm(`이름을 ‘${name}’(으)로 바꿀까요?\n같은 이름의 사람이 이미 있으면 하나로 합쳐집니다.`)) { ev.currentTarget.disabled = false; return; }
          const r = await api(`performers/${id}`, { method: "PATCH", body: { name } });
          if (r && r.id) newId = r.id;
          if (r && r.merged) toast("같은 이름의 사람과 합쳤습니다");
        }
        toast("저장했습니다");
        location.hash = `#/performer?id=${newId}`;
      } catch (e) { toast(e.message); ev.currentTarget.disabled = false; }
    } }, "저장");
    const delBtn = h("button", { class: "btn danger", onclick: async () => {
      if (!confirm(`‘${p.name}’ 사람을 삭제할까요?\n영상과 사진은 그대로 남고, 사람 지정만 없어집니다.`)) return;
      await api(`performers/${id}`, { method: "DELETE" });
      toast("삭제했습니다");
      location.hash = "#/explore";
    } }, "사람 삭제");
    const coverBtn = h("button", { class: "btn", onclick: () => pickCover() }, ico("image", "in"), "대표 사진 고르기");
    editPanel = h("div", { class: "panel" }, h("h3", {}, "수정"),
      form,
      h("div", { class: "row", style: "margin-top:10px" }, coverBtn),
      h("div", { class: "row", style: "margin-top:12px" }, saveBtn, h("button", { class: "btn", onclick: () => setEdit(false) }, "취소")),
      hasInfo ? h("p", { class: "meta" }, "이름을 다른 사람과 같게 바꾸면 두 사람이 합쳐집니다.") : null,
      h("div", { class: "pf-danger" }, delBtn));
  }

  /** 대표 사진 고르기: 이 사람의 영상·사진 중에서 */
  async function pickCover() {
    const [vs, ps] = await Promise.all([api(`videos?performer=${id}&sort=added&order=desc&per=60`).catch(() => ({ items: [] })),
      serverCaps.photos ? api(`photos?performer=${id}&sort=taken&order=desc&per=60`).catch(() => ({ items: [] })) : { items: [] }]);
    const choose = async (val) => {
      await api(`performers/${id}`, { method: "PATCH", body: { info: { cover: val } } });
      toast(val ? "대표 사진을 바꿨습니다" : "자동으로 고르게 했습니다"); close(() => route());
    };
    const cell = (src, val) => h("button", { class: "cover-pick" + (p.cover_pick === val ? " on" : ""), onclick: () => choose(val) }, h("img", { src, loading: "lazy", alt: "" }));
    const close = openSheet("대표 사진 고르기", [
      h("div", { class: "cover-grid" },
        ...vs.items.filter((x) => x.thumbs > 0).map((x) => cell(thumbUrl(x.id, 0, x.thumbs), `video:${x.id}`)),
        ...ps.items.map((x) => cell(`/photothumb/${x.id}.jpg`, `photo:${x.id}`))),
    ], [h("button", { class: "btn", style: "grid-column: 1 / -1", onclick: () => choose("") }, "자동으로 고르기 (별점 높은 영상)")]);
  }
  if (p.cover_pick) {   // 직접 고른 대표 사진이 있으면 그것부터
    const [k, cid] = p.cover_pick.split(":");
    setAvatar(k === "photo" ? `/photothumb/${cid}.jpg` : thumbUrl(cid, 0, "c"));
  }

  // --- 영상
  const vMode = viewMode("videos");
  const vGrid = h("div", { class: vMode === "wall" ? "wall" : "grid" });
  const vMore = h("div", { class: "more" });
  const vTitle = h("h3", { class: "pf-sec" }, "영상");
  const vSection = h("section", {}, h("div", { class: "row", style: "justify-content:space-between" }, vTitle,
    h("a", { class: "btn sm", href: `#/?performer=${id}` }, "동영상 탭에서 보기")), vGrid, vMore);
  // --- 사진
  const showPhotos = serverCaps.photos;
  const pMode = viewMode("photos");
  const pGrid = h("div", { class: pMode === "wall" ? "wall" : "pgrid" });
  const pMore = h("div", { class: "more" });
  const pTitle = h("h3", { class: "pf-sec" }, "사진");
  const pSection = showPhotos ? h("section", {}, pTitle, pGrid, pMore) : null;

  // --- 선택 모드 (꾹 눌러 여러 개 골라 태그·사람·날짜·즐겨찾기·삭제)
  const selHolder = h("div", { class: "sel-float" });
  const [allPerf, allTags] = await Promise.all([api("performers").catch(() => []), api("tags").catch(() => [])]);
  const sel = makeSelection({ holder: selHolder, refresh: () => route(), performers: allPerf, tags: allTags });

  $app.replaceChildren(h("div", { class: "profile" }, selHolder, head, editPanel, vSection, pSection));

  let vTotal = 0, pTotal = 0;
  const drawCounts = () => { counts.textContent = `영상 ${vTotal.toLocaleString()}개` + (showPhotos ? ` · 사진 ${pTotal.toLocaleString()}장` : ""); };
  let vPage = 1;
  async function loadVideos() {
    const d = await api(`videos?performer=${id}&sort=added&order=desc&per=24&page=${vPage}`);
    vTotal = d.total; drawCounts();
    vTitle.textContent = `영상 ${d.total.toLocaleString()}`;
    if (vPage === 1 && !d.total) { vGrid.replaceWith(h("p", { class: "meta" }, "이 사람이 나온 영상이 없습니다.")); return; }
    if (vPage === 1 && d.items[0] && d.items[0].thumbs > 0) setAvatar(thumbUrl(d.items[0].id, 0, d.items[0].thumbs));
    d.items.forEach((v) => { v.kind = "video"; vGrid.append(sel.selectable(vMode === "wall" ? videoTile(v) : videoCard(v), v)); });
    const shown = (vPage - 1) * d.per + d.items.length;
    vMore.replaceChildren(...(shown < d.total ? [h("button", { class: "btn", onclick: () => { vPage++; loadVideos(); } }, `영상 더 보기 (${shown}/${d.total})`)] : []));
  }
  const pItems = [];
  let pPage = 1;
  async function loadPhotos() {
    const d = await api(`photos?performer=${id}&sort=taken&order=desc&per=30&page=${pPage}`);
    pTotal = d.total; drawCounts();
    pTitle.textContent = `사진 ${d.total.toLocaleString()}`;
    if (pPage === 1 && !d.total) { pGrid.replaceWith(h("p", { class: "meta" }, "이 사람이 나온 사진이 없습니다.")); return; }
    if (pPage === 1 && d.items[0]) setAvatar(`/photothumb/${d.items[0].id}.jpg`);
    for (const ph of d.items) {
      const i = pItems.length;
      pItems.push(ph);
      ph.kind = "photo";
      pGrid.append(sel.selectable(photoCell(ph, pMode, () => openViewer(pItems, i)), ph));
    }
    const shown = (pPage - 1) * d.per + d.items.length;
    pMore.replaceChildren(...(shown < d.total ? [h("button", { class: "btn", onclick: () => { pPage++; loadPhotos(); } }, `사진 더 보기 (${shown}/${d.total})`)] : []));
  }
  drawCounts();
  await Promise.all([loadVideos(), showPhotos ? loadPhotos().catch(() => {}) : null]);
}

// ---------------------------------------------------------------- 앱 서버 (안드로이드)
// ---------------------------------------------------------------- 숏폼 (2분 이하 영상을 위아래로 넘겨 보기)
const SHORT_MAX = 120;
let shortsMuted = false;

async function renderShorts(params) {
  setTab("shorts");
  document.body.classList.add("shorts-mode");
  try { if (window.VidShelfApp) VidShelfApp.setDark(true); } catch (e) {}   // 영상 보는 동안 위아래 막대를 어둡게
  const seed = params.get("s") || String(Date.now() % 100000);
  const feed = h("div", { class: "shorts" });
  $app.replaceChildren(feed);
  const items = [];   // { v, el, video, bar }
  let page = 1, total = Infinity, loading = false, active = -1, lastActive = 0;

  function makeItem(v) {
    const video = h("video", { playsinline: true, loop: true, preload: "none", poster: v.thumbs ? thumbUrl(v.id, 0, v.thumbs) : null });
    video.muted = shortsMuted;
    if (v.width && v.height && v.width > v.height) video.classList.add("wide");   // 가로 영상은 잘리지 않게
    const bar = h("div", { class: "sbar" });
    const icon = h("div", { class: "splay" }, ico("play"));
    const muteBtn = h("button", { class: "sbtn", "aria-label": "소리" }, ico(shortsMuted ? "mute" : "sound"));
    muteBtn.onclick = (e) => {
      e.stopPropagation();
      shortsMuted = !shortsMuted;
      items.forEach((it) => { it.video.muted = shortsMuted; it.mute.replaceChildren(ico(shortsMuted ? "mute" : "sound")); });
    };
    let counted = false, watched = 0, lastT = null;
    video.addEventListener("timeupdate", () => {   // 본 시간 (통계용)
      const t = video.currentTime;
      if (lastT != null && !video.paused) { const d = t - lastT; if (d > 0 && d < 2) watched += d; }
      lastT = t;
    });
    video.addEventListener("seeking", () => { lastT = null; });
    const flush = () => { if (watched >= 1) { const sec = Math.round(watched); watched = 0; api(`videos/${v.id}/watched`, { method: "POST", body: { secs: sec } }).catch(() => {}); } };
    video.addEventListener("play", () => {
      icon.classList.remove("show");
      if (!counted) { counted = true; api(`videos/${v.id}/play`, { method: "POST" }).catch(() => {}); }
    });
    video.addEventListener("timeupdate", () => { if (video.duration && !el.querySelector(".seekbar.dragging")) bar.style.width = `${(video.currentTime / video.duration) * 100}%`; });
    const sbarWrap = h("div", { class: "sbar-wrap" }, bar);
    attachScrub(sbarWrap, bar, {
      duration: () => (isFinite(video.duration) ? video.duration : 0),
      onSeek: (t) => { video.currentTime = t; },
      previewSrc: () => `/media/${v.id}`,
    });
    const errBox = h("div", { class: "serr", hidden: true });
    video.addEventListener("error", () => {
      if (!video.getAttribute("src") || !video.error) return;
      const show = (msg) => {
        errBox.replaceChildren(h("p", {}, msg),
          hasNativePlayer() ? h("button", { class: "btn primary", onclick: (e) => { e.stopPropagation(); playNative(v, 0); } }, ico("external", "in"), "앱 플레이어로 재생") : null);
        errBox.hidden = false;
      };
      const unplayable = () => {   // 형식 문제: 기억해 두고 숏폼에서 빼고 다음 영상으로
        api(`videos/${v.id}/unplayable`, { method: "POST" }).catch(() => {});
        toast("재생할 수 없는 형식이라 숏폼에서 뺐습니다");
        removeItem();
      };
      const formatErr = video.error.code === 3 || video.error.code === 4;   // 3: 디코딩 실패, 4: 지원하지 않는 형식
      if (formatErr) unplayable();
      else show("재생하지 못했습니다.");
    });
    // 하트(즐겨찾기)와 삭제
    const HEART = "heart";
    const svg = (name, cls) => ico(name, cls);
    const favBtn = h("button", { class: "sbtn sfav", "aria-label": "즐겨찾기" }, svg(HEART));
    const drawFav = () => { favBtn.classList.toggle("on", !!v.favorite); favBtn.setAttribute("aria-pressed", v.favorite ? "true" : "false"); };
    const setFav = async (on) => {
      if (!!v.favorite === on) return;
      v.favorite = on ? 1 : 0; drawFav();
      favBtn.classList.remove("pop"); void favBtn.offsetWidth; if (on) favBtn.classList.add("pop");
      try { await api(`videos/${v.id}`, { method: "PATCH", body: { favorite: on } }); }
      catch (e) { v.favorite = on ? 0 : 1; drawFav(); toast(e.message); }
    };
    favBtn.onclick = (e) => { e.stopPropagation(); setFav(!v.favorite); };
    drawFav();
    const delBtn = h("button", { class: "sbtn", "aria-label": "삭제", onclick: (e) => { e.stopPropagation(); askDelete(); } },
      svg("trash"));
    function askDelete() {
      const cloud = v.source && v.source !== "local";
      const run = async (mode) => {
        try {
          await api("batch", { method: "POST", body: { items: [{ kind: "video", id: v.id }], delete: mode } });
          toast(cloud ? "목록에서 숨겼습니다" : mode === "trash" ? "휴지통으로 옮깁니다. 확인 창에서 허용하세요." : "영구 삭제합니다. 확인 창에서 허용하세요.");
          removeItem();
        } catch (e) { toast(e.message); }
      };
      const close = openSheet("이 영상 삭제", cloud ? [
        h("p", { class: "meta", style: "margin:0" }, "MEGA·iCloud 영상은 공유 링크라 지울 수 없어서, 이 앱 목록에서만 숨깁니다 (설정 → 정리 → 숨긴 영상에서 되돌릴 수 있음)."),
        h("button", { class: "del-opt danger", onclick: () => close(() => run("trash")) }, h("b", {}, "목록에서 숨기기")),
      ] : [
        h("p", { class: "meta", style: "margin:0" }, "휴대폰의 실제 파일을 지웁니다. 안드로이드가 한 번 더 확인합니다."),
        h("button", { class: "del-opt", onclick: () => close(() => run("trash")) },
          h("b", {}, "휴지통으로 옮기기"), h("span", { class: "meta" }, "갤러리 휴지통에서 약 30일 동안 되살릴 수 있습니다.")),
        h("button", { class: "del-opt danger", onclick: () => { if (confirm("이 영상을 영구 삭제할까요? 되돌릴 수 없습니다.")) close(() => run("delete")); } },
          h("b", {}, "영구 삭제"), h("span", { class: "meta" }, "바로 지워지고 되돌릴 수 없습니다.")),
      ], [h("button", { class: "btn", style: "grid-column: 1 / -1", onclick: () => close() }, "취소")]);
    }
    function removeItem() {   // 지운 영상은 접히듯 사라지고 다음 영상이 올라옴
      const k = items.findIndex((x) => x.el === el);
      video.pause();
      el.classList.add("gone");
      setTimeout(() => {
        watch.unobserve(el);
        if (k >= 0) items.splice(k, 1);
        setSrc({ video, v }, false);
        el.remove();
        active = -1;
        const next = Math.min(Math.max(0, k), items.length - 1);
        if (next >= 0) { items[next].el.scrollIntoView({ block: "start" }); activate(next); }
      }, 260);
    }

    const loadingEl = h("div");
    const el = h("section", { class: "short" }, video, loadingEl, h("div", { class: "sshade", "aria-hidden": "true" }), icon, errBox,
      h("div", { class: "sinfo" },
        h("a", { class: "stitle", href: `#/v/${v.id}` }, v.title),
        v.performers && v.performers.length ? h("div", { class: "sperf" }, v.performers.join(", ")) : null),
      h("div", { class: "sside" }, favBtn, delBtn, muteBtn,
        h("a", { class: "sbtn", href: `#/v/${v.id}`, "aria-label": "자세히" }, ico("info"))),
      sbarWrap);
    loadingEl.replaceWith(attachLoading(video, h("div")));
    holdFast(el, video);
    // 한 번 누르면 재생/일시정지, 두 번 빠르게 누르면 하트 (인스타처럼)
    let tapTimer = null, lastTap = 0;
    el.addEventListener("click", (e) => {
      if (e.target.closest("a, button, .serr, .sbar-wrap")) return;
      const now = Date.now();
      if (now - lastTap < 300) {
        clearTimeout(tapTimer); tapTimer = null; lastTap = 0;
        burstHeart(e.clientX, e.clientY);
        setFav(true);
        return;
      }
      lastTap = now;
      tapTimer = setTimeout(() => {
        tapTimer = null;
        if (video.paused) video.play().catch(() => {}); else { video.pause(); icon.classList.add("show"); }
      }, 260);
    });
    function burstHeart(x, y) {
      const r = el.getBoundingClientRect();
      const tilt = Math.round(Math.random() * 30 - 15);
      const big = h("div", { class: "heart-burst", "aria-hidden": "true", style: `left:${x - r.left}px;top:${y - r.top}px;--tilt:${tilt}deg` }, svg(HEART));
      el.append(big);
      setTimeout(() => big.remove(), 900);
      try { if (window.VidShelfApp && VidShelfApp.haptic) VidShelfApp.haptic(); else if (navigator.vibrate) navigator.vibrate(25); } catch (er) {}
    }
    return { v, el, video, bar, mute: muteBtn, flush };
  }

  const setSrc = (it, on) => {
    if (on && !it.video.getAttribute("src")) { it.video.src = `/media/${it.v.id}`; it.video.preload = "auto"; }
    if (!on && it.video.getAttribute("src")) { it.video.pause(); it.video.removeAttribute("src"); it.video.load(); }
  };
  function activate(i) {
    if (i === active) return;
    active = i;
    // 아래로 넘기면 하단 메뉴를 숨기고, 위로 올리면 다시 보여 줌 (첫 영상에서는 항상 보임)
    document.body.classList.toggle("nav-hidden", i > 0 && i > lastActive);
    lastActive = i;
    items.forEach((it, k) => {
      setSrc(it, Math.abs(k - i) <= 1);   // 지금 영상과 앞뒤 하나만 받아 둠
      if (k !== i) { it.video.pause(); it.flush(); }
    });
    const it = items[i];
    it.video.play().catch(() => {   // 소리가 있는 자동 재생이 막히면 소리 없이
      shortsMuted = true; items.forEach((x) => { x.video.muted = true; x.mute.replaceChildren(ico("mute")); });
      it.video.play().catch(() => {});
    });
    if (i >= items.length - 4) load();
  }
  const watch = new IntersectionObserver((ents) => ents.forEach((e) => {
    if (e.isIntersecting && e.intersectionRatio > 0.6) activate(items.findIndex((x) => x.el === e.target));
  }), { root: feed, threshold: [0.6] });

  async function load() {
    if (loading || items.length >= total) return;
    loading = true;
    try {
      const d = await api(`videos?max_dur=${SHORT_MAX}&sort=random&seed=${seed}&per=20&page=${page}`);
      total = d.total; page++;
      for (const v of d.items) {
        const it = makeItem(v);
        items.push(it); feed.append(it.el); watch.observe(it.el);
      }
      if (!items.length) feed.replaceWith(h("div", { class: "empty" },
        h("p", {}, "2분 이하 영상이 없습니다."),
        h("p", { class: "meta" }, "MEGA 영상은 한 번 재생하거나 미리보기를 만든 뒤에 길이를 알 수 있어서, 그 전에는 여기에 나오지 않습니다.")));
    } finally { loading = false; }
  }
  pageCleanup = () => { watch.disconnect(); items.forEach((it) => { it.flush(); setSrc(it, false); }); applyTheme(); };
  await load();
}

// ---------------------------------------------------------------- 보관함 (사진·사람·태그·설정 모음)
async function renderLibraryHub() {
  setTab("library");
  if (!Object.keys(serverCaps).length) serverCaps = await api("settings").catch(() => ({}));
  const todoN = h("span", {}, "사람·태그가 없고 ‘정리 완료’ 표시도 안 된 영상·사진");
  api("media?type=all&unorganized=1&per=1").then((d) => { todoN.textContent = d.total ? `${d.total.toLocaleString()}개 남음 · 사람·태그를 붙이거나 ‘정리 완료’로 표시하세요` : "모두 정리했습니다"; }).catch(() => {});
  const row = (href, icon, title, sub) => h("a", { href }, setIcon(icon), h("div", { class: "set-text" }, h("div", { class: "set-title" }, title), sub ? h("div", { class: "meta" }, sub) : null), h("span", { class: "chev", "aria-hidden": "true" }, ico("next")));
  $app.replaceChildren(h("div", { class: "libhub" },
    h("h2", { class: "set-group-title" }, "정리"),
    h("div", { class: "lib-list set-list" },
      row("#/media?unorganized=1", "broom", "정리할 항목", todoN)),
    h("h2", { class: "set-group-title" }, "기록"),
    h("div", { class: "lib-list set-list" },
      row("#/stats", "history", "시청 기록 · 통계", "최근 본 영상 · 시청 시간 · 많이 본 사람")),
    h("h2", { class: "set-group-title" }, "파일"),
    h("div", { class: "lib-list set-list" },
      serverCaps.duplicates ? row("#/duplicates", "dup", "중복 영상·사진", "같은 영상·사진이 여러 곳에 있는지 찾기") : null,
      serverCaps.hidden_count !== undefined ? row("#/hidden", "hidden", "숨긴 영상", `${serverCaps.hidden_count}개`) : null),
    h("h2", { class: "set-group-title" }, "앱"),
    h("div", { class: "lib-list set-list" }, row("#/settings", "gear", "설정", "화면 · 폴더 · 백업"))));
}

/** 탐색: 사람을 큰 카드로 쭉 (장면 3장), 위쪽 검색·필터는 미디어 탭처럼 떠 있음. 태그·나이로 거르기 */
const EX_AGES = [["teen", "10대", 0, 19], ["20a", "20~24세", 20, 24], ["20b", "25~29세", 25, 29], ["30", "30대", 30, 39], ["40", "40세 이상", 40, 999], ["none", "나이 모름", -1, -1]];
const EX_SORTS = [["name", "이름"], ["videos", "영상 많은 순"], ["recent", "최근 추가"], ["young", "어린 순"], ["old", "나이 많은 순"]];
async function renderExplore(params0) {
  setTab("explore");
  let params = new URLSearchParams(params0);
  const [all, tags] = await Promise.all([api("performers"), api("tags").catch(() => [])]);
  const tagName = (id) => (tags.find((t) => String(t.id) === String(id)) || { name: "#" + id }).name;
  const ageOf = (p) => (p.birthdate ? age(p.birthdate) : null);
  const urlFor = () => "#/explore" + (params.toString() ? "?" + params : "");
  const MODES = ["people", "tags", "folders"];   // 사람 / 태그 / 폴더
  const modeOf = () => (MODES.includes(params.get("t")) ? params.get("t") : "people");
  const isTags = () => modeOf() === "tags";
  const isFolders = () => modeOf() === "folders";
  let albums = null;

  const countLine = h("div", { class: "meta" }, "");
  const search = h("input", { type: "search", class: "ex-search", value: params.get("q") || "" });
  const segInd = h("span", { class: "type-ind", "aria-hidden": "true", style: `width: calc((100% - 6px) / ${MODES.length})` });
  const segBtns = [["people", "사람"], ["tags", "태그"], ["folders", "폴더"]].map(([k, l]) => h("button", { role: "tab", onclick: () => setMode(k) }, l));
  const typeSeg = h("div", { class: "type-seg", role: "tablist" }, segInd, ...segBtns);
  function setMode(k, anim) {
    if (k === modeOf()) return;
    const p = new URLSearchParams();
    if (k !== "people") p.set("t", k);
    search.value = "";
    update(p, anim || (MODES.indexOf(k) > MODES.indexOf(modeOf()) ? "left" : "right"));
  }
  window.__mediaSwipeTarget = (dir) => { const j = MODES.indexOf(modeOf()) + dir; return j >= 0 && j < MODES.length ? content : null; };
  window.__mediaSwipe = (dir) => { const j = MODES.indexOf(modeOf()) + dir; if (j < 0 || j >= MODES.length) return false; setMode(MODES[j]); return true; };
  const filterBtn = h("button", { class: "filter-btn", onclick: () => openFilter() });
  const chipsBox = h("div", { class: "fchips" });
  const grid = h("div", { class: "ex-grid" });
  const more = h("div", { class: "more" });
  const content = h("div", { class: "ex-content" }, grid, more);
  const PER = 24;
  let list = [], shown = 0;

  function filtered() {
    const q = (params.get("q") || "").trim().toLowerCase();
    const tg = params.getAll("tag"), ages = params.getAll("age");
    let out = all.filter((p) => {
      if (q && !(p.name.toLowerCase().includes(q) || (p.group || "").toLowerCase().includes(q) || (p.real_name || "").toLowerCase().includes(q) || (p.aliases || "").toLowerCase().includes(q))) return false;
      if (tg.length && !tg.every((t) => (p.tags || []).map(String).includes(t))) return false;
      if (ages.length) {
        const a = ageOf(p);
        if (!ages.some((k) => { const r = EX_AGES.find((x) => x[0] === k); return r && (k === "none" ? a == null || a === "?" : typeof a === "number" && a >= r[2] && a <= r[3]); })) return false;
      }
      return true;
    });
    const sort = params.get("sort") || "videos";
    const by = {
      name: (a, b) => a.name.localeCompare(b.name, "ko"),
      videos: (a, b) => (b.count + b.photo_count) - (a.count + a.photo_count) || a.name.localeCompare(b.name, "ko"),
      recent: (a, b) => (b.latest || 0) - (a.latest || 0),
      young: (a, b) => (ageOf(a) ?? 999) - (ageOf(b) ?? 999),
      old: (a, b) => (ageOf(b) ?? -1) - (ageOf(a) ?? -1),
    }[sort] || ((a, b) => 0);
    return out.sort(by);
  }
  const nFilters = () => params.getAll("tag").length + params.getAll("age").length;

  function card(p) {
    const [pk, pid] = (p.cover_pick || "").split(":");
    const pics = pk === "photo" ? [`/photothumb/${pid}.jpg`] : pk === "video" ? [thumbUrl(pid, 0, "c")] : [];   // 직접 고른 대표 사진이 큰 칸에
    (p.frames || []).filter((fid) => !(pk === "video" && String(fid) === pid)).forEach((fid) => pics.push(thumbUrl(fid, 0, "c")));
    if (pics.length < 3 && p.photo_cover) pics.push(`/photothumb/${p.photo_cover}.jpg`);
    const cov = h("div", { class: "ex-cov n" + Math.max(1, Math.min(3, pics.length)) },
      ...(pics.length ? pics.slice(0, 3) : [null]).map((src) => {
        const box = h("span", {});
        if (src) { const img = h("img", { src, loading: "lazy", alt: "" }); img.onerror = () => img.remove(); box.append(img); }
        else box.append(h("b", { class: "ex-init" }, p.name.slice(0, 1)));
        return box;
      }));
    const a = ageOf(p);
    const sub = [p.count ? `영상 ${p.count}` : null, p.photo_count ? `사진 ${p.photo_count}` : null, typeof a === "number" ? `만 ${a}세` : null].filter(Boolean).join(" · ");
    return h("a", { class: "ex-card", href: `#/performer?id=${p.id}` }, cov,
      h("div", { class: "ex-cap" }, h("b", {}, p.name), p.group ? h("span", { class: "ex-group" }, p.group) : null, h("span", { class: "meta" }, sub || "항목 없음")));
  }
  function drawMore() {
    const next = list.slice(shown, shown + PER);
    grid.append(...next.map(card));
    shown += next.length;
    window.__mediaPages = Math.ceil(shown / PER);
    if (shown < list.length) autoMore(more, drawMore); else more.replaceChildren();
  }
  function drawChips() {
    const without = (key, val) => { const p = new URLSearchParams(params); const rest = p.getAll(key).filter((x) => x !== val); p.delete(key); rest.forEach((x) => p.append(key, x)); update(p); };
    const chips = [];
    for (const t of params.getAll("tag")) chips.push(h("span", { class: "fchip" }, "#" + tagName(t), h("button", { "aria-label": "태그 필터 해제", onclick: () => without("tag", t) }, ico("close", "x"))));
    for (const k of params.getAll("age")) { const r = EX_AGES.find((x) => x[0] === k); if (r) chips.push(h("span", { class: "fchip" }, r[1], h("button", { "aria-label": "나이 필터 해제", onclick: () => without("age", k) }, ico("close", "x")))); }
    if (chips.length > 1) chips.push(h("button", { class: "fclear", onclick: () => { const p = new URLSearchParams(params); p.delete("tag"); p.delete("age"); update(p); } }, "모두 지우기"));
    chipsBox.replaceChildren(...chips); chipsBox.hidden = !chips.length;
    filterBtn.innerHTML = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg>';
    filterBtn.append("필터", nFilters() ? h("span", { class: "fbadge" }, nFilters()) : "");
  }
  function tagList() {   // 상위 태그 아래에 하위 태그가 들여쓰기로 이어짐 (검색 중에는 그냥 목록)
    const q = (params.get("q") || "").trim().toLowerCase();
    const byName = (params.get("sort") || "count") === "name";
    const cmp = byName ? (a, b) => a.name.localeCompare(b.name, "ko")
      : (a, b) => (b.count + (b.photo_count || 0)) - (a.count + (a.photo_count || 0)) || a.name.localeCompare(b.name, "ko");
    if (q) return tags.filter((t) => t.name.toLowerCase().includes(q) || (t.aliases || "").toLowerCase().includes(q)).sort(cmp).map((t) => ({ t, depth: 0 }));
    const ids = new Set(tags.map((t) => t.id));
    const kids = (pid) => tags.filter((t) => (t.parent || 0) === pid || (pid === 0 && t.parent && !ids.has(t.parent))).sort(cmp);
    const out = [];
    const walk = (pid, depth, seen) => kids(pid).forEach((t) => { if (seen.has(t.id)) return; seen.add(t.id); out.push({ t, depth }); walk(t.id, depth + 1, seen); });
    walk(0, 0, new Set());
    return out;
  }
  let editingTags = false;
  function tagRow({ t, depth }) {
    const n = [t.count ? `영상 ${t.count}` : null, t.photo_count ? `사진 ${t.photo_count}` : null].filter(Boolean).join(" · ") || "항목 없음";
    const kids = [h("span", { class: "ex-hash", "aria-hidden": "true" }, depth ? "↳" : "#"),
      h("div", { class: "ex-tmain" }, h("b", {}, t.name), h("span", { class: "meta" }, n + (t.aliases ? ` · 다른 이름: ${t.aliases}` : "")))];
    const style = depth ? `margin-left:${Math.min(3, depth) * 22}px` : null;
    if (!editingTags) return h("a", { class: "ex-tag", style, href: `#/?tag=${t.id}` }, ...kids, h("span", { class: "chev", "aria-hidden": "true" }, ico("next")));
    return h("div", { class: "ex-tag editing", style }, ...kids,
      h("button", { class: "btn sm", onclick: () => editTag(t) }, "설정"),
      h("button", { class: "btn sm danger", onclick: async () => {
        if (!confirm(`#${t.name} 태그를 삭제할까요?\n영상과 사진은 그대로 남고 태그만 없어집니다.`)) return;
        await api(`tags/${t.id}`, { method: "DELETE" }); toast("삭제했습니다"); route();
      } }, "삭제"));
  }
  /** 태그 설정: 이름 · 상위 태그(묶음) · 다른 이름 */
  function editTag(t) {
    const nameIn = h("input", { type: "text", value: t.name, id: "tag-name", "aria-label": "태그 이름" });
    const below = new Set();   // 자기 자신과 그 아래 태그는 상위로 고를 수 없음
    const grow = (id) => { below.add(id); tags.filter((x) => x.parent === id).forEach((x) => !below.has(x.id) && grow(x.id)); };
    grow(t.id);
    const parentSel = h("select", { id: "tag-parent", "aria-label": "상위 태그" },
      h("option", { value: "0" }, "없음 (맨 위)"),
      ...tags.filter((x) => !below.has(x.id)).sort((a, b) => a.name.localeCompare(b.name, "ko")).map((x) => h("option", { value: String(x.id), selected: (t.parent || 0) === x.id }, "#" + x.name)));
    const aliasIn = h("input", { type: "text", value: t.aliases || "", id: "tag-alias", placeholder: "예: beach, 해변", "aria-label": "다른 이름" });
    const close = openSheet(`#${t.name} 설정`, [
      h("div", { class: "sheet-sec" }, h("h3", {}, "이름"), nameIn),
      h("div", { class: "sheet-sec" }, h("h3", {}, "상위 태그 (묶음)"), parentSel,
        h("p", { class: "meta", style: "margin:6px 0 0" }, "예: ‘바다’를 ‘여행’ 아래에 두면, ‘여행’으로 거를 때 ‘바다’ 항목도 함께 나옵니다.")),
      h("div", { class: "sheet-sec" }, h("h3", {}, "다른 이름"), aliasIn,
        h("p", { class: "meta", style: "margin:6px 0 0" }, "쉼표로 여러 개. 검색할 때 이 이름으로도 찾아집니다.")),
    ], [h("button", { class: "btn", onclick: () => close() }, "취소"),
      h("button", { class: "btn primary sheet-go", onclick: async () => {
        const body = { parent: +parentSel.value, aliases: aliasIn.value.trim() };
        const nn = nameIn.value.trim();
        if (nn && nn !== t.name) body.name = nn;
        try { const r = await api(`tags/${t.id}`, { method: "PATCH", body }); toast(r.merged ? "같은 이름의 태그와 합쳤습니다" : "저장했습니다"); close(() => route()); } catch (e) { toast(e.message); }
      } }, "저장")]);
  }
  function draw(restore, anim) {
    segBtns.forEach((b, i) => { const on = MODES[i] === modeOf(); b.classList.toggle("on", on); b.setAttribute("aria-selected", on ? "true" : "false"); });
    segInd.style.transform = `translateX(${MODES.indexOf(modeOf()) * 100}%)`;
    search.placeholder = isTags() ? "태그 검색" : isFolders() ? "폴더 이름 검색" : "사람 이름 검색";
    search.setAttribute("aria-label", search.placeholder);
    content.classList.remove("in-left", "in-right"); content.style.transform = ""; content.style.opacity = "";
    if (anim) { void content.offsetWidth; content.classList.add("in-" + anim); }
    if (isFolders()) {   // 갤러리처럼 폴더별로
      chipsBox.replaceChildren(); chipsBox.hidden = true;
      filterBtn.replaceChildren(ico("filter"), "정렬");
      grid.className = "ex-albums";
      more.replaceChildren();
      const paint = () => {
        const q = (params.get("q") || "").trim().toLowerCase(), sort = params.get("sort") || "recent";
        const list = (albums || []).filter((a) => !q || a.name.toLowerCase().includes(q) || a.path.toLowerCase().includes(q));
        if (sort === "name") list.sort((a, b) => a.name.localeCompare(b.name, "ko"));
        else if (sort === "count") list.sort((a, b) => (b.videos + b.photos) - (a.videos + a.photos));
        countLine.textContent = `폴더 ${list.length.toLocaleString()}개 · ${{ recent: "최근 추가된 순", name: "이름", count: "많은 순" }[sort] || ""}`;
        grid.replaceChildren(...(list.length ? list.map(albumCard) : [h("div", { class: "empty", style: "grid-column:1/-1" }, (albums || []).length ? "검색과 맞는 폴더가 없습니다." : "아직 사진·영상이 있는 폴더가 없습니다.")]));
      };
      if (albums) paint();
      else { countLine.textContent = "폴더 불러오는 중…"; getAlbums().then((l) => { albums = l; if (isFolders()) paint(); }); }
      return;
    }
    if (isTags()) {
      const tl = tagList();
      countLine.textContent = `태그 ${tl.length.toLocaleString()}개 · ${(params.get("sort") || "count") === "name" ? "이름" : "많이 쓴 순"}`;
      chipsBox.replaceChildren(); chipsBox.hidden = true;
      filterBtn.innerHTML = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg>';
      filterBtn.append("정렬");
      const editBtn = h("button", { class: "btn sm" + (editingTags ? " primary" : ""), onclick: () => { editingTags = !editingTags; draw(); } }, editingTags ? "완료" : [ico("edit", "in"), "편집"]);
      grid.className = "ex-tags";
      grid.replaceChildren(h("div", { class: "ex-tags-head" }, h("span", { class: "meta" }, "누르면 그 태그의 영상·사진을 봅니다"), tags.length ? editBtn : null),
        ...(tl.length ? tl.map(tagRow) : [h("div", { class: "empty" }, tags.length ? "검색과 맞는 태그가 없습니다." : "아직 태그가 없습니다.")]));
      more.replaceChildren();
      return;
    }
    grid.className = "ex-grid";
    list = filtered(); shown = 0;
    grid.replaceChildren();
    const sortLabel = (EX_SORTS.find(([v]) => v === (params.get("sort") || "videos")) || [0, ""])[1];
    countLine.textContent = `${list.length.toLocaleString()}명 · ${sortLabel}`;
    drawChips();
    if (!list.length) { grid.append(h("div", { class: "empty", style: "grid-column:1/-1" }, all.length ? "조건에 맞는 사람이 없습니다." : "아직 사람이 없습니다. 영상 화면의 ‘수정’에서 사람을 넣어 보세요.")); more.replaceChildren(); return; }
    const pages = restore ? Math.max(1, restore.pages || 1) : 1;
    for (let i = 0; i < pages && shown < list.length; i++) {
      const next = list.slice(shown, shown + PER); grid.append(...next.map(card)); shown += next.length;
    }
    window.__mediaPages = Math.ceil(shown / PER);
    if (shown < list.length) autoMore(more, drawMore); else more.replaceChildren();
  }
  function update(p, anim) {
    params = p;
    history.replaceState(history.state, "", urlFor());
    lastHash = location.hash;
    window.scrollTo({ top: 0, behavior: "instant" });
    draw(null, anim);
  }
  let typing;
  search.addEventListener("input", () => {
    clearTimeout(typing);
    typing = setTimeout(() => { const p = new URLSearchParams(params); if (search.value.trim()) p.set("q", search.value.trim()); else p.delete("q"); params = p; history.replaceState(history.state, "", urlFor()); lastHash = location.hash; draw(); }, 200);
  });

  function openFilter() {
    if (isFolders()) {
      const cur = params.get("sort") || "recent";
      const close = openSheet("정렬", [h("div", { class: "chips" }, ...[["recent", "최근 추가된 순"], ["count", "많은 순"], ["name", "이름"]].map(([k, l]) =>
        h("button", { class: "chip" + (cur === k ? " on" : ""), onclick: () => close(() => { const p = new URLSearchParams(params); if (k === "recent") p.delete("sort"); else p.set("sort", k); update(p); }) }, l)))]);
      return;
    }
    if (isTags()) {
      const cur = params.get("sort") || "count";
      const close = openSheet("정렬", [h("div", { class: "chips" }, ...[["count", "많이 쓴 순"], ["name", "이름"]].map(([k, l]) =>
        h("button", { class: "chip" + (cur === k ? " on" : ""), onclick: () => close(() => { const p = new URLSearchParams(params); if (k === "count") p.delete("sort"); else p.set("sort", k); update(p); }) }, l)))]);
      return;
    }
    const draft = { tag: new Set(params.getAll("tag")), age: new Set(params.getAll("age")), sort: params.get("sort") || "videos" };
    const goBtn = h("button", { class: "btn primary sheet-go" });
    const toParams = () => {
      const p = new URLSearchParams();
      if (params.get("q")) p.set("q", params.get("q"));
      draft.tag.forEach((t) => p.append("tag", t)); draft.age.forEach((a) => p.append("age", a));
      if (draft.sort !== "videos") p.set("sort", draft.sort);
      return p;   // (태그 화면 설정은 따로)
    };
    const refresh = () => { const save = params; params = toParams(); const n = filtered().length; params = save; goBtn.textContent = `${n.toLocaleString()}명 보기`; };
    const chipSet = (items, set, label) => h("div", { class: "chips" }, ...items.map(([k, l]) => {
      const b = h("button", { class: "chip" + (set.has(k) ? " on" : ""), "aria-pressed": set.has(k) ? "true" : "false", onclick: () => {
        if (set.has(k)) set.delete(k); else set.add(k);
        b.classList.toggle("on", set.has(k)); b.setAttribute("aria-pressed", set.has(k) ? "true" : "false"); refresh();
      } }, label ? label(l) : l);
      return b;
    }));
    const sortBox = h("div", { class: "chips" });
    const drawSort = () => sortBox.replaceChildren(...EX_SORTS.map(([k, l]) => h("button", { class: "chip" + (draft.sort === k ? " on" : ""), onclick: () => { draft.sort = k; drawSort(); refresh(); } }, l)));
    drawSort();
    const usedTags = tags.filter((t) => all.some((p) => (p.tags || []).includes(t.id))).sort((a, b) => b.count - a.count);
    const close = openSheet("필터", [
      h("div", { class: "sheet-sec" }, h("h3", {}, "정렬"), sortBox),
      h("div", { class: "sheet-sec" }, h("h3", {}, "나이"), chipSet(EX_AGES.map((a) => [a[0], a[1]]), draft.age)),
      usedTags.length ? h("div", { class: "sheet-sec" }, h("h3", {}, "태그 (그 태그가 붙은 영상·사진이 있는 사람)"), chipSet(usedTags.map((t) => [String(t.id), t.name]), draft.tag, (n) => "#" + n)) : null,
    ], [
      h("button", { class: "btn", onclick: () => { draft.tag.clear(); draft.age.clear(); draft.sort = "videos"; close(() => update(toParams())); } }, "초기화"),
      goBtn,
    ]);
    goBtn.onclick = () => close(() => update(toParams()));
    refresh();
  }

  $app.replaceChildren(h("div", { class: "explore" },
    h("div", { class: "home-head media-title" }, h("div", {}, countLine, h("h1", {}, "탐색"))),
    h("div", { class: "media-bar" },
      h("div", { class: "media-bar-row" }, typeSeg, filterBtn),
      h("label", { class: "ex-search-box" }, ico("search"), search),
      chipsBox),
    content));

  const mem = scrollMemory[location.hash];
  delete scrollMemory[location.hash];
  draw(mem);
  if (mem && mem.y > 0) { window.scrollTo({ top: mem.y, behavior: "instant" }); requestAnimationFrame(() => { window.scrollTo({ top: mem.y, behavior: "instant" }); endRestore(); }); }
  else endRestore();
}

/** 검색: 사람 · 태그 · 영상·사진을 한 화면에 (다른 이름으로도 찾음) */
async function renderSearch(params) {
  setTab("home");
  const [people, tags] = await Promise.all([api("performers").catch(() => []), api("tags").catch(() => [])]);
  const input = h("input", { type: "search", class: "ex-search", id: "search-q", placeholder: "사람, 태그, 제목 검색", value: params.get("q") || "", autocomplete: "off", "aria-label": "검색어" });
  const out = h("div", { class: "search-out" });
  const recentQ = () => { try { return JSON.parse(localStorage.getItem("vs-recent-q") || "[]"); } catch (e) { return []; } };
  const remember = (q) => { try { const r = recentQ().filter((w) => w !== q); r.unshift(q); localStorage.setItem("vs-recent-q", JSON.stringify(r.slice(0, 8))); } catch (e) {} };
  let token = 0, timer = null;
  const row = (icon, title, sub, href, onGo) => h("a", { class: "s-row", href, onclick: onGo }, icon, h("div", { class: "s-main" }, h("b", {}, title), sub ? h("span", { class: "meta" }, sub) : null), h("span", { class: "chev", "aria-hidden": "true" }, ico("next")));
  async function draw() {
    const q = input.value.trim(), ql = q.toLowerCase(), my = ++token;
    history.replaceState(history.state, "", "#/search" + (q ? "?q=" + encodeURIComponent(q) : ""));
    lastHash = location.hash;
    if (!q) {
      const rq = recentQ();
      out.replaceChildren(rq.length ? h("section", {}, h("h3", { class: "s-h" }, "최근 검색"),
        h("div", { class: "chips" }, ...rq.map((w) => h("button", { class: "chip", onclick: () => { input.value = w; draw(); } }, ico("history", "in"), w)),
          h("button", { class: "linkbtn", onclick: () => { try { localStorage.removeItem("vs-recent-q"); } catch (e) {} draw(); } }, "지우기")))
        : h("p", { class: "meta s-empty" }, "사람 이름, 다른 이름(영문명 등), 태그, 영상 제목으로 찾을 수 있습니다."));
      return;
    }
    const pm = people.filter((p) => [p.name, p.aliases, p.group, p.real_name].some((x) => (x || "").toLowerCase().includes(ql))).slice(0, 6);
    const tm = tags.filter((t) => [t.name, t.aliases].some((x) => (x || "").toLowerCase().includes(ql))).slice(0, 6);
    const go = () => remember(q);
    const sec = [];
    if (pm.length) sec.push(h("section", {}, h("h3", { class: "s-h" }, "사람"),
      ...pm.map((p) => row(h("span", { class: "s-av" }, entityCover(p, p.name.slice(0, 1))), p.name,
        [p.aliases ? "다른 이름 " + p.aliases : "", `영상 ${p.count || 0}` + (p.photo_count ? ` · 사진 ${p.photo_count}` : "")].filter(Boolean).join(" · "), `#/performer?id=${p.id}`, go))));
    if (tm.length) sec.push(h("section", {}, h("h3", { class: "s-h" }, "태그"),
      ...tm.map((t) => row(h("span", { class: "s-hash" }, "#"), t.name, [t.aliases ? "다른 이름 " + t.aliases : "", `영상 ${t.count || 0}` + (t.photo_count ? ` · 사진 ${t.photo_count}` : "")].filter(Boolean).join(" · "), `#/?tag=${t.id}`, go))));
    const mediaSec = h("section", {}, h("h3", { class: "s-h" }, "영상·사진 찾는 중…"));
    sec.push(mediaSec);
    out.replaceChildren(...sec);
    try {
      const d = await api("media?" + new URLSearchParams({ type: "all", q, per: "18", page: "1" }));
      if (my !== token) return;
      const photos = d.items.filter((x) => x.kind === "photo");
      mediaSec.replaceChildren(
        h("div", { class: "s-h-row" }, h("h3", { class: "s-h" }, `영상·사진 ${d.total.toLocaleString()}개`),
          d.total ? h("a", { class: "more-link", href: "#/media?q=" + encodeURIComponent(q), onclick: go }, "모두 보기 ›") : null),
        d.total ? h("div", { class: "s-grid" }, ...d.items.map((it) => homeSquare(it, photos))) : h("p", { class: "meta" }, "제목이나 폴더 이름이 맞는 항목이 없습니다."));
    } catch (e) { if (my === token) mediaSec.replaceChildren(h("p", { class: "meta" }, e.message)); }
  }
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(draw, 220); });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); const q = input.value.trim(); if (q) remember(q); input.blur(); } });
  $app.replaceChildren(h("div", { class: "search-page" },
    h("div", { class: "search-top" },
      h("button", { class: "round-btn", "aria-label": "뒤로", onclick: () => history.back() }, icon("prev")),
      h("label", { class: "ex-search-box" }, ico("search"), input)),
    out));
  draw();
  setTimeout(() => input.focus(), 60);
}

/** 시청 기록 · 통계 */
function fmtHours(secs) {
  const m = Math.round(secs / 60);
  if (m < 1) return "0분";
  if (m < 60) return `${m}분`;
  return `${Math.floor(m / 60)}시간` + (m % 60 ? ` ${m % 60}분` : "");
}
async function renderStats() {
  setTab("library");
  const [st, recent, most, people] = await Promise.all([
    api("stats"),
    api("videos?sort=played&order=desc&per=30&page=1"),
    api("videos?sort=plays&order=desc&per=12&page=1"),
    api("performers").catch(() => []),
  ]);
  const days = st.days || [];
  const week = days.slice(-7).reduce((a, d) => a + d.secs, 0);
  const prevWeek = days.slice(0, 7).reduce((a, d) => a + d.secs, 0);
  const today = days.length ? days[days.length - 1].secs : 0;
  const max = Math.max(60, ...days.map((d) => d.secs));
  const WD = ["일", "월", "화", "수", "목", "금", "토"];
  const tile = (label, value, sub) => h("div", { class: "st-tile" }, h("span", { class: "meta" }, label), h("b", {}, value), sub ? h("span", { class: "meta" }, sub) : null);
  const diff = week - prevWeek;
  const chart = h("div", { class: "st-chart", role: "img", "aria-label": "최근 14일 날짜별 시청 시간" },
    ...days.map((d, i) => {
      const dt = new Date(d.date + "T00:00:00");
      const isToday = i === days.length - 1;
      return h("div", { class: "st-col" + (isToday ? " today" : ""), title: `${dt.getMonth() + 1}월 ${dt.getDate()}일 · ${fmtHours(d.secs)}` },
        h("div", { class: "st-bar-box" }, h("div", { class: "st-bar", style: `height:${Math.max(d.secs ? 4 : 0, (d.secs / max) * 100)}%` })),
        h("span", {}, isToday ? "오늘" : WD[dt.getDay()]));
    }));
  const watched = (recent.items || []).filter((v) => v.last_played).slice(0, 3);   // 나머지는 ‘모두 보기’에서
  const mostPlayed = (most.items || []).filter((v) => v.play_count > 0);
  const top = st.top_performers || [];
  const topMax = Math.max(1, ...top.map((p) => p.secs || p.plays));
  $app.replaceChildren(h("div", { class: "statpage" },
    h("div", { class: "home-head" }, h("div", {}, h("div", { class: "meta" }, `본 영상 ${(st.videos_watched || 0).toLocaleString()}개`), h("h1", {}, "시청 기록"))),
    h("div", { class: "st-tiles" },
      tile("오늘", fmtHours(today)),
      tile("최근 7일", fmtHours(week), prevWeek || week ? (diff >= 0 ? `지난주보다 ${fmtHours(diff)} 더` : `지난주보다 ${fmtHours(-diff)} 덜`) : null),
      tile("지금까지", fmtHours(st.total_secs || 0))),
    h("section", { class: "panel" }, h("h3", {}, "최근 14일"), chart,
      !week && !prevWeek ? h("p", { class: "meta" }, "영상을 보면 여기에 날짜별 시청 시간이 쌓입니다. (이번 버전부터 기록됩니다)") : null),
    top.length ? h("section", { class: "panel" }, h("h3", {}, "많이 본 사람"),
      h("div", { class: "st-people" }, ...top.map((p, i) => {
        const pf = people.find((x) => x.id === p.id) || p;
        return h("a", { class: "st-person", href: `#/performer?id=${p.id}` },
          h("span", { class: "st-rank" }, String(i + 1)),
          h("span", { class: "yt-av" }, entityCover(pf, p.name.slice(0, 1))),
          h("div", { class: "st-pmain" }, h("b", {}, p.name),
            h("div", { class: "st-pbar" }, h("i", { style: `width:${((p.secs || p.plays) / topMax) * 100}%` })),
            h("span", { class: "meta" }, `${p.plays}회 · ${fmtHours(p.secs || 0)}`)));
      }))) : null,
    h("section", {}, h("div", { class: "sec-head" }, h("h2", {}, "최근 본 영상"), h("a", { class: "more-link", href: "#/media?type=video&sort=played" }, "모두 보기 ›")),
      watched.length ? h("div", { class: "st-history" }, ...watched.map((v) => h("a", { class: "st-hist", href: `#/v/${v.id}` },
        h("div", { class: "thumb" }, v.thumbs > 0 ? h("img", { loading: "lazy", alt: "", src: thumbUrl(v.id, 0, v.thumbs), onerror: (e) => (e.target.hidden = true) }) : null,
          v.duration ? h("span", { class: "badge dur" }, fmtDur(v.duration)) : null),
        h("div", { class: "st-htext" }, h("b", {}, v.title), h("span", { class: "meta" }, `${timeAgo(v.last_played)} · ${v.play_count}회 재생`)))))
        : h("p", { class: "meta" }, "아직 본 영상이 없습니다.")),
    mostPlayed.length ? h("section", {}, h("div", { class: "sec-head" }, h("h2", {}, "많이 본 영상")),
      h("div", { class: "grid" }, ...mostPlayed.map((v) => videoCard(v)))) : null));
}

function favSyncPanel(st) {
  return h("div", { class: "panel" }, h("h3", {}, "즐겨찾기 연동"),
    h("p", { class: "meta" }, st.fav_sync
      ? "이 기기의 사진·영상은 갤러리(안드로이드)의 즐겨찾기와 서로 맞춰집니다. 갤러리에서 바꾸면 앱을 열 때 반영되고, 앱에서 바꾸면 갤러리에도 반영됩니다."
      : "안드로이드 11 이상에서만 갤러리 즐겨찾기와 연동됩니다. 이 기기에서는 앱 안에서만 즐겨찾기가 저장됩니다."),
    h("p", { class: "meta" }, "MEGA·iCloud 항목은 공유 링크가 읽기 전용이라, 즐겨찾기가 앱 안에만 저장됩니다. 목록이나 홈에서 사진·영상을 길게 누르면 즐겨찾기에 넣거나 뺄 수 있습니다."),
    st.fav_sync && st.manage_media_supported ? (st.manage_media
      ? h("p", { class: "meta" }, ico("done", "in"), "‘미디어 관리’ 권한이 켜져 있어 확인 창 없이 바로 반영됩니다.")
      : h("div", {}, h("p", { class: "meta" }, "지금은 앱에서 즐겨찾기를 바꿀 때마다 안드로이드가 확인 창을 띄웁니다. 아래 버튼으로 ‘미디어 관리’ 권한을 켜면 묻지 않고 바로 반영됩니다."),
          h("a", { class: "btn", href: "vidshelf://manage-media" }, "‘미디어 관리’ 권한 켜기"))) : null);
}

function themePanel() {
  const seg = h("div", { class: "theme-seg", role: "group", "aria-label": "화면 테마" });
  const draw = () => seg.replaceChildren(...[["system", "시스템 설정"], ["light", "라이트"], ["dark", "다크"]].map(([v, l]) =>
    h("button", { class: themePref() === v ? "on" : "", "aria-pressed": themePref() === v ? "true" : "false", onclick: () => { setThemePref(v); draw(); } }, l)));
  draw();
  return h("div", { class: "panel" }, h("h3", {}, "화면"), seg,
    h("p", { class: "meta" }, "‘시스템 설정’을 고르면 휴대폰의 다크 모드를 켜고 끌 때 함께 바뀝니다. 이 설정은 기기마다 따로 저장됩니다."));
}

// ---------------------------------------------------------------- 홈
/** 가로로 넘기는 한 줄: 제목, ‘모두 보기’, 내용. 내용을 불러오기 전에는 자리만 잡아 둠. */
function shelf(title, moreHref, kind) {
  const row = h("div", { class: "shelf-row " + kind });
  const sec = h("section", { class: "shelf" },
    h("div", { class: "shelf-head" }, h("h2", {}, title), moreHref ? h("a", { href: moreHref }, "모두 보기 ›") : null),
    row);
  return { sec, fill(items) {
    if (!items.length) { sec.remove(); return; }
    row.replaceChildren(...items);
  } };
}

/** 홈 화면 줄 순서·보이기 (이 기기에 저장) */
const HOME_SECTIONS = [["resume", "이어 보기"], ["recent", "최근 추가된 영상"], ["favs", "즐겨찾기"], ["photos", "최근 사진"], ["albums", "폴더"], ["people", "사람"]];
let homeExtra = [];   // 홈에 표시하기로 한 저장된 필터: [["sf:12", "필터 · 공연 즐겨찾기"], …]
/** 홈에 한 줄로 넣은 폴더 (이 기기에 저장) */
function homeFolders() { try { return JSON.parse(localStorage.getItem("vs-home-folders") || "[]"); } catch (e) { return []; } }
function setHomeFolders(list) { try { localStorage.setItem("vs-home-folders", JSON.stringify(list)); } catch (e) {} }
const homeSections = () => HOME_SECTIONS.concat(homeExtra, homeFolders().map((f) => ["fd:" + f, "폴더 · " + folderName(f)]));
function homeLayout() {
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem("vs-home") || "[]"); } catch (e) {}
  const all = homeSections();
  const out = saved.filter((x) => all.some(([k]) => k === x.k));
  all.forEach(([k]) => { if (!out.some((x) => x.k === k)) out.push({ k, on: true }); });   // 새로 생긴 줄은 맨 뒤에 켜진 채로
  return out;
}
function openHomeEditor() {
  let layout = homeLayout();
  const label = (k) => (homeSections().find(([x]) => x === k) || [k, k])[1];
  const list = h("div", { class: "home-edit-list" });
  const saveLayout = () => { try { localStorage.setItem("vs-home", JSON.stringify(layout)); } catch (e) {} };
  const draw = () => list.replaceChildren(...layout.map((x, i) => {
    const sw = h("button", { class: "switch" + (x.on ? " on" : ""), role: "switch", "aria-checked": x.on ? "true" : "false", "aria-label": `${label(x.k)} 보이기`,
      onclick: () => { x.on = !x.on; saveLayout(); draw(); } });
    const move = (d) => { const j = i + d; if (j < 0 || j >= layout.length) return; [layout[i], layout[j]] = [layout[j], layout[i]]; saveLayout(); draw(); };
    return h("div", { class: "home-edit-row" + (x.on ? "" : " off") },
      h("div", { class: "he-move" },
        h("button", { class: "round-btn sm", "aria-label": "위로", disabled: i === 0, onclick: () => move(-1) }, ico("up")),
        h("button", { class: "round-btn sm", "aria-label": "아래로", disabled: i === layout.length - 1, onclick: () => move(1) }, ico("down"))),
      h("span", { class: "he-name" }, label(x.k)),
      x.k.startsWith("sf:") || x.k.startsWith("fd:") ? h("button", { class: "round-btn sm", "aria-label": "홈에서 빼기", onclick: async () => {
        if (x.k.startsWith("sf:")) {
          await api(`saved_filters/${x.k.slice(3)}/home`, { method: "POST", body: { on: false } }).catch(() => null);
          homeExtra = homeExtra.filter(([k]) => k !== x.k);
        } else setHomeFolders(homeFolders().filter((f) => f !== x.k.slice(3)));
        layout = layout.filter((y) => y.k !== x.k);
        saveLayout(); draw(); drawAdd(); drawFolderAdd();
      } }, ico("close", "x")) : null, sw);
  }));
  draw();
  // 저장된 필터를 홈 줄로 추가
  const addBox = h("div", { class: "home-edit-add" });
  const drawAdd = async () => {
    const all = await api("saved_filters").catch(() => []);
    const rest = all.filter((f) => !f.home);
    if (!all.length) { addBox.replaceChildren(h("p", { class: "meta", style: "margin:0" }, "저장된 필터가 없습니다. 미디어 탭의 필터에서 조건을 고른 뒤 ‘필터 저장’을 누르면 여기에 나옵니다.")); return; }
    addBox.replaceChildren(h("div", { class: "he-sub" }, "저장된 필터 추가"),
      ...(rest.length ? rest.map((f) => h("div", { class: "home-edit-row" },
        h("span", { class: "he-name" }, f.default ? ico("star", "in filled") : null, f.name),
        h("button", { class: "btn sm primary", onclick: async (e) => {
          e.currentTarget.disabled = true;
          await api(`saved_filters/${f.id}/home`, { method: "POST", body: { on: true } }).catch(() => null);
          homeExtra = homeExtra.filter(([k]) => k !== "sf:" + f.id).concat([["sf:" + f.id, "필터 · " + f.name]]);
          layout = layout.filter((x) => x.k !== "sf:" + f.id).concat([{ k: "sf:" + f.id, on: true }]);
          saveLayout(); draw(); drawAdd();
        } }, "+ 추가"))) : [h("p", { class: "meta", style: "margin:0" }, "모든 저장된 필터가 홈에 있습니다.")]));
  };
  drawAdd();
  // 폴더를 홈 줄로 추가 (갤러리 앨범처럼)
  const folderAdd = h("div", { class: "home-edit-add" });
  let foldersAll = false;
  const drawFolderAdd = async () => {
    const albums = await getAlbums();
    const have = new Set(homeFolders());
    const rest = albums.filter((a) => !have.has(a.path)).sort((a, b) => (b.videos + b.photos) - (a.videos + a.photos));
    if (!albums.length) { folderAdd.replaceChildren(); return; }
    const shown = foldersAll ? rest : rest.slice(0, 6);
    folderAdd.replaceChildren(h("div", { class: "he-sub" }, "폴더 줄 추가"),
      ...(rest.length ? shown.map((a) => h("div", { class: "home-edit-row" },
        h("span", { class: "he-name" }, ico("folder", "in"), a.name, h("span", { class: "meta he-meta" }, ` ${(a.videos + a.photos).toLocaleString()}개`)),
        h("button", { class: "btn sm primary", onclick: (e) => {
          e.currentTarget.disabled = true;
          setHomeFolders(homeFolders().concat([a.path]));
          layout = layout.filter((x) => x.k !== "fd:" + a.path).concat([{ k: "fd:" + a.path, on: true }]);
          saveLayout(); draw(); drawFolderAdd();
        } }, "+ 추가"))) : [h("p", { class: "meta", style: "margin:0" }, "모든 폴더가 홈에 있습니다.")]),
      !foldersAll && rest.length > shown.length ? h("button", { class: "btn sm", onclick: () => { foldersAll = true; drawFolderAdd(); } }, `폴더 ${rest.length - shown.length}개 더 보기`) : null);
  };
  drawFolderAdd();
  openSheet("홈 편집", [h("p", { class: "meta", style: "margin:0" }, "화살표로 순서를 바꾸고, 스위치로 보이거나 숨깁니다."), list, addBox, folderAdd],
    [h("button", { class: "btn", onclick: () => { layout = homeSections().map(([k]) => ({ k, on: true })); saveLayout(); draw(); } }, "처음대로"),
     h("button", { class: "btn primary sheet-go", onclick: () => history.back() }, "완료")]);
  const onClose = () => { window.removeEventListener("popstate", onClose); if (parseHash().path === "/home" || !location.hash) setTimeout(route, 230); };
  window.addEventListener("popstate", onClose);
}

/** 홈의 정사각형 칸 (영상은 ▶ 길이, 사진은 누르면 사진 보기) */
function homeSquare(it, photos) {
  const isPhoto = it.kind === "photo";
  const img = h("img", { loading: "lazy", alt: it.title || "", src: isPhoto ? `/photothumb/${it.id}.jpg` : it.thumbs > 0 ? thumbUrl(it.id, 0, it.thumbs) : null });
  img.onerror = () => (img.hidden = true);
  const kids = [img, !isPhoto ? h("span", { class: "sq-dur" }, ico("play", "in"), it.duration ? fmtDur(it.duration) : "") : null];
  const cell = isPhoto
    ? h("button", { class: "sq", "aria-label": it.title || "사진", onclick: () => openViewer(photos, photos.indexOf(it)) }, ...kids)
    : h("a", { class: "sq", href: `#/v/${it.id}`, "aria-label": it.title || "영상" }, ...kids);
  return longPressFav(cell, it);
}

async function renderHome() {
  setTab("home");
  if (!Object.keys(serverCaps).length) serverCaps = await api("settings").catch(() => ({}));   // 앱을 막 열었을 때
  const stats = h("div", { class: "meta" });
  const resume = shelf("이어 보기", "#/?sort=played", "vids");
  const recent = shelf("최근 추가된 영상", "#/?sort=added", "vids");
  const favs = shelf("즐겨찾기", "#/media?fav=1", "favs");
  const photos = shelf("최근 사진", "#/photos", "photos");
  const people = shelf("사람", "#/explore", "people");
  const albumsSec = shelf("폴더", "#/explore?t=folders", "albums");
  const secs = { resume, recent, favs, photos, people, albums: albumsSec };
  // 갤러리처럼 폴더 줄 + 홈에 넣은 폴더는 각각 한 줄
  const layout0 = homeLayout();
  if (layout0.some((x) => x.k === "albums" && x.on)) getAlbums().then((l) => albumsSec.fill(l.slice(0, 14).map(albumCard)));
  homeFolders().forEach((f) => {
    const sec = shelf(folderName(f), folderHref(f), "favs");
    secs["fd:" + f] = sec;
    if (!layout0.some((x) => x.k === "fd:" + f && x.on)) return;
    api("media?type=all&per=18&folder=" + encodeURIComponent(f)).then((d) => {
      const ph = d.items.filter((x) => x.kind === "photo");
      sec.fill(d.items.map((it) => homeSquare(it, ph)));
    }).catch(() => sec.fill([]));
  });
  const quickPeople = h("div", { class: "home-people" }), quickChips = h("div", { class: "home-chips" }), heroBox = h("div");
  // 저장된 필터 중 ‘홈에 표시’한 것은 각각 한 줄
  const savedAll = await api("saved_filters").catch(() => []);
  const homeFilters = savedAll.filter((f) => f.home);
  homeExtra = homeFilters.map((f) => ["sf:" + f.id, "필터 · " + f.name]);
  homeFilters.forEach((f) => {
    const p = new URLSearchParams(f.params || "");
    if (f.type && f.type !== "all") p.set("type", f.type);
    const sec = shelf(f.name, "#/media" + (p.toString() ? "?" + p : ""), "favs");
    secs["sf:" + f.id] = sec;
    const sp = toServerParams(p); sp.set("type", f.type || "all"); sp.set("per", "18");
    if (sp.get("sort") === "random") sp.set("seed", String(Math.floor(Math.random() * 1e6)));
    api("media?" + sp).then((d) => {
      const ph = d.items.filter((x) => x.kind === "photo");
      sec.fill(d.items.map((it) => homeSquare(it, ph)));
    }).catch(() => sec.fill([]));
  });
  const layout = homeLayout();
  $app.replaceChildren(h("div", { class: "home" },
    h("div", { class: "home-head" }, h("div", {}, stats, h("h1", {}, "내 보관함"))),
    // 검색에서 시작: 검색칸 · 자주 보는 사람 · 바로 가기 칩 · 이어 볼 영상 하나
    h("a", { class: "home-search", href: "#/search" }, ico("search"), "사람, 태그, 제목 검색"),
    quickPeople, quickChips, heroBox,
    ...layout.filter((x) => x.on && secs[x.k]).map((x) => secs[x.k].sec),
    h("div", { class: "home-edit" }, h("button", { class: "btn sm", onclick: openHomeEditor }, ico("edit", "in"), "홈 편집"))));

  const counts = { videos: null, photos: null, people: null };
  const n = (x) => (x == null ? "…" : x.toLocaleString());
  const drawStats = () => (stats.textContent = [`영상 ${n(counts.videos)}`, serverCaps.photos ? `사진 ${n(counts.photos)}` : "", `사람 ${n(counts.people)}`].filter(Boolean).join(" · "));
  drawStats();

  const small = (v) => videoCard(v);
  // 바로 가기 칩: 저장된 필터(★ 기본 먼저) · 안 본 영상 · 많이 쓴 태그
  {
    const chips = [...savedAll].sort((a, b) => (b.default ? 1 : 0) - (a.default ? 1 : 0)).map((f) => {
      const p = new URLSearchParams(f.params || ""); if (f.type && f.type !== "all") p.set("type", f.type);
      return h("a", { class: "hchip", href: "#/media" + (p.toString() ? "?" + p : "") }, f.default ? ico("star", "in filled") : null, f.name);
    });
    chips.push(h("a", { class: "hchip", href: "#/media?type=video&unwatched=1" }, "안 본 영상"));
    api("tags").then((tl) => {
      tl.filter((t) => t.count || t.photo_count).sort((a, b) => (b.count + (b.photo_count || 0)) - (a.count + (a.photo_count || 0))).slice(0, 4)
        .forEach((t) => chips.push(h("a", { class: "hchip", href: `#/?tag=${t.id}` }, "#" + t.name)));
      quickChips.replaceChildren(...chips);
    }).catch(() => quickChips.replaceChildren(...chips));
  }
  const jobs = [
    api("videos?sort=played&order=desc&per=40").then((d) => {
      counts.videos = d.total; drawStats();
      const going = d.items.filter((v) => v.resume_pos > 5 && v.duration && v.resume_pos < v.duration - 10);
      if (going[0]) {   // 가장 최근에 보던 영상 하나를 크게
        const v = going[0];
        heroBox.replaceChildren(h("a", { class: "home-hero", href: `#/v/${v.id}` },
          h("img", { src: hdSrc(v.thumbs > 0 ? thumbUrl(v.id, 0, v.thumbs) : null), alt: "", onerror: (e) => (e.target.hidden = true) }),
          h("span", { class: "hh-go" }, ico("play", "in"), "이어 보기"),
          h("div", { class: "hh-tx" }, h("b", {}, v.title), h("span", {}, `${fmtDur(Math.max(0, v.duration - v.resume_pos))} 남음` + (v.last_played ? " · " + timeAgo(v.last_played) : ""))),
          h("i", { class: "hh-bar", style: `width:${Math.min(100, (v.resume_pos / v.duration) * 100)}%` })));
      }
      resume.fill(going.slice(1, 13).map(small));
    }),
    api("videos?sort=added&order=desc&per=15").then((d) => recent.fill(d.items.map(small))),
    api("media?type=all&fav=1&sort=added&order=desc&per=24").then((d) => {   // 영상과 사진 모두
      const photos = d.items.filter((x) => x.kind === "photo");
      favs.fill(d.items.map((it) => homeSquare(it, photos)));
    }),
    api("performers").then((list) => {
      counts.people = list.length; drawStats();
      quickPeople.replaceChildren(...list.filter((p) => p.count || p.photo_count).sort((a, b) => (b.count + b.photo_count) - (a.count + a.photo_count)).slice(0, 12)
        .map((p) => h("a", { class: "hp", href: `#/performer?id=${p.id}` }, h("span", { class: "hp-av" }, entityCover(p, p.name.slice(0, 1))), h("span", {}, p.name))));
      people.fill(list.filter((p) => p.count || p.photo_count).sort((a, b) => (b.count + b.photo_count) - (a.count + a.photo_count)).slice(0, 20)
        .map((p) => h("a", { class: "person", href: `#/performer?id=${p.id}` },
          h("div", { class: "pf-avatar" }, entityCover(p, ico("person"))), h("span", {}, p.name))));
    }),
  ];
  if (serverCaps.photos) jobs.push(api("photos?sort=taken&order=desc&per=24").then((d) => {
    counts.photos = d.total; drawStats();
    photos.fill(d.items.map((p, i) => photoCell(p, "grid", () => openViewer(d.items, i))));
  }));
  else photos.fill([]);
  const fills = [resume, recent, favs, people, photos];   // jobs 와 같은 순서
  await Promise.all(jobs.map((j, k) => j.catch(() => { if (fills[k]) fills[k].fill([]); })));
  // 모두 비어 있으면 안내
  if (!$app.querySelector(".shelf")) $app.querySelector(".home").append(h("div", { class: "empty" },
    h("p", {}, "아직 보여 줄 것이 없습니다."), h("a", { class: "btn primary", href: "#/settings" }, "설정에서 폴더나 MEGA 링크 추가")));
}

// ---------------------------------------------------------------- 백업 / 복원
function backupPanel() {
  const file = h("input", { type: "file", accept: ".json,application/json", hidden: true });
  const msg = h("p", { class: "meta" });
  file.addEventListener("change", async () => {
    const f = file.files[0];
    if (!f) return;
    if (!confirm(`‘${f.name}’ 백업으로 지금 정보를 바꿀까요?\n지금 있는 태그·별점·사람 정보는 백업 내용으로 바뀝니다.`)) { file.value = ""; return; }
    msg.textContent = "불러오는 중…";
    try {
      const text = await f.text();
      const r = await fetch("/api/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: text });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || r.statusText);
      msg.textContent = `복원했습니다. 영상 정보 ${d.videos}개. MEGA 목록은 잠시 뒤 다시 받습니다.`;
      toast("백업을 불러왔습니다");
    } catch (e) { msg.textContent = "복원 실패: " + e.message; }
    file.value = "";
  });
  return h("div", { class: "panel" }, h("h3", {}, "백업 / 복원"),
    h("p", { class: "meta" }, "태그·별점·즐겨찾기·사람 정보·북마크·메모를 파일 하나로 저장합니다. 앱을 지웠다 다시 설치할 때 이 파일로 되살릴 수 있습니다. (비밀번호는 넣지 않습니다)"),
    h("p", { class: "warn" }, "백업 파일에는 MEGA 링크(열쇠 포함)가 들어 있으니 다른 사람에게 보내지 마세요."),
    h("div", { class: "row" },
      h("a", { class: "btn primary", href: "/api/backup", download: "vidshelf-backup.json" }, "백업 파일 저장 (Download 폴더)"),
      h("button", { class: "btn", onclick: () => file.click() }, "백업에서 복원")),
    file, msg);
}

// ---------------------------------------------------------------- 숨긴 영상
async function renderHidden() {
  setTab("settings");
  const items = await api("hidden");
  $app.replaceChildren(h("div", { class: "settings" },
    h("div", { class: "row", style: "justify-content:space-between;margin-bottom:12px" },
      h("h2", { style: "margin:0;font-size:20px" }, `숨긴 영상 ${items.length}개`),
      h("a", { class: "btn sm", href: "#/settings" }, "설정으로")),
    items.length ? h("div", { class: "dup-items" }, items.map((v) => {
      const img = h("img", { loading: "lazy", alt: "", src: v.thumbs > 0 ? thumbUrl(v.id, 0, v.thumbs) : null, hidden: !(v.thumbs > 0) });
      img.onerror = () => (img.hidden = true);
      return h("div", { class: "dup-item" },
        h("div", { class: "thumb" }, img, h("div", { class: "noimg" }, ico("play"))),
        h("div", { class: "dup-body" },
          h("div", { class: "dup-name" }, v.filename),
          h("div", { class: "meta" }, ico(v.source === "local" ? "device" : "cloud", "in"), (v.source === "local" ? "이 기기 · " : (SOURCE_LABEL[v.source] || "") + " · ") + (v.folder || "") + " · " + fmtSize(v.size)),
          h("div", { class: "row", style: "margin-top:6px" }, h("button", { class: "btn sm", onclick: async (ev) => {
            await api(`videos/${v.id}/unhide`, { method: "POST" });
            ev.target.closest(".dup-item").classList.add("gone"); ev.target.replaceWith(h("span", { class: "meta" }, "다시 보입니다"));
          } }, "다시 보이기"))));
    })) : h("div", { class: "empty" }, "숨긴 영상이 없습니다.")));
}

// ---------------------------------------------------------------- 중복 영상
async function renderDuplicates() {
  setTab("settings");
  $app.replaceChildren(h("div", { class: "empty" }, "중복 영상·사진을 찾는 중…"));
  const d = await api("duplicates");
  const groups = d.groups || [];
  const wasted = groups.reduce((n, g) => n + g.size * (g.items.length - 1), 0);
  const groupEl = (g) => h("div", { class: "panel" },
    h("h3", {}, `${g.items.length}개 · ${fmtSize(g.size)}` + (g.reason ? ` · ${g.reason}` : "")),
    h("div", { class: "dup-items" }, g.items.map((v) => {
      const ph = v.kind === "photo";
      const ep = ph ? "photos" : "videos";
      const img = h("img", { loading: "lazy", alt: "", src: ph ? `/photothumb/${v.id}.jpg` : v.thumbs > 0 ? thumbUrl(v.id, 0, v.thumbs) : null, hidden: !ph && !(v.thumbs > 0) });
      img.onerror = () => (img.hidden = true);
      const hideBtn = h("button", { class: "btn sm danger", onclick: async (ev) => {
        if (!confirm(`‘${v.filename}’ 을(를) 라이브러리에서 숨길까요?\n(파일은 지우지 않습니다. 태그·별점은 다른 복사본에 남아 있지 않으니 필요하면 먼저 옮겨 두세요)`)) return;
        await api(`${ep}/${v.id}`, { method: "DELETE" });
        ev.target.closest(".dup-item").classList.add("gone");
        ev.target.replaceWith(h("span", { class: "meta" }, "숨김"));
      } }, "목록에서 숨기기");
      const keepBtn = h("button", { class: "btn sm primary", onclick: async (ev) => {
        const others = g.items.filter((x) => x.id !== v.id);
        if (!confirm(`이것만 남기고 나머지 ${others.length}개는 숨길까요?\n숨기는 쪽의 태그·사람·별점 등 정보는 이것으로 합쳐집니다.`)) return;
        await api("duplicates/keep", { method: "POST", body: { kind: ph ? "photo" : "video", keep: v.id, others: others.map((x) => x.id) } });
        const box = ev.target.closest(".panel");
        box.querySelectorAll(".dup-item").forEach((el) => el !== ev.target.closest(".dup-item") && el.classList.add("gone"));
        box.querySelectorAll("button").forEach((b) => (b.disabled = true));
        toast("하나만 남기고 정보를 합쳤습니다");
      } }, "이것만 남기기");
      return h("div", { class: "dup-item" },
        ph ? h("button", { class: "thumb", onclick: () => openViewer(g.items, g.items.indexOf(v)) }, img)
          : h("a", { class: "thumb", href: `#/v/${v.id}` }, img, h("div", { class: "noimg" }, ico("play")),
            v.duration ? h("span", { class: "badge dur" }, fmtDur(v.duration)) : null),
        h("div", { class: "dup-body" },
          ph ? h("span", { class: "dup-name" }, ico("image", "in"), v.filename) : h("a", { class: "dup-name", href: `#/v/${v.id}` }, v.filename),
          h("div", { class: "meta" }, ico(v.source === "local" ? "device" : "cloud", "in"), (v.source === "local" ? "이 기기 · " : (SOURCE_LABEL[v.source] || "") + " · ") + (v.folder || "")),
          h("div", { class: "meta" }, [v.rating ? "★".repeat(v.rating) : "", v.play_count ? `${v.play_count}회 재생` : "", v.performers && v.performers.length ? v.performers.join(", ") : ""].filter(Boolean).join(" · ")),
          h("div", { class: "row", style: "margin-top:6px" }, keepBtn, hideBtn)));
    })));
  $app.replaceChildren(h("div", { class: "settings" },
    h("div", { class: "row", style: "justify-content:space-between;margin-bottom:12px" },
      h("h2", { style: "margin:0;font-size:20px" }, "중복 영상·사진"),
      h("a", { class: "btn sm", href: "#/settings" }, "설정으로")),
    groups.length
      ? h("p", { class: "meta" }, `${groups.length}묶음 · 중복으로 차지하는 크기 약 ${fmtSize(wasted)}. 영상은 파일 크기가, 사진은 파일 크기와 가로·세로가 똑같으면 같은 것으로 봅니다. 남길 영상에서 ‘이것만 남기기’를 누르면 나머지는 숨기고 태그·사람 등 정보는 합쳐집니다. 숨긴 영상은 설정 → 숨긴 영상에서 되돌릴 수 있습니다.`)
      : h("div", { class: "empty" }, "중복 영상·사진이 없습니다."),
    ...groups.map(groupEl)));
}

/** 가져올 폴더 고르기: 사진·영상이 있는 폴더를 개수와 함께 보여 주고 체크해서 고름 (처음 화면에서 ‘폴더를 골라서’를 고르면 여기로) */
async function renderSetup() {
  setTab("library");
  document.body.classList.add("nav-hidden");
  const [folders, st] = await Promise.all([api("folders").catch(() => []), api("settings").catch(() => ({ library_paths: [] }))]);
  const stored = (st.library_paths || []).map((p) => p.path);
  const chosen = new Set(folders.filter((f) => stored.some((p) => f.path.startsWith(p))).map((f) => f.path));
  const list = h("div", { class: "setup-list" });
  const goBtn = h("button", { class: "btn primary setup-go" });
  const n = (x) => (x || 0).toLocaleString();
  const draw = () => {
    list.replaceChildren(...folders.map((f) => {
      const on = chosen.has(f.path), parts = f.path.replace(/\/+$/, "").split("/");
      return h("button", { class: "setup-row" + (on ? " on" : ""), "aria-pressed": on ? "true" : "false",
        onclick: () => { if (chosen.has(f.path)) chosen.delete(f.path); else chosen.add(f.path); draw(); } },
        h("span", { class: "set-ico t4" }, ico("folder")),
        h("span", { class: "setup-text" }, h("b", {}, parts[parts.length - 1] || f.path), h("span", { class: "meta" }, parts.slice(0, -1).join(" / ") || "내장 메모리")),
        h("span", { class: "setup-count meta" }, [f.videos ? `영상 ${n(f.videos)}` : "", f.photos ? `사진 ${n(f.photos)}` : ""].filter(Boolean).join(" · ")),
        ico("select", on ? "setup-check filled" : "setup-check"));
    }));
    goBtn.disabled = !chosen.size;
    goBtn.textContent = chosen.size ? `폴더 ${chosen.size}개 가져오기` : "폴더를 골라 주세요";
  };
  goBtn.onclick = async () => {
    goBtn.disabled = true;
    await api("settings", { method: "PUT", body: { library_paths: [...chosen], library_all: false } });
    toast(`폴더 ${chosen.size}개의 사진과 영상을 가져옵니다`);
    location.replace("#/home");
  };
  const allBtn = h("button", { class: "btn setup-all", onclick: async () => {
    await api("settings", { method: "PUT", body: { library_all: true } });
    toast("휴대폰의 모든 사진과 영상을 가져옵니다");
    location.replace("#/home");
  } }, ico("device", "in"), "휴대폰 전체 가져오기");
  const toggleAll = h("button", { class: "btn sm", onclick: () => { if (chosen.size === folders.length) chosen.clear(); else folders.forEach((f) => chosen.add(f.path)); draw(); } }, "모두 선택");
  draw();
  $app.replaceChildren(h("div", { class: "setup" },
    h("div", { class: "home-head" }, h("div", {}, h("div", { class: "meta" }, "처음 설정"), h("h1", {}, "가져올 폴더 고르기"))),
    h("p", { class: "meta setup-lead" }, "체크한 폴더의 사진과 영상만 목록에 나와요. 나중에 설정 → 라이브러리와 미디어 폴더에서 언제든 바꿀 수 있어요."),
    folders.length ? h("div", { class: "setup-tools" }, h("span", { class: "meta" }, `사진·영상이 있는 폴더 ${folders.length}개`), toggleAll) : null,
    folders.length ? list : h("div", { class: "empty" }, "아직 사진·영상이 있는 폴더를 찾지 못했습니다. 잠시 뒤 다시 열어 보세요."),
    h("div", { class: "setup-bar" }, goBtn, allBtn)));
}

async function folderPicker(onPick) {
  const list = h("div", { class: "list" });
  const head = h("header");
  let current = "";
  const close = () => modal.remove();
  const chooseBtn = h("button", { class: "btn primary", onclick: () => { if (current) { close(); onPick(current); } } }, "이 폴더 선택");
  const modal = h("div", { class: "modal", onclick: (e) => { if (e.target === modal) close(); } },
    h("div", { class: "box" }, head, list,
      h("footer", {}, h("button", { class: "btn", onclick: close }, "취소"), chooseBtn)));
  async function go(path) {
    const r = await api("browse?path=" + encodeURIComponent(path));
    current = r.path;
    head.textContent = r.path || "위치 선택";
    chooseBtn.disabled = !r.path;
    list.replaceChildren(
      ...(r.parent != null ? [h("button", { onclick: () => go(r.parent) }, ico("folderUp", "in"), r.parent ? "상위 폴더" : "처음 위치")] : []),
      ...(r.error ? [h("div", { class: "meta", style: "padding:10px 14px" }, "열 수 없음: " + r.error)] : []),
      ...r.dirs.map((d) => h("button", { onclick: () => go(d.path) }, ico("folder", "in"), d.name)));
  }
  document.body.append(modal);
  go("");
}

// ---------------------------------------------------------------- login
function renderLogin() {
  const pw = h("input", { type: "password", placeholder: "비밀번호", autocomplete: "current-password" });
  const submit = async (e) => {
    e.preventDefault();
    const r = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: pw.value }) });
    if (r.ok) route(); else toast("비밀번호가 틀렸습니다");
  };
  $app.replaceChildren(h("form", { class: "panel login", onsubmit: submit },
    h("h3", {}, "VidShelf 로그인"), pw, h("button", { class: "btn primary" }, "로그인")));
  pw.focus();
}

route();
pollStatus();
api("settings").then((st) => {
  serverCaps = st;
}).catch(() => {});
