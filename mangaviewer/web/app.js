/* Manga Viewer 화면 (빌드 과정 없는 순수 JS) */
"use strict";

const $app = document.getElementById("app");
let typingSearch = false;   // 검색어 입력 때문에 화면을 다시 그리는 중인지

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
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || r.statusText);
  return data;
}

function fmtSize(b) {
  if (!b) return "0 MB";
  const u = ["B", "KB", "MB", "GB"]; let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return `${b.toFixed(i > 1 ? 1 : 0)} ${u[i]}`;
}
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2600);
}
function parseHash() {
  const raw = location.hash.slice(1) || "/";
  const [path, qs] = raw.split("?");
  return { path, params: new URLSearchParams(qs || "") };
}
function setTab(name) {
  document.querySelectorAll(".tabs a").forEach((a) => a.classList.toggle("on", a.dataset.tab === name));
}
function keepTypingFocus(input) {   // 검색어를 입력하던 중에만 검색창에 커서를 되돌림
  if (!typingSearch) return;
  typingSearch = false;
  input.focus({ preventScroll: true });
  const n = input.value.length;
  try { input.setSelectionRange(n, n); } catch (e) {}
}
const ICON = {
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
};
function icon(name) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("class", "ico"); s.setAttribute("aria-hidden", "true");
  s.innerHTML = ICON[name];
  return s;
}
function store(key, val) {
  try { if (val === undefined) return localStorage.getItem(key); localStorage.setItem(key, val); } catch (e) { return null; }
}

// ---------------------------------------------------------------- 테마 (시스템 / 라이트 / 다크)
function themePref() { return store("mv-theme") || "system"; }
function systemDark() {
  try { return window.MangaApp ? MangaApp.isSystemDark() : matchMedia("(prefers-color-scheme: dark)").matches; }
  catch (e) { return false; }
}
function applyTheme() {
  const pref = themePref();
  const dark = pref === "dark" || (pref === "system" && systemDark());
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = dark ? "#121316" : "#F4F3EF";
  try { if (window.MangaApp) MangaApp.setDark(dark); } catch (e) {}   // 앱의 상태 표시줄 색도 맞춤
}
function setThemePref(p) { store("mv-theme", p); applyTheme(); }
window.onSystemTheme = () => applyTheme();   // 앱이 휴대폰 다크 모드 변경을 알려 줌
try { matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme); } catch (e) {}
applyTheme();

/** 목록 끝이 화면에 가까워지면 다음 목록을 자동으로 불러옴 */
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

/** 연결 오류 안내. 국내 차단으로 보이면 VPN 안내를 함께 보여 줌. */
function errorBox(msg, retry) {
  const blocked = /차단|VPN|연결 실패|reset|ssl|handshake/i.test(msg || "");
  return h("div", { class: "errbox" },
    h("div", { class: "warn" }, msg || "불러오지 못했습니다"),
    blocked ? h("div", { class: "vpn" },
      h("b", {}, "VPN 을 켜 주세요. "),
      "국내에서는 e-hentai 가 막혀 있습니다. 삼성 ", h("b", {}, "보안 폴더 안에"), " VPN 앱(예: 1.1.1.1)을 설치해 켠 뒤 다시 시도하세요. 일반 공간에서 켠 VPN 은 보안 폴더 앱에 적용되지 않습니다.") : null,
    retry ? h("button", { class: "btn dark", onclick: retry }, "다시 시도") : null);
}

// ---------------------------------------------------------------- 저장 진행 상황 (아래 막대 위)
async function pollStatus() {
  try {
    const s = await api("status");
    const bar = document.getElementById("jobbar");
    bar.hidden = !s.job;
    if (s.job) bar.replaceChildren(h("i", { class: "spin" }), h("span", {}, s.job));
    setTimeout(pollStatus, s.job ? 1500 : 5000);
  } catch (e) {
    setTimeout(pollStatus, 8000);
  }
}

// ---------------------------------------------------------------- router
window.addEventListener("hashchange", route);
function pageIn() {
  if (window.__noPageIn) { window.__noPageIn = false; return; }
  $app.classList.remove("page-in");
  void $app.offsetWidth;
  $app.classList.add("page-in");
}
window.addEventListener("hashchange", () => requestAnimationFrame(pageIn));

async function route() {
  const { path, params } = parseHash();
  window.scrollTo(0, 0);
  try {
    if (path === "/ko" || path === "/" || path === "") return await renderList("ko", params);
    if (path === "/fav") return await renderList("fav", params);
    if (path === "/saved") return await renderSaved();
    if (path === "/settings") return await renderSettings();
    if (path === "/comic") return await renderComic(+params.get("gid"), params.get("t") || "", params);
    location.hash = "#/ko";
  } catch (e) {
    $app.replaceChildren(errorBox("오류: " + e.message, route));
  } finally {
    finishTabSwipe();
  }
}

// ---------------------------------------------------------------- 하단 탭 사이를 좌우로 밀어 이동
const TAB_ORDER = ["ko", "fav", "saved", "settings"];
function currentRootTab() {
  const p = parseHash().path;
  if (p === "/ko" || p === "/" || p === "") return "ko";
  return TAB_ORDER.includes(p.slice(1)) ? p.slice(1) : null;
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
  let sx = 0, sy = 0, t0 = 0, mode = null, from = null, dx = 0;
  const W = () => window.innerWidth;
  const blocked = (tgt) => {
    if (tgt.closest("input, textarea, select, .viewer")) return true;
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
      mode = Math.abs(x) > Math.abs(y) * 1.2 ? "h" : "v";
      if (mode === "v") { from = null; return; }
      $app.style.transition = "none";
    }
    e.preventDefault();
    const i = TAB_ORDER.indexOf(from);
    const edge = (x > 0 && i === 0) || (x < 0 && i === TAB_ORDER.length - 1);
    dx = edge ? x * 0.25 : x;
    $app.style.transform = `translateX(${dx}px)`;
    $app.style.opacity = String(1 - Math.min(0.35, Math.abs(dx) / W() * 0.5));
  }, { passive: false });
  document.addEventListener("touchend", () => {
    if (!from || mode !== "h") { from = null; return; }
    const i = TAB_ORDER.indexOf(from);
    const v = Math.abs(dx) / Math.max(1, Date.now() - t0);
    const dir = dx < 0 ? 1 : -1;
    const target = TAB_ORDER[i + dir];
    from = null;
    $app.style.transition = "transform .22s cubic-bezier(.3,.7,.3,1), opacity .22s ease";
    if (target && (Math.abs(dx) > W() * 0.28 || (v > 0.5 && Math.abs(dx) > 40))) {
      $app.style.transform = `translateX(${-dir * W()}px)`;
      $app.style.opacity = "0";
      tabSwipePending = dir;
      setTimeout(() => { window.__noPageIn = true; location.hash = "#/" + target; }, 200);
    } else {
      $app.style.transform = "";
      $app.style.opacity = "";
      setTimeout(() => { $app.style.transition = ""; }, 240);
    }
  });
})();

// ---------------------------------------------------------------- 만화 카드
/** 표지 주소: 앱을 거쳐 받아서 보관 (차단·오프라인 대비) */
const comicThumb = (u) => !u ? "" : u.startsWith("/") ? u : `/eh/thumb?u=${encodeURIComponent(u)}`;

function comicCard(g, extra) {
  const img = h("img", { src: comicThumb(g.thumb), loading: "lazy", alt: "" });
  img.onerror = () => (img.hidden = true);
  const read = g.read_page > 0 ? Math.min(100, (g.read_page / Math.max(1, g.pages)) * 100) : 0;
  return h("a", { class: "ccard", href: `#/comic?gid=${g.gid}&t=${g.token}` },
    h("div", { class: "cthumb" }, img, g.pages ? h("span", { class: "badge" }, `${g.pages}p`) : null,
      read ? h("div", { class: "progress", style: `width:${read}%` }) : null),
    h("div", { class: "title", title: g.title }, g.title_jpn || g.title),
    h("div", { class: "sub" }, g.category ? h("span", {}, g.category) : null, g.read_page ? h("span", {}, `${g.read_page}쪽까지 읽음`) : null),
    extra || null);
}

function pageHead(title, sub, right) {
  return h("div", { class: "phead" }, h("h1", {}, title), sub ? h("span", { class: "sub" }, sub) : null, right || null);
}

// ---------------------------------------------------------------- e-hentai 로그인
function ehLoginForm() {
  const user = h("input", { type: "text", placeholder: "아이디", autocomplete: "username" });
  const pass = h("input", { type: "password", placeholder: "비밀번호", autocomplete: "current-password" });
  const msg = h("p", { class: "warn" });
  const submit = async (body, btn, m) => {
    btn.disabled = true; m.textContent = "";
    try { await api("eh/login", { method: "POST", body }); toast("로그인했습니다"); route(); }
    catch (e) { m.textContent = e.message; btn.disabled = false; }
  };
  const loginBtn = h("button", { class: "btn dark block", onclick: (e) => submit({ user: user.value, pass: pass.value }, e.currentTarget, msg) }, "로그인");
  const mid = h("input", { type: "text", inputmode: "numeric", placeholder: "ipb_member_id (숫자)" });
  const hash = h("input", { type: "text", placeholder: "ipb_pass_hash (32자리)", autocomplete: "off" });
  const msg2 = h("p", { class: "warn" });
  const cookieBtn = h("button", { class: "btn block", onclick: (e) => submit({ member_id: mid.value, pass_hash: hash.value }, e.currentTarget, msg2) }, "쿠키로 로그인");
  return h("div", { class: "settings" },
    h("div", { class: "panel" }, h("h3", {}, "e-hentai 로그인"),
      h("p", { class: "meta" }, "e-hentai(포럼) 계정으로 로그인하면 내 즐겨찾기를 볼 수 있습니다. 비밀번호는 저장하지 않고 로그인 쿠키만 이 앱 안에 암호화해서 저장합니다."),
      h("div", { style: "margin-top:12px" },
        h("a", { class: "btn primary block", href: "mangaviewer://eh-login" }, "e-hentai 로그인 화면 열기"),
        h("p", { class: "meta" }, "앱 안에 e-hentai 로그인 페이지가 열립니다. 아이디·비밀번호를 넣고 로봇 확인이 나오면 풀어 주세요. 로그인되면 자동으로 돌아옵니다. 연결이 안 되면 보안 폴더 안에서 VPN 을 켜세요."))),
    h("details", { class: "panel" }, h("summary", {}, "다른 방법: 아이디·비밀번호를 여기에 입력"),
      h("div", { style: "display:grid;gap:8px;margin-top:10px" }, user, pass, loginBtn, msg)),
    h("details", { class: "panel" }, h("summary", {}, "다른 방법: 쿠키 값 직접 입력 (PC 필요)"),
      h("p", { class: "meta" }, "PC 브라우저에서 e-hentai 에 로그인한 뒤, 개발자 도구(F12) → Application(저장소) → Cookies → e-hentai.org 에서 ipb_member_id 와 ipb_pass_hash 값을 복사해 넣으세요."),
      h("div", { style: "display:grid;gap:8px;margin-top:10px" }, mid, hash, cookieBtn, msg2)));
}

// ---------------------------------------------------------------- 한국어 / 즐겨찾기 목록
/** 즐겨찾기 폴더 이름 (정보 화면의 폴더 고르기에 씀) */
function folderNames() {
  try { return JSON.parse(store("mv-folders") || "{}"); } catch (e) { return {}; }
}

async function renderList(tab, params) {
  setTab(tab);
  const st = await api("eh/status");
  const isFav = tab === "fav";
  if (isFav && !st.logged_in) {
    $app.replaceChildren(h("div", {}, pageHead("즐겨찾기"), ehLoginForm()));
    return;
  }
  const favcat = params.get("favcat") || "all", q = params.get("q") || "";
  const update = (ch) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(ch)) (v == null || v === "") ? p.delete(k) : p.set(k, v);
    location.hash = "#/" + tab + (p.toString() ? "?" + p : "");
  };
  let t;
  const search = h("input", { type: "search", class: "search", value: q, enterkeyhint: "search",
    placeholder: isFav ? "즐겨찾기에서 검색 (제목, 태그)" : "한국어 만화 검색 (제목, 태그, 작가)",
    oninput: (e) => { clearTimeout(t); t = setTimeout(() => { typingSearch = true; update({ q: e.target.value }); }, 700); },
    onkeydown: (e) => { if (e.key === "Enter") { clearTimeout(t); e.target.blur(); update({ q: e.target.value }); } } });
  const folderChips = h("div", { class: "chips scroll" });
  const recent = h("div");
  const grid = h("div", { class: "cgrid" });
  const more = h("div");
  const status = h("div");
  $app.replaceChildren(h("div", {},
    pageHead(isFav ? "즐겨찾기" : "한국어", isFav ? "" : "e-hentai 한국어 만화"),
    h("div", { class: "toolbar" }, search),
    isFav ? folderChips : null,
    !isFav && !q ? recent : null,
    q ? h("p", { class: "meta", style: "margin:-4px 0 10px" }, `‘${q}’ 검색 결과`) : null,
    status, grid, more));
  keepTypingFocus(search);

  if (!isFav && !q) {   // 이어 읽기: 최근 읽은 만화
    api("eh/recent").then((d) => {
      if (!d.items.length) return;
      recent.replaceChildren(h("section", { class: "shelf" }, h("h2", {}, "이어 읽기"),
        h("div", { class: "shelf-row" }, d.items.map((g) => comicCard(g)))));
    }).catch(() => {});
  }

  let next = null, first = true;
  async function load() {
    const qs = new URLSearchParams();
    if (isFav) qs.set("favcat", favcat);
    if (q) qs.set("q", q);
    if (next) qs.set("next", next);
    if (first) more.replaceChildren(h("div", { class: "auto-more" }, h("i", { class: "spin" })));
    let d;
    try { d = await api((isFav ? "eh/favorites?" : "eh/search?") + qs); }
    catch (e) {
      const box = errorBox(e.message, () => { box.remove(); load(); });
      if (first) { more.replaceChildren(); status.replaceChildren(box); } else more.replaceChildren(box);
      return;
    }
    if (isFav && d.logged_in === false) {
      $app.replaceChildren(h("div", {}, pageHead("즐겨찾기"), h("p", { class: "warn" }, "로그인이 풀렸습니다. 다시 로그인하세요."), ehLoginForm()));
      return;
    }
    if (first) {
      first = false;
      if (isFav) {
        const names = {};
        d.folders.forEach((f) => (names[f.cat] = f.name));
        store("mv-folders", JSON.stringify(names));
        const total = d.folders.reduce((n, f) => n + f.count, 0);
        folderChips.replaceChildren(
          h("button", { class: "chip" + (favcat === "all" ? " on" : ""), onclick: () => update({ favcat: null }) }, `전체${total ? " " + total : ""}`),
          ...d.folders.filter((f) => f.count > 0 || f.cat === favcat).map((f) =>
            h("button", { class: "chip" + (favcat === f.cat ? " on" : ""), onclick: () => update({ favcat: f.cat }) }, `${f.name} ${f.count}`)));
      }
      if (!d.items.length) {
        grid.replaceWith(h("div", { class: "empty" }, q ? "검색 결과가 없습니다." : isFav ? "즐겨찾기한 만화가 없습니다." : "만화를 찾지 못했습니다."));
        more.replaceChildren(); return;
      }
    }
    d.items.forEach((g) => grid.append(comicCard(g)));
    next = d.next;
    if (next) autoMore(more, load); else more.replaceChildren(h("p", { class: "meta", style: "text-align:center;margin:24px 0" }, "목록의 끝입니다"));
  }
  await load();
}

// ---------------------------------------------------------------- 저장 (기기에 저장한 만화)
async function renderSaved() {
  setTab("saved");
  const d = await api("eh/saved");
  const grid = h("div", { class: "cgrid" });
  for (const g of d.items) {
    const status = g.done ? h("div", { class: "meta" }, `저장됨 · ${g.pages}쪽`)
      : g.error ? h("div", { class: "warn" }, `멈춤 ${g.saved_pages}/${g.pages}: ${g.error}`)
      : h("div", { class: "meta" }, `받는 중 ${g.saved_pages}/${g.pages}`);
    const btns = h("div", { class: "row" },
      !g.done ? h("button", { class: "btn sm", onclick: async (e) => { e.preventDefault(); await api("eh/save", { method: "POST", body: g }); toast("이어서 받습니다"); route(); } }, "이어 받기") : null,
      h("button", { class: "btn sm danger", onclick: async (e) => {
        e.preventDefault();
        if (!confirm(`‘${g.title}’ 저장본을 지울까요?`)) return;
        await api("eh/unsave", { method: "POST", body: { gid: g.gid } }); route();
      } }, "삭제"));
    grid.append(h("div", { class: "saved-item" }, comicCard(g, status), btns));
  }
  $app.replaceChildren(h("div", {},
    pageHead("저장", d.items.length ? `${d.items.length}권` : ""),
    h("p", { class: "meta", style: "margin:-6px 0 14px" }, "휴대폰에 저장한 만화는 인터넷이나 VPN 없이 볼 수 있습니다. 만화 정보 화면의 ‘휴대폰에 저장’으로 추가하세요."),
    d.items.length ? grid : h("div", { class: "empty" }, "저장한 만화가 없습니다.")));
}

// ---------------------------------------------------------------- 설정
function themePanel() {
  const seg = h("div", { class: "theme-seg", role: "group", "aria-label": "화면 테마" });
  const draw = () => seg.replaceChildren(...[["system", "시스템 설정"], ["light", "라이트"], ["dark", "다크"]].map(([v, l]) =>
    h("button", { class: themePref() === v ? "on" : "", "aria-pressed": themePref() === v ? "true" : "false", onclick: () => { setThemePref(v); draw(); } }, l)));
  draw();
  return h("div", { class: "panel" }, h("h3", {}, "화면 테마"), seg,
    h("p", { class: "meta" }, "‘시스템 설정’을 고르면 휴대폰의 다크 모드를 켜고 끌 때 함께 바뀝니다."));
}

async function renderSettings() {
  setTab("settings");
  const st = await api("eh/status");
  const account = st.logged_in
    ? h("div", { class: "panel" }, h("h3", {}, "e-hentai 계정"),
        h("p", {}, "로그인되어 있습니다."),
        h("div", { class: "row", style: "margin-top:12px" },
          h("button", { class: "btn danger", onclick: async () => {
            if (!confirm("e-hentai 에서 로그아웃할까요? (이 앱에 저장한 로그인 쿠키를 지웁니다)")) return;
            await api("eh/logout", { method: "POST" }); toast("로그아웃했습니다"); route();
          } }, "로그아웃")))
    : null;
  const usage = h("dl", { class: "stats" }, h("dt", {}, "불러오는 중…"));
  const drawUsage = (u) => usage.replaceChildren(
    h("dt", {}, "읽은 페이지 보관"), h("dd", {}, `${fmtSize(u.cache)} / 한도 ${fmtSize(u.limit)}`),
    h("dt", {}, "표지 보관"), h("dd", {}, fmtSize(u.thumbs)),
    h("dt", {}, "휴대폰에 저장한 만화"), h("dd", {}, fmtSize(u.saved)));
  api("cache").then(drawUsage).catch((e) => usage.replaceChildren(h("dt", { class: "warn" }, e.message)));
  const storage = h("div", { class: "panel" }, h("h3", {}, "저장 공간"), usage,
    h("p", { class: "meta" }, "한 번 본 페이지는 다시 받지 않도록 휴대폰에 보관합니다. 한도를 넘으면 오래 안 본 것부터 저절로 지웁니다."),
    h("div", { class: "row", style: "margin-top:12px" },
      h("button", { class: "btn", onclick: async (e) => {
        if (!confirm("보관한 페이지와 표지를 지울까요? (‘저장’ 탭의 만화는 지우지 않습니다)")) return;
        e.currentTarget.disabled = true;
        try { drawUsage(await api("cache/clear", { method: "POST" })); try { if (window.MangaApp) MangaApp.clearWebCache(); } catch (x) {} toast("보관 이미지를 지웠습니다"); }
        catch (x) { toast(x.message); }
        e.currentTarget.disabled = false;
      } }, "보관 이미지 지우기")));
  const vpn = h("div", { class: "panel" }, h("h3", {}, "연결이 안 될 때"),
    h("p", {}, "국내에서는 e-hentai 접속이 막혀 있습니다. 삼성 ", h("b", {}, "보안 폴더 안에"), " VPN 앱(예: 1.1.1.1)을 설치해 켠 뒤 다시 시도하세요."),
    h("p", { class: "meta" }, "일반 공간에서 켠 VPN 은 보안 폴더 안의 앱에 적용되지 않습니다. ‘저장’ 탭의 만화는 VPN 없이도 볼 수 있습니다."));
  $app.replaceChildren(h("div", { class: "settings" },
    pageHead("설정"),
    themePanel(),
    account || h("div", {}, ehLoginForm()),
    storage, vpn,
    h("p", { class: "meta", style: "text-align:center;margin-top:20px" }, "Manga Viewer 1.1")));
}

// ---------------------------------------------------------------- 만화 정보
const NS = { language: "언어", parody: "패러디", character: "캐릭터", group: "그룹", artist: "작가", cosplayer: "코스플레이어", male: "남성", female: "여성", mixed: "혼합", other: "기타", misc: "기타", reclass: "분류", location: "장소", temp: "임시" };
const NS_ORDER = ["artist", "group", "parody", "character", "female", "male", "mixed", "cosplayer", "location", "other", "misc", "reclass", "temp", "language"];
const ACT_ICON = {
  heart: '<path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 7.9 3.6 4.5 7 4.5c2 0 3.4 1.1 5 3 1.6-1.9 3-3 5-3 3.4 0 5.6 3.4 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z"/>',
  save: '<path d="M12 3.5v11"/><path d="M7.5 10l4.5 4.5 4.5-4.5"/><path d="M4.5 15.5v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3"/>',
  chat: '<path d="M4 5.5h16v11H9l-5 4z"/>',
};
function actIcon(name, filled) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("class", "ico" + (filled ? " filled" : "")); s.setAttribute("aria-hidden", "true");
  s.innerHTML = ACT_ICON[name];
  return s;
}

/** 아래에서 올라오는 선택 창. 뒤로 가기로도 닫힘. */
function openSheet(title, body) {
  let closed = false;
  const close = (fromPop) => {
    if (closed) return;
    closed = true;
    window.removeEventListener("popstate", onPop);
    wrap.classList.add("out");
    setTimeout(() => wrap.remove(), 220);
    if (!fromPop) history.back();
  };
  const onPop = () => close(true);
  const wrap = h("div", { class: "sheet-wrap", onclick: (e) => { if (e.target === wrap) close(); } },
    h("div", { class: "sheet", role: "dialog", "aria-modal": "true" },
      h("div", { class: "sheet-grip" }), h("h3", {}, title), body));
  document.body.append(wrap);
  history.pushState({ sheet: true }, "");
  window.addEventListener("popstate", onPop);
  return () => close();
}

/** e-hentai 날짜(“22 November 2026, 10:00”)를 한국어로 */
function fmtPosted(s) {
  const d = new Date(String(s).replace(",", "") + " UTC");
  return isNaN(d) ? s : d.toLocaleString("ko-KR", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** 미리보기 한 칸. 작은 그림은 여러 장이 붙은 그림에서 잘라서 보여 줌. */
function previewCell(it, onOpen) {
  const cell = h("button", { class: "pv", "aria-label": `${it.n}쪽부터 읽기`, onclick: () => onOpen(it.n) });
  if (it.full) {
    const img = h("img", { src: comicThumb(it.url), loading: "lazy", alt: "" });
    cell.append(img);
  } else {
    const inner = h("div", { class: "pv-in" });
    inner.style.cssText = `width:${it.w}px;height:${it.h}px;background-image:url("${comicThumb(it.url)}");background-position:${it.x}px ${it.y}px`;
    cell.dataset.w = it.w; cell.dataset.h = it.h;
    cell.append(inner);
  }
  cell.append(h("span", { class: "pv-n" }, it.n));
  return cell;
}
function layoutPreviews(root) {
  root.querySelectorAll(".pv[data-w]").forEach((c) => {
    const cw = c.clientWidth, ch = c.clientHeight, w = +c.dataset.w, hh = +c.dataset.h;
    if (!cw || !w) return;
    const s = Math.min(cw / w, ch / hh);
    c.firstChild.style.transform = `translate(${(cw - w * s) / 2}px, ${(ch - hh * s) / 2}px) scale(${s})`;
  });
}
window.addEventListener("resize", () => layoutPreviews(document));

function commentView(c) {
  const sc = parseInt(c.score, 10);
  return h("div", { class: "cmt" + (c.uploader ? " up" : "") },
    h("div", { class: "cmt-head" },
      h("b", {}, c.name || "알 수 없음"),
      c.uploader ? h("span", { class: "cmt-tag" }, "올린 사람") : null,
      h("span", { class: "meta" }, fmtPosted(c.posted)),
      c.score ? h("span", { class: "cmt-score" + (sc > 0 ? " pos" : sc < 0 ? " neg" : "") }, c.score) : null),
    h("div", { class: "cmt-text" }, c.text));
}

async function renderComic(gid, token, params) {
  let g, offline = false;
  try { g = await api(`eh/gallery?gid=${gid}&t=${token}`); }
  catch (e) {   // 연결이 안 되어도 저장한 만화면 정보 없이 바로 읽을 수 있게
    const s = (await api("eh/saved").catch(() => ({ items: [] }))).items.find((x) => x.gid === gid);
    if (!s) throw e;
    g = Object.assign({ tags: [], rating: "", posted: "" }, s);
    offline = true;
  }
  if (g.logged_in === false) { location.hash = "#/fav"; return; }
  let startAt = Math.min(Math.max(1, g.read_page || 1), g.pages);
  const read = (n) => openReader(g, n, (last) => {   // 다 읽고 닫으면 화면은 그대로, 읽기 버튼만 새로
    g.read_page = last;
    startAt = Math.min(Math.max(1, last), g.pages);
    drawReadRow();
  });

  // ---- 위쪽: 표지와 제목
  const cover = h("img", { src: comicThumb(g.thumb), alt: "" });
  cover.onerror = () => (cover.hidden = true);
  const title = h("h1", { class: "comic-title", onclick: () => title.classList.toggle("open") }, g.title_jpn || g.title);
  const facts = [g.category, `${g.pages}쪽`, g.rating ? `★ ${(+g.rating).toFixed(1)}` : "", g.posted ? new Date(g.posted * 1000).toLocaleDateString("ko-KR") : ""].filter(Boolean);
  const hero = h("div", { class: "hero" },
    h("div", { class: "comic-cover", onclick: () => read(startAt) }, cover),
    h("div", { class: "hero-main" },
      title,
      g.title_jpn && g.title !== g.title_jpn ? h("p", { class: "orig" }, g.title) : null,
      h("div", { class: "facts" }, facts.map((f) => h("span", {}, f))),
      g.uploader ? h("p", { class: "meta", style: "margin:4px 0 0" }, `올린 사람 ${g.uploader}`) : null));

  // ---- 읽기 버튼
  const readRow = h("div", { class: "read-row" });
  const drawReadRow = () => readRow.replaceChildren(...[
    h("button", { class: "btn primary read-main", onclick: () => read(startAt) }, g.read_page > 1 ? `이어 읽기 · ${startAt}쪽` : "읽기"),
    g.read_page > 1 ? h("button", { class: "btn", onclick: () => read(1) }, "처음부터") : null].filter(Boolean));
  drawReadRow();

  // ---- 즐겨찾기 · 저장 · 댓글 버튼
  const favAct = h("button", { class: "act", disabled: true }, actIcon("heart"), h("b", {}, "즐겨찾기"), h("small", {}, "…"));
  const saveAct = h("button", { class: "act" }, actIcon("save"), h("b", {}, "휴대폰에 저장"), h("small", {}, "…"));
  const cmtAct = h("button", { class: "act", onclick: () => cmtSec.scrollIntoView({ behavior: "smooth", block: "start" }) }, actIcon("chat"), h("b", {}, "댓글"), h("small", {}, "…"));
  const setAct = (btn, sub, on) => { btn.lastChild.textContent = sub; btn.classList.toggle("on", !!on); btn.querySelector(".ico").classList.toggle("filled", !!on); };

  let fav = null;
  const drawFav = (f) => {
    fav = f;
    if (!f || f.logged_in === false) { favAct.disabled = false; setAct(favAct, "로그인 필요", false); return; }
    favAct.disabled = false;
    setAct(favAct, f.favcat >= 0 ? (f.name || `폴더 ${f.favcat}`) : "추가하기", f.favcat >= 0);
  };
  favAct.onclick = () => {
    if (!fav || fav.logged_in === false) { location.hash = "#/settings"; toast("설정에서 e-hentai 에 로그인하세요"); return; }
    const names = folderNames();
    let closeSheet;
    const setFav = async (cat, btn) => {
      btn.disabled = true;
      try {
        const f = await api("eh/fav", { method: "POST", body: { gid: g.gid, t: g.token, favcat: cat } });
        drawFav(Object.assign({ logged_in: true }, f));
        toast(cat < 0 ? "즐겨찾기에서 뺐습니다" : `‘${f.name || names[cat] || "폴더 " + cat}’에 넣었습니다`);
        closeSheet();
      } catch (e) { toast(e.message); btn.disabled = false; }
    };
    const list = h("div", { class: "sheet-list" }, Array.from({ length: 10 }, (_, i) =>
      h("button", { class: "sheet-item" + (fav.favcat === i ? " on" : ""), onclick: (e) => setFav(i, e.currentTarget) },
        h("span", { class: "dot c" + i }), h("span", { class: "grow" }, names[i] || `폴더 ${i}`), fav.favcat === i ? h("span", { class: "meta" }, "지금 여기") : null)));
    closeSheet = openSheet(fav.favcat >= 0 ? "다른 폴더로 옮기기" : "즐겨찾기 폴더 고르기", h("div", {}, list,
      fav.favcat >= 0 ? h("button", { class: "btn danger block", style: "margin-top:10px", onclick: (e) => setFav(-1, e.currentTarget) }, "즐겨찾기에서 빼기") : null));
  };

  const drawSave = async () => {
    const d = await api("eh/saved").catch(() => ({ items: [] }));
    const s = d.items.find((x) => x.gid === g.gid);
    setAct(saveAct, !s ? "저장하기" : s.done ? "저장됨" : s.error ? `멈춤 ${s.saved_pages}/${s.pages}` : `받는 중 ${s.saved_pages}/${s.pages}`, !!s);
    saveAct.onclick = s ? () => (location.hash = "#/saved") : async () => {
      saveAct.disabled = true;
      try {
        await api("eh/save", { method: "POST", body: { gid: g.gid, token: g.token, title: g.title_jpn || g.title, thumb: g.thumb, pages: g.pages, category: g.category } });
        toast("휴대폰에 저장을 시작했습니다. 아래 막대에 진행 상황이 나옵니다.");
      } catch (e) { toast(e.message); }
      saveAct.disabled = false;
      drawSave();
    };
  };
  drawSave();

  // ---- 미리보기
  const pvGrid = h("div", { class: "pv-grid" });
  const pvMore = h("div");
  const pvSec = h("section", { class: "csec" }, h("h2", {}, "미리보기"), pvGrid, pvMore);
  let pvPage = 0, perPage = 0;
  const addPreviews = (items) => {
    items.forEach((it) => pvGrid.append(previewCell(it, read)));
    requestAnimationFrame(() => layoutPreviews(pvGrid));
    const pagesOfPv = perPage ? Math.ceil(g.pages / perPage) : 1;
    pvMore.replaceChildren(...[pvPage + 1 < pagesOfPv ? h("button", { class: "btn block", onclick: async (e) => {
      e.currentTarget.disabled = true; e.currentTarget.textContent = "불러오는 중…";
      try { pvPage++; const d = await api(`eh/previews?gid=${g.gid}&t=${g.token}&p=${pvPage}`); addPreviews(d.items); }
      catch (x) { pvPage--; pvMore.replaceChildren(errorBox(x.message, () => addPreviews([]))); }
    } }, "미리보기 더 보기") : null].filter(Boolean));
  };

  // ---- 태그
  const groups = {};
  for (const tag of g.tags || []) {
    const [ns, name] = tag.includes(":") ? tag.split(/:(.*)/s) : ["misc", tag];
    (groups[ns] = groups[ns] || []).push(name);
  }
  const nsList = Object.keys(groups).sort((a, b) => (NS_ORDER.indexOf(a) + 99) % 99 - (NS_ORDER.indexOf(b) + 99) % 99);
  const tagSec = nsList.length ? h("section", { class: "csec" }, h("h2", {}, "태그"),
    h("div", { class: "tag-groups" }, nsList.map((ns) => h("div", { class: "tag-group" },
      h("span", { class: "tag-ns" }, NS[ns] || ns),
      h("div", { class: "chips" }, groups[ns].map((n) => h("a", { class: "chip", href: `#/ko?q=${encodeURIComponent(`${ns}:"${n}$"`)}` }, n))))))) : null;

  // ---- 댓글
  const cmtList = h("div", { class: "cmt-list" });
  const cmtWrite = h("div");
  const cmtTitle = h("h2", {}, "댓글");
  const cmtSec = h("section", { class: "csec" }, cmtTitle, cmtList, cmtWrite);
  const SHOW = 4;
  const drawComments = (list, all) => {
    cmtTitle.textContent = list.length ? `댓글 ${list.length}` : "댓글";
    setAct(cmtAct, list.length ? `${list.length}개` : "쓰기", false);
    if (!list.length) { cmtList.replaceChildren(h("p", { class: "meta" }, "아직 댓글이 없습니다.")); return; }
    const shown = all ? list : list.slice(0, SHOW);
    cmtList.replaceChildren(...shown.map(commentView),
      ...(!all && list.length > SHOW ? [h("button", { class: "btn block", onclick: () => drawComments(list, true) }, `댓글 ${list.length}개 모두 보기`)] : []));
  };
  const drawWrite = (loggedIn) => {
    if (!loggedIn) {
      cmtWrite.replaceChildren(h("p", { class: "meta" }, "댓글을 쓰려면 ", h("a", { href: "#/settings", style: "text-decoration:underline" }, "설정에서 로그인"), "하세요."));
      return;
    }
    const ta = h("textarea", { rows: 3, placeholder: "댓글 쓰기 (10글자 이상)", maxlength: 1000 });
    const msg = h("p", { class: "warn" });
    const send = h("button", { class: "btn dark", onclick: async () => {
      const text = ta.value.trim();
      if (text.length < 10) { msg.textContent = "댓글은 10글자 이상이어야 합니다"; return; }
      send.disabled = true; msg.textContent = "";
      try {
        const d = await api("eh/comment", { method: "POST", body: { gid: g.gid, t: g.token, text } });
        const mine = d.comments.some((c) => c.text.replace(/\s+/g, " ").includes(text.replace(/\s+/g, " ").slice(0, 20)));
        drawComments(d.comments, true);
        if (mine) { ta.value = ""; toast("댓글을 등록했습니다"); }
        else msg.textContent = "댓글이 목록에 보이지 않습니다. e-hentai 가 거절했을 수 있습니다 (새 계정·하루 제한 등).";
      } catch (e) { msg.textContent = e.message; }
      send.disabled = false;
    } }, "등록");
    cmtWrite.replaceChildren(h("div", { class: "cmt-write" }, ta, h("div", { class: "row", style: "justify-content:space-between" }, h("span", { class: "meta" }, "e-hentai 에 내 이름으로 올라갑니다"), send)), msg);
  };

  $app.replaceChildren(h("div", { class: "comic" },
    h("button", { class: "backbtn", onclick: () => (history.length > 1 ? history.back() : (location.hash = "#/ko")) }, icon("back"), "뒤로"),
    hero, readRow,
    h("div", { class: "acts" }, favAct, saveAct, cmtAct),
    pvSec, tagSec, cmtSec));

  // 미리보기·댓글·즐겨찾기 상태는 갤러리 화면 한 번으로 받음
  const loadDetails = async () => {
    pvGrid.replaceChildren(...Array.from({ length: 8 }, () => h("div", { class: "pv skel" })));
    cmtList.replaceChildren(h("p", { class: "meta" }, "불러오는 중…"));
    try {
      const d = await api(`eh/details?gid=${g.gid}&t=${g.token}`);
      perPage = d.per_page; pvGrid.replaceChildren();
      if (d.items.length) addPreviews(d.items); else pvGrid.replaceWith(h("p", { class: "meta" }, "미리보기가 없습니다."));
      drawComments(d.comments, false);
      drawFav(d.logged_in ? Object.assign({ logged_in: true }, d.fav) : { logged_in: false });
      drawWrite(d.logged_in);
    } catch (e) {
      pvGrid.replaceChildren();
      pvMore.replaceChildren(errorBox((offline ? "연결이 안 되어 저장한 정보로 보여 줍니다. " : "") + e.message, loadDetails));
      cmtList.replaceChildren(h("p", { class: "meta" }, "댓글을 불러오지 못했습니다."));
      setAct(cmtAct, "-", false);
      drawFav(null); favAct.disabled = true; setAct(favAct, "-", false);
    }
  };
  loadDetails();
  if (params.get("read")) read(+params.get("read") || startAt);
}

// ---------------------------------------------------------------- 만화 보기
/** 세로 스크롤 또는 한 장씩 넘기기. 화면 근처 페이지만 받고, 읽은 위치를 기억. */
function openReader(g, start, onClose) {
  let closed = false, current = start, saveTimer;
  let mode = store("mv-reader-mode") || "scroll";
  const counter = h("span", { class: "count" });
  const pageUrl = (n) => `/eh/page/${g.gid}/${g.token}/${n}`;
  const progressBody = () => ({ gid: g.gid, page: current, token: g.token, title: g.title_jpn || g.title, thumb: g.thumb, pages: g.pages });
  const drawCounter = () => (counter.textContent = `${current} / ${g.pages}`);
  const saveProgress = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => api("eh/progress", { method: "POST", body: progressBody() }).catch(() => {}), 800);
  };
  const setCurrent = (n) => { current = n; drawCounter(); saveProgress(); };

  /** 실패한 페이지: 이유를 앱에 다시 물어서 빨간 글씨로 표시 */
  const failView = (n, src, retry) => {
    const why = h("p", { class: "rerr" });
    fetch(src).then((r) => r.json().then((d) => d.error, () => (r.ok ? "이미지를 표시하지 못했습니다" : `HTTP ${r.status}`)))
      .then((t) => (why.textContent = t || "")).catch(() => (why.textContent = "앱에 연결하지 못했습니다"));
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
  single.addEventListener("touchend", (e) => {   // 좌우로 밀어 넘기기
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
    modeBtn.textContent = mode === "scroll" ? "한 장씩" : "스크롤";
    el.classList.toggle("paged", mode === "page");
    if (mode === "page") { scrollView.hidden = true; single.hidden = false; showSingle(current); }
    else { single.hidden = true; scrollView.hidden = false; requestAnimationFrame(() => pages[current - 1] && pages[current - 1].scrollIntoView()); }
  };
  modeBtn.onclick = () => { mode = mode === "scroll" ? "page" : "scroll"; store("mv-reader-mode", mode); applyMode(); };

  const close = () => {
    if (closed) return;
    closed = true; near.disconnect(); mid.disconnect(); el.remove(); document.body.style.overflow = "";
    window.removeEventListener("popstate", onPop); document.removeEventListener("keydown", onKey);
    api("eh/progress", { method: "POST", body: progressBody() }).catch(() => {}).then(() => (onClose ? onClose(current) : route()));
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

// ---------------------------------------------------------------- 시작
if (!location.hash) history.replaceState(null, "", "#/ko");
route();
pollStatus();
