/* VidShelf front-end (vanilla JS, no build step) */
"use strict";

const $app = document.getElementById("app");
let serverCaps = {};   // 서버가 지원하는 기능 (안드로이드 앱: MEGA, 출연자 프로필 등)

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
async function route() {
  const { path, params } = parseHash();
  stopPlayer();
  window.scrollTo(0, 0);
  try {
    let m;
    if (path === "/" || path === "") return await renderLibrary(params);
    if ((m = path.match(/^\/v\/(\d+)$/))) return await renderVideo(+m[1], params);
    if (path === "/tags") return await renderEntities("tags", "태그", "tag");
    if (path === "/performers") return await renderEntities("performers", "출연자", "performer");
    if (path === "/performer") return await renderPerformer(+params.get("id"));
    if (path === "/settings") return await renderSettings();
    if (path === "/mega") return await renderMega(params);
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
  setTab("library");
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
    oninput: (e) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => update({ q: e.target.value }), 400); } });
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
  const grid = h("div", { class: "grid" });
  const moreWrap = h("div", { class: "more" });
  $app.replaceChildren(
    h("div", { class: "toolbar" }, search, sortSel, orderBtn, reshuffle),
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
    data.items.forEach((v) => grid.append(videoCard(v)));
    const shown = (page - 1) * data.per + data.items.length;
    moreWrap.replaceChildren(shown < data.total
      ? h("button", { class: "btn", onclick: () => { page++; load(); } }, `더 보기 (${shown}/${data.total})`)
      : "");
  }
  await load();
  search.focus({ preventScroll: true });
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
  setTab("library");
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
    if (!v.duration && mode === "direct" && isFinite(video.duration) && video.duration > 0) {
      v.duration = video.duration; seek.max = Math.floor(v.duration);
      api(`videos/${v.id}/progress`, { method: "POST", body: { pos: 0, duration: v.duration } }).catch(() => {});
    }
  });
  video.addEventListener("play", () => {
    if (!counted) { counted = true; api(`videos/${v.id}/play`, { method: "POST" }).catch(() => {}); }
  });
  video.addEventListener("error", () => {
    if (mode === "direct" && video.error && !canTranscode) {
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
  setMode(mode, startAt, params.get("t") != null);
  const resume = v.resume_pos > 5 && !params.get("t")
    ? h("button", { class: "btn sm", onclick: (e) => { e.target.remove(); seekTo(v.resume_pos); } }, `▶ ${fmtDur(v.resume_pos)}부터 이어보기`)
    : null;

  // --- title / rating / favorite
  const titleIn = h("input", { type: "text", value: v.title, onchange: (e) => save({ title: e.target.value.trim() || v.title }) });
  const stars = h("div", { class: "stars" });
  const drawStars = () => stars.replaceChildren(...[1, 2, 3, 4, 5].map((n) =>
    h("button", { class: n <= v.rating ? "on" : "", title: `${n}점`, onclick: () => save({ rating: v.rating === n ? 0 : n }) }, "★")));
  const favBtn = h("button", { class: "favbtn", onclick: () => save({ favorite: !v.favorite }) });
  const drawFav = () => { favBtn.classList.toggle("on", !!v.favorite); favBtn.textContent = v.favorite ? "♥ 즐겨찾기" : "♡ 즐겨찾기"; };

  async function save(patch) {
    v = Object.assign(v, await api(`videos/${v.id}`, { method: "PATCH", body: patch }));
    drawStars(); drawFav(); drawTags(); drawPerformers();
  }

  // --- tags / performers editor
  function linkEditor(field, all, label, filterKey, prefix) {
    const box = h("div", { class: "chips" });
    const listId = "dl-" + field;
    const input = h("input", { type: "text", list: listId, placeholder: `${label} 추가 (Enter)` });
    const add = () => {
      const names = input.value.split(",").map((s) => s.trim()).filter(Boolean);
      if (!names.length) return;
      input.value = "";
      save({ [field]: v[field].map((t) => t.name).concat(names) });
    };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });
    const draw = () => box.replaceChildren(...(v[field].length ? v[field].map((t) =>
      h("span", { class: "chip" },
        h("a", { href: `#/?${filterKey}=${t.id}` }, prefix + t.name),
        h("button", { title: "제거", onclick: () => save({ [field]: v[field].filter((x) => x.id !== t.id).map((x) => x.name) }) }, "×")))
      : [h("span", { class: "meta" }, "없음")]));
    const panel = h("div", { class: "panel" }, h("h3", {}, label), box,
      h("div", { class: "taginput" }, input, h("button", { class: "btn", onclick: add }, "추가")),
      h("datalist", { id: listId }, all.map((t) => h("option", { value: t.name }))));
    return [panel, draw];
  }
  const [tagPanel, drawTags] = linkEditor("tags", allTags, "태그", "tag", "# ");
  const [perfPanel, drawPerformers] = linkEditor("performers", allPerformers, "출연자", "performer", "");

  // --- markers
  const markerList = h("ul", { class: "markers" });
  const markerTitle = h("input", { type: "text", placeholder: "북마크 이름 (선택)" });
  const drawMarkers = () => markerList.replaceChildren(...(v.markers.length ? v.markers.map((m) =>
    h("li", {},
      h("button", { class: "btn sm t", onclick: () => seekTo(m.seconds) }, fmtDur(m.seconds)),
      h("span", { class: "mt" }, m.title || ""),
      h("button", { class: "btn sm danger", title: "삭제", onclick: async () => {
        await api(`markers/${m.id}`, { method: "DELETE" });
        v.markers = v.markers.filter((x) => x.id !== m.id); drawMarkers();
      } }, "×")))
    : [h("li", { class: "meta" }, "재생 중 원하는 장면에서 ‘현재 위치 추가’를 누르세요.")]));
  const addMarker = async () => {
    v.markers = await api(`videos/${v.id}/markers`, { method: "POST", body: { seconds: currentTime(), title: markerTitle.value.trim() } });
    markerTitle.value = ""; drawMarkers(); toast("북마크를 추가했습니다");
  };

  // --- frames strip (클릭하면 그 지점으로 이동)
  const nFrames = Math.max(0, (v.thumbs || 0) - 1);
  const frames = nFrames ? h("div", { class: "framestrip" }, Array.from({ length: nFrames }, (_, i) => {
    const t = v.duration * ((i + 1 - 0.5) / nFrames);
    return h("img", { src: thumbUrl(v.id, i + 1, v.thumbs), loading: "lazy", title: fmtDur(t), onclick: () => seekTo(t) });
  })) : null;

  // --- details
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
  const deleteFileBtn = h("button", { class: "btn danger sm", onclick: async () => {
    if (!confirm(`파일을 휴대폰에서 완전히 삭제합니다.\n${v.filename}\n\n되돌릴 수 없습니다. 계속할까요?`)) return;
    await api(`videos/${v.id}?file=1`, { method: "DELETE" }); toast("파일을 삭제했습니다"); location.hash = "#/";
  } }, "파일 삭제");
  const regenBtn = h("button", { class: "btn sm", onclick: async () => {
    await api(`videos/${v.id}/thumbs`, { method: "POST" }); toast("미리보기를 다시 만듭니다");
  } }, "미리보기 다시 만들기");

  $app.replaceChildren(h("div", { class: "watch" },
    h("div", {},
      h("div", { class: "player" }, video),
      seekRow,
      h("div", { class: "player-note" }, canTranscode ? modeNote : null, canTranscode ? modeBtn : null, resume),
      h("div", { class: "titlebox" }, titleIn),
      h("div", { class: "actions" }, stars, favBtn,
        v.source === "mega" ? h("a", { class: "btn sm", href: `/media/${v.id}?dl=1` }, "휴대폰에 저장")
          : v.can_delete === false ? null : h("a", { class: "btn sm", href: `/media/${v.id}`, download: v.filename }, "다운로드")),
      frames ? h("div", { class: "panel", style: "margin-top:14px" }, h("h3", {}, "장면"), frames) : null),
    h("div", {},
      tagPanel, perfPanel,
      h("div", { class: "panel" }, h("h3", {}, "북마크"), markerList,
        h("div", { class: "taginput" }, markerTitle, h("button", { class: "btn", onclick: addMarker }, "현재 위치 추가"))),
      h("div", { class: "panel" }, h("h3", {}, "메모"), details),
      h("div", { class: "panel" }, h("h3", {}, "파일 정보"), info,
        h("div", { class: "row", style: "margin-top:12px" }, regenBtn, removeBtn, v.can_delete === false ? null : deleteFileBtn)))));
  drawStars(); drawFav(); drawTags(); drawPerformers(); drawMarkers();
}

// ---------------------------------------------------------------- tags / performers
async function renderEntities(ep, label, filterKey) {
  setTab(ep);
  const items = await api(ep);
  let filter = "";
  const grid = h("div", { class: "egrid" });
  const draw = () => {
    const list = items.filter((e) => e.name.toLowerCase().includes(filter.toLowerCase()));
    grid.replaceChildren(...list.map((e) => h("div", { class: "ecard" },
      h("a", { href: `#/?${filterKey}=${e.id}` },
        h("div", { class: "thumb" }, e.cover ? h("img", { src: thumbUrl(e.cover, 0, "c"), loading: "lazy", alt: "" }) : h("div", { class: "noimg" }, filterKey === "tag" ? "#" : "👤"))),
      h("div", { class: "body" },
        h("a", { class: "name", href: `#/?${filterKey}=${e.id}`, title: e.name }, e.name),
        h("span", { class: "meta" }, `${e.count}`),
      ),
      e.group !== undefined ? h("div", { class: "body meta", style: "padding-top:0;display:block" },
        [e.group, e.birthdate ? `${e.birthdate} (${age(e.birthdate)}세)` : "", e.height ? `${e.height}cm` : ""].filter(Boolean).join(" · ") || "정보 없음") : null,
      e.group !== undefined ? h("div", { class: "body", style: "padding-top:0" },
        h("a", { class: "btn sm", href: `#/performer?id=${e.id}` }, "프로필")) : null,
      h("div", { class: "body", style: "padding-top:0" },
        h("button", { class: "btn sm", onclick: async () => {
          const n = prompt(`${label} 이름 변경 (기존 이름과 같게 하면 합쳐집니다)`, e.name);
          if (!n || n === e.name) return;
          await api(`${ep}/${e.id}`, { method: "PATCH", body: { name: n } }); route();
        } }, "이름 변경"),
        h("button", { class: "btn sm danger", onclick: async () => {
          if (!confirm(`'${e.name}' ${label}을(를) 삭제할까요? (영상은 그대로 남습니다)`)) return;
          await api(`${ep}/${e.id}`, { method: "DELETE" }); route();
        } }, "삭제")))));
  };
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
      autoBtn,
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
    st.mega_supported ? megaPanel(st.mega || []) : null,
    h("div", { class: "panel" }, h("h3", {}, "정리"),
      h("p", { class: "meta" }, `찾을 수 없는 파일: ${c.missing || 0}개 (옮겨졌거나 삭제된 파일)`),
      h("button", { class: "btn", disabled: !c.missing, onclick: async () => {
        const r = await api("cleanup", { method: "POST" }); toast(`${r.removed}개를 정리했습니다`); renderSettings();
      } }, "찾을 수 없는 파일 목록에서 지우기")),
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
  const field = (key, label, placeholder, type = "text") => {
    const inp = h("input", { type, id: `pf-${key}`, value: p[key] || "", placeholder });
    return [h("dt", {}, h("label", { for: `pf-${key}` }, label)), h("dd", {}, inp)];
  };
  const form = h("dl", { class: "info", style: "align-items:center;font-size:15px" },
    ...field("group", "그룹", "예: 하츠투하츠"), ...field("real_name", "본명", "예: 홍길동"),
    ...field("birthdate", "생년월일", "", "date"), ...field("height", "키 (cm)", "예: 165", "number"));
  const val = (k) => document.getElementById(`pf-${k}`).value.trim();
  const status = h("p", { class: "meta" },
    p.source ? `출처: ${p.source}` : p.looked_up ? (p.lookup_found ? "" : "인터넷에서 정보를 찾지 못했습니다. 직접 입력해 주세요.") : "아직 인터넷에서 찾아보지 않았습니다.");
  $app.replaceChildren(h("div", { class: "settings" },
    h("div", { class: "panel" },
      h("div", { class: "row", style: "justify-content:space-between" },
        h("h2", { style: "margin:0;font-size:22px" }, p.name),
        h("a", { class: "btn sm", href: `#/?performer=${p.id}` }, "영상 보기")),
      p.birthdate ? h("p", { class: "meta" }, `만 ${age(p.birthdate)}세`) : null),
    h("div", { class: "panel" }, h("h3", {}, "프로필"), form,
      h("div", { class: "row", style: "margin-top:12px" },
        h("button", { class: "btn primary", onclick: async () => {
          await api(`performers/${id}`, { method: "PATCH", body: { info: { group: val("group"), real_name: val("real_name"), birthdate: val("birthdate"), height: val("height") } } });
          toast("저장했습니다"); renderPerformer(id);
        } }, "저장"),
        h("button", { class: "btn", onclick: async (ev) => {
          const b = ev.currentTarget; b.disabled = true; b.textContent = "찾는 중…";
          try {
            const r = await api(`performers/${id}/lookup`, { method: "POST" });
            toast(r.lookup_found ? "인터넷에서 정보를 찾았습니다" : "정보를 찾지 못했습니다");
          } catch (e) { toast(e.message); }
          renderPerformer(id);
        } }, "인터넷에서 다시 찾기")),
      status,
      h("p", { class: "meta" }, "그룹 이름을 정확히 적어 두면 동명이인을 거르는 데 쓰입니다. 인터넷 정보는 틀릴 수 있으니 확인 후 고쳐 주세요."))));
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
function megaPanel(links) {
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
    links.length ? h("button", { class: "btn sm", style: "margin-top:8px", onclick: async (e) => {
      e.currentTarget.disabled = true; await api("mega/refresh", { method: "POST" }); toast("MEGA 목록을 새로 받았습니다"); renderSettings();
    } }, "MEGA 목록 새로고침") : null);
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
}).catch(() => {});
