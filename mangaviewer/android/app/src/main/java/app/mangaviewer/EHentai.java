package app.mangaviewer;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * e-hentai 클라이언트: 로그인(쿠키), 즐겨찾기 목록, 갤러리 정보(gdata API), 페이지 이미지 받기.
 * 비밀번호는 저장하지 않고 로그인 쿠키(ipb_member_id, ipb_pass_hash)만 씁니다.
 */
class EHentai {

    static final String BASE = "https://e-hentai.org";
    private static final String API = "https://api.e-hentai.org/api.php";
    private static final String LOGIN = "https://forums.e-hentai.org/index.php?act=Login&CODE=01";
    private static final String UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";
    private static final long CACHE_LIMIT = 500L * 1024 * 1024;   // 받은 만화 이미지 보관 한도

    static class NotLoggedIn extends IOException {
        NotLoggedIn() { super("e-hentai 로그인이 필요합니다"); }
    }

    private final File cacheDir, savedDir, thumbDir;
    volatile String memberId = "", passHash = "";

    static final String BLOCKED = "e-hentai 접속이 막혔습니다 (국내 차단). 보안 폴더 안에서 VPN 앱을 켠 뒤 다시 시도하세요.";

    /** 연결 오류를 알기 쉬운 문구로 바꿈. 차단으로 보이는 오류는 VPN 안내. */
    static IOException explain(String host, IOException e) {
        if (e instanceof NotLoggedIn) return e;
        String m = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
        String low = (m + " " + e.getClass().getSimpleName()).toLowerCase();
        if (low.contains("reset") || low.contains("ssl") || low.contains("handshake") || low.contains("closed by peer")
                || low.contains("unexpected end of stream") || low.contains("refused") || low.contains("unknownhost") || low.contains("unable to resolve"))
            return new IOException(BLOCKED + " (" + host + ": " + m + ")");
        return new IOException(host + " 연결 실패: " + m);
    }

    /** 갤러리별 페이지 토큰 (페이지 번호 → /s/ 토큰) */
    private static class Gallery {
        int perPage;
        final Map<Integer, String> pageTokens = new HashMap<>();
    }
    private final Map<Long, Gallery> galleries = new LinkedHashMap<Long, Gallery>(16, .75f, true) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<Long, Gallery> e) { return size() > 50; }
    };

    EHentai(File cacheDir, File savedDir, File thumbDir) {
        this.cacheDir = cacheDir;
        this.savedDir = savedDir;
        this.thumbDir = thumbDir;
    }

    boolean loggedIn() { return !memberId.isEmpty() && !passHash.isEmpty(); }

    private String cookie() {
        StringBuilder c = new StringBuilder("nw=1");   // 내용 경고 화면 건너뛰기
        if (loggedIn()) c.append("; ipb_member_id=").append(memberId).append("; ipb_pass_hash=").append(passHash);
        return c.toString();
    }

    // ------------------------------------------------------------------ HTTP
    private HttpURLConnection open(String url) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(20000);
        c.setReadTimeout(40000);
        c.setRequestProperty("User-Agent", UA);
        c.setRequestProperty("Cookie", cookie());
        return c;
    }

    private String get(String url) throws IOException {
        HttpURLConnection c = open(url);
        try {
            int code = c.getResponseCode();
            if (code >= 400) throw new IOException("e-hentai 응답 오류 (HTTP " + code + ")");
            try (InputStream in = c.getInputStream()) {
                return new String(Comics.readAll(in), StandardCharsets.UTF_8);
            }
        } catch (IOException e) {
            if (e.getMessage() != null && e.getMessage().startsWith("e-hentai 응답 오류")) throw e;
            throw explain(new URL(url).getHost(), e);
        }
    }

    private String post(String url, String type, byte[] body, HttpURLConnection[] keep) throws IOException {
        HttpURLConnection c = open(url);
        c.setDoOutput(true);
        c.setRequestMethod("POST");
        c.setRequestProperty("Content-Type", type);
        if (keep != null) { c.setInstanceFollowRedirects(false); keep[0] = c; }
        int code;
        try {
            try (OutputStream o = c.getOutputStream()) { o.write(body); }
            code = c.getResponseCode();
        } catch (IOException e) {
            throw explain(new URL(url).getHost(), e);
        }
        InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
        if (in == null) return "";
        try (InputStream i = in) { return new String(Comics.readAll(i), StandardCharsets.UTF_8); }
    }

    // ------------------------------------------------------------------ 로그인
    /** 아이디·비밀번호로 로그인해 {member_id, pass_hash} 를 돌려줍니다. */
    String[] login(String user, String pass) throws IOException {
        String form = "referer=" + enc("https://forums.e-hentai.org/index.php") + "&b=&bt=&CookieDate=1"
                + "&UserName=" + enc(user) + "&PassWord=" + enc(pass);
        HttpURLConnection[] keep = new HttpURLConnection[1];
        String body = post(LOGIN, "application/x-www-form-urlencoded", form.getBytes(StandardCharsets.UTF_8), keep);
        String id = "", hash = "";
        for (Map.Entry<String, List<String>> e : keep[0].getHeaderFields().entrySet()) {
            if (e.getKey() == null || !e.getKey().equalsIgnoreCase("Set-Cookie")) continue;
            for (String v : e.getValue()) {
                String kv = v.split(";", 2)[0].trim();
                if (kv.startsWith("ipb_member_id=")) id = kv.substring(14);
                if (kv.startsWith("ipb_pass_hash=")) hash = kv.substring(14);
            }
        }
        if (id.isEmpty() || hash.isEmpty() || id.equals("0")) {
            String low = body.toLowerCase();
            if (low.contains("captcha") || low.contains("recaptcha"))
                throw new IOException("e-hentai 가 로봇 확인(캡차)을 요구해서 앱에서 로그인할 수 없습니다. 아래 ‘쿠키로 로그인’을 써 주세요.");
            throw new IOException("로그인하지 못했습니다. 아이디와 비밀번호를 확인하세요.");
        }
        return new String[]{id, hash};
    }

    // ------------------------------------------------------------------ 즐겨찾기
    private static final Pattern GALLERY_LINK = Pattern.compile("e-hentai\\.org/g/(\\d+)/([0-9a-f]{10})/");
    private static final Pattern NEXT_LINK = Pattern.compile("id=\"[ud]next\"[^>]*href=\"([^\"]+)\"|href=\"([^\"]+)\"[^>]*id=\"[ud]next\"");
    private static final Pattern FAV_FOLDER = Pattern.compile("<div class=\"fp[^\"]*\"[^>]*favcat=(\\d)[^>]*>(.*?)</div>\\s*</div>", Pattern.DOTALL);

    /** favcat: "all" 또는 0~9, next: 다음 쪽 커서(없으면 첫 쪽). */
    JSONObject favorites(String favcat, String search, String next) throws IOException, JSONException {
        if (!loggedIn()) throw new NotLoggedIn();
        StringBuilder url = new StringBuilder(BASE + "/favorites.php?favcat=").append(favcat == null || favcat.isEmpty() ? "all" : enc(favcat));
        if (search != null && !search.trim().isEmpty()) url.append("&f_search=").append(enc(search.trim()));
        if (next != null && !next.isEmpty()) url.append("&next=").append(enc(next));
        String html = get(url.toString());
        if (!html.contains("favorites.php") || html.contains("This page requires you to log on")) throw new NotLoggedIn();

        List<Object[]> ids = galleryIds(html);
        String nextCursor = nextCursor(html);

        // 즐겨찾기 폴더 이름과 개수
        JSONArray folders = new JSONArray();
        Matcher fm = FAV_FOLDER.matcher(html);
        while (fm.find()) {
            String count = "", name = "";
            for (String part : fm.group(2).split("<[^>]+>")) {
                String t = unescape(part).trim();
                if (t.isEmpty()) continue;
                if (count.isEmpty() && t.matches("[\\d,]+")) count = t.replace(",", "");
                else if (name.isEmpty()) name = t;
            }
            folders.put(new JSONObject().put("cat", fm.group(1)).put("name", name.isEmpty() ? "폴더 " + fm.group(1) : name)
                    .put("count", count.isEmpty() ? 0 : Long.parseLong(count)));
        }
        return new JSONObject().put("items", gdata(ids)).put("next", nextCursor == null ? JSONObject.NULL : nextCursor)
                .put("folders", folders);
    }

    /** 목록 페이지의 갤러리 (순서 유지, 중복 제거) */
    private static List<Object[]> galleryIds(String html) {
        Set<String> seen = new LinkedHashSet<>();
        List<Object[]> ids = new ArrayList<>();
        Matcher m = GALLERY_LINK.matcher(html);
        while (m.find()) if (seen.add(m.group(1))) ids.add(new Object[]{Long.parseLong(m.group(1)), m.group(2)});
        return ids;
    }

    /** ‘다음 쪽’ 링크의 커서 */
    private static String nextCursor(String html) throws IOException {
        Matcher nm = NEXT_LINK.matcher(html);
        if (!nm.find()) return null;
        String href = unescape(nm.group(1) != null ? nm.group(1) : nm.group(2));
        Matcher c = Pattern.compile("[?&]next=([^&#]+)").matcher(href);
        return c.find() ? java.net.URLDecoder.decode(c.group(1), "UTF-8") : null;
    }

    /** e-hentai 전체 검색 (로그인 없이도 됨). */
    JSONObject search(String query, String next) throws IOException, JSONException {
        StringBuilder url = new StringBuilder(BASE + "/?f_search=").append(enc(query));
        if (next != null && !next.isEmpty()) url.append("&next=").append(enc(next));
        String html = get(url.toString());
        if (html.contains("No hits found")) return new JSONObject().put("items", new JSONArray()).put("next", JSONObject.NULL);
        String n = nextCursor(html);
        return new JSONObject().put("items", gdata(galleryIds(html))).put("next", n == null ? JSONObject.NULL : n);
    }

    /** 갤러리 정보 (제목, 표지, 페이지 수, 태그 …). 25개씩 나눠서 요청. */
    JSONArray gdata(List<Object[]> ids) throws IOException, JSONException {
        JSONArray out = new JSONArray();
        for (int i = 0; i < ids.size(); i += 25) {
            JSONArray list = new JSONArray();
            for (Object[] id : ids.subList(i, Math.min(ids.size(), i + 25))) list.put(new JSONArray().put(id[0]).put(id[1]));
            JSONObject req = new JSONObject().put("method", "gdata").put("gidlist", list).put("namespace", 1);
            String res = post(API, "application/json", req.toString().getBytes(StandardCharsets.UTF_8), null);
            JSONArray meta = new JSONObject(res).optJSONArray("gmetadata");
            for (int k = 0; meta != null && k < meta.length(); k++) {
                JSONObject g = meta.getJSONObject(k);
                if (g.has("error")) continue;
                out.put(new JSONObject().put("gid", g.optLong("gid")).put("token", g.optString("token"))
                        .put("title", unescape(g.optString("title"))).put("title_jpn", unescape(g.optString("title_jpn")))
                        .put("category", g.optString("category")).put("thumb", g.optString("thumb"))
                        .put("pages", Integer.parseInt(g.optString("filecount", "0")))
                        .put("rating", g.optString("rating")).put("posted", g.optString("posted"))
                        .put("uploader", g.optString("uploader"))
                        .put("tags", g.optJSONArray("tags") == null ? new JSONArray() : g.optJSONArray("tags")));
            }
        }
        return out;
    }

    // ------------------------------------------------------------------ 페이지 이미지
    private static final Pattern PAGE_LINK = Pattern.compile("/s/([0-9a-f]{10})/(\\d+)-(\\d+)");
    private static final Pattern TITLE = Pattern.compile("<title>(.*?)</title>", Pattern.DOTALL);
    private static final Pattern IMG_FALLBACK = Pattern.compile("src=\"(https?://[^\"]+?/(?:h|om)/[^\"]+)\"");
    private static final Pattern IMG = Pattern.compile("<img[^>]*id=\"img\"[^>]*src=\"([^\"]+)\"|<img[^>]*src=\"([^\"]+)\"[^>]*id=\"img\"");
    private static final Pattern NL = Pattern.compile("nl\\('([^']+)'\\)");

    /** 갤러리 화면 한 쪽(p, 0부터)의 HTML. 첫 쪽은 댓글 전체(hc=1)를 포함. 1분 동안 다시 받지 않음. */
    private final Map<String, Object[]> htmlCache = new LinkedHashMap<String, Object[]>(16, .75f, true) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, Object[]> e) { return size() > 12; }
    };

    private String galleryHtml(long gid, String token, int p) throws IOException {
        String key = gid + "/" + token + "/" + p;
        synchronized (htmlCache) {
            Object[] c = htmlCache.get(key);
            if (c != null && System.currentTimeMillis() - (Long) c[0] < 60_000) return (String) c[1];
        }
        String url = BASE + "/g/" + gid + "/" + token + "/?p=" + p + (p == 0 ? "&hc=1" : "");
        String html = get(url);
        if (!PAGE_LINK.matcher(html).find() && html.contains("nw=")) html = get(url + "&nw=session");   // 성인 경고 화면 넘기기
        if (!PAGE_LINK.matcher(html).find()) {
            if (html.contains("Key missing") || html.contains("Gallery not found")) throw new IOException("갤러리 주소가 맞지 않습니다 (삭제되었을 수 있습니다)");
            if (html.contains("This gallery has been removed") || html.contains("unavailable")) throw new IOException("삭제되었거나 볼 수 없는 갤러리입니다");
            if (p == 0) {
                Matcher t = TITLE.matcher(html);
                throw new IOException("갤러리 페이지에서 그림 목록을 찾지 못했습니다 (" + (t.find() ? unescape(t.group(1)).trim() : html.length() + "자") + ")");
            }
        }
        synchronized (htmlCache) { htmlCache.put(key, new Object[]{System.currentTimeMillis(), html}); }
        return html;
    }

    /** 즐겨찾기·댓글을 바꾼 뒤, 로그인이 바뀐 뒤에는 새로 받도록 */
    void forgetHtml() {
        synchronized (htmlCache) { htmlCache.clear(); }
    }

    /** HTML 에 있는 페이지 토큰을 기억하고 그 개수를 돌려줌 */
    private int storeTokens(long gid, Gallery g, String html) {
        Matcher m = PAGE_LINK.matcher(html);
        Set<Integer> found = new LinkedHashSet<>();
        synchronized (g) {
            while (m.find()) {
                if (Long.parseLong(m.group(2)) != gid) continue;
                int n = Integer.parseInt(m.group(3));
                g.pageTokens.put(n, m.group(1));
                found.add(n);
            }
        }
        return found.size();
    }

    /** 갤러리 목록 한 쪽(p, 0부터)을 읽어 페이지 토큰을 기억합니다. 그 쪽에 있던 페이지 수를 돌려줌. */
    private int loadGalleryPage(long gid, String token, Gallery g, int p) throws IOException {
        return storeTokens(gid, g, galleryHtml(gid, token, p));
    }

    // ------------------------------------------------------------------ 미리보기 (갤러리의 작은 그림들)
    private static final Pattern STYLE_URL = Pattern.compile("style=\"([^\"]*url\\([^\"]*)\"");
    private static final Pattern IMG_SRC = Pattern.compile("<img[^>]+src=\"(https?://[^\"]+)\"");
    private static final Pattern CSS_W = Pattern.compile("width:\\s*(\\d+)px");
    private static final Pattern CSS_H = Pattern.compile("height:\\s*(\\d+)px");
    private static final Pattern CSS_BG = Pattern.compile("url\\(['\"]?([^)'\"]+)['\"]?\\)\\s*(-?\\d+)(?:px)?(?:\\s+(-?\\d+)(?:px)?)?");

    /**
     * 갤러리 화면의 미리보기 그림. 작은 그림은 여러 장이 한 그림(스프라이트)에 붙어 있어서
     * {n, url, x, y, w, h} 로 돌려줍니다 (x, y: 그 그림 안의 위치). 큰 미리보기면 {n, url, full: true}.
     */
    static JSONArray previews(long gid, String html) throws JSONException {
        JSONArray out = new JSONArray();
        int s = html.indexOf("id=\"gdt\"");
        if (s < 0) return out;
        int e = html.indexOf("class=\"gtb\"", s);
        if (e < 0) e = html.indexOf("id=\"cdiv\"", s);
        if (e < 0) e = html.length();
        String sec = html.substring(s, e);
        List<int[]> links = new ArrayList<>();
        Matcher m = PAGE_LINK.matcher(sec);
        while (m.find()) {
            if (Long.parseLong(m.group(2)) != gid) continue;
            int end = sec.indexOf('>', m.end());
            links.add(new int[]{m.start(), end < 0 ? m.end() : end + 1, Integer.parseInt(m.group(3))});
        }
        if (links.isEmpty()) return out;
        int firstUrl = sec.indexOf("url(");
        boolean styleBefore = firstUrl >= 0 && firstUrl < links.get(0)[0];   // 예전 화면: 그림 상자 안에 링크
        for (int k = 0; k < links.size(); k++) {
            int[] l = links.get(k);
            String after = sec.substring(l[1], k + 1 < links.size() ? links.get(k + 1)[0] : sec.length());
            String before = sec.substring(k > 0 ? links.get(k - 1)[1] : 0, l[0]);
            JSONObject it = new JSONObject().put("n", l[2]);
            Matcher im = IMG_SRC.matcher(after);
            String style = null;
            if (im.find() && !im.group(1).contains("blank.gif")) {
                it.put("url", unescape(im.group(1))).put("full", true);
            } else {
                Matcher st = STYLE_URL.matcher(styleBefore ? before : after);
                while (st.find()) {
                    style = st.group(1);
                    if (!styleBefore) break;   // 앞에 있으면 링크에 가장 가까운(마지막) 것
                }
            }
            if (style != null) {
                Matcher bg = CSS_BG.matcher(style), w = CSS_W.matcher(style), hh = CSS_H.matcher(style);
                if (!bg.find() || !w.find() || !hh.find()) continue;
                it.put("url", unescape(bg.group(1))).put("x", Integer.parseInt(bg.group(2)))
                        .put("y", bg.group(3) == null ? 0 : Integer.parseInt(bg.group(3)))
                        .put("w", Integer.parseInt(w.group(1))).put("h", Integer.parseInt(hh.group(1)));
            }
            if (it.has("url")) out.put(it);
        }
        return out;
    }

    /** 미리보기 한 쪽 (p, 0부터). {items, per_page} */
    JSONObject previewPage(long gid, String token, int p) throws IOException, JSONException {
        String html = galleryHtml(gid, token, p);
        Gallery g = gallery(gid);
        int k = storeTokens(gid, g, html);
        if (p == 0 && k > 0) synchronized (g) { if (g.perPage == 0) g.perPage = k; }
        return new JSONObject().put("items", previews(gid, html)).put("per_page", k);
    }

    /** 만화 정보 화면에 필요한 것을 한 번에: 첫 쪽 미리보기, 댓글, 즐겨찾기 상태 */
    JSONObject details(long gid, String token) throws IOException, JSONException {
        JSONObject out = previewPage(gid, token, 0);
        String html = galleryHtml(gid, token, 0);
        out.put("comments", comments(html)).put("logged_in", loggedIn());
        if (loggedIn()) out.put("fav", favState(html));
        return out;
    }

    // ------------------------------------------------------------------ 댓글
    private static final Pattern COMMENT_POSTED = Pattern.compile("Posted on (.+?) by:", Pattern.DOTALL);
    private static final Pattern COMMENT_NAME = Pattern.compile("by:.*?<a[^>]*>(.*?)</a>", Pattern.DOTALL);
    private static final Pattern COMMENT_SCORE = Pattern.compile("id=\"comment_score_\\d+\"[^>]*>([^<]*)<");
    private static final Pattern COMMENT_BODY = Pattern.compile("<div class=\"c6\"[^>]*id=\"comment_(\\d+)\"[^>]*>");
    private static final Pattern ERROR_P = Pattern.compile("<p class=\"br\">(.*?)</p>", Pattern.DOTALL);

    /** 갤러리 첫 쪽 HTML 의 댓글 목록: {id, name, posted, score, text, uploader} */
    static JSONArray comments(String html) throws JSONException {
        JSONArray out = new JSONArray();
        int s = html.indexOf("id=\"cdiv\"");
        if (s < 0) return out;
        String sec = html.substring(s);
        String[] blocks = sec.split("<div class=\"c1\"");
        for (int i = 1; i < blocks.length; i++) {
            String b = blocks[i];
            Matcher body = COMMENT_BODY.matcher(b);
            if (!body.find()) continue;
            int end = b.length();
            for (String stop : new String[]{"<div class=\"c7\"", "<div class=\"c8\"", "<div id=\"chd\"", "<div id=\"formdiv\""}) {
                int k = b.indexOf(stop, body.end());
                if (k >= 0 && k < end) end = k;
            }
            String text = b.substring(body.end(), end).replaceAll("(</div>\\s*)+$", "");
            text = text.replaceAll("[\\r\\n]+", " ").replaceAll("(?i)<br\\s*/?>", "\n").replaceAll("<[^>]+>", "");
            StringBuilder lines = new StringBuilder();
            for (String line : text.split("\n", -1)) lines.append(unescape(line).trim()).append('\n');
            text = lines.toString().trim();
            Matcher posted = COMMENT_POSTED.matcher(b), name = COMMENT_NAME.matcher(b), score = COMMENT_SCORE.matcher(b);
            long id = Long.parseLong(body.group(1));
            out.put(new JSONObject().put("id", id)
                    .put("name", name.find() ? unescape(name.group(1).replaceAll("<[^>]+>", "")).trim() : "")
                    .put("posted", posted.find() ? unescape(posted.group(1).replaceAll("<[^>]+>", "")).trim() : "")
                    .put("score", score.find() ? score.group(1).trim() : "")
                    .put("uploader", id == 0 || b.contains("Uploader Comment"))
                    .put("text", text));
        }
        return out;
    }

    /** 댓글 쓰기. 등록 뒤의 댓글 목록을 돌려줌. */
    JSONArray postComment(long gid, String token, String text) throws IOException, JSONException {
        if (!loggedIn()) throw new NotLoggedIn();
        String html = post(BASE + "/g/" + gid + "/" + token + "/?hc=1", "application/x-www-form-urlencoded",
                ("commenttext_new=" + enc(text)).getBytes(StandardCharsets.UTF_8), null);
        forgetHtml();
        if (html.contains("This page requires you to log on")) throw new NotLoggedIn();
        Matcher err = ERROR_P.matcher(html);
        if (err.find()) {
            String msg = unescape(err.group(1).replaceAll("<[^>]+>", "")).trim();
            if (!msg.isEmpty()) throw new IOException("댓글을 등록하지 못했습니다: " + msg);
        }
        return comments(galleryHtml(gid, token, 0));
    }

    private synchronized Gallery gallery(long gid) {
        Gallery g = galleries.get(gid);
        if (g == null) { g = new Gallery(); galleries.put(gid, g); }
        return g;
    }

    private String pageToken(long gid, String token, int n) throws IOException {
        Gallery g = gallery(gid);
        synchronized (g) {
            String t = g.pageTokens.get(n);
            if (t != null) return t;
            if (g.perPage == 0) {
                int k = loadGalleryPage(gid, token, g, 0);
                if (k > 0) g.perPage = k;
                t = g.pageTokens.get(n);
                if (t != null) return t;
            }
            if (g.perPage == 0) throw new IOException("갤러리의 그림 목록을 읽지 못했습니다");
            int p = (n - 1) / g.perPage;
            loadGalleryPage(gid, token, g, p);
            t = g.pageTokens.get(n);
            if (t == null) {   // 한 쪽 당 개수가 다르면 앞뒤 쪽도 봄
                for (int q : new int[]{p + 1, p - 1}) {
                    if (q < 0) continue;
                    loadGalleryPage(gid, token, g, q);
                    if ((t = g.pageTokens.get(n)) != null) break;
                }
            }
            if (t == null) throw new IOException("페이지를 찾지 못했습니다");
            return t;
        }
    }

    /** 페이지 이미지의 주소와, 실패 시 다른 서버로 다시 받을 때 쓰는 nl 값. */
    private String[] imageUrl(long gid, String pageToken, int n, String nl) throws IOException {
        String html = get(BASE + "/s/" + pageToken + "/" + gid + "-" + n + (nl == null ? "" : "?nl=" + enc(nl)));
        Matcher m = IMG.matcher(html);
        boolean ok = m.find();
        if (!ok) { m = IMG_FALLBACK.matcher(html); ok = m.find(); }
        if (!ok) {
            if (html.contains("You have exceeded your image viewing limits") || html.contains("509.gif"))
                throw new IOException("e-hentai 이미지 보기 한도를 넘었습니다. 잠시 후 다시 시도하세요.");
            Matcher t = TITLE.matcher(html);
            throw new IOException("이미지 주소를 찾지 못했습니다 (" + (t.find() ? unescape(t.group(1)).trim() : html.length() + "자") + ")");
        }
        String src = unescape(m.group(1) != null ? m.group(1) : m.group(m.groupCount() >= 2 ? 2 : 1));
        if (src.contains("509.gif") || src.contains("/509s.gif"))
            throw new IOException("e-hentai 이미지 보기 한도를 넘었습니다. 잠시 후 다시 시도하세요.");
        Matcher k = NL.matcher(html);
        return new String[]{src, k.find() ? k.group(1) : null};
    }

    private byte[] download(String url) throws IOException {
        String host = new URL(url).getHost();
        try {
            return downloadOnce(url);
        } catch (IOException e) {
            if (e.getMessage() != null && e.getMessage().startsWith("HTTP ")) throw new IOException("이미지 서버(" + host + ") 응답 오류: " + e.getMessage());
            throw explain("이미지 서버 " + host, e);
        }
    }

    private byte[] downloadOnce(String url) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();   // 이미지 서버에는 로그인 쿠키를 보내지 않음
        c.setConnectTimeout(20000);
        c.setReadTimeout(40000);
        c.setRequestProperty("User-Agent", UA);
        c.setRequestProperty("Referer", BASE + "/");
        int code = c.getResponseCode();
        if (code >= 400) throw new IOException("HTTP " + code);
        try (InputStream in = c.getInputStream()) {
            ByteArrayOutputStream b = new ByteArrayOutputStream();
            byte[] buf = new byte[65536];
            int k;
            while ((k = in.read(buf)) > 0) b.write(buf, 0, k);
            byte[] data = b.toByteArray();
            if (data.length < 64) throw new IOException("빈 이미지");
            return data;
        }
    }

    private File pageFile(long gid, int n) { return new File(new File(cacheDir, String.valueOf(gid)), n + ".img"); }

    /** n 번째 페이지(1부터) 이미지. 받은 이미지는 기기에 보관해 다시 받지 않음. */
    byte[] page(long gid, String token, int n) throws IOException {
        File sf = savedFile(gid, n);
        if (sf.length() > 0) return Comics.readAll(new java.io.FileInputStream(sf));
        File f = pageFile(gid, n);
        if (f.length() > 0) {
            f.setLastModified(System.currentTimeMillis());
            return Comics.readAll(new java.io.FileInputStream(f));
        }
        String pt = pageToken(gid, token, n);
        String[] img = imageUrl(gid, pt, n, null);
        byte[] data;
        try {
            data = download(img[0]);
        } catch (IOException e) {
            if (img[1] == null) throw e;
            try {
                data = download(imageUrl(gid, pt, n, img[1])[0]);   // 다른 서버로 한 번 더
            } catch (IOException e2) {
                throw new IOException(e.getMessage() + " / 다른 서버: " + e2.getMessage());
            }
        }
        f.getParentFile().mkdirs();
        File tmp = new File(f.getPath() + ".tmp");
        try (FileOutputStream o = new FileOutputStream(tmp)) { o.write(data); }
        tmp.renameTo(f);
        pruneSoon();
        return data;
    }

    // ------------------------------------------------------------------ 기기에 저장한 만화
    File savedFile(long gid, int n) { return new File(new File(savedDir, String.valueOf(gid)), n + ".img"); }
    File savedCover(long gid) { return new File(new File(savedDir, String.valueOf(gid)), "cover.img"); }

    /** 저장한 쪽 수 */
    int savedCount(long gid) {
        File[] fs = new File(savedDir, String.valueOf(gid)).listFiles();
        int n = 0;
        if (fs != null) for (File f : fs) if (f.getName().endsWith(".img") && !f.getName().startsWith("cover") && f.length() > 0) n++;
        return n;
    }

    /** 한 쪽을 저장 (이미 보관한 이미지가 있으면 그것을 씀). */
    void savePage(long gid, String token, int n) throws IOException {
        File sf = savedFile(gid, n);
        if (sf.length() > 0) return;
        byte[] data = page(gid, token, n);
        writeFile(sf, data);
    }

    void saveCover(long gid, String thumbUrl) {
        File cf = savedCover(gid);
        if (cf.length() > 0 || thumbUrl == null || thumbUrl.isEmpty()) return;
        try { writeFile(cf, thumb(thumbUrl)); } catch (IOException ignored) {}
    }

    void deleteSaved(long gid) {
        File d = new File(savedDir, String.valueOf(gid));
        File[] fs = d.listFiles();
        if (fs != null) for (File f : fs) f.delete();
        d.delete();
    }

    private static void writeFile(File f, byte[] data) throws IOException {
        f.getParentFile().mkdirs();
        File tmp = new File(f.getPath() + ".tmp");
        try (FileOutputStream o = new FileOutputStream(tmp)) { o.write(data); }
        if (!tmp.renameTo(f)) throw new IOException("저장 실패");
    }

    // ------------------------------------------------------------------ 표지 (앱을 거쳐 받고 보관)
    static boolean thumbHostOk(String url) {
        try {
            String h = new URL(url).getHost().toLowerCase();
            return h.equals("ehgt.org") || h.endsWith(".ehgt.org") || h.endsWith("e-hentai.org") || h.endsWith(".hath.network");
        } catch (Exception e) {
            return false;
        }
    }

    byte[] thumb(String url) throws IOException {
        if (!thumbHostOk(url)) throw new IOException("허용되지 않은 주소");
        File f = new File(thumbDir, Integer.toHexString(url.hashCode()) + "-" + url.length() + ".img");
        if (f.length() > 0) return Comics.readAll(new java.io.FileInputStream(f));
        byte[] data = download(url);
        try { writeFile(f, data); } catch (IOException ignored) {}
        return data;
    }

    // ------------------------------------------------------------------ 즐겨찾기 추가·해제
    private static final Pattern FAV_BOX = Pattern.compile("id=\"fav\">\\s*<div([^>]*)>");
    private static final Pattern FAV_Y = Pattern.compile("background-position:\\s*0(?:px)?\\s+-(\\d+)px");
    private static final Pattern FAV_TITLE = Pattern.compile("title=\"([^\"]*)\"");

    /** 이 갤러리가 내 즐겨찾기 어느 폴더에 있는지. {"favcat": -1(없음)~9, "name": 폴더 이름} */
    JSONObject favoriteState(long gid, String token) throws IOException, JSONException {
        if (!loggedIn()) throw new NotLoggedIn();
        return favState(galleryHtml(gid, token, 0));
    }

    private static JSONObject favState(String html) throws JSONException {
        Matcher box = FAV_BOX.matcher(html);
        if (box.find()) {
            String attrs = box.group(1);
            Matcher y = FAV_Y.matcher(attrs), t = FAV_TITLE.matcher(attrs);
            int cat = y.find() ? Math.max(0, Math.min(9, Math.round((Integer.parseInt(y.group(1)) - 2) / 19f))) : 0;
            return new JSONObject().put("favcat", cat).put("name", t.find() ? unescape(t.group(1)) : "Favorites " + cat);
        }
        return new JSONObject().put("favcat", -1).put("name", "");
    }

    /** favcat 0~9 면 그 폴더로 추가(또는 옮김), -1 이면 즐겨찾기에서 뺌. */
    void setFavorite(long gid, String token, int favcat) throws IOException {
        if (!loggedIn()) throw new NotLoggedIn();
        String form = "favcat=" + (favcat < 0 ? "favdel" : String.valueOf(favcat)) + "&favnote=&update=1"
                + (favcat < 0 ? "&apply=Apply+Changes" : "&apply=Add+to+Favorites");
        String html = post(BASE + "/gallerypopups.php?gid=" + gid + "&t=" + token + "&act=addfav",
                "application/x-www-form-urlencoded", form.getBytes(StandardCharsets.UTF_8), null);
        forgetHtml();
        if (html.contains("This page requires you to log on")) throw new NotLoggedIn();
    }

    static String imageType(byte[] d) {
        if (d.length > 3 && (d[0] & 0xff) == 0x89 && d[1] == 'P') return "image/png";
        if (d.length > 3 && d[0] == 'G' && d[1] == 'I' && d[2] == 'F') return "image/gif";
        if (d.length > 11 && d[0] == 'R' && d[8] == 'W' && d[9] == 'E') return "image/webp";
        return "image/jpeg";
    }

    private long lastPrune = 0;

    /** 보관한 이미지가 한도를 넘으면 오래 안 본 것부터 지움. */
    private synchronized void pruneSoon() {
        if (System.currentTimeMillis() - lastPrune < 60_000) return;
        lastPrune = System.currentTimeMillis();
        List<File> files = new ArrayList<>();
        File[] dirs = cacheDir.listFiles();
        long total = 0;
        if (dirs == null) return;
        for (File d : dirs) {
            File[] fs = d.listFiles();
            if (fs == null) continue;
            for (File f : fs) { files.add(f); total += f.length(); }
        }
        if (total <= CACHE_LIMIT) return;
        files.sort((a, b) -> Long.compare(a.lastModified(), b.lastModified()));
        for (File f : files) {
            if (total <= CACHE_LIMIT * 0.8) break;
            total -= f.length();
            f.delete();
        }
    }

    // ------------------------------------------------------------------ 보관 용량
    static long dirSize(File d) {
        File[] fs = d.listFiles();
        long n = 0;
        if (fs != null) for (File f : fs) n += f.isDirectory() ? dirSize(f) : f.length();
        return n;
    }

    private static void deleteTree(File d) {
        File[] fs = d.listFiles();
        if (fs != null) for (File f : fs) { if (f.isDirectory()) deleteTree(f); f.delete(); }
    }

    /** {"cache": 읽은 페이지 보관, "thumbs": 표지 보관, "saved": 기기에 저장한 만화, "limit": 보관 한도} (바이트) */
    JSONObject usage() throws JSONException {
        return new JSONObject().put("cache", dirSize(cacheDir)).put("thumbs", dirSize(thumbDir))
                .put("saved", dirSize(savedDir)).put("limit", CACHE_LIMIT);
    }

    /** 읽은 페이지·표지 보관 파일을 지움 (기기에 저장한 만화는 그대로). */
    synchronized void clearCache() {
        deleteTree(cacheDir);
        deleteTree(thumbDir);
    }

    // ------------------------------------------------------------------ utils
    private static String enc(String s) {
        try { return URLEncoder.encode(s, "UTF-8"); } catch (Exception e) { return s; }
    }

    static String unescape(String s) {
        if (s == null || s.indexOf('&') < 0) return s == null ? "" : s;
        return android.text.Html.fromHtml(s, android.text.Html.FROM_HTML_MODE_LEGACY).toString();
    }

    static final List<String> FOLDER_CATS = Arrays.asList("0", "1", "2", "3", "4", "5", "6", "7", "8", "9");
}
