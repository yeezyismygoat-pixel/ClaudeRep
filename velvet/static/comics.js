/* Velvet — 만화 탭 (e-hentai 한국어·즐겨찾기·저장, 만화 정보, 만화 보기)
   app.js 의 h · ico · icon · api · toast · openSheet · autoMore · setTab · route · slideTo 를 씁니다.
   app.js 보다 먼저 불러오고, 여기서는 함수만 정의합니다. */
"use strict";

const CX_SEGS = [["ko", "한국어"], ["fav", "즐겨찾기"], ["saved", "저장"]];
const cxThumb = (u) => !u ? "" : u.startsWith("/") ? u : `/eh/thumb?u=${encodeURIComponent(u)}`;
function cxStore(key, val) {
  try { if (val === undefined) return localStorage.getItem(key); localStorage.setItem(key, val); } catch (e) { return null; }
}
/** 즐겨찾기 폴더 이름 (정보 화면의 폴더 고르기에 씀) */
function cxFolderNames() {
  try { return JSON.parse(cxStore("vv-eh-folders") || "{}"); } catch (e) { return {}; }
}

/** 로그인되면 앱이 부름: 즐겨찾기로 */
window.onEhLogin = () => {
  const to = "#/comics?tab=fav";
  if (location.hash === to) route(); else location.hash = to;
};

// ---------------------------------------------------------------- 조각
function cxCard(g, extra) {
  const img = h("img", { src: cxThumb(g.thumb), loading: "lazy", alt: "" });
  img.onerror = () => (img.hidden = true);
  const pct = g.read_page > 0 ? Math.min(100, (g.read_page / Math.max(1, g.pages)) * 100) : 0;
  return h("a", { class: "cx-card", href: `#/comic?gid=${g.gid}&t=${g.token}` },
    h("div", { class: "cx-cover" }, img,
      g.pages ? h("span", { class: "cx-badge" }, `${g.pages}쪽`) : null,
      pct ? h("i", { class: "cx-prog", style: `width:${pct}%` }) : null),
    h("div", { class: "cx-title", title: g.title }, g.title_jpn || g.title),
    h("div", { class: "cx-sub" + (g.read_page ? " gold" : "") }, g.read_page ? `${g.read_page} / ${g.pages}쪽 읽음` : (g.category || "")),
    extra || null);
}

function cxHead(title, sub, right) {
  return h("div", { class: "home-head cx-head" }, h("div", {}, sub ? h("div", { class: "meta" }, sub) : null, h("h1", {}, title)), right || null);
}

/** 연결 오류 안내. 국내 차단으로 보이면 VPN 안내를 함께. */
function cxError(msg, retry) {
  const blocked = /차단|VPN|연결 실패|reset|ssl|handshake|timed? ?out|resolve|unreachable/i.test(msg || "");
  return h("div", { class: "cx-err" },
    h("p", { class: "cx-err-msg" }, msg || "불러오지 못했습니다"),
    blocked ? h("div", { class: "cx-vpn" },
      h("b", {}, "VPN 을 켜 주세요. "),
      "국내에서는 e-hentai 가 막혀 있습니다. 삼성 ", h("b", {}, "보안 폴더 안에"), " VPN 앱(예: 1.1.1.1)을 설치해 켠 뒤 다시 시도하세요. 일반 공간에서 켠 VPN 은 보안 폴더 앱에 적용되지 않습니다.") : null,
    retry ? h("button", { class: "btn primary", onclick: retry }, "다시 시도") : null);
}

function cxLoginPanel() {
  const user = h("input", { type: "text", placeholder: "아이디", autocomplete: "username" });
  const pass = h("input", { type: "password", placeholder: "비밀번호", autocomplete: "current-password" });
  const msg = h("p", { class: "cx-warn" });
  const submit = async (body, btn, m) => {
    btn.disabled = true; m.textContent = "";
    try { await api("eh/login", { method: "POST", body }); toast("e-hentai 에 로그인했습니다"); route(); }
    catch (e) { m.textContent = e.message; btn.disabled = false; }
  };
  const loginBtn = h("button", { class: "btn primary", onclick: (e) => submit({ user: user.value, pass: pass.value }, e.currentTarget, msg) }, "로그인");
  const mid = h("input", { type: "text", inputmode: "numeric", placeholder: "ipb_member_id (숫자)" });
  const hash = h("input", { type: "text", placeholder: "ipb_pass_hash (32자리)", autocomplete: "off" });
  const msg2 = h("p", { class: "cx-warn" });
  const cookieBtn = h("button", { class: "btn", onclick: (e) => submit({ member_id: mid.value, pass_hash: hash.value }, e.currentTarget, msg2) }, "쿠키로 로그인");
  return h("div", { class: "cx-login" },
    h("div", { class: "panel" }, h("h3", {}, "e-hentai 로그인"),
      h("p", { class: "meta" }, "e-hentai(포럼) 계정으로 로그인하면 내 즐겨찾기를 보고 댓글을 쓸 수 있어요. 비밀번호는 저장하지 않고, 로그인 쿠키만 이 휴대폰 안에 암호화해서 저장해요."),
      h("a", { class: "btn primary cx-block", href: "velvet://eh-login" }, "e-hentai 로그인 화면 열기"),
      h("p", { class: "meta" }, "앱 안에 e-hentai 로그인 페이지가 열려요. 로봇 확인이 나오면 풀어 주세요. 로그인되면 저절로 돌아와요. 연결이 안 되면 보안 폴더 안에서 VPN 을 켜세요.")),
    h("details", { class: "panel" }, h("summary", {}, "다른 방법: 아이디·비밀번호를 여기에 입력"),
      h("div", { class: "cx-form" }, user, pass, loginBtn, msg)),
    h("details", { class: "panel" }, h("summary", {}, "다른 방법: 쿠키 값 직접 입력 (PC 필요)"),
      h("p", { class: "meta" }, "PC 브라우저에서 e-hentai 에 로그인한 뒤, 개발자 도구(F12) → Application → Cookies → e-hentai.org 에서 ipb_member_id 와 ipb_pass_hash 값을 복사해 넣으세요."),
      h("div", { class: "cx-form" }, mid, hash, cookieBtn, msg2)));
}

// ---------------------------------------------------------------- 만화 탭: 한국어 / 즐겨찾기 / 저장
async function renderComics(params) {
  setTab("comics");
  const asked = params.get("tab");
  const tab = CX_SEGS.some(([k]) => k === asked) ? asked : CX_SEGS.some(([k]) => k === cxStore("vv-comics-tab")) ? cxStore("vv-comics-tab") : "ko";
  cxStore("vv-comics-tab", tab);
  const idx = CX_SEGS.findIndex(([k]) => k === tab);
  const goSeg = (k) => { if (k !== tab) slideTo("#/comics?tab=" + k, CX_SEGS.findIndex(([x]) => x === k) > idx ? 1 : -1); };
  const content = h("div", { class: "cx-content" });
  // 옆으로 밀면 한국어 ↔ 즐겨찾기 ↔ 저장, 끝에서 더 밀면 옆 탭으로
  window.__mediaSwipeTarget = (dir) => { const j = idx + dir; return j >= 0 && j < CX_SEGS.length ? content : null; };
  window.__mediaSwipe = (dir) => { const j = idx + dir; if (j < 0 || j >= CX_SEGS.length) return false; goSeg(CX_SEGS[j][0]); return true; };

  const seg = h("div", { class: "cx-seg", role: "tablist", "aria-label": "만화 목록" },
    ...CX_SEGS.map(([k, l]) => h("button", { role: "tab", class: k === tab ? "on" : "", "aria-selected": k === tab ? "true" : "false", onclick: () => goSeg(k) }, l)));
  const gear = h("a", { class: "round-btn cx-headbtn", href: "#/comics/settings", "aria-label": "만화 설정", title: "만화 설정" }, ico("gear"));
  $app.replaceChildren(h("div", { class: "cx" }, cxHead("만화", "e-hentai", gear), seg, content));

  if (tab === "saved") return cxSaved(content);
  const isFav = tab === "fav";
  const st = await api("eh/status").catch(() => ({ logged_in: false }));
  if (isFav && !st.logged_in) { content.replaceChildren(cxLoginPanel()); return; }

  const favcat = params.get("favcat") || "all", q = params.get("q") || "";
  const update = (ch) => {
    const p = new URLSearchParams(params);
    p.set("tab", tab);
    for (const [k, v] of Object.entries(ch)) (v == null || v === "") ? p.delete(k) : p.set(k, v);
    location.hash = "#/comics?" + p;
  };
  let t;
  const search = h("input", { type: "search", class: "cx-search", value: q, enterkeyhint: "search",
    "aria-label": "만화 검색",
    placeholder: isFav ? "즐겨찾기에서 검색 (제목, 태그)" : "한국어 만화 검색 (제목, 태그, 작가)",
    oninput: (e) => { clearTimeout(t); t = setTimeout(() => { typingSearch = true; update({ q: e.target.value }); }, 700); },
    onkeydown: (e) => { if (e.key === "Enter") { clearTimeout(t); e.target.blur(); update({ q: e.target.value }); } } });
  const folderChips = h("div", { class: "cx-chips" });
  const recent = h("div");
  const grid = h("div", { class: "cx-grid" });
  const more = h("div");
  const status = h("div");
  content.replaceChildren(...[
    h("label", { class: "cx-search-box" }, ico("search"), search),
    isFav ? folderChips : null,
    !isFav && !q ? recent : null,
    q ? h("p", { class: "meta cx-qline" }, `‘${q}’ 검색 결과`) : null,
    status, grid, more].filter(Boolean));
  keepTypingFocus(search);

  if (!isFav && !q) {   // 이어 읽기: 최근 읽은 만화 (인터넷 없이도 보임)
    api("eh/recent").then((d) => {
      if (!d.items.length) return;
      recent.replaceChildren(h("section", { class: "cx-shelf" }, h("h2", {}, "이어 읽기"),
        h("div", { class: "cx-row" }, d.items.map((g) => cxCard(g)))));
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
      const box = cxError(e.message, () => { box.remove(); load(); });
      if (first) { more.replaceChildren(); status.replaceChildren(box); } else more.replaceChildren(box);
      return;
    }
    if (isFav && d.logged_in === false) {
      content.replaceChildren(h("p", { class: "cx-warn" }, "로그인이 풀렸어요. 다시 로그인해 주세요."), cxLoginPanel());
      return;
    }
    if (first) {
      first = false;
      if (isFav) {
        const names = {};
        d.folders.forEach((f) => (names[f.cat] = f.name));
        cxStore("vv-eh-folders", JSON.stringify(names));
        const total = d.folders.reduce((n, f) => n + f.count, 0);
        folderChips.replaceChildren(
          h("button", { class: "chip" + (favcat === "all" ? " on" : ""), onclick: () => update({ favcat: null }) }, `전체${total ? " " + total : ""}`),
          ...d.folders.filter((f) => f.count > 0 || f.cat === favcat).map((f) =>
            h("button", { class: "chip" + (favcat === f.cat ? " on" : ""), onclick: () => update({ favcat: f.cat }) }, `${f.name} ${f.count}`)));
      }
      if (!d.items.length) {
        grid.replaceWith(h("div", { class: "empty" }, q ? "검색 결과가 없어요." : isFav ? "즐겨찾기한 만화가 없어요." : "만화를 찾지 못했어요."));
        more.replaceChildren(); return;
      }
    }
    d.items.forEach((g) => grid.append(cxCard(g)));
    next = d.next;
    if (next) autoMore(more, load); else more.replaceChildren(h("p", { class: "meta cx-end" }, "목록의 끝이에요"));
  }
  await load();
}

/** 저장: 휴대폰에 받아 둔 만화 (인터넷·VPN 없이 읽기) */
async function cxSaved(content) {
  const d = await api("eh/saved");
  const grid = h("div", { class: "cx-grid" });
  for (const g of d.items) {
    const stLine = g.done ? h("div", { class: "meta" }, `저장됨 · ${g.pages}쪽`)
      : g.error ? h("div", { class: "cx-warn" }, `멈춤 ${g.saved_pages}/${g.pages}: ${g.error}`)
      : h("div", { class: "meta" }, `받는 중 ${g.saved_pages}/${g.pages}`);
    const btns = h("div", { class: "cx-saved-btns" },
      !g.done ? h("button", { class: "btn sm", onclick: async (e) => { e.preventDefault(); await api("eh/save", { method: "POST", body: g }); toast("이어서 받아요"); route(); } }, "이어 받기") : null,
      h("button", { class: "btn sm danger", onclick: async (e) => {
        e.preventDefault();
        if (!confirm(`‘${g.title}’ 저장본을 지울까요?`)) return;
        await api("eh/unsave", { method: "POST", body: { gid: g.gid } }); route();
      } }, "삭제"));
    grid.append(h("div", { class: "cx-saved" }, cxCard(g, stLine), btns));
  }
  content.replaceChildren(
    h("p", { class: "meta cx-lead" }, "휴대폰에 저장한 만화는 인터넷이나 VPN 없이 볼 수 있어요. 만화 정보 화면의 ‘휴대폰에 저장’으로 추가하세요."),
    d.items.length ? grid : h("div", { class: "empty" }, "저장한 만화가 없어요."));
}

// ---------------------------------------------------------------- 만화 설정
async function renderComicSettings() {
  setTab("comics");
  const st = await api("eh/status").catch(() => ({ logged_in: false }));
  const account = st.logged_in
    ? h("div", { class: "panel" }, h("h3", {}, "e-hentai 계정"),
        h("p", {}, "로그인되어 있어요."),
        h("button", { class: "btn danger", onclick: async () => {
          if (!confirm("e-hentai 에서 로그아웃할까요? (이 앱에 저장한 로그인 쿠키를 지웁니다)")) return;
          await api("eh/logout", { method: "POST" }); toast("로그아웃했어요"); route();
        } }, "로그아웃"))
    : cxLoginPanel();
  const usage = h("dl", { class: "cx-usage" }, h("dt", {}, "불러오는 중…"));
  const drawUsage = (u) => usage.replaceChildren(
    h("dt", {}, "읽은 페이지 보관"), h("dd", {}, `${fmtSize(u.cache)} / 한도 ${fmtSize(u.limit)}`),
    h("dt", {}, "표지 보관"), h("dd", {}, fmtSize(u.thumbs)),
    h("dt", {}, "휴대폰에 저장한 만화"), h("dd", {}, fmtSize(u.saved)));
  api("eh/cache").then(drawUsage).catch((e) => usage.replaceChildren(h("dt", { class: "cx-warn" }, e.message)));
  const storage = h("div", { class: "panel" }, h("h3", {}, "저장 공간"), usage,
    h("p", { class: "meta" }, "한 번 본 페이지는 다시 받지 않도록 휴대폰에 보관해요. 한도를 넘으면 오래 안 본 것부터 저절로 지워요."),
    h("button", { class: "btn", onclick: async (e) => {
      const b = e.currentTarget;
      if (!confirm("보관한 페이지와 표지를 지울까요? (‘저장’에 있는 만화는 지우지 않아요)")) return;
      b.disabled = true;
      try { drawUsage(await api("eh/cacheclear", { method: "POST" })); try { if (window.VidShelfApp && VidShelfApp.clearWebCache) VidShelfApp.clearWebCache(); } catch (x) {} toast("보관 이미지를 지웠어요"); }
      catch (x) { toast(x.message); }
      b.disabled = false;
    } }, "보관 이미지 지우기"));
  const vpn = h("div", { class: "panel" }, h("h3", {}, "연결이 안 될 때"),
    h("p", {}, "국내에서는 e-hentai 접속이 막혀 있어요. 삼성 ", h("b", {}, "보안 폴더 안에"), " VPN 앱(예: 1.1.1.1)을 설치해 켠 뒤 다시 시도하세요."),
    h("p", { class: "meta" }, "일반 공간에서 켠 VPN 은 보안 폴더 안의 앱에 적용되지 않아요. ‘저장’에 있는 만화는 VPN 없이도 볼 수 있어요."));
  $app.replaceChildren(h("div", { class: "cx cx-settings" },
    h("button", { class: "cx-back", onclick: () => (history.length > 1 ? history.back() : (location.hash = "#/comics")) }, ico("back"), "만화"),
    cxHead("만화 설정", "e-hentai"),
    account, storage, vpn));
}

// ---------------------------------------------------------------- 만화 정보
const CX_NS = { language: "언어", parody: "패러디", character: "캐릭터", group: "그룹", artist: "작가", cosplayer: "코스플레이어", male: "남성", female: "여성", mixed: "혼합", other: "기타", misc: "기타", reclass: "분류", location: "장소", temp: "임시" };
const CX_NS_ORDER = ["artist", "group", "parody", "character", "female", "male", "mixed", "cosplayer", "location", "other", "misc", "reclass", "temp", "language"];
const CX_ACT = {
  heart: '<path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 7.9 3.6 4.5 7 4.5c2 0 3.4 1.1 5 3 1.6-1.9 3-3 5-3 3.4 0 5.6 3.4 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2z"/>',
  save: '<path d="M12 3.5v11"/><path d="M7.5 10l4.5 4.5 4.5-4.5"/><path d="M4.5 15.5v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3"/>',
  chat: '<path d="M4 5.5h16v11H9l-5 4z"/>',
};
function cxActIcon(name) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("class", "ico cx-acti"); s.setAttribute("aria-hidden", "true");
  s.innerHTML = CX_ACT[name];
  return s;
}
/** e-hentai 날짜(“22 November 2026, 10:00”)를 한국어로 */
function cxPosted(s) {
  const d = new Date(String(s).replace(",", "") + " UTC");
  return isNaN(d) ? s : d.toLocaleString("ko-KR", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
/** 미리보기 한 칸. 작은 그림은 여러 장이 붙은 그림에서 잘라서 보여 줌. */
function cxPreview(it, onOpen) {
  const cell = h("button", { class: "cx-pv", "aria-label": `${it.n}쪽부터 읽기`, onclick: () => onOpen(it.n) });
  if (it.full) cell.append(h("img", { src: cxThumb(it.url), loading: "lazy", alt: "" }));
  else {
    const inner = h("div", { class: "cx-pv-in" });
    inner.style.cssText = `width:${it.w}px;height:${it.h}px;background-image:url("${cxThumb(it.url)}");background-position:${it.x}px ${it.y}px`;
    cell.dataset.w = it.w; cell.dataset.h = it.h;
    cell.append(inner);
  }
  cell.append(h("span", { class: "cx-pv-n" }, it.n));
  return cell;
}
function cxLayoutPreviews(root) {
  root.querySelectorAll(".cx-pv[data-w]").forEach((c) => {
    const cw = c.clientWidth, ch = c.clientHeight, w = +c.dataset.w, hh = +c.dataset.h;
    if (!cw || !w) return;
    const s = Math.min(cw / w, ch / hh);
    c.firstChild.style.transform = `translate(${(cw - w * s) / 2}px, ${(ch - hh * s) / 2}px) scale(${s})`;
  });
}
window.addEventListener("resize", () => cxLayoutPreviews(document));

function cxComment(c) {
  const sc = parseInt(c.score, 10);
  return h("div", { class: "cx-cmt" + (c.uploader ? " up" : "") },
    h("div", { class: "cx-cmt-head" },
      h("b", {}, c.name || "알 수 없음"),
      c.uploader ? h("span", { class: "cx-cmt-tag" }, "올린 사람") : null,
      h("span", { class: "meta" }, cxPosted(c.posted)),
      c.score ? h("span", { class: "cx-cmt-score" + (sc > 0 ? " pos" : sc < 0 ? " neg" : "") }, c.score) : null),
    h("div", { class: "cx-cmt-text" }, c.text));
}

async function renderComic(params) {
  setTab("comics");
  const gid = +params.get("gid"), token = params.get("t") || "";
  let g, offline = false;
  try { g = await api(`eh/gallery?gid=${gid}&t=${token}`); }
  catch (e) {   // 연결이 안 되어도 저장한 만화면 정보 없이 바로 읽을 수 있게
    const s = (await api("eh/saved").catch(() => ({ items: [] }))).items.find((x) => x.gid === gid);
    if (!s) { $app.replaceChildren(h("div", { class: "cx" }, h("button", { class: "cx-back", onclick: () => history.back() }, ico("back"), "뒤로"), cxError(e.message, route))); return; }
    g = Object.assign({ tags: [], rating: "", posted: "" }, s);
    offline = true;
  }
  if (g.logged_in === false) { location.hash = "#/comics?tab=fav"; return; }
  let startAt = Math.min(Math.max(1, g.read_page || 1), g.pages);
  const read = (n) => cxOpenReader(g, n, (last) => {   // 다 읽고 닫으면 화면은 그대로, 읽기 버튼만 새로
    g.read_page = last;
    startAt = Math.min(Math.max(1, last), g.pages);
    drawReadRow();
  });

  // ---- 위쪽: 표지와 제목
  const cover = h("img", { src: cxThumb(g.thumb), alt: "" });
  cover.onerror = () => (cover.hidden = true);
  const title = h("h1", { class: "cx-ctitle", onclick: () => title.classList.toggle("open") }, g.title_jpn || g.title);
  const facts = [g.category, `${g.pages}쪽`, g.rating ? `★ ${(+g.rating).toFixed(1)}` : "", g.posted ? new Date(g.posted * 1000).toLocaleDateString("ko-KR") : ""].filter(Boolean);
  const hero = h("div", { class: "cx-hero" },
    h("button", { class: "cx-hcover", "aria-label": "읽기", onclick: () => read(startAt) }, cover),
    h("div", { class: "cx-hmain" },
      title,
      g.title_jpn && g.title !== g.title_jpn ? h("p", { class: "cx-orig" }, g.title) : null,
      h("div", { class: "cx-facts" }, facts.map((f) => h("span", {}, f))),
      g.uploader ? h("p", { class: "meta" }, `올린 사람 ${g.uploader}`) : null));

  // ---- 읽기 버튼
  const readRow = h("div", { class: "cx-readrow" });
  const drawReadRow = () => readRow.replaceChildren(...[
    h("button", { class: "btn primary cx-readmain", onclick: () => read(startAt) }, g.read_page > 1 ? `이어 읽기 · ${startAt}쪽` : "읽기"),
    g.read_page > 1 ? h("button", { class: "btn", onclick: () => read(1) }, "처음부터") : null].filter(Boolean));
  drawReadRow();

  // ---- 즐겨찾기 · 저장 · 댓글
  const act = (name, label) => h("button", { class: "cx-act" }, cxActIcon(name), h("b", {}, label), h("small", {}, "…"));
  const favAct = act("heart", "즐겨찾기"), saveAct = act("save", "휴대폰에 저장"), cmtAct = act("chat", "댓글");
  favAct.disabled = true;
  cmtAct.onclick = () => cmtSec.scrollIntoView({ behavior: "smooth", block: "start" });
  const setAct = (btn, sub, on) => { btn.lastChild.textContent = sub; btn.classList.toggle("on", !!on); };

  let fav = null;
  const drawFav = (f) => {
    fav = f;
    favAct.disabled = false;
    if (!f || f.logged_in === false) { setAct(favAct, "로그인 필요", false); return; }
    setAct(favAct, f.favcat >= 0 ? (f.name || `폴더 ${f.favcat}`) : "추가하기", f.favcat >= 0);
  };
  favAct.onclick = () => {
    if (!fav || fav.logged_in === false) { location.hash = "#/comics/settings"; toast("e-hentai 에 로그인하세요"); return; }
    const names = cxFolderNames();
    let closeSheet;
    const setFav = async (cat, btn) => {
      btn.disabled = true;
      try {
        const f = await api("eh/fav", { method: "POST", body: { gid: g.gid, t: g.token, favcat: cat } });
        drawFav(Object.assign({ logged_in: true }, f));
        toast(cat < 0 ? "즐겨찾기에서 뺐어요" : `‘${f.name || names[cat] || "폴더 " + cat}’에 넣었어요`);
        closeSheet();
      } catch (e) { toast(e.message); btn.disabled = false; }
    };
    const list = h("div", { class: "cx-folders" }, Array.from({ length: 10 }, (_, i) =>
      h("button", { class: "cx-folder" + (fav.favcat === i ? " on" : ""), onclick: (e) => setFav(i, e.currentTarget) },
        h("span", { class: "cx-dot c" + i }), h("span", { class: "grow" }, names[i] || `폴더 ${i}`), fav.favcat === i ? h("span", { class: "meta" }, "지금 여기") : null)));
    closeSheet = openSheet(fav.favcat >= 0 ? "다른 폴더로 옮기기" : "즐겨찾기 폴더 고르기", [list,
      fav.favcat >= 0 ? h("button", { class: "btn danger cx-block", onclick: (e) => setFav(-1, e.currentTarget) }, "즐겨찾기에서 빼기") : null]);
  };

  const drawSave = async () => {
    const d = await api("eh/saved").catch(() => ({ items: [] }));
    const s = d.items.find((x) => x.gid === g.gid);
    setAct(saveAct, !s ? "저장하기" : s.done ? "저장됨" : s.error ? `멈춤 ${s.saved_pages}/${s.pages}` : `받는 중 ${s.saved_pages}/${s.pages}`, !!s);
    saveAct.onclick = s ? () => (location.hash = "#/comics?tab=saved") : async () => {
      saveAct.disabled = true;
      try {
        await api("eh/save", { method: "POST", body: { gid: g.gid, token: g.token, title: g.title_jpn || g.title, thumb: g.thumb, pages: g.pages, category: g.category } });
        toast("휴대폰에 저장을 시작했어요. 아래 막대에 진행 상황이 나와요.");
      } catch (e) { toast(e.message); }
      saveAct.disabled = false;
      drawSave();
    };
  };
  drawSave();

  // ---- 미리보기
  const pvGrid = h("div", { class: "cx-pvgrid" });
  const pvMore = h("div");
  const pvSec = h("section", { class: "cx-sec" }, h("h2", {}, "미리보기"), pvGrid, pvMore);
  let pvPage = 0, perPage = 0;
  const addPreviews = (items) => {
    items.forEach((it) => pvGrid.append(cxPreview(it, read)));
    requestAnimationFrame(() => cxLayoutPreviews(pvGrid));
    const pagesOfPv = perPage ? Math.ceil(g.pages / perPage) : 1;
    pvMore.replaceChildren(...[pvPage + 1 < pagesOfPv ? h("button", { class: "btn cx-block", onclick: async (e) => {
      e.currentTarget.disabled = true; e.currentTarget.textContent = "불러오는 중…";
      try { pvPage++; const d = await api(`eh/previews?gid=${g.gid}&t=${g.token}&p=${pvPage}`); addPreviews(d.items); }
      catch (x) { pvPage--; pvMore.replaceChildren(cxError(x.message, () => addPreviews([]))); }
    } }, "미리보기 더 보기") : null].filter(Boolean));
  };

  // ---- 태그
  const groups = {};
  for (const tag of g.tags || []) {
    const [ns, name] = tag.includes(":") ? tag.split(/:(.*)/s) : ["misc", tag];
    (groups[ns] = groups[ns] || []).push(name);
  }
  const nsList = Object.keys(groups).sort((a, b) => (CX_NS_ORDER.indexOf(a) + 99) % 99 - (CX_NS_ORDER.indexOf(b) + 99) % 99);
  const tagSec = nsList.length ? h("section", { class: "cx-sec" }, h("h2", {}, "태그"),
    h("div", { class: "cx-tags" }, nsList.map((ns) => h("div", { class: "cx-tagrow" },
      h("span", { class: "cx-ns" }, CX_NS[ns] || ns),
      h("div", { class: "cx-chips wrap" }, groups[ns].map((n) => h("a", { class: "chip", href: `#/comics?tab=ko&q=${encodeURIComponent(`${ns}:"${n}$"`)}` }, n))))))) : null;

  // ---- 댓글
  const cmtList = h("div", { class: "cx-cmts" });
  const cmtWrite = h("div");
  const cmtTitle = h("h2", {}, "댓글");
  const cmtSec = h("section", { class: "cx-sec" }, cmtTitle, cmtList, cmtWrite);
  const SHOW = 4;
  const drawComments = (list, all) => {
    cmtTitle.textContent = list.length ? `댓글 ${list.length}` : "댓글";
    setAct(cmtAct, list.length ? `${list.length}개` : "쓰기", false);
    if (!list.length) { cmtList.replaceChildren(h("p", { class: "meta" }, "아직 댓글이 없어요.")); return; }
    const shown = all ? list : list.slice(0, SHOW);
    cmtList.replaceChildren(...shown.map(cxComment),
      ...(!all && list.length > SHOW ? [h("button", { class: "btn cx-block", onclick: () => drawComments(list, true) }, `댓글 ${list.length}개 모두 보기`)] : []));
  };
  const drawWrite = (loggedIn) => {
    if (!loggedIn) {
      cmtWrite.replaceChildren(h("p", { class: "meta" }, "댓글을 쓰려면 ", h("a", { href: "#/comics/settings", class: "cx-link" }, "e-hentai 에 로그인"), "하세요."));
      return;
    }
    const ta = h("textarea", { rows: 3, placeholder: "댓글 쓰기 (10글자 이상)", maxlength: 1000, "aria-label": "댓글" });
    const msg = h("p", { class: "cx-warn" });
    const send = h("button", { class: "btn primary", onclick: async () => {
      const text = ta.value.trim();
      if (text.length < 10) { msg.textContent = "댓글은 10글자 이상이어야 해요"; return; }
      send.disabled = true; msg.textContent = "";
      try {
        const d = await api("eh/comment", { method: "POST", body: { gid: g.gid, t: g.token, text } });
        const mine = d.comments.some((c) => c.text.replace(/\s+/g, " ").includes(text.replace(/\s+/g, " ").slice(0, 20)));
        drawComments(d.comments, true);
        if (mine) { ta.value = ""; toast("댓글을 올렸어요"); }
        else msg.textContent = "댓글이 목록에 보이지 않아요. e-hentai 가 거절했을 수 있어요 (새 계정·하루 제한 등).";
      } catch (e) { msg.textContent = e.message; }
      send.disabled = false;
    } }, "올리기");
    cmtWrite.replaceChildren(h("div", { class: "cx-write" }, ta, h("div", { class: "cx-write-foot" }, h("span", { class: "meta" }, "e-hentai 에 내 이름으로 올라가요"), send)), msg);
  };

  $app.replaceChildren(h("div", { class: "cx cx-comic" },
    h("button", { class: "cx-back", onclick: () => (history.length > 1 ? history.back() : (location.hash = "#/comics")) }, ico("back"), "뒤로"),
    hero, readRow,
    h("div", { class: "cx-acts" }, favAct, saveAct, cmtAct),
    pvSec, tagSec, cmtSec));

  // 미리보기·댓글·즐겨찾기 상태는 갤러리 화면 한 번으로 받음
  const loadDetails = async () => {
    pvGrid.replaceChildren(...Array.from({ length: 8 }, () => h("div", { class: "cx-pv skel" })));
    cmtList.replaceChildren(h("p", { class: "meta" }, "불러오는 중…"));
    try {
      const d = await api(`eh/details?gid=${g.gid}&t=${g.token}`);
      perPage = d.per_page; pvGrid.replaceChildren();
      if (d.items.length) addPreviews(d.items); else pvGrid.replaceChildren(h("p", { class: "meta" }, "미리보기가 없어요."));
      drawComments(d.comments, false);
      drawFav(d.logged_in ? Object.assign({ logged_in: true }, d.fav) : { logged_in: false });
      drawWrite(d.logged_in);
    } catch (e) {
      pvGrid.replaceChildren();
      pvMore.replaceChildren(cxError((offline ? "연결이 안 되어 저장한 정보로 보여 줘요. " : "") + e.message, loadDetails));
      cmtList.replaceChildren(h("p", { class: "meta" }, "댓글을 불러오지 못했어요."));
      setAct(cmtAct, "-", false);
      drawFav(null); favAct.disabled = true; setAct(favAct, "-", false);
    }
  };
  loadDetails();
  if (params.get("read")) read(+params.get("read") || startAt);
}

// ---------------------------------------------------------------- 만화 보기
/** 세로 스크롤 또는 한 장씩 넘기기. 화면 근처 페이지만 받고, 읽은 위치를 기억. */
function cxOpenReader(g, start, onClose) {
  let closed = false, current = start, saveTimer;
  let mode = cxStore("vv-reader-mode") || "scroll";
  const counter = h("span", { class: "cx-count" });
  const pageUrl = (n) => `/eh/page/${g.gid}/${g.token}/${n}`;
  const progressBody = () => ({ gid: g.gid, page: current, token: g.token, title: g.title_jpn || g.title, thumb: g.thumb, pages: g.pages });
  const drawCounter = () => (counter.textContent = `${current} / ${g.pages}`);
  const saveProgress = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => api("eh/progress", { method: "POST", body: progressBody() }).catch(() => {}), 800);
  };
  const setCurrent = (n) => { current = n; drawCounter(); saveProgress(); };
  const immersive = (on) => { try { if (window.VidShelfApp && VidShelfApp.immersive) VidShelfApp.immersive(on); } catch (e) {} };

  /** 실패한 페이지: 이유를 앱에 다시 물어서 표시 */
  const failView = (n, src, retry) => {
    const why = h("p", { class: "cx-rerr" });
    fetch(src).then((r) => r.json().then((d) => d.error, () => (r.ok ? "이미지를 표시하지 못했어요" : `HTTP ${r.status}`)))
      .then((t) => (why.textContent = t || "")).catch(() => (why.textContent = "앱에 연결하지 못했어요"));
    return h("div", { class: "cx-rfail" }, h("button", { class: "btn", onclick: (e) => { e.stopPropagation(); retry(); } }, `${n}쪽 불러오기 실패 · 다시 시도`), why);
  };

  // ---- 세로 스크롤
  const pages = [];
  const list = h("div", { class: "cx-rpages" });
  const load = (i) => {
    const pg = pages[i];
    if (!pg || pg.dataset.state) return;
    pg.dataset.state = "loading";
    const img = h("img", { alt: `${i + 1}쪽`, decoding: "async" });
    img.onload = () => { pg.dataset.state = "done"; pg.classList.add("loaded"); };
    img.onerror = () => { pg.dataset.state = "failed"; pg.replaceChildren(failView(i + 1, img.src, () => { pg.dataset.state = ""; pg.replaceChildren(h("span", { class: "cx-pn" }, `${i + 1}`)); load(i); })); };
    img.src = pageUrl(i + 1);
    pg.replaceChildren(img);
  };
  for (let i = 0; i < g.pages; i++) {
    const pg = h("div", { class: "cx-rpage", "data-n": i + 1 }, h("span", { class: "cx-pn" }, `${i + 1}`));
    pages.push(pg); list.append(pg);
  }
  const near = new IntersectionObserver((ents) => ents.forEach((e) => e.isIntersecting && load(+e.target.dataset.n - 1)), { rootMargin: "300% 0px" });
  const mid = new IntersectionObserver((ents) => ents.forEach((e) => { if (e.isIntersecting && mode === "scroll") setCurrent(+e.target.dataset.n); }), { rootMargin: "-50% 0px -50% 0px" });
  const end = h("div", { class: "cx-rend" }, h("p", {}, "마지막 쪽이에요"), h("button", { class: "btn", onclick: () => history.back() }, "닫기"));
  const scrollView = h("div", { class: "cx-rscroll" }, list, end);

  // ---- 한 장씩
  const single = h("div", { class: "cx-rsingle" });
  const showSingle = (n) => {
    if (n < 1) return;
    if (n > g.pages) { toast("마지막 쪽이에요"); return; }
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

  const modeBtn = h("button", { class: "cx-rbtn cx-rmode", "aria-label": "보기 방식 바꾸기" });
  const applyMode = () => {
    modeBtn.textContent = mode === "scroll" ? "한 장씩" : "스크롤";
    el.classList.toggle("paged", mode === "page");
    if (mode === "page") { scrollView.hidden = true; single.hidden = false; showSingle(current); }
    else { single.hidden = true; scrollView.hidden = false; requestAnimationFrame(() => pages[current - 1] && pages[current - 1].scrollIntoView()); }
  };
  modeBtn.onclick = () => { mode = mode === "scroll" ? "page" : "scroll"; cxStore("vv-reader-mode", mode); applyMode(); };

  const close = () => {
    if (closed) return;
    closed = true; near.disconnect(); mid.disconnect(); el.remove(); document.body.style.overflow = "";
    immersive(false);
    window.removeEventListener("popstate", onPop); document.removeEventListener("keydown", onKey);
    api("eh/progress", { method: "POST", body: progressBody() }).catch(() => {}).then(() => (onClose ? onClose(current) : route()));
  };
  const onPop = () => close();
  const onKey = (e) => {
    if (mode !== "page") return;
    if (e.key === "ArrowRight") showSingle(current + 1); else if (e.key === "ArrowLeft") showSingle(current - 1);
  };
  const bar = h("div", { class: "cx-rtop" }, h("button", { class: "cx-rbtn", "aria-label": "닫기", onclick: () => history.back() }, ico("close")), counter, modeBtn);
  const el = h("div", { class: "cx-reader", role: "dialog", "aria-modal": "true", "aria-label": g.title_jpn || g.title }, bar, scrollView, single);
  list.addEventListener("click", (e) => { if (e.target.tagName === "IMG") bar.classList.toggle("hide"); });
  document.body.append(el);
  document.body.style.overflow = "hidden";
  immersive(true);
  history.pushState({ viewer: true }, "");
  window.addEventListener("popstate", onPop);
  document.addEventListener("keydown", onKey);
  pages.forEach((p) => { near.observe(p); mid.observe(p); });
  drawCounter();
  applyMode();
}
