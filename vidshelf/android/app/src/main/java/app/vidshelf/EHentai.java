package app.vidshelf;

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

    private final File cacheDir;
    volatile String memberId = "", passHash = "";

    /** 갤러리별 페이지 토큰 (페이지 번호 → /s/ 토큰) */
    private static class Gallery {
        int perPage;
        final Map<Integer, String> pageTokens = new HashMap<>();
    }
    private final Map<Long, Gallery> galleries = new LinkedHashMap<Long, Gallery>(16, .75f, true) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<Long, Gallery> e) { return size() > 50; }
    };

    EHentai(File cacheDir) { this.cacheDir = cacheDir; }

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
        int code;
        try {
            code = c.getResponseCode();
        } catch (IOException e) {
            throw new IOException(new URL(url).getHost() + " 연결 실패: " + (e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage()));
        }
        if (code >= 400) throw new IOException("e-hentai 응답 오류 (HTTP " + code + ")");
        try (InputStream in = c.getInputStream()) {
            return new String(Library.readAll(in), StandardCharsets.UTF_8);
        }
    }

    private String post(String url, String type, byte[] body, HttpURLConnection[] keep) throws IOException {
        HttpURLConnection c = open(url);
        c.setDoOutput(true);
        c.setRequestMethod("POST");
        c.setRequestProperty("Content-Type", type);
        if (keep != null) { c.setInstanceFollowRedirects(false); keep[0] = c; }
        try (OutputStream o = c.getOutputStream()) { o.write(body); }
        int code = c.getResponseCode();
        InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
        if (in == null) return "";
        try (InputStream i = in) { return new String(Library.readAll(i), StandardCharsets.UTF_8); }
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

        // 갤러리 목록 (순서 유지, 중복 제거)
        Set<String> seen = new LinkedHashSet<>();
        List<Object[]> ids = new ArrayList<>();
        Matcher m = GALLERY_LINK.matcher(html);
        while (m.find()) if (seen.add(m.group(1))) ids.add(new Object[]{Long.parseLong(m.group(1)), m.group(2)});

        // 다음 쪽
        String nextCursor = null;
        Matcher nm = NEXT_LINK.matcher(html);
        if (nm.find()) {
            String href = unescape(nm.group(1) != null ? nm.group(1) : nm.group(2));
            Matcher c = Pattern.compile("[?&]next=([^&#]+)").matcher(href);
            if (c.find()) nextCursor = java.net.URLDecoder.decode(c.group(1), "UTF-8");
        }

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

    /** 갤러리 목록 한 쪽(p, 0부터)을 읽어 페이지 토큰을 기억합니다. 그 쪽에 있던 페이지 수를 돌려줌. */
    private int loadGalleryPage(long gid, String token, Gallery g, int p) throws IOException {
        String url = BASE + "/g/" + gid + "/" + token + "/?p=" + p;
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
        Matcher m = PAGE_LINK.matcher(html);
        Set<Integer> found = new LinkedHashSet<>();
        while (m.find()) {
            if (Long.parseLong(m.group(2)) != gid) continue;
            int n = Integer.parseInt(m.group(3));
            g.pageTokens.put(n, m.group(1));
            found.add(n);
        }
        return found.size();
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
            String why = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
            throw new IOException("이미지 서버(" + host + ") 연결 실패: " + why);
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
        File f = pageFile(gid, n);
        if (f.length() > 0) {
            f.setLastModified(System.currentTimeMillis());
            return Library.readAll(new java.io.FileInputStream(f));
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
