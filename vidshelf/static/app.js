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
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2600);
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
  document.querySelectorAll(".tabs a").forEach((a) => a.classList.toggle("on", a.dataset.tab === t));
}

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
  if (meta) meta.content = dark ? "#121316" : "#F4F3EF";
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
  const top0 = () => 90, track = () => window.innerHeight - 90 - 120;   // 위 버튼·아래 메뉴를 피한 구간
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
        if (fav && !mark) { mark = h("span", { class: "sq-fav", "aria-label": "즐겨찾기" }, "♥"); (el.querySelector(".tile-img, .thumb") || el).append(mark); }
        if (!fav && mark) mark.remove();
        el.classList.remove("fav-pop"); void el.offsetWidth; el.classList.add("fav-pop");
        toast(fav ? "♥ 즐겨찾기에 넣었습니다" : "즐겨찾기에서 뺐습니다");
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
    const quota = megaQuotaText(s);
    bar.hidden = !busy && !quota;
    if (!busy && quota) bar.replaceChildren(h("span", { class: "warn" }, "⚠ " + quota));
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
window.addEventListener("hashchange", () => requestAnimationFrame(pageIn));

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
async function route() {
  if (lastHash && /^#\/(media|photos|explore)?(\?|$)/.test(lastHash)) scrollMemory[lastHash] = { y: window.scrollY, pages: window.__mediaPages || 1, at: Date.now() };
  lastHash = location.hash;
  window.__mediaSwipe = null; window.__mediaSwipeTarget = null;
  stopHoldPreview();
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
    if (path === "/tags") return await renderEntities("tags", "태그", "tag");
    if (path === "/performers") return await renderEntities("performers", "사람", "performer");
    if (path === "/performer") return await renderPerformer(+params.get("id"));
    if (path === "/settings") return await renderSettings({ section: params.get("section") });
    if (path === "/mega") return await renderMega(params);
    if (path === "/cloud") return await renderCloud();
    if (path === "/icloud") return await renderICloudAlbum(+params.get("a") || 0);
    if (path === "/photos") return await renderMedia(params, "photo");
    if (path === "/shorts") return await renderShorts(params);
    if (path === "/library") return await renderLibraryHub();
    if (path === "/stats") return await renderStats();
    if (path === "/explore") return await renderExplore(params);
    if (path === "/media") return await renderMedia(params, params.get("type") || "all");
    if (path === "/duplicates") return await renderDuplicates();
    if (path === "/hidden") return await renderHidden();
    location.hash = "#/";
  } catch (e) {
    if (e.message !== "login required") $app.replaceChildren(h("div", { class: "empty" }, "오류: " + e.message));
  } finally {
    finishTabSwipe();   // 밀어서 넘어온 경우 새 화면이 옆에서 들어옴
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
      filterChips.push(h("span", { class: "chip on" }, (key === "tag" ? "# " : "👤 ") + e.name,
        h("button", { title: "필터 해제", onclick: () => {
          const p = new URLSearchParams(params);
          const rest = p.getAll(key).filter((x) => x !== id);
          p.delete(key); rest.forEach((x) => p.append(key, x));
          location.hash = libHash(p);
        } }, "×")));
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
    ["fav", "♥ 즐겨찾기"], ["unwatched", "안 본 영상"], ["missing", "찾을 수 없는 파일"],
  ].map(([k, l]) => h("button", { class: "chip" + (params.get(k) === "1" ? " on" : ""),
    onclick: () => update({ [k]: params.get(k) === "1" ? null : "1" }) }, l));
  const reshuffle = sort === "random" ? h("button", { class: "btn", onclick: () => update({ seed: Date.now() % 100000 }) }, "🔀 섞기") : null;

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
const FILTER_KEYS = ["q", "performer", "tag", "fav", "unwatched"];

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
  $app.style.transition = "none";
  $app.style.transform = `translateX(${dir * 28}%)`;
  $app.style.opacity = "0";
  void $app.offsetWidth;
  $app.style.transition = "transform .34s cubic-bezier(.2,.8,.2,1), opacity .25s ease";
  $app.style.transform = "";
  $app.style.opacity = "";
  setTimeout(() => { $app.style.transition = ""; }, 380);
}
(function tabSwipe() {
  let sx = 0, sy = 0, t0 = 0, mode = null, from = null, dx = 0, moving = null;
  const W = () => window.innerWidth;
  const blocked = (tgt) => {
    if (tgt.closest("input, textarea, select, .sheet, .viewer, .modal, .seekbar")) return true;
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
const act = (label, ico, fn) => { const b = h("button", { class: "sel-act", onclick: fn }); b.innerHTML = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ico}</svg>`; b.append(label); return b; };
const actBar = h("div", { class: "sel-actions", hidden: true },
  act("태그", '<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.4"/>', () => editLinks("tags")),
  act("사람", '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.2 3.6-6.5 8-6.5s8 2.3 8 6.5"/>', () => editLinks("performers")),
  act("날짜", '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>', () => editDate()),
  act("즐겨찾기", '<path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 7.9 3.6 4.5 7 4.5c2 0 3.4 1.1 5 3 1.6-1.9 3-3 5-3 3.4 0 5.6 3.4 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z"/>', () => editFav()),
  act("삭제", '<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v6M14 11v6"/>', () => editDelete()));
opts.holder.append(selBar);   // 아래 버튼 막대는 움직임 효과가 걸린 화면 밖(body)에 붙여야 화면 맨 아래에 고정됨
let selecting = false;
function onSelPop() { if (selecting) endSelect(false, true, true); }
function startSelect() {
  selecting = true;
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
function selectable(el, it) {
  el._item = it;
  cells.set(keyOf(it), el);
  if (selected.has(keyOf(it))) el.classList.add("sel");
  let timer = null, sx = 0, sy = 0, fired = false;
  const cancel = () => { clearTimeout(timer); timer = null; };
  el.addEventListener("touchstart", (e) => {
    fired = false; sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    if (selecting) return;
    timer = setTimeout(() => {   // 길게 누르면 선택 모드 시작
      timer = null; fired = true;
      try { navigator.vibrate && navigator.vibrate(18); } catch (er) {}
      startSelect(); toggleSel(it, el);
    }, 480);
  }, { passive: true });
  el.addEventListener("touchmove", (e) => { if (timer && Math.hypot(e.touches[0].clientX - sx, e.touches[0].clientY - sy) > 10) cancel(); }, { passive: true });
  el.addEventListener("touchend", cancel);
  el.addEventListener("touchcancel", cancel);
  el.addEventListener("contextmenu", (e) => { e.preventDefault(); if (!selecting) { startSelect(); toggleSel(it, el); } });
  el.addEventListener("click", (e) => {   // 선택 모드에서는 열지 않고 고르기
    if (fired) { e.preventDefault(); e.stopImmediatePropagation(); fired = false; return; }
    if (selecting) { e.preventDefault(); e.stopImmediatePropagation(); toggleSel(it, el); }
  }, true);
  return el;
}
const selItems = () => [...selected.values()].map((it) => ({ kind: it.kind, id: it.id }));
async function applyBatch(body, msg) {
  try {
    const r = await api("batch", { method: "POST", body: { items: selItems(), ...body } });
    toast(msg.replace("{n}", r.updated));
    endSelect();
    opts.refresh();
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
      (field === "tags" ? "#" : "") + t.name, h("span", { class: "meta" }, ` ${t.count}/${info.total}`), off ? " ✕" : "");
  }) : [h("span", { class: "meta" }, `선택한 항목에 붙은 ${label}이(가) 없습니다.`)]));
  const all = (field === "tags" ? opts.tags : opts.performers) || [];
  const addBox = h("div", { class: "chips" });
  const drawAdd = () => addBox.replaceChildren(...[...add].map((n) => h("span", { class: "chip on" }, (field === "tags" ? "#" : "") + n,
    h("button", { "aria-label": `${n} 빼기`, onclick: () => { add.delete(n); drawAdd(); } }, "×"))));
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
      close(() => applyBatch({ ["add_" + field]: [...add], ["remove_" + field]: [...remove] }, `${label}를 {n}개 항목에 반영했습니다`));
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
    h("button", { class: "btn primary sheet-go", onclick: () => close(() => applyBatch({ favorite: true }, "♥ {n}개를 즐겨찾기에 넣었습니다")) }, allFav ? "이미 모두 즐겨찾기" : "♥ 즐겨찾기에 넣기"),
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
      await api("batch", { method: "POST", body: { items: selItems(), delete: mode } });
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

  return { selectable, cells, endSelect, isSelecting: () => selecting };
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
  const nFilters = () => params.getAll("performer").length + params.getAll("tag").length + (params.get("q") ? 1 : 0) + (params.get("fav") === "1" ? 1 : 0) + (params.get("unwatched") === "1" ? 1 : 0);
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
  const sel = makeSelection({ holder: selHolder, refresh: () => update({ anim: "fade" }), performers, tags });
  const { selectable, cells } = sel;
  const mediaTab = parseHash().path === "/media";   // 미디어 탭의 목록 보기는 꾹 누르면 미리보기, 태그·사람으로 들어온 목록은 선택

  function drawHeader() {
    const mode = viewMode("media") === "wall" ? "wall" : "feed";
    viewBtn.hidden = type === "photo";   // 사진은 항상 이미지 벽
    viewBtn.setAttribute("aria-label", mode === "wall" ? "목록으로 보기" : "이미지 벽으로 보기");
    viewBtn.title = viewBtn.getAttribute("aria-label");
    viewBtn.innerHTML = mode === "wall"
      ? '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3.5" width="18" height="10" rx="2"/><path d="M3 17h12M3 20.5h8"/></svg>'
      : '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="10" height="7" rx="1.5"/><rect x="15" y="4" width="6" height="7" rx="1.5"/><rect x="3" y="13" width="6" height="7" rx="1.5"/><rect x="11" y="13" width="10" height="7" rx="1.5"/></svg>';
    filterBtn.innerHTML = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg>';
    filterBtn.append("필터", nFilters() ? h("span", { class: "fbadge" }, nFilters()) : "");
    segBtns.forEach((b, i) => { const on = TYPES[i] === type; b.classList.toggle("on", on); b.setAttribute("aria-selected", on ? "true" : "false"); });
    segInd.style.transform = `translateX(${TYPES.indexOf(type) * 100}%)`;   // 선택 표시가 미끄러지듯 이동
    drawChips();
  }

  // ---- 걸린 필터
  function drawChips() {
    const without = (key, val) => { const p = new URLSearchParams(params); const rest = p.getAll(key).filter((x) => x !== val); p.delete(key); rest.forEach((x) => p.append(key, x)); update({ p }); };
    const chips = [];
    if (params.get("q")) chips.push(h("span", { class: "fchip" }, `“${params.get("q")}”`, h("button", { "aria-label": "검색어 지우기", onclick: () => without("q", params.get("q")) }, "×")));
    for (const id of params.getAll("performer")) {
      const pf = performers.find((x) => String(x.id) === id) || {};
      chips.push(h("span", { class: "fchip" }, h("span", { class: "fc-av" }, entityCover(pf, "")), perfName(id), h("button", { "aria-label": `${perfName(id)} 필터 해제`, onclick: () => without("performer", id) }, "×")));
    }
    for (const id of params.getAll("tag")) chips.push(h("span", { class: "fchip" }, "#" + tagName(id), h("button", { "aria-label": `${tagName(id)} 필터 해제`, onclick: () => without("tag", id) }, "×")));
    if (params.get("fav") === "1") chips.push(h("span", { class: "fchip" }, "♥ 즐겨찾기", h("button", { "aria-label": "즐겨찾기 필터 해제", onclick: () => without("fav", "1") }, "×")));
    if (params.get("unwatched") === "1") chips.push(h("span", { class: "fchip" }, "안 본 영상", h("button", { "aria-label": "안 본 영상 필터 해제", onclick: () => without("unwatched", "1") }, "×")));
    if (chips.length > 1) chips.push(h("button", { class: "fclear", onclick: () => { const p = new URLSearchParams(params); FILTER_KEYS.forEach((k) => p.delete(k)); update({ p }); } }, "모두 지우기"));
    chipsBox.replaceChildren(...chips);
    chipsBox.hidden = !chips.length;
  }

  viewBtn.onclick = () => {
    try { localStorage.setItem("vs-mode-media", viewMode("media") === "wall" ? "feed" : "wall"); } catch (e) {}
    update({ anim: "fade" });
  };

  $app.replaceChildren(h("div", { class: "media" },
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
    const photos = [];
    let page = 1;
    let restoring = anim === "none" && restore && restore.y > 0 ? restore : null;
    const base = new URLSearchParams(params);
    base.set("type", type); base.set("sort", sort); base.set("order", order); base.set("per", "60");
    if (sort === "random" && !base.get("seed")) base.set("seed", "7");
    cells.clear();
    const old = content.firstElementChild;
    if (old && !old.classList.contains("skeleton")) { old.style.minHeight = old.offsetHeight + "px"; old.classList.add("leaving"); }   // 새 목록이 오기 전까지 높이 유지(깜빡임 방지)
    else content.replaceChildren(skeletonList(mode));   // 처음 열 때: 빈 화면 대신 칸 모양 회색 틀
    async function load() {
      base.set("page", page);
      let d;
      try { d = await api("media?" + base.toString()); } catch (e) { if (my === token) more.replaceChildren(h("span", { class: "warn" }, e.message)); return; }
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
            run.append(mediaTab ? cell : selectable(cell, it));
          }
        } else if (mode === "wall") {
          grid.append(selectable(videoTile(it), it));
        } else {
          grid.append(mediaTab ? holdPreview(ytCell(it, null), it) : selectable(ytCell(it, null), it));   // 미디어 탭 목록 보기: 꾹 누르면 미리보기
        }
      }
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
    };
    img.onerror = () => (img.hidden = true);
    // 원래 비율 그대로 (모르면 이미지를 받아 본 뒤 맞춤)
    const known = it.width > 0 && it.height > 0;
    const ratio = known ? it.width / it.height : 16 / 9;
    const pname = (it.performers || [])[0];
    const pf = pname ? performers.find((x) => x.name === pname) : null;
    const when = timeAgo(isPhoto ? it.taken || it.added_at : it.added_at);
    const sub = [(it.performers || []).join(", "), isPhoto ? "사진" : resLabel(it.width, it.height), when].filter(Boolean).join(" · ");
    const kids = [
      h("div", { class: "yt-thumb", style: `aspect-ratio:${ratio}` }, img,
        !isPhoto && it.duration ? h("span", { class: "badge dur" }, fmtDur(it.duration)) : null,
        it.favorite ? h("span", { class: "sq-fav", "aria-label": "즐겨찾기" }, "♥") : null,
        !isPhoto && it.resume_pos > 5 && it.duration ? h("div", { class: "progress", style: `width:${Math.min(100, (it.resume_pos / it.duration) * 100)}%` }) : null),
      h("div", { class: "yt-info" },
        h("span", { class: "yt-av" }, pf ? entityCover(pf, pname.slice(0, 1)) : h("span", {}, pname ? pname.slice(0, 1) : isPhoto ? "▣" : "▶")),
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
      !isPhoto ? h("span", { class: "sq-dur" }, "▶ " + (it.duration ? fmtDur(it.duration) : "")) : null,
      it.favorite ? h("span", { class: "sq-fav", "aria-label": "즐겨찾기" }, "♥") : null];
    return isPhoto
      ? h("button", { class: "sq", onclick: open, "aria-label": it.title || "사진" }, ...kids)
      : h("a", { class: "sq", href: `#/v/${it.id}`, "aria-label": it.title || "영상" }, ...kids);
  }

  // ---- 필터 시트: 검색 · 사람 · 태그 · 정렬 · 즐겨찾기
  function openFilterSheet() {
    const sort = sortOf(), order = orderOf();
    const draft = {
      q: params.get("q") || "", performer: new Set(params.getAll("performer")), tag: new Set(params.getAll("tag")),
      sort, order, fav: params.get("fav") === "1", unwatched: params.get("unwatched") === "1",
    };
    const toParams = () => {
      const p = new URLSearchParams();
      if (draft.q.trim()) p.set("q", draft.q.trim());
      draft.performer.forEach((x) => p.append("performer", x));
      draft.tag.forEach((x) => p.append("tag", x));
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
        const p = toParams(); p.set("type", type); p.set("per", "1");
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
          ...rq.map((w) => h("button", { class: "chip", onclick: () => { draft.q = w; search.value = w; refreshCount(); drawSuggest(); } }, "🕘 " + w)),
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
        const on = draft.performer.has(String(pf.id));
        return h("button", { class: "pick-person" + (on ? " on" : ""), "aria-pressed": on ? "true" : "false",
          onclick: () => { on ? draft.performer.delete(String(pf.id)) : draft.performer.add(String(pf.id)); drawPeople(); refreshCount(); } },
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
        const on = draft.tag.has(String(t.id));
        return h("button", { class: "chip" + (on ? " on" : ""), "aria-pressed": on ? "true" : "false",
          onclick: () => { on ? draft.tag.delete(String(t.id)) : draft.tag.add(String(t.id)); drawTags(); refreshCount(); } }, "#" + t.name);
      }), ...(!tagsAll && tagList.length > 10 ? [h("button", { class: "chip dashed", onclick: () => { tagsAll = true; drawTags(); } }, `+${tagList.length - 10}`)] : []));
    };

    const sortBox = h("div", { class: "chips" });
    const drawSort = () => sortBox.replaceChildren(...MEDIA_SORTS.concat(type === "video" ? VIDEO_SORTS : []).map(([v, l]) => {
      const on = draft.sort === v;
      return h("button", { class: "chip" + (on ? " sel" : ""), "aria-pressed": on ? "true" : "false", onclick: () => {
        if (on && v !== "random") draft.order = draft.order === "asc" ? "desc" : "asc";
        else { draft.sort = v; draft.order = v === "title" ? "asc" : "desc"; }
        drawSort(); refreshCount();
      } }, l + (on && v !== "random" ? (draft.order === "asc" ? " ↑" : " ↓") : ""));
    }));

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
          f.default ? h("span", { class: "sf-star", "aria-label": "기본 필터" }, "★") : null,
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
            }) }, h("b", {}, f.default ? "기본 필터 해제" : "★ 기본 필터로 지정"),
              h("span", { class: "meta" }, f.default ? "미디어 탭을 열면 조건 없이 전체가 보입니다." : "미디어 탭을 열 때마다 이 조건이 자동으로 걸립니다.")),
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
        h("button", { class: "chip add", onclick: () => { saveRow.hidden = !saveRow.hidden; if (!saveRow.hidden) nameIn.focus(); } }, "＋ 지금 조건 저장"),
        ...(savedFilters.length ? [h("p", { class: "meta sf-hint" }, "길게 누르면 ★ 기본 필터로 정하거나 지울 수 있습니다. 기본 필터는 미디어 탭을 열 때 자동으로 걸립니다.")] : []));
    }
    api("saved_filters").then((l) => { savedFilters = l; drawSaved(); }).catch(() => {});
    drawSaved();

    const sheet = h("section", { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": "필터" },
      h("div", { class: "sheet-grip", "aria-hidden": "true" }),
      h("div", { class: "sheet-head" }, h("h2", {}, "필터"), h("button", { class: "round-btn", "aria-label": "닫기", onclick: () => close(false) }, icon("close"))),
      h("div", { class: "sheet-body" },
        h("label", { class: "sheet-search" }, h("span", { "aria-hidden": "true" }, "⌕"), search),
        suggest,
        h("div", { class: "sheet-sec" }, h("h3", {}, "저장된 필터"), savedBox, saveRow),
        people.length ? h("div", { class: "sheet-sec" }, h("div", { class: "sheet-sec-head" }, h("h3", {}, "사람"), peopleMore), peopleBox) : null,
        tagList.length ? h("div", { class: "sheet-sec" }, h("h3", {}, "태그"), tagBox) : null,
        h("div", { class: "sheet-sec" }, h("h3", {}, "정렬"), sortBox),
        toggle("즐겨찾기만 보기", "fav"),
        type === "video" ? toggle("안 본 영상만", "unwatched") : null),
      h("div", { class: "sheet-foot" },
        h("button", { class: "btn", onclick: () => {
          draft.q = ""; search.value = ""; draft.performer.clear(); draft.tag.clear(); draft.fav = false; draft.unwatched = false;
          draft.sort = "added"; draft.order = "desc";
          sheet.querySelectorAll(".switch").forEach((x) => { x.classList.remove("on"); x.setAttribute("aria-checked", "false"); });
          drawPeople(); drawTags(); drawSort(); refreshCount();
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
  window.__fsCleanup = attachFastScroll(() => (["added", "taken", "title"].includes(sortOf()) ? labelAtCenter() : ""));
  await drawContent("none");
}

// ---------------------------------------------------------------- 보기 방식 (그리드 / 이미지 벽)
function viewMode(kind) {
  try { return localStorage.getItem("vs-mode-" + kind) || "grid"; } catch (e) { return "grid"; }
}
function modeToggle(kind, onChange) {
  const cur = viewMode(kind);
  const set = (m) => { try { localStorage.setItem("vs-mode-" + kind, m); } catch (e) {} onChange(); };
  return h("div", { class: "seg", role: "group", "aria-label": "보기 방식" },
    h("button", { class: cur === "grid" ? "on" : "", onclick: () => set("grid") }, "▦ 그리드"),
    h("button", { class: cur === "wall" ? "on" : "", onclick: () => set("wall") }, "▤ 이미지 벽"));
}
const wallHeight = () => (window.innerWidth < 560 ? 110 : 180);

/** 이미지 벽 한 칸: 원래 비율을 유지하고 아래에 사람 이름을 표시 */
/** 크게 보이는 칸용 큰 미리보기 주소 (화질 깨짐 방지) */
const hdSrc = (src, size = 1080) => !src ? src : src + (src.includes("?") ? "&" : "?") + "s=" + size;

function wallTile({ href, onclick, src, ratio, badges, performers }) {
  src = hdSrc(src);
  let r = ratio > 0 ? Math.min(3, Math.max(0.4, ratio)) : 1;
  const box = h("div", { class: "tile-img", style: `aspect-ratio:${r}` });
  const tile = h(href ? "a" : "div", { class: "tile", href, onclick, style: `flex:${r} 1 ${Math.round(r * wallHeight())}px` }, box,
    h("div", { class: "tile-cap" + (performers && performers.length ? " has" : "") }, performers && performers.length ? performers.join(", ") : "\u00a0"));
  if (src) {
    const img = h("img", { src, loading: "lazy", alt: "" });
    img.onload = () => {
      if (!(ratio > 0) && img.naturalWidth) {   // 비율을 모르면 이미지를 받아 본 뒤 맞춤
        r = Math.min(3, Math.max(0.4, img.naturalWidth / img.naturalHeight));
        box.style.aspectRatio = r; tile.style.flex = `${r} 1 ${Math.round(r * wallHeight())}px`;
      }
    };
    img.onerror = () => (img.hidden = true);
    box.append(img);
  }
  (badges || []).forEach((b) => b && box.append(b));
  return tile;
}

function videoTile(v) {
  return wallTile({
    href: `#/v/${v.id}`, src: v.thumbs > 0 ? thumbUrl(v.id, 0, v.thumbs) : null,
    ratio: v.width && v.height ? v.width / v.height : 0, performers: v.performers,   // 모르면 썸네일의 실제 비율을 씀
    badges: [v.duration ? h("span", { class: "badge dur" }, fmtDur(v.duration)) : null, v.favorite ? h("span", { class: "badge fav" }, "♥") : null],
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
    chips.push(h("span", { class: "chip on" }, e.name, h("button", { title: "필터 해제", onclick: () => update({ performer: null }) }, "×")));
  }
  for (const id of params.getAll("tag")) {
    const e = await api(`tags/${id}`).catch(() => ({ name: "" + id }));
    chips.push(h("span", { class: "chip on" }, "# " + e.name, h("button", { title: "필터 해제", onclick: () => update({ tag: null }) }, "×")));
  }
  let t;
  const search = h("input", { type: "search", class: "search", placeholder: "이름, 사람, 폴더 검색", value: params.get("q") || "",
    oninput: (e) => { clearTimeout(t); t = setTimeout(() => { typingSearch = true; update({ q: e.target.value }); }, 400); } });
  const sortSel = h("select", { "aria-label": "정렬", onchange: (e) => update({ sort: e.target.value, order: null }) },
    PHOTO_SORTS.map(([v, l]) => h("option", { value: v, selected: v === sort }, l)));
  const orderBtn = sort === "random" ? h("button", { class: "btn", onclick: () => update({ seed: Date.now() % 100000 }) }, "🔀 섞기")
    : h("button", { class: "btn", onclick: () => update({ order: order === "asc" ? "desc" : "asc" }) }, order === "asc" ? "↑ 오름차순" : "↓ 내림차순");
  const fav = h("button", { class: "chip" + (params.get("fav") === "1" ? " on" : ""), onclick: () => update({ fav: params.get("fav") === "1" ? null : "1" }) }, "♥ 즐겨찾기");
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
    return wallTile({ onclick: open, src: `/photothumb/${p.id}.jpg`, ratio: p.width && p.height ? p.width / p.height : 0,
      performers: p.performers, badges: [p.favorite ? h("span", { class: "badge fav" }, "♥") : null] });
  }
  const img = h("img", { src: `/photothumb/${p.id}.jpg`, loading: "lazy", alt: "" });
  img.onerror = () => (img.hidden = true);
  return h("div", { class: "pcard", onclick: open },
    h("div", { class: "thumb" }, img, p.favorite ? h("span", { class: "badge fav" }, "♥") : null),
    h("div", { class: "title", title: p.title }, p.title),
    p.performers.length ? h("div", { class: "sub" }, p.performers.join(", ")) : null);
}

const ICON = {
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  heart: '<path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 7.9 3.6 4.5 7 4.5c2 0 3.4 1.1 5 3 1.6-1.9 3-3 5-3 3.4 0 5.6 3.4 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z"/>',
  prev: '<path d="M15 5l-7 7 7 7"/>',
  next: '<path d="M9 5l7 7-7 7"/>',
};
function icon(name) {
  const span = document.createElement("span");
  span.innerHTML = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICON[name]}</svg>`;
  return span.firstChild;
}

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
    document.removeEventListener("keydown", onKey); window.removeEventListener("popstate", onPop);
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
          editing ? h("button", { class: n <= (cur.rating || 0) ? "on" : "", title: `${n}점`, onclick: () => save({ rating: cur.rating === n ? 0 : n }) }, "★")
            : n <= (cur.rating || 0) ? h("span", { class: "on" }, "★") : null)),
        h("button", { class: "btn sm" + (editing ? " primary" : ""), onclick: () => { editing = !editing; draw(); } }, editing ? "완료" : "✎ 수정")),
      h("span", { class: "meta" }, "출연한 사람"),
      h("div", { class: "chips" }, ...(cur.performer_refs.length ? cur.performer_refs.map((p) => editing
        ? h("span", { class: "chip" }, p.name,
            h("button", { "aria-label": `${p.name} 제거`, onclick: () => save({ performers: cur.performer_refs.filter((x) => x.id !== p.id).map((x) => x.name) }) }, "×"))
        : h("button", { class: "chip", onclick: () => { close(); location.hash = `#/performer?id=${p.id}`; } }, p.name))
        : [h("span", { class: "meta" }, editing ? "출연한 사람 없음 — 아래에 이름을 입력하세요" : "출연한 사람 없음")])),
      ...(editing ? [input] : []),
      h("span", { class: "meta" }, "태그"),
      h("div", { class: "chips" }, ...((cur.tags || []).length ? cur.tags.map((t) => editing
        ? h("span", { class: "chip" }, "# " + t.name,
            h("button", { "aria-label": `${t.name} 제거`, onclick: () => save({ tags: cur.tags.filter((x) => x.id !== t.id).map((x) => x.name) }) }, "×"))
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
  let pinch = null, pan = null, lastTap = 0;
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
    if (!lock) { if (Math.abs(x) < 8 && Math.abs(y) < 8) return; lock = Math.abs(x) > Math.abs(y) * 1.2 ? "h" : "v"; }
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
    if (lock !== "h") {   // 움직이지 않은 짧은 탭: 사진을 두 번 누르면 확대/원래대로
      if (!lock && stage.contains(e.target) && Date.now() - t0 < 250) {
        const now = Date.now();
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
    h("div", { class: "vtop" }, h("button", { class: "vbtn", "aria-label": "닫기", onclick: () => history.back() }, icon("close")), counter, favBtn),
    stage, info);
  el.addEventListener("touchstart", onStart, { passive: true });
  el.addEventListener("touchmove", onMove, { passive: false });
  el.addEventListener("touchend", onEnd);
  el.addEventListener("touchcancel", onEnd);
  document.body.append(el);
  document.body.style.overflow = "hidden";
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
    v.favorite ? h("span", { class: "badge fav" }, "♥") : null,
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
      v.rating ? h("span", { class: "stars-mini" }, "★".repeat(v.rating)) : null,
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
  const autoNextOn = () => { try { return localStorage.getItem("vs-autonext") !== "0"; } catch (e) { return true; } };
  const autoNextBtn = h("button", { class: "btn sm", onclick: () => {
    const on = !autoNextOn();
    try { localStorage.setItem("vs-autonext", on ? "1" : "0"); } catch (e) {}
    drawAutoNext(); toast(on ? "영상이 끝나면 다음 영상을 이어서 재생합니다" : "연속 재생을 껐습니다");
  } });
  const drawAutoNext = () => { autoNextBtn.textContent = autoNextOn() ? "↻ 연속 재생 켬" : "연속 재생 끔"; autoNextBtn.classList.toggle("on", autoNextOn()); };
  drawAutoNext();
  window.__nativeClosed = (id, pos) => { if (String(id) === String(v.id) && pos > 0) { try { video.currentTime = pos; } catch (e) {} } };
  const goNative = (why) => {
    if (!hasNativePlayer()) { toast(why); return; }
    toast("이 형식은 앱 플레이어로 재생합니다");
    playNative(v, currentTime());
  };
  video.addEventListener("error", () => {
    if (mode === "direct" && video.error && (v.source === "mega" || v.source === "icloud")) {
      api("status").then((st) => { const q = megaQuotaText(st); if (q) toast(q); else goNative("재생하지 못했습니다. 지원하지 않는 형식이거나 연결 문제입니다."); })
        .catch(() => goNative("재생하지 못했습니다."));
    } else if (mode === "direct" && video.error && !canTranscode) {
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
    ? h("button", { class: "btn sm", onclick: (e) => { e.target.remove(); seekTo(v.resume_pos); } }, `▶ ${fmtDur(v.resume_pos)}부터 이어보기`)
    : null;

  // --- 재생 조작부: 처음에는 아무것도 가리지 않고, 화면을 누르면 나타났다가 잠시 뒤 사라짐
  const svgIco = (d) => { const sp = document.createElement("span"); sp.innerHTML = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`; return sp.firstChild; };
  const PLAY = '<path d="M7 4.5l13 7.5-13 7.5z" fill="currentColor" stroke="none"/>', PAUSE = '<rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none"/>';
  const centerBtn = h("button", { class: "vp-center", "aria-label": "재생/일시정지" });
  const playBtn = h("button", { class: "vp-btn", "aria-label": "재생/일시정지" });
  const timeEl = h("span", { class: "vp-time" }, "0:00");
  const fill = h("div", { class: "vp-fill" });
  const track = h("div", { class: "vp-track" }, h("div", { class: "vp-rail" }, fill));
  const fsBtn = h("button", { class: "vp-btn", "aria-label": "전체 화면" }, svgIco('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'));
  const remainEl = h("span", { class: "vp-time" }, "");
  // 이전·다음 영상: 영상을 연 목록의 순서대로
  let queue = [];
  try { queue = JSON.parse(sessionStorage.getItem("vs_queue") || "[]"); } catch (e) {}
  const qi = queue.indexOf(String(v.id));
  const prevId = qi > 0 ? queue[qi - 1] : null, nextId = qi >= 0 && qi < queue.length - 1 ? queue[qi + 1] : null;
  const goVideo = (id) => { if (id) location.replace(`#/v/${id}`); };   // 뒤로 가기는 목록으로 바로 돌아가도록 기록을 바꿈
  const prevBtn = h("button", { class: "vp-skip", "aria-label": "이전 영상", disabled: !prevId, onclick: (e) => { e.stopPropagation(); goVideo(prevId); } },
    svgIco('<path d="M6 5v14" stroke-width="2.4"/><path d="M19 5.5L8.5 12 19 18.5z" fill="currentColor" stroke="none"/>'));
  const nextBtn = h("button", { class: "vp-skip", "aria-label": "다음 영상", disabled: !nextId, onclick: (e) => { e.stopPropagation(); goVideo(nextId); } },
    svgIco('<path d="M18 5v14" stroke-width="2.4"/><path d="M5 5.5L15.5 12 5 18.5z" fill="currentColor" stroke="none"/>'));
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

  const favBtn = () => h("button", { class: "favbtn" + (v.favorite ? " on" : ""), onclick: () => save({ favorite: !v.favorite }) }, v.favorite ? "♥ 즐겨찾기" : "♡ 즐겨찾기");
  const dlBtn = () => v.source === "mega" || v.source === "icloud" ? h("a", { class: "btn sm", href: `/media/${v.id}?dl=1` }, "휴대폰에 저장")
    : v.can_delete === false ? null : h("a", { class: "btn sm", href: `/media/${v.id}`, download: v.filename }, "다운로드");
  const addMarker = async (titleIn) => {
    v.markers = await api(`videos/${v.id}/markers`, { method: "POST", body: { seconds: currentTime(), title: titleIn ? titleIn.value.trim() : "" } });
    toast(`${fmtDur(currentTime())} 북마크를 추가했습니다`); drawInfo();
  };

  function readView() {
    const stat = (big, small) => h("div", {}, h("b", {}, big), h("span", {}, small));
    const people = v.performers.map((p) => h("div", { class: "vperson" },
      h("span", { class: "av", "aria-hidden": "true" }, p.name.slice(0, 1)),
      h("span", { class: "nm" }, p.name),
      h("a", { class: "pf", href: `#/performer?id=${p.id}` }, "프로필")));
    const tags = v.tags.map((t) => h("a", { class: "chip", href: `#/?tag=${t.id}` }, "#" + t.name));
    return [
      h("div", { class: "vcard" },
        h("div", { class: "vhead" },
          h("h1", { class: "vtitle" }, v.title),
          h("button", { class: "favround" + (v.favorite ? " on" : ""), "aria-label": v.favorite ? "즐겨찾기 해제" : "즐겨찾기", onclick: () => save({ favorite: !v.favorite }) }, v.favorite ? "♥" : "♡")),
        h("div", { class: "vstats" },
          stat(v.duration ? fmtDur(v.duration) : "-", "길이"),
          stat(resLabel(v.width, v.height) || "-", "화질"),
          stat(v.rating ? "★" + v.rating : "-", "별점"),
          stat(`${v.play_count || 0}회`, "재생")),
        ...people,
        h("div", { class: "chips" }, ...tags,
          h("button", { class: "chip dashed", onclick: () => setEditing(true) }, "✎ 수정"))),
      h("div", { class: "actions", style: "margin-top:12px" }, dlBtn(),
        hasNativePlayer() ? h("button", { class: "btn sm", onclick: () => { video.pause(); playNative(v, currentTime()); } }, "▶ 앱 플레이어로 재생") : null,
        h("span", { class: "meta" }, (v.source !== "local" ? SOURCE_LABEL[v.source] + " · " : "") + fmtSize(v.size))),
      v.details ? h("p", { class: "vmemo" }, v.details) : null,
      v.markers.length ? h("div", { class: "vmarks" }, v.markers.map((m) =>
        h("button", { onclick: () => seekTo(m.seconds) }, h("b", {}, fmtDur(m.seconds)), h("span", {}, m.title || "북마크")))) : null,
      frames ? h("div", { class: "panel", style: "margin-top:14px" }, h("h3", {}, "장면"), frames) : null,
    ];
  }

  function editView() {
    const titleIn = h("input", { type: "text", value: v.title, onchange: (e) => save({ title: e.target.value.trim() || v.title }) });
    const stars = h("div", { class: "stars" }, ...[1, 2, 3, 4, 5].map((n) =>
      h("button", { class: n <= v.rating ? "on" : "", title: `${n}점`, onclick: () => save({ rating: v.rating === n ? 0 : n }) }, "★")));
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
          h("button", { title: "제거", "aria-label": `${t.name} 제거`, onclick: () => save({ [field]: v[field].filter((x) => x.id !== t.id).map((x) => x.name) }) }, "×")))
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
      } }, "×"))) : [h("li", { class: "meta" }, "북마크가 없습니다.")]));
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
    } }, "🖼 지금 장면을 썸네일로");
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
    const coverPickBtn = h("button", { class: "btn sm", onclick: () => coverFile.click() }, "📷 기기 사진으로");
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

  $app.replaceChildren(h("div", { class: "watch1" },
    playerBox,
    seekRow,
    h("div", { class: "player-note" }, canTranscode ? modeNote : null, canTranscode ? modeBtn : null, resume,
      h("button", { class: "btn sm", onclick: () => addMarker(null) }, "🔖 지금 위치 북마크"), autoNextBtn),
    infoBox));
  drawInfo();
}

// ---------------------------------------------------------------- tags / performers
function entityCover(e, fallback) {
  const src = e.cover ? thumbUrl(e.cover, 0, "c") : e.photo_cover ? `/photothumb/${e.photo_cover}.jpg` : null;
  if (!src) return h("div", { class: "noimg" }, fallback);
  const img = h("img", { src, loading: "lazy", alt: "" });
  img.onerror = () => { img.replaceWith(h("div", { class: "noimg" }, fallback)); };
  return img;
}

async function renderEntities(ep, label, filterKey) {
  setTab(ep);
  const items = await api(ep);
  let filter = "", editing = false;
  const grid = h("div", { class: "egrid" });
  const draw = () => {
    const list = items.filter((e) => e.name.toLowerCase().includes(filter.toLowerCase()));
    grid.replaceChildren(...list.map((e) => {
      if (filterKey === "performer") {   // 사람: 카드 전체를 누르면 프로필로
        const href = `#/performer?id=${e.id}`;
        return h("a", { class: "ecard", href },
          h("div", { class: "thumb" }, entityCover(e, "👤")),
          h("div", { class: "body" },
            h("span", { class: "name", title: e.name }, e.name),
            h("span", { class: "meta" }, e.photo_count ? `${e.count} · 사진 ${e.photo_count}` : `${e.count}`)),
          e.group !== undefined ? h("div", { class: "body meta", style: "padding-top:0;display:block" },
            [e.group, e.birthdate ? `${age(e.birthdate)}세` : ""].filter(Boolean).join(" · ") || "정보 없음") : null);
      }
      // 태그: 누르면 그 태그 영상 목록. 이름 변경·삭제는 ‘수정’을 눌렀을 때만
      const href = `#/?${filterKey}=${e.id}`;
      if (!editing) return h("a", { class: "ecard", href },
        h("div", { class: "thumb" }, entityCover(e, "#")),
        h("div", { class: "body" },
          h("span", { class: "name", title: e.name }, "# " + e.name),
          h("span", { class: "meta" }, e.photo_count ? `${e.count} · 사진 ${e.photo_count}` : `${e.count}`)),
        e.photo_count ? h("div", { class: "body", style: "padding-top:0" },
          h("button", { class: "btn sm", onclick: (ev) => { ev.preventDefault(); location.hash = `#/photos?tag=${e.id}`; } }, "사진 보기")) : null);
      return h("div", { class: "ecard" },
        h("div", { class: "thumb" }, entityCover(e, "#")),
        h("div", { class: "body" },
          h("span", { class: "name", title: e.name }, "# " + e.name),
          h("span", { class: "meta" }, `${e.count}`)),
        h("div", { class: "body", style: "padding-top:0" },
          h("button", { class: "btn sm", onclick: async () => {
            const n = prompt(`${label} 이름 변경 (기존 이름과 같게 하면 합쳐집니다)`, e.name);
            if (!n || n === e.name) return;
            await api(`${ep}/${e.id}`, { method: "PATCH", body: { name: n } }); route();
          } }, "이름 변경"),
          h("button", { class: "btn sm danger", onclick: async () => {
            if (!confirm(`'${e.name}' ${label}을(를) 삭제할까요? (영상은 그대로 남습니다)`)) return;
            await api(`${ep}/${e.id}`, { method: "DELETE" }); route();
          } }, "삭제")));
    }));
  };
  const editBtn = filterKey === "tag" && items.length ? h("button", { class: "btn" + (editing ? " primary" : ""), onclick: () => { editing = !editing; editBtn.className = "btn" + (editing ? " primary" : ""); editBtn.textContent = editing ? "완료" : "✎ 수정"; draw(); } }, editing ? "완료" : "✎ 수정") : null;
  $app.replaceChildren(
    h("div", { class: "toolbar" },
      h("input", { type: "search", class: "search", placeholder: `${label} 검색`, oninput: (e) => { filter = e.target.value; draw(); } }),
      editBtn,
      h("span", { class: "meta" }, `${items.length}개`)),
    items.length ? grid : h("div", { class: "empty" }, `${label}이(가) 없습니다. 영상 화면에서 ${label}을(를) 추가해 보세요.`));
  draw();
}

// ---------------------------------------------------------------- settings
/** 설정 아이콘 (선 그림) */
const SET_ICON = {
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  display: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
  folder: '<path d="M3 7.5a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  cloud: '<path d="M17.5 19H7.2a4.7 4.7 0 0 1-.8-9.3A6 6 0 0 1 18 9.6a4.7 4.7 0 0 1-.5 9.4z"/>',
  heart: '<path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 7.9 3.6 4.5 7 4.5c2 0 3.4 1.1 5 3 1.6-1.9 3-3 5-3 3.4 0 5.6 3.4 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z"/>',
  broom: '<path d="M14.5 3.5l6 6"/><path d="M17.5 6.5l-7 7"/><path d="M10.5 13.5c-3 0-6 2-7 7 5-1 7-4 7-7z"/>',
  backup: '<path d="M12 3v12"/><path d="M7.5 10.5L12 15l4.5-4.5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
};
function setIcon(name) {
  const span = document.createElement("span");
  span.className = "set-ico";
  span.innerHTML = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${SET_ICON[name]}</svg>`;
  return span;
}

/** 설정: 첫 화면은 항목 목록, 항목을 누르면 그 항목만 보이는 화면 */
async function renderSettings(opts = {}) {
  setTab("settings");
  const section = opts.section !== undefined ? opts.section : parseHash().params.get("section");
  const reload = () => renderSettings({ section });
  const [st, status] = await Promise.all([api("settings"), api("status")]);
  const c = status.counts || {};
  const themeName = { system: "시스템 설정", light: "라이트", dark: "다크" }[themePref()] || "시스템 설정";
  const nCloud = (st.mega || []).length + (st.icloud || []).length;

  const SECTIONS = [
    { group: "일반", items: [
      { id: "display", icon: "display", title: "화면", sub: themeName },
      { id: "library", icon: "folder", title: "라이브러리와 미디어 폴더", sub: `영상 ${(c.total || 0).toLocaleString()}개 · 폴더 ${st.library_paths.length}개` },
      st.mega_supported ? { id: "cloud", icon: "cloud", title: "클라우드", sub: nCloud ? `MEGA ${(st.mega || []).length} · iCloud ${(st.icloud || []).length}` : "연결된 곳 없음" } : null,
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
    const quota = megaQuotaText(status);
    $app.replaceChildren(h("div", { class: "settings" },
      h("div", { class: "home-head" }, h("div", {}, h("div", { class: "meta" }, "VidShelf"), h("h1", {}, "설정"))),
      quota ? h("a", { class: "panel warn set-alert", href: "#/settings?section=cloud" }, "⚠ " + quota) : null,
      ...SECTIONS.map((g) => h("section", { class: "set-group" },
        h("h2", { class: "set-group-title" }, g.group),
        h("div", { class: "lib-list set-list" }, g.items.filter(Boolean).map((it) =>
          h("a", { href: `#/settings?section=${it.id}` }, setIcon(it.icon),
            h("div", { class: "set-text" }, h("div", { class: "set-title" }, it.title), h("div", { class: "meta" }, it.sub)),
            h("span", { class: "chev", "aria-hidden": "true" }, "›"))))))));
    return;
  }

  // ---- 하위 화면
  const info = SECTIONS.flatMap((g) => g.items).find((x) => x && x.id === section) || { title: "설정" };
  const page = (...kids) => $app.replaceChildren(h("div", { class: "settings sub" + (kids.filter(Boolean).length === 1 ? " solo" : "") },
    h("a", { class: "btn sm back-btn", href: "#/settings" }, "‹ 설정"),
    h("h1", { class: "set-page-title" }, info.title),
    ...kids.filter(Boolean)));

  if (section === "display") return page(themePanel());
  if (section === "favorites") return page(favSyncPanel(st));
  if (section === "backup") return page(backupPanel());
  if (section === "cloud") {
    const quota = megaQuotaText(status);
    return page(quota ? h("div", { class: "panel warn", style: "font-size:14px" }, quota) : null, cloudPanel(st));
  }

  if (section === "library") {
    const paths = st.library_paths.map((p) => p.path);
    const savePaths = async (list) => { await api("settings", { method: "PUT", body: { library_paths: list } }); reload(); };
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
        h("p", { class: "meta", style: "margin-top:0" }, "이 기기에서 영상과 사진을 가져올 폴더입니다. ‘폴더 찾아보기’에서 휴대폰의 모든 폴더를 고를 수 있습니다."),
        pathList,
        h("div", { class: "row" },
          h("button", { class: "btn", onclick: () => folderPicker((p) => savePaths(paths.concat([p]))) }, "📁 폴더 찾아보기"),
          h("button", { class: "btn primary", disabled: status.scanning || !paths.length, onclick: async () => {
            await api("scan", { method: "POST" }); toast("스캔을 시작했습니다"); setTimeout(reload, 800);
          } }, status.scanning ? "스캔 중…" : "지금 스캔")),
        h("div", { class: "taginput" }, manual, h("button", { class: "btn", onclick: () => manual.value.trim() && savePaths(paths.concat([manual.value.trim()])) }, "추가")),
        suggestions,
        status.last_scan ? h("p", { class: "meta" }, `마지막 스캔: ${fmtDate(status.last_scan)}`) : null));
  }

  if (section === "cleanup") {
    const row = (title, sub, action) => h("div", { class: "clean-row" }, h("div", {}, h("div", { class: "set-title" }, title), h("div", { class: "meta" }, sub)), action);
    return page(h("div", { class: "panel" },
      row("찾을 수 없는 파일", `${c.missing || 0}개 · 옮겨졌거나 삭제된 파일의 기록`,
        h("button", { class: "btn sm", disabled: !c.missing, onclick: async () => {
          const r = await api("cleanup", { method: "POST" }); toast(`${r.removed}개를 정리했습니다`); reload();
        } }, "지우기")),
      st.duplicates ? row("중복 영상", "기기와 클라우드, 여러 폴더에 같은 영상이 있는지 찾기", h("a", { class: "btn sm", href: "#/duplicates" }, "찾기")) : null,
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
  const avatar = h("div", { class: "pf-avatar" }, h("span", {}, "👤"));
  const setAvatar = (src) => {
    if (!src || avatar.querySelector("img")) return;
    const img = h("img", { src, alt: "" });
    img.onload = () => avatar.replaceChildren(img);
  };
  const facts = [];
  if (hasInfo) {
    if (p.group) facts.push(["그룹", p.group]);
    if (p.real_name) facts.push(["본명", p.real_name]);
    if (p.birthdate) facts.push(["생년월일", `${p.birthdate} (만 ${age(p.birthdate)}세)`]);
    if (p.height) facts.push(["키", `${p.height}cm`]);
  }
  const counts = h("p", { class: "meta", style: "margin:4px 0 0" });
  const editBtn = h("button", { class: "btn sm" + (editing ? " primary" : ""), onclick: () => setEdit(!editing) }, editing ? "수정 닫기" : "✎ 수정");
  const head = h("div", { class: "panel pf-head" }, avatar,
    h("div", { class: "pf-main" },
      h("div", { class: "row", style: "justify-content:space-between;flex-wrap:nowrap;align-items:flex-start" },
        h("h2", { class: "pf-name" }, p.name), editBtn),
      counts,
      facts.length ? h("dl", { class: "info pf-facts" }, ...facts.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)]))
        : hasInfo ? h("p", { class: "meta" }, p.looked_up ? "등록된 정보가 없습니다. ‘수정’에서 직접 입력할 수 있습니다." : "정보를 인터넷에서 찾는 중이거나 아직 찾지 않았습니다.") : null,
      p.source ? h("p", { class: "meta", style: "margin:6px 0 0" }, "출처: ",
        p.source_url ? h("a", { href: p.source_url, target: "_blank", rel: "noopener", style: "text-decoration:underline" }, p.source) : p.source) : null));

  // --- 수정 (이름 변경 · 정보 · 삭제)
  let editPanel = null;
  if (editing) {
    const nameIn = h("input", { type: "text", id: "pf-name", value: p.name });
    const field = (key, label, placeholder, type = "text") =>
      [h("dt", {}, h("label", { for: `pf-${key}` }, label)), h("dd", {}, h("input", { type, id: `pf-${key}`, value: p[key] || "", placeholder }))];
    const val = (k) => document.getElementById(`pf-${k}`).value.trim();
    const form = h("dl", { class: "info", style: "align-items:center;font-size:15px" },
      h("dt", {}, h("label", { for: "pf-name" }, "이름")), h("dd", {}, nameIn),
      ...(hasInfo ? [...field("group", "그룹", "예: 하츠투하츠"), ...field("real_name", "본명", "예: 홍길동"),
        ...field("birthdate", "생년월일", "", "date"), ...field("height", "키 (cm)", "예: 165", "number")] : []));
    const saveBtn = h("button", { class: "btn primary", onclick: async (ev) => {
      ev.currentTarget.disabled = true;
      try {
        const name = nameIn.value.trim();
        if (!name) { toast("이름을 입력하세요"); ev.currentTarget.disabled = false; return; }
        let newId = id;
        if (hasInfo) await api(`performers/${id}`, { method: "PATCH", body: { info: { group: val("group"), real_name: val("real_name"), birthdate: val("birthdate"), height: val("height") } } });
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
    const lookupBtn = hasInfo ? h("button", { class: "btn", onclick: async (ev) => {
      const b = ev.currentTarget; b.disabled = true; b.textContent = "찾는 중…";
      try {
        const r = await api(`performers/${id}/lookup`, { method: "POST" });
        toast(r.lookup_found ? "인터넷에서 정보를 찾았습니다" : "정보를 찾지 못했습니다");
      } catch (e) { toast(e.message); }
      route();
    } }, "인터넷에서 다시 찾기") : null;
    const delBtn = h("button", { class: "btn danger", onclick: async () => {
      if (!confirm(`‘${p.name}’ 사람을 삭제할까요?\n영상과 사진은 그대로 남고, 사람 지정만 없어집니다.`)) return;
      await api(`performers/${id}`, { method: "DELETE" });
      toast("삭제했습니다");
      location.hash = "#/performers";
    } }, "사람 삭제");
    editPanel = h("div", { class: "panel" }, h("h3", {}, "수정"),
      form,
      h("div", { class: "row", style: "margin-top:12px" }, saveBtn, lookupBtn, h("button", { class: "btn", onclick: () => setEdit(false) }, "취소")),
      hasInfo ? h("p", { class: "meta" }, "이름을 다른 사람과 같게 바꾸면 두 사람이 합쳐집니다. 그룹 이름을 정확히 적어 두면 인터넷에서 찾을 때 동명이인을 거릅니다.") : null,
      h("div", { class: "pf-danger" }, delBtn));
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
// ---------------------------------------------------------------- MEGA
/** 클라우드 링크 (MEGA 폴더 · iCloud 공유 앨범) — 입력칸 하나, 링크를 보고 알아서 구분 */
function cloudPanel(st) {
  const mega = st.mega || [], icloud = st.icloud || [];
  const input = h("input", { type: "text", placeholder: "MEGA 폴더 또는 iCloud 공유 앨범 링크", autocomplete: "off", "aria-label": "클라우드 링크" });
  const msg = h("p", { class: "meta" });
  const kindOf = (url) => /mega\.(nz|co\.nz)\//i.test(url) ? "mega" : /icloud\.com\/sharedalbum/i.test(url) ? "icloud" : null;
  const add = async (btn) => {
    const url = input.value.trim();
    if (!url) return;
    const kind = kindOf(url);
    if (!kind) { msg.textContent = "MEGA 폴더 링크(https://mega.nz/folder/…#…)나 iCloud 공유 앨범 링크(https://www.icloud.com/sharedalbum/#…)만 추가할 수 있습니다."; return; }
    btn.disabled = true; msg.textContent = kind === "mega" ? "MEGA 폴더를 불러오는 중…" : "iCloud 앨범을 불러오는 중…";
    try {
      await api(kind, { method: "POST", body: { url } });
      toast(kind === "mega" ? "MEGA 폴더를 추가했습니다" : "iCloud 앨범을 추가했습니다");
      renderSettings();
    } catch (e) { msg.textContent = e.message; btn.disabled = false; }
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(addBtn); } });
  const addBtn = h("button", { class: "btn primary", onclick: (e) => add(e.currentTarget) }, "추가");
  const item = (kind, l, sub, open, del) => h("li", {},
    h("span", { class: "p" }, h("span", { class: "src-badge " + kind }, kind === "mega" ? "MEGA" : "iCloud"), " " + l.name,
      h("div", { class: "meta" }, sub), l.error ? h("div", { class: "warn" }, l.error) : null),
    h("a", { class: "btn sm", href: open }, "열기"),
    h("button", { class: "btn sm danger", onclick: async () => {
      if (!confirm(`‘${l.name}’ 연결을 끊을까요? (클라우드의 파일은 그대로입니다)`)) return;
      await api(del, { method: "DELETE" }); renderSettings();
    } }, "제거"));
  const rows = [
    ...mega.map((l) => item("mega", l, `파일 ${l.files}개 · 영상 ${l.videos}개`, `#/mega?link=${l.index}`, `mega/${l.index}`)),
    ...icloud.map((a) => item("icloud", a, `사진 ${a.photos}장 · 영상 ${a.videos}개`, `#/icloud?a=${a.index}`, `icloud/${a.index}`)),
  ];
  return h("div", { class: "panel", id: "cloud-settings" }, h("h3", {}, "클라우드 (MEGA · iCloud)"),
    h("p", { class: "meta" }, "링크를 붙여넣으면 MEGA 인지 iCloud 인지 알아서 구분해 추가합니다."),
    h("ul", { class: "pathlist" }, rows.length ? rows : h("li", { class: "meta" }, "연결된 클라우드가 없습니다.")),
    h("div", { class: "taginput" }, input, addBtn),
    msg,
    h("details", { class: "cloud-help" }, h("summary", {}, "링크 만드는 방법"),
      h("p", { class: "meta" }, "MEGA: 앱이나 웹에서 폴더 → 공유 → 링크 복사. 링크에 열쇠(# 뒤 부분)가 있어야 합니다."),
      h("p", { class: "meta" }, "iCloud: 아이폰 사진 앱 → 앨범 → 공유 앨범 → 사람 아이콘 → ‘공개 웹사이트’ 켜기 → 링크 복사. iCloud Drive 와 일반 사진 보관함은 로그인이 필요해서 지원하지 않습니다.")),
    rows.length ? h("a", { class: "btn", href: "#/cloud", style: "margin-top:8px;display:inline-block" }, "☁ 클라우드 파일 보기") : null,
    mega.length && st.mega_thumbs !== undefined ? megaThumbToggle(st) : null,
    rows.length && st.mega_refresh_hours !== undefined ? megaRefreshSelect(st) : null,
    rows.length ? h("button", { class: "btn sm", style: "margin-top:8px", onclick: async (e) => {
      e.currentTarget.disabled = true; await api("mega/refresh", { method: "POST" }); toast("클라우드 목록을 새로 받았습니다"); renderSettings();
    } }, "클라우드 목록 새로고침") : null);
}

function megaRefreshSelect(st) {
  const sel = h("select", { "aria-label": "MEGA 자동 새로고침 간격", onchange: async () => {
    await api("settings", { method: "PUT", body: { mega_refresh_hours: +sel.value } }); toast("저장했습니다");
  } }, [[0, "끄기"], [1, "1시간마다"], [3, "3시간마다"], [6, "6시간마다"], [12, "12시간마다"], [24, "하루마다"]].map(([v, l]) =>
    h("option", { value: v, selected: v === st.mega_refresh_hours }, l)));
  return h("div", { class: "row", style: "margin-top:12px" }, h("span", {}, "목록 자동 새로고침"), sel,
    st.mega_last_refresh ? h("span", { class: "meta" }, `마지막: ${fmtDate(st.mega_last_refresh)}`) : null);
}

/** MEGA 전송량 한도 안내 문구 (한도에 걸리지 않았으면 null) */
function megaQuotaText(s) {
  if (!s || !s.mega_quota_hit) return null;
  if (s.mega_quota_until) {
    const min = Math.max(1, Math.round((s.mega_quota_until * 1000 - Date.now()) / 60000));
    const at = new Date(s.mega_quota_until * 1000).toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" });
    return `MEGA 전송량 한도에 걸렸습니다. 약 ${min >= 60 ? Math.floor(min / 60) + "시간 " + (min % 60) + "분" : min + "분"} 뒤(${at}쯤) 풀립니다.`;
  }
  return `MEGA 전송량 한도에 걸렸습니다 (${new Date(s.mega_quota_hit * 1000).toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" })}). 보통 몇 시간 안에 풀립니다.`;
}

function megaThumbToggle(st) {
  const box = h("input", { type: "checkbox", id: "mega-thumbs", checked: st.mega_thumbs });
  box.addEventListener("change", async () => {
    box.disabled = true;
    try {
      await api("settings", { method: "PUT", body: { mega_thumbs: box.checked } });
      toast(box.checked ? "썸네일이 없는 MEGA 영상의 미리보기를 만듭니다" : "MEGA 썸네일 만들기를 껐습니다");
    } catch (e) { toast(e.message); }
    box.disabled = false;
  });
  return h("div", { style: "margin-top:10px" },
    h("label", { class: "row", for: "mega-thumbs" }, box, h("span", {}, "썸네일이 없는 MEGA 영상은 앱이 직접 미리보기 만들기")),
    h("p", { class: "meta", style: "margin:4px 0 0" }, "영상 앞부분 몇 MB 만 받아서 한 장면을 뽑습니다. 데이터와 MEGA 전송량을 조금 씁니다 (영상 하나에 보통 2~10MB)."),
    st.mega_thumb_missing ? h("p", { class: "meta", style: "margin:4px 0 0" }, `썸네일이 없는 MEGA 영상: ${st.mega_thumb_missing}개` + (st.mega_thumb_failed ? ` (만들지 못한 영상 ${st.mega_thumb_failed}개)` : "")) : null);
}

// ---------------------------------------------------------------- 클라우드 파일 (MEGA · iCloud)
async function renderCloud() {
  setTab("cloud");
  const st = await api("settings");
  const mega = st.mega || [], icloud = st.icloud || [];
  const row = (href, title, sub, err) => h("a", { href }, h("div", {}, h("div", {}, title), h("div", { class: "meta" }, sub), err ? h("div", { class: "warn" }, err) : null), h("span", {}, "›"));
  $app.replaceChildren(h("div", {},
    h("div", { class: "home-head" }, h("div", {}, h("div", { class: "meta" }, "MEGA · iCloud"), h("h1", {}, "클라우드 파일"))),
    h("h2", { class: "pf-sec" }, "MEGA 폴더"),
    mega.length ? h("div", { class: "lib-list" }, mega.map((l) => row(`#/mega?link=${l.index}`, "☁ " + l.name, `파일 ${l.files}개 · 영상 ${l.videos}개`, l.error)))
      : h("p", { class: "meta" }, "연결된 MEGA 폴더가 없습니다."),
    h("h2", { class: "pf-sec" }, "iCloud 공유 앨범"),
    icloud.length ? h("div", { class: "lib-list" }, icloud.map((a) => row(`#/icloud?a=${a.index}`, " " + a.name, `사진 ${a.photos}장 · 영상 ${a.videos}개`, a.error)))
      : h("p", { class: "meta" }, "연결된 iCloud 공유 앨범이 없습니다."),
    h("a", { class: "btn", href: "#/settings?section=cloud", style: "margin-top:16px;display:inline-block" }, "링크 추가·삭제")));
}

async function renderICloudAlbum(i) {
  setTab("cloud");
  const d = await api(`icloud/${i}/items`);
  const photos = d.items.filter((x) => x.kind === "photo");
  const grid = h("div", { class: "sqgrid" }, d.items.map((it) => {
    const isPhoto = it.kind === "photo";
    const img = h("img", { loading: "lazy", alt: it.title || "", src: isPhoto ? `/photothumb/${it.id}.jpg` : thumbUrl(it.id, 0, 1) });
    img.onerror = () => (img.hidden = true);
    return isPhoto
      ? h("button", { class: "sq", "aria-label": it.title, onclick: () => openViewer(photos, photos.indexOf(it)) }, img)
      : h("a", { class: "sq", href: `#/v/${it.id}`, "aria-label": it.title }, img, h("span", { class: "sq-dur" }, "▶ " + (it.duration ? fmtDur(it.duration) : "")));
  }));
  $app.replaceChildren(h("div", {},
    h("a", { class: "btn sm", href: "#/cloud", style: "margin-bottom:12px;display:inline-block" }, "‹ 클라우드 파일"),
    h("div", { class: "home-head" }, h("div", {}, h("div", { class: "meta" }, `iCloud 공유 앨범 · ${d.items.length}개`), h("h1", {}, d.name))),
    d.error ? h("div", { class: "panel warn" }, d.error) : null,
    d.items.length ? grid : h("div", { class: "empty" }, "이 앨범은 비어 있습니다.")));
}


async function renderMega(params) {
  setTab("settings");   // MEGA 파일 보기는 설정 안에 있음
  const links = await api("mega");
  if (!links.length) {
    $app.replaceChildren(h("div", { class: "empty" }, h("p", {}, "연결된 MEGA 폴더가 없습니다."),
      h("a", { class: "btn primary", href: "#/settings" }, "설정에서 MEGA 링크 추가")));
    return;
  }
  const idx = Math.min(links.length - 1, +(params.get("link") || 0));
  const data = await api(`mega/${idx}/browse?folder=${encodeURIComponent(params.get("folder") || "")}`);
  const go = (folder) => { location.hash = `#/mega?link=${idx}` + (folder ? `&folder=${folder}` : ""); };
  const linkChips = links.length > 1 ? h("div", { class: "chips", style: "margin-bottom:10px" }, links.map((l) =>
    h("a", { class: "chip" + (l.index === idx ? " on" : ""), href: `#/mega?link=${l.index}` }, "☁ " + l.name))) : null;
  const crumbs = h("div", { class: "chips", style: "margin-bottom:12px" }, (data.crumbs || []).map((c, i, arr) =>
    i === arr.length - 1 ? h("span", { class: "chip on" }, c.name) : h("button", { class: "chip", onclick: () => go(c.handle) }, c.name)));
  const folders = (data.folders || []).map((f) => h("button", { class: "chip", onclick: () => go(f.handle) }, "📁 " + f.name));
  const media = [], others = [];
  for (const f of data.files || []) {
    if (f.kind === "video") {
      const img = h("img", { loading: "lazy", alt: "", hidden: !f.thumb, src: f.thumb ? `/thumbs/${f.id}/0.jpg?v=1` : null });
      img.onerror = () => (img.hidden = true);
      media.push(h("a", { class: "card", href: `#/v/${f.id}` },
        h("div", { class: "thumb" }, img, h("div", { class: "noimg" }, "▶ 영상")),
        h("div", { class: "title", title: f.name }, f.name), h("div", { class: "sub" }, h("span", {}, fmtSize(f.size)))));
    } else if (f.kind === "image") {
      media.push(h("a", { class: "card", href: f.url, target: "_blank", rel: "noopener" },
        h("div", { class: "thumb" }, h("img", { loading: "lazy", alt: "", src: f.url, onerror: (e) => (e.target.hidden = true) })),
        h("div", { class: "title", title: f.name }, f.name), h("div", { class: "sub" }, h("span", {}, fmtSize(f.size)))));
    } else {
      others.push(h("li", {},
        h("span", { class: "p" }, (f.kind === "audio" ? "🎵 " : "📄 ") + f.name, h("div", { class: "meta" }, fmtSize(f.size))),
        h("a", { class: "btn sm", href: f.url, target: "_blank", rel: "noopener" }, "열기"),
        h("a", { class: "btn sm", href: f.url + "?dl=1" }, "받기")));
    }
  }
  $app.replaceChildren(h("div", {},
    h("a", { class: "btn sm", href: "#/cloud", style: "margin-bottom:12px;display:inline-block" }, "‹ 클라우드 파일"),
    linkChips, crumbs,
    data.error ? h("div", { class: "panel warn" }, data.error) : null,
    folders.length ? h("div", { class: "chips", style: "margin-bottom:14px" }, folders) : null,
    media.length ? h("div", { class: "grid" }, media) : null,
    others.length ? h("div", { class: "panel", style: "margin-top:14px" }, h("h3", {}, "기타 파일"), h("ul", { class: "pathlist" }, others)) : null,
    !folders.length && !media.length && !others.length ? h("div", { class: "empty" }, "이 폴더는 비어 있습니다.") : null));
}

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
    const icon = h("div", { class: "splay" }, "▶");
    const muteBtn = h("button", { class: "sbtn", "aria-label": "소리" }, shortsMuted ? "🔇" : "🔊");
    muteBtn.onclick = (e) => {
      e.stopPropagation();
      shortsMuted = !shortsMuted;
      items.forEach((it) => { it.video.muted = shortsMuted; it.mute.textContent = shortsMuted ? "🔇" : "🔊"; });
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
          hasNativePlayer() ? h("button", { class: "btn primary", onclick: (e) => { e.stopPropagation(); playNative(v, 0); } }, "▶ 앱 플레이어로 재생") : null);
        errBox.hidden = false;
      };
      const unplayable = () => {   // 형식 문제: 기억해 두고 숏폼에서 빼고 다음 영상으로
        api(`videos/${v.id}/unplayable`, { method: "POST" }).catch(() => {});
        toast("재생할 수 없는 형식이라 숏폼에서 뺐습니다");
        removeItem();
      };
      const formatErr = video.error.code === 3 || video.error.code === 4;   // 3: 디코딩 실패, 4: 지원하지 않는 형식
      if (v.source === "mega" || v.source === "icloud") api("status").then((st) => { const q = megaQuotaText(st); if (q) show(q); else if (formatErr) unplayable(); else show("재생하지 못했습니다. 연결을 확인하세요."); }).catch(() => show("재생하지 못했습니다."));
      else if (formatErr) unplayable();
      else show("재생하지 못했습니다.");
    });
    // 하트(즐겨찾기)와 삭제
    const HEART = '<path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 7.9 3.6 4.5 7 4.5c2 0 3.4 1.1 5 3 1.6-1.9 3-3 5-3 3.4 0 5.6 3.4 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z"/>';
    const svg = (d, cls) => { const sp = document.createElement("span"); sp.innerHTML = `<svg class="ico ${cls || ""}" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`; return sp.firstChild; };
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
      svg('<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5"/>'));
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
        h("a", { class: "sbtn", href: `#/v/${v.id}`, "aria-label": "자세히" }, "ⓘ")),
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
      shortsMuted = true; items.forEach((x) => { x.video.muted = true; x.mute.textContent = "🔇"; });
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
const LIB_ICON = {
  heart: '<path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 7.9 3.6 4.5 7 4.5c2 0 3.4 1.1 5 3 1.6-1.9 3-3 5-3 3.4 0 5.6 3.4 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z"/>',
  photos: '<rect x="3" y="3" width="18" height="18" rx="2.5"/><circle cx="9" cy="9" r="1.8"/><path d="M21 15.5l-5-5L4.5 21"/>',
  people: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.2 3.6-6.5 8-6.5s8 2.3 8 6.5"/>',
  tags: '<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
};
function libIcon(name) {
  const span = document.createElement("span");
  span.innerHTML = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${LIB_ICON[name]}</svg>`;
  return span.firstChild;
}
async function renderLibraryHub() {
  setTab("library");
  if (!Object.keys(serverCaps).length) serverCaps = await api("settings").catch(() => ({}));
  const cloudN = (serverCaps.mega || []).length + (serverCaps.icloud || []).length;
  const row = (href, icon, title, sub) => h("a", { href }, setIcon(icon), h("div", { class: "set-text" }, h("div", { class: "set-title" }, title), sub ? h("div", { class: "meta" }, sub) : null), h("span", { class: "chev", "aria-hidden": "true" }, "›"));
  $app.replaceChildren(h("div", { class: "libhub" },
    h("h2", { class: "set-group-title" }, "기록"),
    h("div", { class: "lib-list set-list" },
      row("#/stats", "info", "시청 기록 · 통계", "최근 본 영상 · 시청 시간 · 많이 본 사람")),
    h("h2", { class: "set-group-title" }, "파일"),
    h("div", { class: "lib-list set-list" },
      serverCaps.mega_supported ? row("#/cloud", "cloud", "클라우드 파일", cloudN ? `MEGA ${(serverCaps.mega || []).length} · iCloud ${(serverCaps.icloud || []).length}` : "MEGA · iCloud 링크 연결") : null,
      serverCaps.duplicates ? row("#/duplicates", "broom", "중복 영상", "같은 영상이 여러 곳에 있는지 찾기") : null,
      serverCaps.hidden_count !== undefined ? row("#/hidden", "info", "숨긴 영상", `${serverCaps.hidden_count}개`) : null),
    h("h2", { class: "set-group-title" }, "앱"),
    h("div", { class: "lib-list set-list" }, row("#/settings", "gear", "설정", "화면 · 폴더 · 클라우드 · 백업"))));
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
  const isTags = () => params.get("t") === "tags";   // 사람 / 태그

  const countLine = h("div", { class: "meta" }, "");
  const search = h("input", { type: "search", class: "ex-search", value: params.get("q") || "" });
  const segInd = h("span", { class: "type-ind", "aria-hidden": "true", style: "width: calc((100% - 6px) / 2)" });
  const segBtns = [["people", "사람"], ["tags", "태그"]].map(([k, l]) => h("button", { role: "tab", onclick: () => setMode(k) }, l));
  const typeSeg = h("div", { class: "type-seg two", role: "tablist" }, segInd, ...segBtns);
  function setMode(k, anim) {
    if ((k === "tags") === isTags()) return;
    const p = new URLSearchParams();
    if (k === "tags") p.set("t", "tags");
    search.value = "";
    update(p, anim || (k === "tags" ? "left" : "right"));
  }
  window.__mediaSwipeTarget = (dir) => ((dir > 0 && !isTags()) || (dir < 0 && isTags()) ? content : null);
  window.__mediaSwipe = (dir) => { setMode(dir > 0 ? "tags" : "people"); return true; };
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
      if (q && !(p.name.toLowerCase().includes(q) || (p.group || "").toLowerCase().includes(q) || (p.real_name || "").toLowerCase().includes(q))) return false;
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
    const frames = (p.frames || []).slice(0, 3);
    const pics = frames.map((id) => thumbUrl(id, 0, "c"));
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
    for (const t of params.getAll("tag")) chips.push(h("span", { class: "fchip" }, "#" + tagName(t), h("button", { "aria-label": "태그 필터 해제", onclick: () => without("tag", t) }, "×")));
    for (const k of params.getAll("age")) { const r = EX_AGES.find((x) => x[0] === k); if (r) chips.push(h("span", { class: "fchip" }, r[1], h("button", { "aria-label": "나이 필터 해제", onclick: () => without("age", k) }, "×"))); }
    if (chips.length > 1) chips.push(h("button", { class: "fclear", onclick: () => { const p = new URLSearchParams(params); p.delete("tag"); p.delete("age"); update(p); } }, "모두 지우기"));
    chipsBox.replaceChildren(...chips); chipsBox.hidden = !chips.length;
    filterBtn.innerHTML = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg>';
    filterBtn.append("필터", nFilters() ? h("span", { class: "fbadge" }, nFilters()) : "");
  }
  function tagList() {
    const q = (params.get("q") || "").trim().toLowerCase();
    const out = tags.filter((t) => !q || t.name.toLowerCase().includes(q));
    return (params.get("sort") || "count") === "name" ? out.sort((a, b) => a.name.localeCompare(b.name, "ko"))
      : out.sort((a, b) => (b.count + (b.photo_count || 0)) - (a.count + (a.photo_count || 0)) || a.name.localeCompare(b.name, "ko"));
  }
  let editingTags = false;
  function tagRow(t) {
    const n = [t.count ? `영상 ${t.count}` : null, t.photo_count ? `사진 ${t.photo_count}` : null].filter(Boolean).join(" · ") || "항목 없음";
    const kids = [h("span", { class: "ex-hash", "aria-hidden": "true" }, "#"), h("div", { class: "ex-tmain" }, h("b", {}, t.name), h("span", { class: "meta" }, n))];
    if (!editingTags) return h("a", { class: "ex-tag", href: `#/?tag=${t.id}` }, ...kids, h("span", { class: "chev", "aria-hidden": "true" }, "›"));
    return h("div", { class: "ex-tag editing" }, ...kids,
      h("button", { class: "btn sm", onclick: async () => {
        const nn = prompt("새 태그 이름", t.name);
        if (!nn || !nn.trim() || nn.trim() === t.name) return;
        try { const r = await api(`tags/${t.id}`, { method: "PATCH", body: { name: nn.trim() } }); toast(r.merged ? "같은 이름의 태그와 합쳤습니다" : "이름을 바꿨습니다"); route(); } catch (e) { toast(e.message); }
      } }, "이름 변경"),
      h("button", { class: "btn sm danger", onclick: async () => {
        if (!confirm(`#${t.name} 태그를 삭제할까요?\n영상과 사진은 그대로 남고 태그만 없어집니다.`)) return;
        await api(`tags/${t.id}`, { method: "DELETE" }); toast("삭제했습니다"); route();
      } }, "삭제"));
  }
  function draw(restore, anim) {
    segBtns.forEach((b, i) => { const on = (i === 1) === isTags(); b.classList.toggle("on", on); b.setAttribute("aria-selected", on ? "true" : "false"); });
    segInd.style.transform = `translateX(${isTags() ? 100 : 0}%)`;
    search.placeholder = isTags() ? "태그 검색" : "사람 이름 검색";
    search.setAttribute("aria-label", search.placeholder);
    content.classList.remove("in-left", "in-right"); content.style.transform = ""; content.style.opacity = "";
    if (anim) { void content.offsetWidth; content.classList.add("in-" + anim); }
    if (isTags()) {
      const tl = tagList();
      countLine.textContent = `태그 ${tl.length.toLocaleString()}개 · ${(params.get("sort") || "count") === "name" ? "이름" : "많이 쓴 순"}`;
      chipsBox.replaceChildren(); chipsBox.hidden = true;
      filterBtn.innerHTML = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg>';
      filterBtn.append("정렬");
      const editBtn = h("button", { class: "btn sm" + (editingTags ? " primary" : ""), onclick: () => { editingTags = !editingTags; draw(); } }, editingTags ? "완료" : "✎ 편집");
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
      h("label", { class: "ex-search-box" }, h("span", { "aria-hidden": "true" }, "⌕"), search),
      chipsBox),
    content));

  const mem = scrollMemory[location.hash];
  delete scrollMemory[location.hash];
  draw(mem);
  if (mem && mem.y > 0) { window.scrollTo({ top: mem.y, behavior: "instant" }); requestAnimationFrame(() => { window.scrollTo({ top: mem.y, behavior: "instant" }); endRestore(); }); }
  else endRestore();
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
      ? h("p", { class: "meta" }, "✓ ‘미디어 관리’ 권한이 켜져 있어 확인 창 없이 바로 반영됩니다.")
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
const HOME_SECTIONS = [["resume", "이어 보기"], ["recent", "최근 추가된 영상"], ["favs", "즐겨찾기"], ["photos", "최근 사진"], ["people", "사람"]];
function homeLayout() {
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem("vs-home") || "[]"); } catch (e) {}
  const out = saved.filter((x) => HOME_SECTIONS.some(([k]) => k === x.k));
  HOME_SECTIONS.forEach(([k]) => { if (!out.some((x) => x.k === k)) out.push({ k, on: true }); });   // 새로 생긴 줄은 맨 뒤에 켜진 채로
  return out;
}
function openHomeEditor() {
  let layout = homeLayout();
  const label = (k) => (HOME_SECTIONS.find(([x]) => x === k) || [k, k])[1];
  const list = h("div", { class: "home-edit-list" });
  const saveLayout = () => { try { localStorage.setItem("vs-home", JSON.stringify(layout)); } catch (e) {} };
  const draw = () => list.replaceChildren(...layout.map((x, i) => {
    const sw = h("button", { class: "switch" + (x.on ? " on" : ""), role: "switch", "aria-checked": x.on ? "true" : "false", "aria-label": `${label(x.k)} 보이기`,
      onclick: () => { x.on = !x.on; saveLayout(); draw(); } });
    const move = (d) => { const j = i + d; if (j < 0 || j >= layout.length) return; [layout[i], layout[j]] = [layout[j], layout[i]]; saveLayout(); draw(); };
    return h("div", { class: "home-edit-row" + (x.on ? "" : " off") },
      h("div", { class: "he-move" },
        h("button", { class: "round-btn sm", "aria-label": "위로", disabled: i === 0, onclick: () => move(-1) }, "▲"),
        h("button", { class: "round-btn sm", "aria-label": "아래로", disabled: i === layout.length - 1, onclick: () => move(1) }, "▼")),
      h("span", { class: "he-name" }, label(x.k)), sw);
  }));
  draw();
  openSheet("홈 편집", [h("p", { class: "meta", style: "margin:0" }, "▲▼로 순서를 바꾸고, 스위치로 보이거나 숨깁니다."), list],
    [h("button", { class: "btn", onclick: () => { layout = HOME_SECTIONS.map(([k]) => ({ k, on: true })); saveLayout(); draw(); } }, "처음대로"),
     h("button", { class: "btn primary sheet-go", onclick: () => history.back() }, "완료")]);
  const onClose = () => { window.removeEventListener("popstate", onClose); if (parseHash().path === "/home" || !location.hash) setTimeout(route, 230); };
  window.addEventListener("popstate", onClose);
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
  const secs = { resume, recent, favs, photos, people };
  const layout = homeLayout();
  $app.replaceChildren(h("div", { class: "home" },
    h("div", { class: "home-head" }, h("div", {}, stats, h("h1", {}, "내 보관함")),
      h("a", { class: "btn", href: "#/?q=", "aria-label": "검색" }, "검색")),
    ...layout.filter((x) => x.on && secs[x.k]).map((x) => secs[x.k].sec),
    h("div", { class: "home-edit" }, h("button", { class: "btn sm", onclick: openHomeEditor }, "✎ 홈 편집"))));

  const counts = { videos: null, photos: null, people: null };
  const n = (x) => (x == null ? "…" : x.toLocaleString());
  const drawStats = () => (stats.textContent = [`영상 ${n(counts.videos)}`, serverCaps.photos ? `사진 ${n(counts.photos)}` : "", `사람 ${n(counts.people)}`].filter(Boolean).join(" · "));
  drawStats();

  const small = (v) => videoCard(v);
  const jobs = [
    api("videos?sort=played&order=desc&per=40").then((d) => {
      counts.videos = d.total; drawStats();
      resume.fill(d.items.filter((v) => v.resume_pos > 5 && v.duration && v.resume_pos < v.duration - 10).slice(0, 12).map(small));
    }),
    api("videos?sort=added&order=desc&per=15").then((d) => recent.fill(d.items.map(small))),
    api("media?type=all&fav=1&sort=added&order=desc&per=24").then((d) => {   // 영상과 사진 모두
      const photos = d.items.filter((x) => x.kind === "photo");
      favs.fill(d.items.map((it) => {
        const isPhoto = it.kind === "photo";
        const img = h("img", { loading: "lazy", alt: it.title || "", src: isPhoto ? `/photothumb/${it.id}.jpg` : it.thumbs > 0 ? thumbUrl(it.id, 0, it.thumbs) : null });
        img.onerror = () => (img.hidden = true);
        const kids = [img, !isPhoto ? h("span", { class: "sq-dur" }, "▶ " + (it.duration ? fmtDur(it.duration) : "")) : null];
        const cell = isPhoto
          ? h("button", { class: "sq", "aria-label": it.title || "사진", onclick: () => openViewer(photos, photos.indexOf(it)) }, ...kids)
          : h("a", { class: "sq", href: `#/v/${it.id}`, "aria-label": it.title || "영상" }, ...kids);
        return longPressFav(cell, it);
      }));
    }),
    api("performers").then((list) => {
      counts.people = list.length; drawStats();
      people.fill(list.filter((p) => p.count || p.photo_count).sort((a, b) => (b.count + b.photo_count) - (a.count + a.photo_count)).slice(0, 20)
        .map((p) => h("a", { class: "person", href: `#/performer?id=${p.id}` },
          h("div", { class: "pf-avatar" }, entityCover(p, "👤")), h("span", {}, p.name))));
    }),
  ];
  if (serverCaps.photos) jobs.push(api("photos?sort=taken&order=desc&per=24").then((d) => {
    counts.photos = d.total; drawStats();
    photos.fill(d.items.map((p, i) => photoCell(p, "grid", () => openViewer(d.items, i))));
  }));
  else photos.fill([]);
  await Promise.all(jobs.map((j) => j.catch(() => {})));
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
    h("p", { class: "meta" }, "태그·별점·즐겨찾기·사람 정보·북마크·메모·클라우드 링크를 파일 하나로 저장합니다. 앱을 지웠다 다시 설치할 때 이 파일로 되살릴 수 있습니다. (비밀번호와 e-hentai 로그인은 넣지 않습니다)"),
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
        h("div", { class: "thumb" }, img, h("div", { class: "noimg" }, "▶")),
        h("div", { class: "dup-body" },
          h("div", { class: "dup-name" }, v.filename),
          h("div", { class: "meta" }, (v.source === "local" ? "📱 이 기기 · " : "☁ " + (SOURCE_LABEL[v.source] || "") + " · ") + (v.folder || "") + " · " + fmtSize(v.size)),
          h("div", { class: "row", style: "margin-top:6px" }, h("button", { class: "btn sm", onclick: async (ev) => {
            await api(`videos/${v.id}/unhide`, { method: "POST" });
            ev.target.closest(".dup-item").classList.add("gone"); ev.target.replaceWith(h("span", { class: "meta" }, "다시 보입니다"));
          } }, "다시 보이기"))));
    })) : h("div", { class: "empty" }, "숨긴 영상이 없습니다.")));
}

// ---------------------------------------------------------------- 중복 영상
async function renderDuplicates() {
  setTab("settings");
  $app.replaceChildren(h("div", { class: "empty" }, "중복 영상을 찾는 중…"));
  const d = await api("duplicates");
  const groups = d.groups || [];
  const wasted = groups.reduce((n, g) => n + g.size * (g.items.length - 1), 0);
  const groupEl = (g) => h("div", { class: "panel" },
    h("h3", {}, `${g.items.length}개 · ${fmtSize(g.size)}` + (g.reason ? ` · ${g.reason}` : "")),
    h("div", { class: "dup-items" }, g.items.map((v) => {
      const img = h("img", { loading: "lazy", alt: "", src: v.thumbs > 0 ? thumbUrl(v.id, 0, v.thumbs) : null, hidden: !(v.thumbs > 0) });
      img.onerror = () => (img.hidden = true);
      const hideBtn = h("button", { class: "btn sm danger", onclick: async (ev) => {
        if (!confirm(`‘${v.filename}’ 을(를) 라이브러리에서 숨길까요?\n(파일은 지우지 않습니다. 태그·별점은 다른 복사본에 남아 있지 않으니 필요하면 먼저 옮겨 두세요)`)) return;
        await api(`videos/${v.id}`, { method: "DELETE" });
        ev.target.closest(".dup-item").classList.add("gone");
        ev.target.replaceWith(h("span", { class: "meta" }, "숨김"));
      } }, "목록에서 숨기기");
      const keepBtn = h("button", { class: "btn sm primary", onclick: async (ev) => {
        const others = g.items.filter((x) => x.id !== v.id);
        if (!confirm(`이 영상만 남기고 나머지 ${others.length}개는 숨길까요?\n숨기는 영상의 태그·사람·별점·북마크·재생 기록은 이 영상으로 합쳐집니다.`)) return;
        await api("duplicates/keep", { method: "POST", body: { keep: v.id, others: others.map((x) => x.id) } });
        const box = ev.target.closest(".panel");
        box.querySelectorAll(".dup-item").forEach((el) => el !== ev.target.closest(".dup-item") && el.classList.add("gone"));
        box.querySelectorAll("button").forEach((b) => (b.disabled = true));
        toast("하나만 남기고 정보를 합쳤습니다");
      } }, "이것만 남기기");
      return h("div", { class: "dup-item" },
        h("a", { class: "thumb", href: `#/v/${v.id}` }, img, h("div", { class: "noimg" }, "▶"),
          v.duration ? h("span", { class: "badge dur" }, fmtDur(v.duration)) : null),
        h("div", { class: "dup-body" },
          h("a", { class: "dup-name", href: `#/v/${v.id}` }, v.filename),
          h("div", { class: "meta" }, (v.source === "local" ? "📱 이 기기 · " : "☁ " + (SOURCE_LABEL[v.source] || "") + " · ") + (v.folder || "")),
          h("div", { class: "meta" }, [v.rating ? "★".repeat(v.rating) : "", v.play_count ? `${v.play_count}회 재생` : "", v.performers && v.performers.length ? v.performers.join(", ") : ""].filter(Boolean).join(" · ")),
          h("div", { class: "row", style: "margin-top:6px" }, keepBtn, hideBtn)));
    })));
  $app.replaceChildren(h("div", { class: "settings" },
    h("div", { class: "row", style: "justify-content:space-between;margin-bottom:12px" },
      h("h2", { style: "margin:0;font-size:20px" }, "중복 영상"),
      h("a", { class: "btn sm", href: "#/settings" }, "설정으로")),
    groups.length
      ? h("p", { class: "meta" }, `${groups.length}묶음 · 중복으로 차지하는 크기 약 ${fmtSize(wasted)}. 파일 크기가 똑같으면 같은 영상으로 봅니다. 남길 영상에서 ‘이것만 남기기’를 누르면 나머지는 숨기고 태그·사람 등 정보는 합쳐집니다. 숨긴 영상은 설정 → 숨긴 영상에서 되돌릴 수 있습니다.`)
      : h("div", { class: "empty" }, "중복 영상이 없습니다."),
    ...groups.map(groupEl)));
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
      ...(r.parent != null ? [h("button", { onclick: () => go(r.parent) }, r.parent ? "⬆ 상위 폴더" : "⬆ 처음 위치")] : []),
      ...(r.error ? [h("div", { class: "meta", style: "padding:10px 14px" }, "열 수 없음: " + r.error)] : []),
      ...r.dirs.map((d) => h("button", { onclick: () => go(d.path) }, "📁 " + d.name)));
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
