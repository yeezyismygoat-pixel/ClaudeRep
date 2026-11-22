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
}   // 서버가 지원하는 기능 (안드로이드 앱: MEGA, 출연자 프로필 등)

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
function setTab(name) {
  document.querySelectorAll(".tabs a").forEach((a) => a.classList.toggle("on", a.dataset.tab === name));
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
async function route() {
  const { path, params } = parseHash();
  stopPlayer();
  if (pageCleanup) { try { pageCleanup(); } catch (e) {} pageCleanup = null; }
  document.body.classList.remove("shorts-mode");
  window.scrollTo(0, 0);
  try {
    let m;
    if (path === "/home" || (path === "/" && !location.hash)) return await renderHome();
    if (path === "/" || path === "") return await renderLibrary(params);
    if ((m = path.match(/^\/v\/(\d+)$/))) return await renderVideo(+m[1], params);
    if (path === "/tags") return await renderEntities("tags", "태그", "tag");
    if (path === "/performers") return await renderEntities("performers", "출연자", "performer");
    if (path === "/performer") return await renderPerformer(+params.get("id"));
    if (path === "/settings") return await renderSettings();
    if (path === "/mega") return await renderMega(params);
    if (path === "/photos") return await renderPhotos(params);
    if (path === "/shorts") return await renderShorts(params);
    if (path === "/duplicates") return await renderDuplicates();
    if (path === "/hidden") return await renderHidden();
    if (path === "/comics") return await renderComics(params);
    if (path === "/comic") return await renderComic(+params.get("gid"), params.get("t") || "", params);
    location.hash = "#/";
  } catch (e) {
    if (e.message !== "login required") $app.replaceChildren(h("div", { class: "empty" }, "오류: " + e.message));
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

  // 활성 필터(태그/출연자) 이름 표시
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
  const search = h("input", { type: "search", class: "search", placeholder: "제목, 태그, 출연자, 경로 검색",
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
      ? h("button", { class: "btn", onclick: () => { page++; load(); } }, `더 보기 (${shown}/${data.total})`)
      : "");
  }
  await load();
  keepTypingFocus(search);
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

/** 이미지 벽 한 칸: 원래 비율을 유지하고 아래에 출연자 이름을 표시 */
function wallTile({ href, onclick, src, ratio, badges, performers }) {
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
  const search = h("input", { type: "search", class: "search", placeholder: "이름, 출연자, 폴더 검색", value: params.get("q") || "",
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
    more.replaceChildren(...(shown < data.total ? [h("button", { class: "btn", onclick: () => { page++; load(); } }, `더 보기 (${shown}/${data.total})`)] : []));
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
  const input = h("input", { type: "text", list: "dl-viewer-perf", placeholder: "출연자 추가 (Enter)" });
  const prevBtn = h("button", { onclick: () => show(i - 1) }, icon("prev"), "이전");
  const nextBtn = h("button", { onclick: () => show(i + 1) }, "다음", icon("next"));
  const close = () => {
    if (closed) return;
    closed = true; el.remove(); document.body.style.overflow = "";
    document.removeEventListener("keydown", onKey); window.removeEventListener("popstate", onPop);
  };
  const onPop = () => close();
  const onKey = (e) => {
    if (document.activeElement === input || document.activeElement === tagInput) return;
    if (e.key === "ArrowLeft") show(i - 1);
    else if (e.key === "ArrowRight") show(i + 1);
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
      ["폴더", cur.folder || "-"], ["출처", cur.source === "mega" ? "MEGA" : "이 기기"]];
    info.replaceChildren(
      h("h2", {}, cur.filename || cur.title),
      h("dl", {}, ...rows.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)])),
      h("div", { class: "row", style: "justify-content:space-between" },
        h("div", { class: "stars" + (editing ? "" : " ro") }, ...[1, 2, 3, 4, 5].map((n) =>
          editing ? h("button", { class: n <= (cur.rating || 0) ? "on" : "", title: `${n}점`, onclick: () => save({ rating: cur.rating === n ? 0 : n }) }, "★")
            : n <= (cur.rating || 0) ? h("span", { class: "on" }, "★") : null)),
        h("button", { class: "btn sm" + (editing ? " primary" : ""), onclick: () => { editing = !editing; draw(); } }, editing ? "완료" : "✎ 수정")),
      h("span", { class: "meta" }, "출연자"),
      h("div", { class: "chips" }, ...(cur.performer_refs.length ? cur.performer_refs.map((p) => editing
        ? h("span", { class: "chip" }, p.name,
            h("button", { "aria-label": `${p.name} 제거`, onclick: () => save({ performers: cur.performer_refs.filter((x) => x.id !== p.id).map((x) => x.name) }) }, "×"))
        : h("button", { class: "chip", onclick: () => { close(); location.hash = `#/performer?id=${p.id}`; } }, p.name))
        : [h("span", { class: "meta" }, editing ? "출연자 없음 — 아래에 이름을 입력하세요" : "출연자 없음")])),
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
  async function show(n) {
    if (n < 0 || n >= items.length) return;
    i = n;
    const p = items[i];
    img.src = `/photo/${p.id}`;
    counter.textContent = `${i + 1} / ${items.length}`;
    el.scrollTop = 0;
    if (items[i + 1]) new Image().src = `/photo/${items[i + 1].id}`;   // 다음 사진 미리 받기
    const d = await api(`photos/${p.id}`);
    if (i === n) { cur = d; draw(); }
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
  const stage = h("div", { class: "stage" }, img);
  let sx = null, sy = null;
  stage.addEventListener("touchstart", (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  stage.addEventListener("touchend", (e) => {
    if (sx == null) return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; sx = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) show(dx < 0 ? i + 1 : i - 1);   // 가로로 민 경우만 넘김
  });
  const el = h("div", { class: "viewer", role: "dialog", "aria-modal": "true" },
    h("div", { class: "vtop" }, h("button", { class: "vbtn", "aria-label": "닫기", onclick: () => history.back() }, icon("close")), counter, favBtn),
    stage, info);
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
  if (v.thumbs > 0) { img.src = thumbUrl(v.id, 0, v.thumbs); noimg.hidden = true; }
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
  const video = h("video", { controls: true, playsinline: true, preload: "metadata", poster: v.thumbs ? thumbUrl(v.id, 0, v.thumbs) : null });
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
    if (autoplay) video.play().catch(() => {});
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
  video.addEventListener("error", () => {
    if (mode === "direct" && video.error && v.source === "mega") {
      api("status").then((st) => toast(megaQuotaText(st) || "재생하지 못했습니다. 지원하지 않는 형식이거나 MEGA 연결 문제입니다.")).catch(() => {});
    } else if (mode === "direct" && video.error && !canTranscode) {
      toast("이 영상 형식은 브라우저에서 재생할 수 없습니다");
    } else if (mode === "direct" && video.error) {
      toast("이 형식은 바로 재생할 수 없어 호환 모드로 전환합니다");
      setMode("transcode", 0, true);
    }
  });
  const saveProgress = () => {
    const t = currentTime();
    if (t > 0) api(`videos/${v.id}/progress`, { method: "POST", body: { pos: t > v.duration - 10 ? 0 : t } }).catch(() => {});
  };
  video.addEventListener("pause", saveProgress);
  progressTimer = setInterval(() => { if (!video.paused) saveProgress(); }, 10000);

  const startAt = params.get("t") != null ? +params.get("t") : 0;
  setMode(mode, startAt, true);   // 영상을 누르고 들어오면 바로 재생
  const resume = v.resume_pos > 5 && !params.get("t")
    ? h("button", { class: "btn sm", onclick: (e) => { e.target.remove(); seekTo(v.resume_pos); } }, `▶ ${fmtDur(v.resume_pos)}부터 이어보기`)
    : null;

  // --- 아래 정보: 평소에는 간단히, ‘수정’을 누르면 고칠 수 있게
  let editing = false;
  const infoBox = h("div", { class: "vinfo-box" });
  async function save(patch) {
    v = Object.assign(v, await api(`videos/${v.id}`, { method: "PATCH", body: patch }));
    drawInfo();
  }
  const setEditing = (on) => { editing = on; drawInfo(); };

  // 장면 (누르면 그 지점으로)
  const nFrames = Math.max(0, (v.thumbs || 0) - 1);
  const frames = nFrames ? h("div", { class: "framestrip" }, Array.from({ length: nFrames }, (_, i) => {
    const t = v.duration * ((i + 1 - 0.5) / nFrames);
    return h("img", { src: thumbUrl(v.id, i + 1, v.thumbs), loading: "lazy", title: fmtDur(t), onclick: () => seekTo(t) });
  })) : null;

  const favBtn = () => h("button", { class: "favbtn" + (v.favorite ? " on" : ""), onclick: () => save({ favorite: !v.favorite }) }, v.favorite ? "♥ 즐겨찾기" : "♡ 즐겨찾기");
  const dlBtn = () => v.source === "mega" ? h("a", { class: "btn sm", href: `/media/${v.id}?dl=1` }, "휴대폰에 저장")
    : v.can_delete === false ? null : h("a", { class: "btn sm", href: `/media/${v.id}`, download: v.filename }, "다운로드");
  const addMarker = async (titleIn) => {
    v.markers = await api(`videos/${v.id}/markers`, { method: "POST", body: { seconds: currentTime(), title: titleIn ? titleIn.value.trim() : "" } });
    toast(`${fmtDur(currentTime())} 북마크를 추가했습니다`); drawInfo();
  };

  function readView() {
    const meta = [v.duration ? fmtDur(v.duration) : "", resLabel(v.width, v.height), v.size ? fmtSize(v.size) : "",
      v.play_count ? `${v.play_count}회 재생` : "", v.source === "mega" ? "MEGA" : ""].filter(Boolean).join(" · ");
    const people = v.performers.map((p) => h("a", { class: "chip", href: `#/performer?id=${p.id}` }, p.name));
    const tags = v.tags.map((t) => h("a", { class: "chip", href: `#/?tag=${t.id}` }, "# " + t.name));
    return [
      h("div", { class: "vhead" },
        h("h1", { class: "vtitle" }, v.title),
        h("button", { class: "btn sm", onclick: () => setEditing(true) }, "✎ 수정")),
      h("div", { class: "vmeta" }, v.rating ? h("span", { class: "stars-mini" }, "★".repeat(v.rating)) : null, h("span", {}, meta)),
      h("div", { class: "actions" }, favBtn(), dlBtn(),
        h("button", { class: "btn sm", onclick: () => addMarker(null) }, "🔖 지금 위치 북마크")),
      people.length || tags.length ? h("div", { class: "chips vchips" }, ...people, ...tags) : null,
      v.details ? h("p", { class: "vmemo" }, v.details) : null,
      v.markers.length ? h("div", { class: "vmarks" }, v.markers.map((m) =>
        h("button", { class: "chip", onclick: () => seekTo(m.seconds) }, h("b", {}, fmtDur(m.seconds)), m.title ? " " + m.title : ""))) : null,
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
    const regenBtn = h("button", { class: "btn sm", onclick: async () => {
      await api(`videos/${v.id}/thumbs`, { method: "POST" }); toast("미리보기를 다시 만듭니다");
    } }, "미리보기 다시 만들기");
    return [
      h("div", { class: "vhead" }, h("h2", { style: "margin:0;font-size:17px" }, "영상 정보 수정"),
        h("button", { class: "btn sm primary", onclick: () => setEditing(false) }, "완료")),
      h("div", { class: "panel" }, h("h3", {}, "제목"), titleIn,
        h("div", { class: "actions", style: "margin-top:10px" }, stars, favBtn())),
      editor("performers", allPerformers, "출연자", ""),
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
    h("div", { class: "player" }, video),
    seekRow,
    h("div", { class: "player-note" }, canTranscode ? modeNote : null, canTranscode ? modeBtn : null, resume),
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
      if (filterKey === "performer") {   // 출연자: 카드 전체를 누르면 프로필로
        const href = `#/performer?id=${e.id}`;
        return h("a", { class: "ecard", href },
          h("div", { class: "thumb" }, entityCover(e, "👤")),
          h("div", { class: "body" },
            h("span", { class: "name", title: e.name }, e.name),
            h("span", { class: "meta" }, e.photo_count ? `${e.count} · 사진 ${e.photo_count}` : `${e.count}`)),
          e.group !== undefined ? h("div", { class: "body meta", style: "padding-top:0;display:block" },
            [e.group, e.birthdate ? `${e.birthdate} (${age(e.birthdate)}세)` : "", e.height ? `${e.height}cm` : ""].filter(Boolean).join(" · ") || "정보 없음") : null);
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
  const autoBtn = ep === "performers" && items.some((e) => e.group !== undefined) || ep === "performers" && serverCaps.performer_info
    ? h("button", { class: "btn", onclick: async (ev) => {
        ev.currentTarget.disabled = true;
        const r = await api("performers/auto", { method: "POST" });
        toast(`영상 ${r.assigned || 0}개에 출연자를 지정했습니다. 출연자 정보는 백그라운드에서 찾습니다.`);
        route();
      } }, "MEGA 폴더 이름으로 출연자 지정") : null;
  $app.replaceChildren(
    h("div", { class: "toolbar" },
      h("input", { type: "search", class: "search", placeholder: `${label} 검색`, oninput: (e) => { filter = e.target.value; draw(); } }),
      autoBtn, editBtn,
      h("span", { class: "meta" }, `${items.length}개`)),
    items.length ? grid : h("div", { class: "empty" }, `${label}이(가) 없습니다. 영상 화면에서 ${label}을(를) 추가해 보세요.`));
  draw();
}

// ---------------------------------------------------------------- settings
async function renderSettings() {
  setTab("settings");
  const [st, status] = await Promise.all([api("settings"), api("status")]);
  const paths = st.library_paths.map((p) => p.path);
  const savePaths = async (list) => { await api("settings", { method: "PUT", body: { library_paths: list } }); renderSettings(); };

  const pathList = h("ul", { class: "pathlist" }, st.library_paths.length ? st.library_paths.map((p) =>
    h("li", {}, h("span", { class: "p" }, p.path, !p.exists ? h("div", { class: "warn" }, "폴더를 찾을 수 없습니다 (저장소 권한을 확인하세요)") : null),
      h("button", { class: "btn sm danger", onclick: () => savePaths(paths.filter((x) => x !== p.path)) }, "제거")))
    : h("li", { class: "meta" }, "아직 추가된 폴더가 없습니다."));

  const suggestions = st.suggestions.length ? h("div", {}, h("p", { class: "meta" }, "빠르게 추가:"),
    h("div", { class: "chips" }, st.suggestions.map((s) =>
      h("button", { class: "chip", onclick: () => savePaths(paths.concat([s])) }, "+ " + s.replace(/\/+$/, "").split("/").slice(-1)[0])))) : null;

  const manual = h("input", { type: "text", placeholder: "직접 입력: " + (st.example_path || "/storage/emulated/0/Movies") });
  const c = status.counts || {};
  const pw = h("input", { type: "password", placeholder: st.password_set ? "새 비밀번호 (비우면 해제)" : "비밀번호", autocomplete: "new-password" });

  $app.replaceChildren(h("div", { class: "settings" },
    h("div", { class: "panel" }, h("h3", {}, "라이브러리"),
      h("div", { class: "stats" },
        h("div", { class: "stat" }, h("b", {}, (c.total || 0).toLocaleString()), h("span", {}, "영상")),
        h("div", { class: "stat" }, h("b", {}, fmtSize(c.bytes)), h("span", {}, "전체 크기")),
        h("div", { class: "stat" }, h("b", {}, (c.seconds || 0) >= 3600 ? ((c.seconds / 3600).toFixed(1) + "시간") : fmtDur(c.seconds)), h("span", {}, "전체 길이")),
        h("div", { class: "stat" }, h("b", {}, c.favorites || 0), h("span", {}, "즐겨찾기")))),
    st.server ? serverPanel(st) : null,
    h("div", { class: "panel" }, h("h3", {}, "영상 폴더"), pathList,
      h("div", { class: "row" },
        h("button", { class: "btn", onclick: () => folderPicker((p) => savePaths(paths.concat([p]))) }, "📁 폴더 찾아보기"),
        h("button", { class: "btn primary", disabled: status.scanning || !paths.length, onclick: async () => {
          await api("scan", { method: "POST" }); toast("스캔을 시작했습니다"); setTimeout(renderSettings, 800);
        } }, status.scanning ? "스캔 중…" : "지금 스캔")),
      h("div", { class: "taginput" }, manual, h("button", { class: "btn", onclick: () => manual.value.trim() && savePaths(paths.concat([manual.value.trim()])) }, "추가")),
      suggestions ? h("div", { style: "margin-top:12px" }, suggestions) : null,
      status.last_scan ? h("p", { class: "meta" }, `마지막 스캔: ${fmtDate(status.last_scan)}`) : null),
    megaQuotaText(status) ? h("div", { class: "panel warn", style: "font-size:14px" }, megaQuotaText(status)) : null,
    st.mega_supported ? megaPanel(st.mega || [], st) : null,
    h("div", { class: "panel" }, h("h3", {}, "정리"),
      h("p", { class: "meta" }, `찾을 수 없는 파일: ${c.missing || 0}개 (옮겨졌거나 삭제된 파일)`),
      h("button", { class: "btn", disabled: !c.missing, onclick: async () => {
        const r = await api("cleanup", { method: "POST" }); toast(`${r.removed}개를 정리했습니다`); renderSettings();
      } }, "찾을 수 없는 파일 목록에서 지우기"),
      st.duplicates ? h("div", { style: "margin-top:14px" },
        h("p", { class: "meta" }, "같은 영상이 이 기기와 MEGA 에 함께 있거나, 여러 폴더에 들어 있는 경우를 찾습니다."),
        h("a", { class: "btn", href: "#/duplicates" }, "중복 영상 찾기")) : null,
      st.hidden_count !== undefined ? h("div", { style: "margin-top:14px" },
        h("p", { class: "meta" }, `숨긴 영상: ${st.hidden_count}개 (라이브러리에서 제거했거나 중복이라 숨긴 영상)`),
        h("a", { class: "btn", href: "#/hidden" }, "숨긴 영상 보기")) : null),
    st.backup ? backupPanel() : null,
    h("div", { class: "panel" }, h("h3", {}, "비밀번호 (같은 Wi-Fi에서 접속할 때 권장)"),
      h("div", { class: "taginput" }, pw, h("button", { class: "btn", onclick: async () => {
        await api("settings", { method: "PUT", body: { password: pw.value } });
        toast(pw.value ? "비밀번호를 설정했습니다" : "비밀번호를 해제했습니다");
        const a = await api("auth").catch(() => ({ ok: false }));
        if (a.ok) renderSettings(); else renderLogin();
      } }, "저장")),
      h("p", { class: "meta" }, st.password_set ? "현재 비밀번호가 설정되어 있습니다." : "현재 비밀번호 없이 접속할 수 있습니다.")),
    st.platform === "android" ? null : h("div", { class: "panel" }, h("h3", {}, "시스템"),
      h("dl", { class: "info" },
        h("dt", {}, "데이터 폴더"), h("dd", {}, st.data_dir),
        h("dt", {}, "ffmpeg"), h("dd", {}, st.ffmpeg ? "사용 가능" : "없음 — pkg install ffmpeg"),
        h("dt", {}, "ffprobe"), h("dd", {}, st.ffprobe ? "사용 가능" : "없음 — pkg install ffmpeg")))));
}

// ---------------------------------------------------------------- 출연자 프로필
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
  const hasInfo = p.group !== undefined;   // 안드로이드 앱만 출연자 정보(그룹·생일 등)를 저장
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
          if (!confirm(`이름을 ‘${name}’(으)로 바꿀까요?\n같은 이름의 출연자가 이미 있으면 하나로 합쳐집니다.`)) { ev.currentTarget.disabled = false; return; }
          const r = await api(`performers/${id}`, { method: "PATCH", body: { name } });
          if (r && r.id) newId = r.id;
          if (r && r.merged) toast("같은 이름의 출연자와 합쳤습니다");
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
      if (!confirm(`‘${p.name}’ 출연자를 삭제할까요?\n영상과 사진은 그대로 남고, 출연자 지정만 없어집니다.`)) return;
      await api(`performers/${id}`, { method: "DELETE" });
      toast("삭제했습니다");
      location.hash = "#/performers";
    } }, "출연자 삭제");
    editPanel = h("div", { class: "panel" }, h("h3", {}, "수정"),
      form,
      h("div", { class: "row", style: "margin-top:12px" }, saveBtn, lookupBtn, h("button", { class: "btn", onclick: () => setEdit(false) }, "취소")),
      hasInfo ? h("p", { class: "meta" }, "이름을 다른 출연자와 같게 바꾸면 두 출연자가 합쳐집니다. 그룹 이름을 정확히 적어 두면 인터넷에서 찾을 때 동명이인을 거릅니다.") : null,
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

  $app.replaceChildren(h("div", { class: "profile" }, head, editPanel, vSection, pSection));

  let vTotal = 0, pTotal = 0;
  const drawCounts = () => { counts.textContent = `영상 ${vTotal.toLocaleString()}개` + (showPhotos ? ` · 사진 ${pTotal.toLocaleString()}장` : ""); };
  let vPage = 1;
  async function loadVideos() {
    const d = await api(`videos?performer=${id}&sort=added&order=desc&per=24&page=${vPage}`);
    vTotal = d.total; drawCounts();
    vTitle.textContent = `영상 ${d.total.toLocaleString()}`;
    if (vPage === 1 && !d.total) { vGrid.replaceWith(h("p", { class: "meta" }, "이 출연자가 지정된 영상이 없습니다.")); return; }
    if (vPage === 1 && d.items[0] && d.items[0].thumbs > 0) setAvatar(thumbUrl(d.items[0].id, 0, d.items[0].thumbs));
    d.items.forEach((v) => vGrid.append(vMode === "wall" ? videoTile(v) : videoCard(v)));
    const shown = (vPage - 1) * d.per + d.items.length;
    vMore.replaceChildren(...(shown < d.total ? [h("button", { class: "btn", onclick: () => { vPage++; loadVideos(); } }, `영상 더 보기 (${shown}/${d.total})`)] : []));
  }
  const pItems = [];
  let pPage = 1;
  async function loadPhotos() {
    const d = await api(`photos?performer=${id}&sort=taken&order=desc&per=30&page=${pPage}`);
    pTotal = d.total; drawCounts();
    pTitle.textContent = `사진 ${d.total.toLocaleString()}`;
    if (pPage === 1 && !d.total) { pGrid.replaceWith(h("p", { class: "meta" }, "이 출연자가 지정된 사진이 없습니다.")); return; }
    if (pPage === 1 && d.items[0]) setAvatar(`/photothumb/${d.items[0].id}.jpg`);
    for (const ph of d.items) {
      const i = pItems.length;
      pItems.push(ph);
      pGrid.append(photoCell(ph, pMode, () => openViewer(pItems, i)));
    }
    const shown = (pPage - 1) * d.per + d.items.length;
    pMore.replaceChildren(...(shown < d.total ? [h("button", { class: "btn", onclick: () => { pPage++; loadPhotos(); } }, `사진 더 보기 (${shown}/${d.total})`)] : []));
  }
  drawCounts();
  await Promise.all([loadVideos(), showPhotos ? loadPhotos().catch(() => {}) : null]);
}

// ---------------------------------------------------------------- 앱 서버 (안드로이드)
function serverPanel(st) {
  const sv = st.server;
  const toggle = h("input", { type: "checkbox", id: "lan-toggle", checked: sv.lan, disabled: !st.password_set && !sv.lan });
  toggle.addEventListener("change", async () => {
    toggle.disabled = true;
    try {
      await api("settings", { method: "PUT", body: { lan: toggle.checked } });
      toast(toggle.checked ? "다른 기기 접속을 켰습니다" : "다른 기기 접속을 껐습니다");
    } catch (e) { toast(e.message); }
    setTimeout(renderSettings, 1500);   // 서버가 새 설정으로 다시 열릴 때까지 잠시 대기
  });
  return h("div", { class: "panel" }, h("h3", {}, "다른 기기에서 보기"),
    h("p", { class: sv.secure_folder ? "meta" : "warn" }, sv.secure_folder
      ? "🔒 보안 폴더에서 실행 중입니다. 보안 폴더의 영상만 보입니다."
      : "⚠ 일반 공간에서 실행 중입니다. 보안 폴더 영상만 보려면 보안 폴더 안의 VidShelf 를 쓰세요."),
    h("label", { class: "row", for: "lan-toggle", style: "margin:10px 0" }, toggle, h("span", {}, "같은 Wi-Fi 의 다른 기기에서 접속 허용")),
    !st.password_set ? h("p", { class: "meta" }, "켜려면 먼저 아래 ‘비밀번호’에서 비밀번호를 정하세요. 다른 기기에서는 그 비밀번호로 로그인합니다.") : null,
    sv.lan ? (sv.lan_addresses.length
      ? h("div", {}, h("p", { class: "meta" }, "다른 기기의 브라우저에서 이 주소를 여세요:"),
          ...sv.lan_addresses.map((a) => h("p", { style: "font-size:18px;margin:4px 0;user-select:all" }, a)))
      : h("p", { class: "warn" }, "Wi-Fi 에 연결되어 있지 않습니다. 이 폰과 다른 기기를 같은 Wi-Fi 에 연결하세요.")) : null);
}

// ---------------------------------------------------------------- MEGA
function megaPanel(links, st) {
  const input = h("input", { type: "text", placeholder: "https://mega.nz/folder/…#…", autocomplete: "off" });
  const msg = h("p", { class: "meta" });
  const add = async (btn) => {
    const url = input.value.trim();
    if (!url) return;
    btn.disabled = true; msg.textContent = "MEGA 폴더를 불러오는 중…";
    try {
      await api("mega", { method: "POST", body: { url } });
      toast("MEGA 폴더를 추가했습니다"); renderSettings();
    } catch (e) { msg.textContent = e.message; btn.disabled = false; }
  };
  const addBtn = h("button", { class: "btn primary", onclick: (e) => add(e.currentTarget) }, "추가");
  return h("div", { class: "panel" }, h("h3", {}, "MEGA 폴더 링크"),
    h("p", { class: "meta" }, "MEGA 앱이나 웹에서 폴더 → 공유 → 링크 복사로 만든 링크를 붙여넣으세요. 링크에는 열쇠(# 뒤)가 포함되어야 합니다. 영상은 라이브러리에, 모든 파일은 MEGA 탭에 나옵니다."),
    h("ul", { class: "pathlist" }, links.length ? links.map((l) => h("li", {},
      h("span", { class: "p" }, "☁ " + l.name, h("div", { class: "meta" }, `파일 ${l.files}개 · 영상 ${l.videos}개`),
        l.error ? h("div", { class: "warn" }, l.error) : null),
      h("a", { class: "btn sm", href: `#/mega?link=${l.index}` }, "열기"),
      h("button", { class: "btn sm danger", onclick: async () => {
        if (!confirm(`‘${l.name}’ MEGA 폴더 연결을 끊을까요? (MEGA 의 파일은 그대로입니다)`)) return;
        await api(`mega/${l.index}`, { method: "DELETE" }); renderSettings();
      } }, "제거")))
      : h("li", { class: "meta" }, "연결된 MEGA 폴더가 없습니다.")),
    h("div", { class: "taginput" }, input, addBtn),
    msg,
    links.length && st.mega_thumbs !== undefined ? megaThumbToggle(st) : null,
    links.length && st.mega_refresh_hours !== undefined ? megaRefreshSelect(st) : null,
    links.length ? h("button", { class: "btn sm", style: "margin-top:8px", onclick: async (e) => {
      e.currentTarget.disabled = true; await api("mega/refresh", { method: "POST" }); toast("MEGA 목록을 새로 받았습니다"); renderSettings();
    } }, "MEGA 목록 새로고침") : null);
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

async function renderMega(params) {
  setTab("mega");
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
  const seed = params.get("seed") || String(Date.now() % 100000);
  const feed = h("div", { class: "shorts" });
  $app.replaceChildren(feed);
  const items = [];   // { v, el, video, bar }
  let page = 1, total = Infinity, loading = false, active = -1;

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
    let counted = false;
    video.addEventListener("play", () => {
      icon.classList.remove("show");
      if (!counted) { counted = true; api(`videos/${v.id}/play`, { method: "POST" }).catch(() => {}); }
    });
    video.addEventListener("timeupdate", () => { if (video.duration) bar.style.width = `${(video.currentTime / video.duration) * 100}%`; });
    const el = h("section", { class: "short" }, video, icon,
      h("div", { class: "sinfo" },
        h("a", { class: "stitle", href: `#/v/${v.id}` }, v.title),
        v.performers && v.performers.length ? h("div", { class: "sperf" }, v.performers.join(", ")) : null),
      h("div", { class: "sside" }, muteBtn,
        h("a", { class: "sbtn", href: `#/v/${v.id}`, "aria-label": "자세히" }, "ⓘ")),
      h("div", { class: "sbar-wrap" }, bar));
    // 누르면 재생/일시정지
    el.addEventListener("click", (e) => {
      if (e.target.closest("a, button")) return;
      if (video.paused) video.play().catch(() => {}); else { video.pause(); icon.classList.add("show"); }
    });
    return { v, el, video, bar, mute: muteBtn };
  }

  const setSrc = (it, on) => {
    if (on && !it.video.getAttribute("src")) { it.video.src = `/media/${it.v.id}`; it.video.preload = "auto"; }
    if (!on && it.video.getAttribute("src")) { it.video.pause(); it.video.removeAttribute("src"); it.video.load(); }
  };
  function activate(i) {
    if (i === active) return;
    active = i;
    items.forEach((it, k) => {
      setSrc(it, Math.abs(k - i) <= 1);   // 지금 영상과 앞뒤 하나만 받아 둠
      if (k !== i) it.video.pause();
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
  pageCleanup = () => { watch.disconnect(); items.forEach((it) => setSrc(it, false)); };
  await load();
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

async function renderHome() {
  setTab("home");
  if (!Object.keys(serverCaps).length) serverCaps = await api("settings").catch(() => ({}));   // 앱을 막 열었을 때
  const stats = h("div", { class: "home-stats" });
  const resume = shelf("이어 보기", "#/?sort=played", "vids");
  const recent = shelf("최근 추가된 영상", "#/?sort=added", "vids");
  const favs = shelf("즐겨찾기 영상", "#/?fav=1", "vids");
  const comics = shelf("이어 읽는 만화", "#/comics", "comics");
  const photos = shelf("최근 사진", "#/photos", "photos");
  const people = shelf("출연자", "#/performers", "people");
  $app.replaceChildren(h("div", { class: "home" }, stats,
    resume.sec, recent.sec, comics.sec, favs.sec, photos.sec, people.sec));

  const statItem = (href, n, label) => h("a", { class: "stat", href }, h("b", {}, n), h("span", {}, label));
  const counts = { videos: null, photos: null, people: null };
  const drawStats = () => stats.replaceChildren(...[
    statItem("#/", counts.videos == null ? "…" : counts.videos.toLocaleString(), "영상"),
    serverCaps.photos ? statItem("#/photos", counts.photos == null ? "…" : counts.photos.toLocaleString(), "사진") : null,
    statItem("#/performers", counts.people == null ? "…" : counts.people.toLocaleString(), "출연자"),
    serverCaps.eh ? statItem("#/comics", "보기", "만화") : null].filter(Boolean));
  drawStats();

  const small = (v) => videoCard(v);
  const jobs = [
    api("videos?sort=played&order=desc&per=40").then((d) => {
      counts.videos = d.total; drawStats();
      resume.fill(d.items.filter((v) => v.resume_pos > 5 && v.duration && v.resume_pos < v.duration - 10).slice(0, 12).map(small));
    }),
    api("videos?sort=added&order=desc&per=15").then((d) => recent.fill(d.items.map(small))),
    api("videos?fav=1&sort=random&seed=" + (Date.now() % 100000) + "&per=15").then((d) => favs.fill(d.items.map(small))),
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
  if (serverCaps.eh) jobs.push(api("eh/recent").then((d) => {
    comics.fill((d.items || []).map((g) => comicCard(g)));
  }));
  else comics.fill([]);
  await Promise.all(jobs.map((j) => j.catch(() => {})));
  // 모두 비어 있으면 안내
  if (!$app.querySelector(".shelf")) $app.querySelector(".home").append(h("div", { class: "empty" },
    h("p", {}, "아직 보여 줄 것이 없습니다."), h("a", { class: "btn primary", href: "#/settings" }, "설정에서 폴더나 MEGA 링크 추가")));
}

// ---------------------------------------------------------------- e-hentai 즐겨찾기 만화
function ehLoginForm(inApp) {
  const user = h("input", { type: "text", placeholder: "아이디", autocomplete: "username" });
  const pass = h("input", { type: "password", placeholder: "비밀번호", autocomplete: "current-password" });
  const msg = h("p", { class: "warn" });
  const submit = async (body, btn) => {
    btn.disabled = true; msg.textContent = "";
    try { await api("eh/login", { method: "POST", body }); toast("로그인했습니다"); route(); }
    catch (e) { msg.textContent = e.message; btn.disabled = false; }
  };
  const loginBtn = h("button", { class: "btn primary", onclick: (e) => submit({ user: user.value, pass: pass.value }, e.currentTarget) }, "로그인");
  const mid = h("input", { type: "text", inputmode: "numeric", placeholder: "ipb_member_id (숫자)" });
  const hash = h("input", { type: "text", placeholder: "ipb_pass_hash (32자리)", autocomplete: "off" });
  const cookieBtn = h("button", { class: "btn", onclick: (e) => submit({ member_id: mid.value, pass_hash: hash.value }, e.currentTarget) }, "쿠키로 로그인");
  const pwForm = h("div", { style: "display:grid;gap:8px;margin-top:10px" }, user, pass, loginBtn, msg);
  const cookieForm = [
    h("p", { class: "meta" }, "PC 브라우저에서 e-hentai 에 로그인한 뒤, 개발자 도구(F12) → Application(저장소) → Cookies → e-hentai.org 에서 ipb_member_id 와 ipb_pass_hash 값을 복사해 넣으세요."),
    h("div", { style: "display:grid;gap:8px;margin-top:10px" }, mid, hash, cookieBtn)];
  return h("div", { class: "settings" },
    h("div", { class: "panel" }, h("h3", {}, "e-hentai 로그인"),
      h("p", { class: "meta" }, "e-hentai(포럼) 계정으로 로그인하면 내 즐겨찾기 만화를 여기서 볼 수 있습니다. 비밀번호는 저장하지 않고 로그인 쿠키만 이 앱 안에 저장합니다."),
      inApp ? h("div", { style: "margin-top:12px" },
        h("a", { class: "btn primary", href: "vidshelf://eh-login", style: "display:block;text-align:center;padding:12px" }, "e-hentai 로그인 화면 열기"),
        h("p", { class: "meta" }, "앱 안에 e-hentai 로그인 페이지가 열립니다. 아이디·비밀번호를 넣고 로봇 확인이 나오면 풀어 주세요. 로그인되면 자동으로 이 화면으로 돌아옵니다.")) : pwForm),
    inApp ? h("details", { class: "panel" }, h("summary", {}, "다른 방법: 아이디·비밀번호를 여기에 입력"), pwForm) : null,
    h("details", { class: "panel" }, h("summary", {}, inApp ? "다른 방법: 쿠키 값 직접 입력 (PC 필요)" : "쿠키로 로그인 (로봇 확인 때문에 위 로그인이 안 될 때)"), ...cookieForm));
}

/** 표지 주소: 앱을 거쳐 받아서 보관 (차단·오프라인 대비) */
const comicThumb = (u) => !u ? "" : u.startsWith("/") ? u : `/eh/thumb?u=${encodeURIComponent(u)}`;

function comicCard(g, extra) {
  const img = h("img", { src: comicThumb(g.thumb), loading: "lazy", alt: "" });
  img.onerror = () => (img.hidden = true);
  const read = g.read_page > 0 ? Math.min(100, (g.read_page / Math.max(1, g.pages)) * 100) : 0;
  return h("a", { class: "ccard", href: `#/comic?gid=${g.gid}&t=${g.token}` },
    h("div", { class: "cthumb" }, img, h("span", { class: "badge dur" }, `${g.pages}p`),
      read ? h("div", { class: "progress", style: `width:${read}%` }) : null),
    h("div", { class: "title", title: g.title }, g.title_jpn || g.title),
    h("div", { class: "sub" }, g.category ? h("span", {}, g.category) : null, g.read_page ? h("span", {}, `${g.read_page}쪽까지 읽음`) : null),
    extra || null);
}

async function renderComics(params) {
  setTab("comics");
  const tab = ["fav", "saved"].includes(params.get("tab")) ? params.get("tab") : "ko";
  const st = await api("eh/status");
  const tabs = h("div", { class: "seg comic-tabs", role: "tablist" },
    h("a", { class: tab === "ko" ? "on" : "", href: "#/comics" }, "한국어"),
    h("a", { class: tab === "fav" ? "on" : "", href: "#/comics?tab=fav" }, "♥ 즐겨찾기"),
    h("a", { class: tab === "saved" ? "on" : "", href: "#/comics?tab=saved" }, "💾 저장"));
  if (tab === "saved") return renderSavedComics(tabs);
  if (tab === "fav" && !st.logged_in) { $app.replaceChildren(h("div", {}, tabs, ehLoginForm(st.in_app))); return; }

  const favcat = params.get("favcat") || "all", q = params.get("q") || "";
  const update = (ch) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(ch)) (v == null || v === "") ? p.delete(k) : p.set(k, v);
    location.hash = "#/comics" + (p.toString() ? "?" + p : "");
  };
  let t;
  const search = h("input", { type: "search", class: "search", value: q,
    placeholder: tab === "fav" ? "즐겨찾기에서 검색 (제목, 태그)" : "한국어 만화 검색 (제목, 태그, 작가)",
    oninput: (e) => { clearTimeout(t); t = setTimeout(() => { typingSearch = true; update({ q: e.target.value }); }, 700); } });
  const folderChips = h("div", { class: "chips" });
  const grid = h("div", { class: "cgrid" });
  const more = h("div", { class: "more" });
  const logout = st.logged_in ? h("button", { class: "btn sm", onclick: async () => {
    if (!confirm("e-hentai 에서 로그아웃할까요? (이 앱에 저장한 로그인 쿠키를 지웁니다)")) return;
    await api("eh/logout", { method: "POST" }); route();
  } }, "로그아웃") : null;
  $app.replaceChildren(h("div", {},
    h("div", { class: "toolbar" }, tabs, h("span", { style: "flex:1" }), tab === "fav" ? logout : null),
    h("div", { class: "toolbar" }, search),
    tab === "fav" ? h("div", { class: "toolbar" }, folderChips) : null,
    grid, more));
  keepTypingFocus(search);
  let next = null, first = true;
  async function load() {
    const qs = new URLSearchParams();
    if (tab === "fav") qs.set("favcat", favcat);
    if (q) qs.set("q", q);
    if (next) qs.set("next", next);
    more.replaceChildren(h("span", { class: "meta" }, "불러오는 중…"));
    let d;
    try { d = await api((tab === "fav" ? "eh/favorites?" : "eh/search?") + qs); }
    catch (e) { more.replaceChildren(h("span", { class: "warn" }, e.message), h("button", { class: "btn sm", style: "margin-left:8px", onclick: load }, "다시 시도")); return; }
    if (tab === "fav" && d.logged_in === false) { $app.replaceChildren(h("div", {}, tabs, h("p", { class: "warn" }, "로그인이 풀렸습니다. 다시 로그인하세요."), ehLoginForm(st.in_app))); return; }
    if (first) {
      first = false;
      if (tab === "fav") {
        const total = d.folders.reduce((n, f) => n + f.count, 0);
        folderChips.replaceChildren(
          h("button", { class: "chip" + (favcat === "all" ? " on" : ""), onclick: () => update({ favcat: null }) }, `전체${total ? " " + total : ""}`),
          ...d.folders.filter((f) => f.count > 0 || f.cat === favcat).map((f) =>
            h("button", { class: "chip" + (favcat === f.cat ? " on" : ""), onclick: () => update({ favcat: f.cat }) }, `${f.name} ${f.count}`)));
      }
      if (!d.items.length) {
        grid.replaceWith(h("div", { class: "empty" }, q ? "검색 결과가 없습니다." : tab === "fav" ? "즐겨찾기한 만화가 없습니다." : "만화를 찾지 못했습니다."));
        more.replaceChildren(); return;
      }
    }
    d.items.forEach((g) => grid.append(comicCard(g)));
    next = d.next;
    more.replaceChildren(...(next ? [h("button", { class: "btn", onclick: load }, "더 보기")] : []));
  }
  await load();
}

async function renderSavedComics(tabs) {
  const d = await api("eh/saved");
  const grid = h("div", { class: "cgrid" });
  for (const g of d.items) {
    const status = g.done ? h("div", { class: "meta" }, `저장됨 · ${g.pages}쪽`)
      : g.error ? h("div", { class: "warn" }, `멈춤 ${g.saved_pages}/${g.pages}: ${g.error}`)
      : h("div", { class: "meta" }, `받는 중 ${g.saved_pages}/${g.pages}`);
    const btns = h("div", { class: "row", style: "margin-top:4px;gap:4px" },
      !g.done ? h("button", { class: "btn sm", onclick: async (e) => { e.preventDefault(); await api("eh/save", { method: "POST", body: g }); toast("이어서 받습니다"); route(); } }, "이어 받기") : null,
      h("button", { class: "btn sm danger", onclick: async (e) => {
        e.preventDefault();
        if (!confirm(`‘${g.title}’ 저장본을 지울까요?`)) return;
        await api("eh/unsave", { method: "POST", body: { gid: g.gid } }); route();
      } }, "삭제"));
    grid.append(h("div", {}, comicCard(g, status), btns));
  }
  $app.replaceChildren(h("div", {},
    h("div", { class: "toolbar" }, tabs),
    h("p", { class: "meta" }, "기기에 저장한 만화는 인터넷 없이 볼 수 있습니다. 만화 정보 화면의 ‘기기에 저장’으로 추가하세요."),
    d.items.length ? grid : h("div", { class: "empty" }, "저장한 만화가 없습니다.")));
}

async function renderComic(gid, token, params) {
  setTab("comics");
  const g = await api(`eh/gallery?gid=${gid}&t=${token}`);
  if (g.logged_in === false) { location.hash = "#/comics"; return; }
  const cover = h("img", { src: comicThumb(g.thumb), alt: "" });
  const groups = {};
  for (const tag of g.tags) {
    const [ns, name] = tag.includes(":") ? tag.split(/:(.*)/s) : ["misc", tag];
    (groups[ns] = groups[ns] || []).push(name);
  }
  const NS = { language: "언어", parody: "패러디", character: "캐릭터", group: "그룹", artist: "작가", cosplayer: "코스플레이어", male: "남성", female: "여성", mixed: "혼합", other: "기타", misc: "기타", reclass: "분류", location: "장소" };
  const tagRows = Object.entries(groups).flatMap(([ns, names]) => [h("dt", {}, NS[ns] || ns),
    h("dd", {}, h("div", { class: "chips" }, names.map((n) => h("a", { class: "chip", href: `#/comics?q=${encodeURIComponent(`${ns}:"${n}$"`)}` }, n))))]);
  const startAt = Math.min(Math.max(1, g.read_page || 1), g.pages);
  // 즐겨찾기 (로그인했을 때만)
  const favBox = h("div", { class: "row" });
  const drawFav = (f) => {
    if (!f || f.logged_in === false) { favBox.replaceChildren(); return; }
    const sel = h("select", { "aria-label": "즐겨찾기 폴더" }, Array.from({ length: 10 }, (_, i) => h("option", { value: i, selected: i === Math.max(0, f.favcat) }, `폴더 ${i}`)));
    const setFav = async (cat, btn) => {
      btn.disabled = true;
      try { drawFav(await api("eh/fav", { method: "POST", body: { gid: g.gid, t: g.token, favcat: cat } })); toast(cat < 0 ? "즐겨찾기에서 뺐습니다" : "즐겨찾기에 넣었습니다"); }
      catch (e) { toast(e.message); btn.disabled = false; }
    };
    favBox.replaceChildren(...(f.favcat >= 0
      ? [h("span", { class: "chip on" }, `♥ ${f.name || "즐겨찾기"}`), sel,
         h("button", { class: "btn sm", onclick: (e) => setFav(+sel.value, e.currentTarget) }, "폴더 옮기기"),
         h("button", { class: "btn sm danger", onclick: (e) => setFav(-1, e.currentTarget) }, "즐겨찾기 해제")]
      : [sel, h("button", { class: "btn sm", onclick: (e) => setFav(+sel.value, e.currentTarget) }, "♡ 즐겨찾기 추가")]));
  };
  api(`eh/favstate?gid=${g.gid}&t=${g.token}`).then(drawFav).catch(() => {});
  // 기기에 저장
  const saveBox = h("div", { class: "row" });
  const drawSave = async () => {
    const d = await api("eh/saved").catch(() => ({ items: [] }));
    const s = d.items.find((x) => x.gid === g.gid);
    saveBox.replaceChildren(s
      ? h("a", { class: "chip", href: "#/comics?tab=saved" }, s.done ? `💾 저장됨` : s.error ? `💾 멈춤 ${s.saved_pages}/${s.pages}` : `💾 받는 중 ${s.saved_pages}/${s.pages}`)
      : h("button", { class: "btn sm", onclick: async (e) => {
          e.currentTarget.disabled = true;
          await api("eh/save", { method: "POST", body: { gid: g.gid, token: g.token, title: g.title_jpn || g.title, thumb: g.thumb, pages: g.pages, category: g.category } });
          toast("기기에 저장을 시작했습니다. 위쪽 막대에 진행 상황이 나옵니다."); drawSave();
        } }, "💾 기기에 저장"));
  };
  drawSave();
  $app.replaceChildren(h("div", { class: "comic" },
    h("div", { class: "panel comic-head" },
      h("div", { class: "comic-cover", onclick: () => openReader(g, 1) }, cover),
      h("div", { class: "pf-main" },
        h("h2", { class: "pf-name", style: "font-size:18px" }, g.title_jpn || g.title),
        g.title_jpn ? h("p", { class: "meta", style: "margin:4px 0 0" }, g.title) : null,
        h("p", { class: "meta", style: "margin:6px 0 10px" }, [g.category, `${g.pages}쪽`, g.rating ? `★ ${g.rating}` : "", g.posted ? new Date(g.posted * 1000).toLocaleDateString("ko-KR") : ""].filter(Boolean).join(" · ")),
        h("div", { class: "row" },
          g.read_page > 1 ? h("button", { class: "btn primary", onclick: () => openReader(g, startAt) }, `이어 읽기 (${startAt}쪽)`) : null,
          h("button", { class: "btn" + (g.read_page > 1 ? "" : " primary"), onclick: () => openReader(g, 1) }, "처음부터 읽기")),
        h("div", { class: "row", style: "margin-top:8px" }, favBox, saveBox))),
    tagRows.length ? h("div", { class: "panel" }, h("h3", {}, "태그"), h("dl", { class: "info", style: "gap:8px 12px;align-items:start" }, ...tagRows)) : null,
    h("p", { class: "meta" }, h("a", { href: `https://e-hentai.org/g/${g.gid}/${g.token}/`, target: "_blank", rel: "noopener", style: "text-decoration:underline" }, "e-hentai 에서 열기"))));
  if (params.get("read")) openReader(g, +params.get("read") || startAt);
}

/** 만화 보기: 세로 스크롤 또는 한 장씩 넘기기. 화면 근처 페이지만 받고, 읽은 위치를 기억. */
function openReader(g, start) {
  let closed = false, current = start, saveTimer;
  let mode = (() => { try { return localStorage.getItem("vs-reader-mode") || "scroll"; } catch (e) { return "scroll"; } })();
  const counter = h("span", { class: "count" });
  const pageUrl = (n) => `/eh/page/${g.gid}/${g.token}/${n}`;
  const progressBody = () => ({ gid: g.gid, page: current, token: g.token, title: g.title_jpn || g.title, thumb: g.thumb, pages: g.pages });
  const drawCounter = () => (counter.textContent = `${current} / ${g.pages}`);
  const saveProgress = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => api("eh/progress", { method: "POST", body: progressBody() }).catch(() => {}), 800);
  };
  const setCurrent = (n) => { current = n; drawCounter(); saveProgress(); };

  /** 실패한 페이지: 이유를 서버에 다시 물어서 표시 */
  const failView = (n, src, retry) => {
    const why = h("p", { class: "rerr" });
    fetch(src).then((r) => r.json().then((d) => d.error, () => (r.ok ? "이미지를 표시하지 못했습니다" : `HTTP ${r.status}`)))
      .then((t) => (why.textContent = t || "")).catch(() => (why.textContent = "앱 서버에 연결하지 못했습니다"));
    return h("div", { class: "rfail" }, h("button", { class: "btn", onclick: (e) => { e.stopPropagation(); retry(); } }, `${n}쪽 불러오기 실패 · 다시 시도`), why);
  };

  // ---- 세로 스크롤
  const pages = [];
  const list = h("div", { class: "rpages" });
  const load = (i) => {
    const pg = pages[i];
    if (!pg || pg.dataset.state) return;
    pg.dataset.state = "loading";
    const img = h("img", { alt: `${i + 1}쪽`, decoding: "async" });
    img.onload = () => { pg.dataset.state = "done"; pg.classList.add("loaded"); };
    img.onerror = () => { pg.dataset.state = "failed"; pg.replaceChildren(failView(i + 1, img.src, () => { pg.dataset.state = ""; pg.replaceChildren(h("span", { class: "meta" }, `${i + 1}`)); load(i); })); };
    img.src = pageUrl(i + 1);
    pg.replaceChildren(img);
  };
  for (let i = 0; i < g.pages; i++) {
    const pg = h("div", { class: "rpage", "data-n": i + 1 }, h("span", { class: "meta" }, `${i + 1}`));
    pages.push(pg); list.append(pg);
  }
  const near = new IntersectionObserver((ents) => ents.forEach((e) => e.isIntersecting && load(+e.target.dataset.n - 1)), { rootMargin: "300% 0px" });
  const mid = new IntersectionObserver((ents) => ents.forEach((e) => { if (e.isIntersecting && mode === "scroll") setCurrent(+e.target.dataset.n); }), { rootMargin: "-50% 0px -50% 0px" });
  const end = h("div", { class: "rend" }, h("p", {}, "마지막 쪽입니다"), h("button", { class: "btn", onclick: () => history.back() }, "닫기"));
  const scrollView = h("div", {}, list, end);

  // ---- 한 장씩
  const single = h("div", { class: "rsingle" });
  const showSingle = (n) => {
    if (n < 1) return;
    if (n > g.pages) { toast("마지막 쪽입니다"); return; }
    setCurrent(n);
    const img = h("img", { alt: `${n}쪽`, src: pageUrl(n) });
    img.onerror = () => single.replaceChildren(failView(n, img.src, () => showSingle(n)));
    single.replaceChildren(img);
    for (const k of [n + 1, n + 2]) if (k <= g.pages) new Image().src = pageUrl(k);   // 다음 쪽 미리 받기
  };
  let sx = null, sy = null;
  single.addEventListener("touchstart", (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  single.addEventListener("touchend", (e) => {
    if (sx == null) return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; sx = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) { e.preventDefault(); showSingle(dx < 0 ? current + 1 : current - 1); }
  });
  single.addEventListener("click", (e) => {   // 왼쪽 1/3: 이전, 오른쪽 1/3: 다음, 가운데: 막대 숨기기
    const x = e.clientX / window.innerWidth;
    if (x < 0.33) showSingle(current - 1); else if (x > 0.67) showSingle(current + 1); else bar.classList.toggle("hide");
  });

  const modeBtn = h("button", { class: "vbtn rmode", "aria-label": "보기 방식" });
  const applyMode = () => {
    modeBtn.textContent = mode === "scroll" ? "한 장" : "스크롤";
    el.classList.toggle("paged", mode === "page");
    if (mode === "page") { scrollView.hidden = true; single.hidden = false; showSingle(current); }
    else { single.hidden = true; scrollView.hidden = false; requestAnimationFrame(() => pages[current - 1] && pages[current - 1].scrollIntoView()); }
  };
  modeBtn.onclick = () => { mode = mode === "scroll" ? "page" : "scroll"; try { localStorage.setItem("vs-reader-mode", mode); } catch (e) {} applyMode(); };

  const close = () => {
    if (closed) return;
    closed = true; near.disconnect(); mid.disconnect(); el.remove(); document.body.style.overflow = "";
    window.removeEventListener("popstate", onPop); document.removeEventListener("keydown", onKey);
    api("eh/progress", { method: "POST", body: progressBody() }).catch(() => {}).then(() => route());
  };
  const onPop = () => close();
  const onKey = (e) => {
    if (mode !== "page") return;
    if (e.key === "ArrowRight") showSingle(current + 1); else if (e.key === "ArrowLeft") showSingle(current - 1);
  };
  const bar = h("div", { class: "vtop" }, h("button", { class: "vbtn", "aria-label": "닫기", onclick: () => history.back() }, icon("close")), counter, modeBtn);
  const el = h("div", { class: "viewer reader", role: "dialog", "aria-modal": "true" }, bar, scrollView, single);
  list.addEventListener("click", (e) => { if (e.target.tagName === "IMG") bar.classList.toggle("hide"); });
  document.body.append(el);
  document.body.style.overflow = "hidden";
  history.pushState({ viewer: true }, "");
  window.addEventListener("popstate", onPop);
  document.addEventListener("keydown", onKey);
  pages.forEach((p) => { near.observe(p); mid.observe(p); });
  drawCounter();
  applyMode();
}

// ---------------------------------------------------------------- 백업 / 복원
function backupPanel() {
  const file = h("input", { type: "file", accept: ".json,application/json", hidden: true });
  const msg = h("p", { class: "meta" });
  file.addEventListener("change", async () => {
    const f = file.files[0];
    if (!f) return;
    if (!confirm(`‘${f.name}’ 백업으로 지금 정보를 바꿀까요?\n지금 있는 태그·별점·출연자·만화 읽은 위치는 백업 내용으로 바뀝니다.`)) { file.value = ""; return; }
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
    h("p", { class: "meta" }, "태그·별점·즐겨찾기·출연자 정보·북마크·메모·만화 읽은 위치·MEGA 링크를 파일 하나로 저장합니다. 앱을 지웠다 다시 설치할 때 이 파일로 되살릴 수 있습니다. (비밀번호와 e-hentai 로그인은 넣지 않습니다)"),
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
          h("div", { class: "meta" }, (v.source === "mega" ? "☁ MEGA · " : "📱 이 기기 · ") + (v.folder || "") + " · " + fmtSize(v.size)),
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
        if (!confirm(`이 영상만 남기고 나머지 ${others.length}개는 숨길까요?\n숨기는 영상의 태그·출연자·별점·북마크·재생 기록은 이 영상으로 합쳐집니다.`)) return;
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
          h("div", { class: "meta" }, (v.source === "mega" ? "☁ MEGA · " : "📱 이 기기 · ") + (v.folder || "")),
          h("div", { class: "meta" }, [v.rating ? "★".repeat(v.rating) : "", v.play_count ? `${v.play_count}회 재생` : "", v.performers && v.performers.length ? v.performers.join(", ") : ""].filter(Boolean).join(" · ")),
          h("div", { class: "row", style: "margin-top:6px" }, keepBtn, hideBtn)));
    })));
  $app.replaceChildren(h("div", { class: "settings" },
    h("div", { class: "row", style: "justify-content:space-between;margin-bottom:12px" },
      h("h2", { style: "margin:0;font-size:20px" }, "중복 영상"),
      h("a", { class: "btn sm", href: "#/settings" }, "설정으로")),
    groups.length
      ? h("p", { class: "meta" }, `${groups.length}묶음 · 중복으로 차지하는 크기 약 ${fmtSize(wasted)}. 파일 크기가 똑같으면 같은 영상으로 봅니다. 남길 영상에서 ‘이것만 남기기’를 누르면 나머지는 숨기고 태그·출연자 등 정보는 합쳐집니다. 숨긴 영상은 설정 → 숨긴 영상에서 되돌릴 수 있습니다.`)
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
  if (st.mega_supported) document.getElementById("tab-mega").hidden = false;
  if (st.photos) document.getElementById("tab-photos").hidden = false;
  if (st.eh) document.getElementById("tab-comics").hidden = false;
}).catch(() => {});
