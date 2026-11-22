package app.mangaviewer;

import android.content.Context;
import android.content.res.AssetManager;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 앱 안 웹 화면이 쓰는 API: e-hentai 목록·검색·즐겨찾기, 읽은 위치, 기기에 저장한 만화, 페이지 이미지.
 * 앱 화면(WebView)만 가진 쿠키(mv_app)가 있어야 응답합니다.
 */
public class Comics implements HttpServer.Handler {

    private static Comics instance;

    public static synchronized Comics get(Context ctx) {
        if (instance == null) instance = new Comics(ctx.getApplicationContext());
        return instance;
    }

    private final Context ctx;
    private final File storeFile;
    private final EHentai eh;
    private JSONObject store;   // settings, eh_progress, eh_saved
    private final ScheduledExecutorService bg = Executors.newSingleThreadScheduledExecutor();

    private Comics(Context ctx) {
        this.ctx = ctx;
        storeFile = new File(ctx.getFilesDir(), "store.json");
        eh = new EHentai(new File(ctx.getCacheDir(), "eh"), new File(ctx.getFilesDir(), "eh-saved"), new File(ctx.getCacheDir(), "eh-thumbs"));
        load();
        loadLogin();
        new Thread(this::saveLoop).start();   // 저장하다 만 만화 이어 받기
    }

    // ------------------------------------------------------------------ 저장 파일
    private synchronized void load() {
        try {
            if (storeFile.exists()) store = new JSONObject(new String(readAll(new FileInputStream(storeFile)), StandardCharsets.UTF_8));
        } catch (Exception e) {
            store = null;
        }
        if (store == null) store = new JSONObject();
        try {
            if (!store.has("settings")) store.put("settings", new JSONObject());
            if (!settings().has("app_token")) settings().put("app_token", randomHex(32));
        } catch (JSONException ignored) {}
        save();
    }

    private boolean savePending = false;

    /** 저장을 잠시 모아서 한 번에 씀 */
    private synchronized void save() {
        if (savePending) return;
        savePending = true;
        bg.schedule(this::writeNow, 1500, TimeUnit.MILLISECONDS);
    }

    private synchronized void writeNow() {
        savePending = false;
        try {
            File tmp = new File(storeFile.getPath() + ".tmp");
            try (FileOutputStream o = new FileOutputStream(tmp)) {
                o.write(store.toString().getBytes(StandardCharsets.UTF_8));
            }
            if (!tmp.renameTo(storeFile)) {
                storeFile.delete();
                tmp.renameTo(storeFile);
            }
        } catch (IOException ignored) {}
    }

    private JSONObject settings() { return store.optJSONObject("settings"); }

    /** 앱 화면(WebView)만 가진 쿠키 값 */
    public synchronized String appToken() { return settings().optString("app_token"); }

    private boolean authed(HttpServer.Request r) {
        String cookie = r.header("cookie");
        if (cookie == null) return false;
        byte[] app = appToken().getBytes();
        for (String part : cookie.split(";")) {
            String p = part.trim();
            if (p.startsWith("mv_app=") && MessageDigest.isEqual(p.substring(7).getBytes(), app)) return true;
        }
        return false;
    }

    // ------------------------------------------------------------------ 로그인 쿠키
    private synchronized void loadLogin() {
        eh.memberId = settings().optString("eh_member_id", "");
        String plain = settings().optString("eh_pass_hash", "");
        eh.passHash = !plain.isEmpty() ? plain : SecretBox.open(settings().optString("eh_pass_hash_enc", ""));
    }

    private synchronized void saveLogin(String id, String hash) throws JSONException {
        JSONObject st = settings();
        st.put("eh_member_id", id);
        String sealed = SecretBox.seal(hash);
        if (sealed != null) { st.put("eh_pass_hash_enc", sealed); st.remove("eh_pass_hash"); }
        else st.put("eh_pass_hash", hash);   // 키 저장소를 못 쓰는 기기
        if (hash.isEmpty()) { st.remove("eh_pass_hash_enc"); st.remove("eh_pass_hash"); }
        eh.memberId = id;
        eh.passHash = hash;
        save();
    }

    /** 앱 안 로그인 화면에서 읽은 쿠키를 저장합니다. */
    public void setLogin(String id, String hash) {
        try { saveLogin(id, hash); } catch (JSONException ignored) {}
    }

    private synchronized JSONObject progress() throws JSONException {
        JSONObject o = store.optJSONObject("eh_progress");
        if (o == null) { o = new JSONObject(); store.put("eh_progress", o); }
        return o;
    }

    // ------------------------------------------------------------------ 기기에 저장한 만화
    private volatile String saveStatus = "";
    private final AtomicBoolean saving = new AtomicBoolean();

    private synchronized JSONObject saved() throws JSONException {
        JSONObject o = store.optJSONObject("eh_saved");
        if (o == null) { o = new JSONObject(); store.put("eh_saved", o); }
        return o;
    }

    /** 저장 목록에서 다 받지 못한 만화를 하나씩 받습니다. */
    private void saveLoop() {
        if (!saving.compareAndSet(false, true)) return;
        try {
            while (true) {
                long gid = -1;
                String token = null, title = "", thumb = "";
                int pages = 0;
                synchronized (this) {
                    JSONObject s = saved();
                    Iterator<String> it = s.keys();
                    while (it.hasNext()) {
                        String k = it.next();
                        JSONObject g = s.optJSONObject(k);
                        if (g == null || g.optBoolean("done", false) || g.optBoolean("paused", false)) continue;
                        gid = Long.parseLong(k); token = g.optString("token"); title = g.optString("title");
                        thumb = g.optString("thumb"); pages = g.optInt("pages");
                        break;
                    }
                }
                if (gid < 0) break;
                eh.saveCover(gid, thumb);
                String error = null;
                for (int n = 1; n <= pages; n++) {
                    synchronized (this) { if (saved().optJSONObject(String.valueOf(gid)) == null) break; }   // 저장 취소됨
                    saveStatus = "만화 저장 중… " + title + " " + n + "/" + pages;
                    try {
                        eh.savePage(gid, token, n);
                    } catch (IOException e) {
                        error = e.getMessage();
                        break;
                    }
                }
                synchronized (this) {
                    JSONObject g = saved().optJSONObject(String.valueOf(gid));
                    if (g != null) {
                        try {
                            if (error == null) { g.put("done", true); g.remove("error"); }
                            else { g.put("paused", true); g.put("error", error); }   // 오류가 나면 멈추고, ‘이어 받기’를 누르면 다시 받음
                        } catch (JSONException ignored) {}
                        save();
                    }
                }
            }
        } catch (Exception ignored) {
        } finally {
            saveStatus = "";
            saving.set(false);
        }
    }

    // ------------------------------------------------------------------ HTTP
    @Override
    public void handle(HttpServer.Request r, HttpServer.Response res) throws Exception {
        String path = r.path;
        if (path.startsWith("/api/") || path.startsWith("/eh/")) {
            if (!authed(r)) { res.error(401, "앱 안에서만 열 수 있습니다"); return; }
        }
        if (path.startsWith("/api/")) {
            api(r, res, path.substring(5));
            return;
        }
        if (path.equals("/eh/thumb") || path.startsWith("/eh/cover/")) {
            byte[] img;
            try {
                if (path.startsWith("/eh/cover/")) {
                    File f = eh.savedCover(parseLong(path.substring(10), -1));
                    if (f.length() == 0) { res.error(404, "not found"); return; }
                    img = readAll(new FileInputStream(f));
                } else {
                    img = eh.thumb(nz(r.param("u")));
                }
            } catch (IOException e) {
                res.error(502, e.getMessage() == null ? "표지를 받지 못했습니다" : e.getMessage());
                return;
            }
            res.header("Cache-Control", "max-age=604800");
            res.send(200, EHentai.imageType(img), img);
            return;
        }
        if (path.startsWith("/eh/page/")) {   // /eh/page/{gid}/{token}/{n}
            String[] p = path.split("/");
            long gid = p.length > 5 ? parseLong(p[3], -1) : -1;
            int n = p.length > 5 ? parseInt(p[5], -1) : -1;
            if (gid < 0 || n < 1 || !p[4].matches("[0-9a-f]{10}")) { res.error(404, "not found"); return; }
            byte[] img;
            try {
                img = eh.page(gid, p[4], n);
            } catch (IOException e) {
                res.error(502, e.getMessage() == null ? "e-hentai 연결 실패" : e.getMessage());
                return;
            }
            res.header("Cache-Control", "max-age=604800");
            res.send(200, EHentai.imageType(img), img);
            return;
        }
        staticFile(path, res);
    }

    private void staticFile(String path, HttpServer.Response res) throws IOException {
        String name = path.equals("/") || path.isEmpty() ? "index.html" : path.substring(1);
        if (name.contains("..")) name = "index.html";
        AssetManager am = ctx.getAssets();
        byte[] body;
        try {
            body = readAll(am.open(name));
        } catch (IOException e) {
            name = "index.html";
            body = readAll(am.open(name));
        }
        String type = name.endsWith(".js") ? "text/javascript; charset=utf-8"
                : name.endsWith(".css") ? "text/css; charset=utf-8"
                : name.endsWith(".svg") ? "image/svg+xml" : "text/html; charset=utf-8";
        res.header("Cache-Control", "no-cache");
        res.send(200, type, body);
    }

    private void api(HttpServer.Request r, HttpServer.Response res, String path) throws Exception {
        String[] parts = path.split("/");
        String m = r.method;
        String p0 = parts.length > 0 ? parts[0] : "";
        if (p0.equals("status")) {
            res.json(200, new JSONObject().put("job", saveStatus).toString());
            return;
        }
        if (p0.equals("cache") && m.equals("GET")) {
            res.json(200, eh.usage().toString());
            return;
        }
        if (p0.equals("cache") && parts.length > 1 && parts[1].equals("clear") && m.equals("POST")) {
            eh.clearCache();
            res.json(200, eh.usage().toString());
            return;
        }
        if (p0.equals("eh")) { ehApi(r, res, parts.length > 1 ? parts[1] : "", m); return; }
        res.error(404, "unknown endpoint");
    }

    private void ehApi(HttpServer.Request r, HttpServer.Response res, String action, String m) throws Exception {
        if (action.equals("status")) {
            res.json(200, new JSONObject().put("logged_in", eh.loggedIn()).put("in_app", true).toString());
            return;
        }
        if (action.equals("login") && m.equals("POST")) {
            JSONObject b = body(r);
            String id, hash;
            try {
                if (b.has("member_id")) {   // 쿠키로 로그인
                    id = b.optString("member_id").trim();
                    hash = b.optString("pass_hash").trim();
                    if (!id.matches("\\d+") || !hash.matches("[0-9a-fA-F]{32}")) { res.error(400, "ipb_member_id 는 숫자, ipb_pass_hash 는 32자리 영문·숫자입니다"); return; }
                } else {
                    String[] c = eh.login(b.optString("user").trim(), b.optString("pass"));
                    id = c[0];
                    hash = c[1];
                }
            } catch (IOException e) {
                res.error(400, e.getMessage());
                return;
            }
            String oldId = eh.memberId, oldHash = eh.passHash;
            saveLogin(id, hash);
            try {
                eh.favorites("all", null, null);   // 실제로 즐겨찾기를 볼 수 있는지 확인
            } catch (EHentai.NotLoggedIn e) {
                saveLogin(oldId, oldHash);
                res.error(400, "로그인 정보가 맞지 않습니다. 다시 확인하세요.");
                return;
            } catch (IOException ignored) {
                // 네트워크 문제는 로그인 실패로 보지 않음
            }
            res.json(200, "{\"ok\":true}");
            return;
        }
        if (action.equals("logout") && m.equals("POST")) {
            saveLogin("", "");
            res.json(200, "{\"ok\":true}");
            return;
        }
        if (action.equals("saved")) {
            JSONArray items = new JSONArray();
            synchronized (this) {
                JSONObject s = saved(), prog = progress();
                List<String> keys = new ArrayList<>();
                Iterator<String> it = s.keys();
                while (it.hasNext()) keys.add(it.next());
                keys.sort((a, b2) -> Long.compare(s.optJSONObject(b2).optLong("at"), s.optJSONObject(a).optLong("at")));
                for (String k : keys) {
                    JSONObject g = s.optJSONObject(k), pr = prog.optJSONObject(k);
                    long gid = Long.parseLong(k);
                    items.put(new JSONObject().put("gid", gid).put("token", g.optString("token")).put("title", g.optString("title"))
                            .put("title_jpn", "").put("category", g.optString("category")).put("pages", g.optInt("pages"))
                            .put("thumb", eh.savedCover(gid).length() > 0 ? "/eh/cover/" + gid : g.optString("thumb"))
                            .put("saved_pages", eh.savedCount(gid)).put("done", g.optBoolean("done", false))
                            .put("error", g.optString("error", "")).put("read_page", pr == null ? 0 : pr.optInt("page")));
                }
            }
            res.json(200, new JSONObject().put("items", items).toString());
            return;
        }
        if (action.equals("save") && m.equals("POST")) {
            JSONObject b = body(r);
            long gid = b.optLong("gid", -1);
            if (gid < 0 || !b.optString("token").matches("[0-9a-f]{10}")) { res.error(400, "잘못된 갤러리"); return; }
            synchronized (this) {
                JSONObject g = saved().optJSONObject(String.valueOf(gid));
                if (g == null) {
                    g = new JSONObject().put("at", System.currentTimeMillis() / 1000);
                    saved().put(String.valueOf(gid), g);
                }
                for (String k : new String[]{"token", "title", "thumb", "category"}) if (b.has(k)) g.put(k, b.optString(k));
                g.put("pages", b.optInt("pages", g.optInt("pages")));
                g.remove("paused");
                g.remove("error");
                g.put("done", false);
                save();
            }
            new Thread(this::saveLoop).start();
            res.json(200, "{\"ok\":true}");
            return;
        }
        if (action.equals("unsave") && m.equals("POST")) {
            long gid = body(r).optLong("gid", -1);
            synchronized (this) { saved().remove(String.valueOf(gid)); save(); }
            eh.deleteSaved(gid);
            res.json(200, "{\"ok\":true}");
            return;
        }
        if (action.equals("favstate") || (action.equals("fav") && m.equals("POST"))) {
            long gid = parseLong(r.param("gid"), -1);
            String t = nz(r.param("t"));
            JSONObject b = action.equals("fav") ? body(r) : null;
            if (b != null) { gid = b.optLong("gid", -1); t = b.optString("t"); }
            if (gid < 0 || !t.matches("[0-9a-f]{10}")) { res.error(400, "잘못된 갤러리"); return; }
            try {
                if (b != null) eh.setFavorite(gid, t, b.optInt("favcat", -1));
                res.json(200, eh.favoriteState(gid, t).put("logged_in", true).toString());
            } catch (EHentai.NotLoggedIn e) {
                res.json(200, new JSONObject().put("logged_in", false).put("favcat", -1).toString());
            } catch (IOException e) {
                res.error(502, e.getMessage());
            }
            return;
        }
        if (action.equals("recent")) {   // 최근 읽은 만화 (네트워크 없이, 저장해 둔 정보로)
            List<JSONObject> list = new ArrayList<>();
            synchronized (this) {
                JSONObject prog = progress();
                Iterator<String> it = prog.keys();
                while (it.hasNext()) {
                    String gid = it.next();
                    JSONObject pr = prog.optJSONObject(gid);
                    if (pr == null || !pr.has("token")) continue;
                    list.add(new JSONObject().put("gid", Long.parseLong(gid)).put("token", pr.optString("token"))
                            .put("title", pr.optString("title")).put("title_jpn", "").put("thumb", pr.optString("thumb"))
                            .put("pages", pr.optInt("pages")).put("read_page", pr.optInt("page")).put("category", "")
                            .put("at", pr.optLong("at")));
                }
            }
            list.sort((a, b2) -> Long.compare(b2.optLong("at"), a.optLong("at")));
            JSONArray items = new JSONArray();
            for (JSONObject o : list.subList(0, Math.min(20, list.size()))) items.put(o);
            res.json(200, new JSONObject().put("items", items).toString());
            return;
        }
        if (action.equals("progress") && m.equals("POST")) {
            JSONObject b = body(r);
            synchronized (this) {
                JSONObject pr = new JSONObject().put("page", b.optInt("page", 1)).put("at", System.currentTimeMillis() / 1000);
                for (String k : new String[]{"token", "title", "thumb"}) if (b.has(k)) pr.put(k, b.optString(k));
                if (b.has("pages")) pr.put("pages", b.optInt("pages"));
                progress().put(String.valueOf(b.optLong("gid")), pr);
                save();
            }
            res.json(200, "{\"ok\":true}");
            return;
        }
        if (action.equals("favorites") || action.equals("gallery") || action.equals("search")) {
            JSONArray items;
            JSONObject out = new JSONObject();
            try {
                if (action.equals("favorites")) {
                    out = eh.favorites(r.param("favcat"), r.param("q"), r.param("next"));
                    items = out.getJSONArray("items");
                } else if (action.equals("search")) {
                    String q = nz(r.param("q")).trim();
                    out = eh.search("language:korean" + (q.isEmpty() ? "" : " " + q), r.param("next"));
                    items = out.getJSONArray("items");
                } else {
                    List<Object[]> one = new ArrayList<>();
                    String t = nz(r.param("t"));
                    if (!t.matches("[0-9a-f]{10}")) { res.error(400, "잘못된 갤러리 주소"); return; }
                    one.add(new Object[]{parseLong(r.param("gid"), -1), t});
                    items = eh.gdata(one);
                    if (items.length() == 0) { res.error(404, "갤러리를 찾지 못했습니다 (삭제되었을 수 있습니다)"); return; }
                }
            } catch (EHentai.NotLoggedIn e) {
                res.json(200, new JSONObject().put("logged_in", false).toString());
                return;
            } catch (IOException e) {
                res.error(502, e.getMessage() == null ? "e-hentai 연결 실패" : e.getMessage());
                return;
            }
            synchronized (this) {
                JSONObject prog = progress();
                for (int i = 0; i < items.length(); i++) {
                    JSONObject g = items.getJSONObject(i), pr = prog.optJSONObject(String.valueOf(g.optLong("gid")));
                    g.put("read_page", pr == null ? 0 : pr.optInt("page", 0));
                }
            }
            res.json(200, (action.equals("gallery") ? items.getJSONObject(0) : out.put("logged_in", eh.loggedIn())).toString());
            return;
        }
        res.error(404, "unknown endpoint");
    }

    // ------------------------------------------------------------------ utils
    private static JSONObject body(HttpServer.Request r) {
        try {
            String s = r.bodyText();
            return s.isEmpty() ? new JSONObject() : new JSONObject(s);
        } catch (JSONException e) {
            return new JSONObject();
        }
    }

    static byte[] readAll(InputStream in) throws IOException {
        try (InputStream i = in) {
            ByteArrayOutputStream b = new ByteArrayOutputStream();
            byte[] buf = new byte[65536];
            int n;
            while ((n = i.read(buf)) > 0) b.write(buf, 0, n);
            return b.toByteArray();
        }
    }

    private static String nz(String s) { return s == null ? "" : s; }

    private static int parseInt(String s, int d) {
        try { return Integer.parseInt(s.trim()); } catch (Exception e) { return d; }
    }

    private static long parseLong(String s, long d) {
        try { return Long.parseLong(s.trim()); } catch (Exception e) { return d; }
    }

    static String randomHex(int bytes) {
        byte[] b = new byte[bytes];
        new SecureRandom().nextBytes(b);
        StringBuilder sb = new StringBuilder();
        for (byte x : b) sb.append(String.format("%02x", x));
        return sb.toString();
    }
}
