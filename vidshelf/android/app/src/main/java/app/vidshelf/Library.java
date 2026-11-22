package app.vidshelf;

import android.content.ContentUris;
import android.content.Context;
import android.content.res.AssetManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.MediaStore;
import android.util.Size;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpCookie;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Random;
import java.util.Set;
import java.util.TreeSet;
import java.util.concurrent.Semaphore;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import javax.crypto.Mac;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * 영상 목록(MediaStore) + 사용자 정보(태그·별점 등, JSON 파일) + 웹 API.
 * API 는 vidshelf/server.py 와 같은 형식이라 같은 웹 화면(vidshelf/static)을 씁니다.
 */
public class Library implements HttpServer.Handler {

    static final int N_FRAMES = 8;
    static final String[] DEFAULT_PATHS = {"DCIM/", "Download/"};
    private static final Set<String> DIRECT_EXTS = new HashSet<>(java.util.Arrays.asList(
            "mp4", "m4v", "mov", "mkv", "webm", "3gp", "ogv"));

    private static Library instance;

    public static synchronized Library get(Context ctx) {
        if (instance == null) instance = new Library(ctx.getApplicationContext());
        return instance;
    }

    static class Video {
        long id;
        String name, relPath, mime, key;
        long size, dateAdded, dateModified;
        double duration;
        int width, height;
        Uri uri;
        Mega.Link link;      // MEGA 영상이면 설정됨
        Mega.Node node;
    }

    private final Context ctx;
    private final File storeFile, thumbDir;
    private JSONObject store;                         // settings, videos(meta), tags, performers, seq
    private List<Video> all = new ArrayList<>();      // MediaStore 의 모든 영상
    private final Map<Long, Video> byId = new HashMap<>();
    private long lastScan = 0;
    private final Semaphore frameLock = new Semaphore(2);
    private final List<Mega.Link> megaLinks = new ArrayList<>();
    private static final Set<String> MEGA_VIDEO_EXTS = new HashSet<>(java.util.Arrays.asList(
            "mp4", "m4v", "mov", "mkv", "webm", "3gp", "ogv", "avi", "wmv", "flv", "ts", "mpg", "mpeg"));

    private Library(Context ctx) {
        this.ctx = ctx;
        storeFile = new File(ctx.getFilesDir(), "library.json");
        thumbDir = new File(ctx.getCacheDir(), "thumbs");
        load();
        JSONArray links = settings().optJSONArray("mega_links");
        for (int i = 0; links != null && i < links.length(); i++) {
            try { megaLinks.add(Mega.parse(links.optString(i))); } catch (Exception ignored) {}
        }
        new Thread(this::refreshMega).start();
    }

    // ------------------------------------------------------------------ MEGA
    /** 모든 MEGA 링크의 파일 목록을 다시 받습니다 (네트워크 작업, 잠금 밖에서 실행). */
    public void refreshMega() {
        List<Mega.Link> links;
        synchronized (this) { links = new ArrayList<>(megaLinks); }
        for (Mega.Link l : links) Mega.load(l);
        scan();
    }

    private synchronized void saveMegaLinks() {
        JSONArray a = new JSONArray();
        for (Mega.Link l : megaLinks) a.put(l.url);
        try { settings().put("mega_links", a); } catch (JSONException ignored) {}
        save();
    }

    private synchronized JSONArray megaJson() throws JSONException {
        JSONArray out = new JSONArray();
        for (int i = 0; i < megaLinks.size(); i++) {
            Mega.Link l = megaLinks.get(i);
            int files = 0, vids = 0;
            for (Mega.Node n : l.nodes) if (!n.folder) { files++; if (MEGA_VIDEO_EXTS.contains(ext(n.name))) vids++; }
            out.put(new JSONObject().put("index", i).put("name", l.name).put("handle", l.handle)
                    .put("files", files).put("videos", vids).put("loaded", l.loadedAt > 0)
                    .put("error", l.error == null ? JSONObject.NULL : l.error));
        }
        return out;
    }

    private synchronized JSONObject megaBrowse(int index, String folder) throws JSONException {
        if (index < 0 || index >= megaLinks.size()) return null;
        Mega.Link l = megaLinks.get(index);
        Map<String, Mega.Node> by = l.byHandle;
        Mega.Node cur = folder == null || folder.isEmpty() ? null : by.get(folder);
        if (cur == null) {
            cur = by.get(l.handle);
            if (cur == null) for (Mega.Node n : l.nodes) if (n.folder && !by.containsKey(n.parent)) { cur = n; break; }
        }
        JSONObject o = new JSONObject().put("link", new JSONObject().put("index", index).put("name", l.name))
                .put("error", l.error == null ? JSONObject.NULL : l.error);
        if (cur == null) return o.put("folders", new JSONArray()).put("files", new JSONArray()).put("crumbs", new JSONArray());
        List<JSONObject> crumbs = new ArrayList<>();
        Mega.Node c = cur;
        int guard = 0;
        while (c != null && guard++ < 64) {
            crumbs.add(0, new JSONObject().put("handle", c.handle).put("name", c.name));
            c = by.get(c.parent);
        }
        List<Mega.Node> folders = new ArrayList<>(), files = new ArrayList<>();
        for (Mega.Node n : l.nodes) if (cur.handle.equals(n.parent)) (n.folder ? folders : files).add(n);
        Comparator<Mega.Node> byName = Comparator.comparing(n -> n.name.toLowerCase(Locale.ROOT));
        folders.sort(byName);
        files.sort(byName);
        JSONArray fo = new JSONArray(), fi = new JSONArray();
        for (Mega.Node n : folders) fo.put(new JSONObject().put("handle", n.handle).put("name", n.name));
        for (Mega.Node n : files) {
            String e = ext(n.name);
            String kind = MEGA_VIDEO_EXTS.contains(e) ? "video" : mimeFor(e).startsWith("image/") ? "image" : mimeFor(e).startsWith("audio/") ? "audio" : "file";
            fi.put(new JSONObject().put("handle", n.handle).put("name", n.name).put("size", n.size).put("kind", kind)
                    .put("id", kind.equals("video") ? n.id : JSONObject.NULL).put("thumb", n.thumbHandle != null)
                    .put("url", "/mega-file/" + index + "/" + n.handle));
        }
        return o.put("folder", new JSONObject().put("handle", cur.handle).put("name", cur.name))
                .put("crumbs", new JSONArray(crumbs)).put("folders", fo).put("files", fi);
    }

    static String ext(String name) {
        int d = name.lastIndexOf('.');
        return d >= 0 ? name.substring(d + 1).toLowerCase(Locale.ROOT) : "";
    }

    static String mimeFor(String ext) {
        switch (ext) {
            case "mp4": case "m4v": case "mov": case "3gp": return "video/mp4";
            case "mkv": case "webm": return "video/webm";
            case "ogv": return "video/ogg";
            case "avi": return "video/x-msvideo";
            case "jpg": case "jpeg": return "image/jpeg";
            case "png": return "image/png";
            case "gif": return "image/gif";
            case "webp": return "image/webp";
            case "heic": return "image/heic";
            case "mp3": return "audio/mpeg";
            case "m4a": case "aac": return "audio/mp4";
            case "ogg": case "opus": return "audio/ogg";
            case "wav": return "audio/wav";
            case "flac": return "audio/flac";
            case "pdf": return "application/pdf";
            case "txt": case "srt": case "vtt": case "md": return "text/plain; charset=utf-8";
            default: return "application/octet-stream";
        }
    }

    // ------------------------------------------------------------------ store
    private synchronized void load() {
        try {
            if (storeFile.exists()) {
                byte[] b = readAll(new FileInputStream(storeFile));
                store = new JSONObject(new String(b, StandardCharsets.UTF_8));
            }
        } catch (Exception e) {
            store = null;
        }
        if (store == null) store = new JSONObject();
        try {
            if (!store.has("settings")) store.put("settings", new JSONObject());
            if (!store.has("videos")) store.put("videos", new JSONObject());
            if (!store.has("tags")) store.put("tags", new JSONObject());
            if (!store.has("performers")) store.put("performers", new JSONObject());
            if (!store.has("seq")) store.put("seq", 1);
            JSONObject st = settings();
            if (!st.has("library_paths")) st.put("library_paths", new JSONArray(DEFAULT_PATHS));
            if (!st.has("secret")) st.put("secret", randomHex(32));
        } catch (JSONException ignored) {
        }
        save();
    }

    private synchronized void save() {
        try {
            File tmp = new File(storeFile.getPath() + ".tmp");
            try (FileOutputStream o = new FileOutputStream(tmp)) {
                o.write(store.toString().getBytes(StandardCharsets.UTF_8));
            }
            if (!tmp.renameTo(storeFile)) {
                storeFile.delete();
                tmp.renameTo(storeFile);
            }
        } catch (IOException ignored) {
        }
    }

    private JSONObject settings() { return store.optJSONObject("settings"); }

    private synchronized long nextId() {
        long n = store.optLong("seq", 1);
        try { store.put("seq", n + 1); } catch (JSONException ignored) {}
        return n;
    }

    private synchronized JSONObject meta(Video v) {
        JSONObject vids = store.optJSONObject("videos");
        JSONObject m = vids.optJSONObject(v.key);
        if (m == null) {
            m = new JSONObject();
            try {
                vids.put(v.key, m);
            } catch (JSONException ignored) {}
        }
        return m;
    }

    public synchronized List<String> libraryPaths() {
        List<String> out = new ArrayList<>();
        JSONArray a = settings().optJSONArray("library_paths");
        if (a != null) for (int i = 0; i < a.length(); i++) out.add(a.optString(i));
        return out;
    }

    public synchronized boolean lanEnabled() { return settings().optBoolean("lan", false); }

    public synchronized void setLan(boolean on) {
        try { settings().put("lan", on); } catch (JSONException ignored) {}
        save();
    }

    public synchronized boolean passwordSet() { return settings().has("password_hash"); }

    public synchronized void setPassword(String pw) {
        try {
            if (pw == null || pw.isEmpty()) {
                settings().remove("password_hash");
                settings().remove("salt");
            } else {
                String salt = randomHex(8);
                settings().put("salt", salt);
                settings().put("password_hash", hashPassword(pw, salt));
            }
        } catch (JSONException ignored) {
        }
        save();
    }

    // ------------------------------------------------------------------ MediaStore scan
    public synchronized void scan() {
        List<Video> list = new ArrayList<>();
        Uri base = MediaStore.Video.Media.EXTERNAL_CONTENT_URI;
        String[] proj = {
                MediaStore.Video.Media._ID, MediaStore.Video.Media.DISPLAY_NAME, MediaStore.Video.Media.RELATIVE_PATH,
                MediaStore.Video.Media.SIZE, MediaStore.Video.Media.DURATION, MediaStore.Video.Media.WIDTH,
                MediaStore.Video.Media.HEIGHT, MediaStore.Video.Media.DATE_ADDED, MediaStore.Video.Media.DATE_MODIFIED,
                MediaStore.Video.Media.MIME_TYPE};
        try (Cursor c = ctx.getContentResolver().query(base, proj, null, null, null)) {
            if (c != null) {
                while (c.moveToNext()) {
                    Video v = new Video();
                    v.id = c.getLong(0);
                    v.name = nz(c.getString(1));
                    v.relPath = nz(c.getString(2));
                    v.size = c.getLong(3);
                    v.duration = c.getLong(4) / 1000.0;
                    v.width = c.getInt(5);
                    v.height = c.getInt(6);
                    v.dateAdded = c.getLong(7);
                    v.dateModified = c.getLong(8);
                    v.mime = c.getString(9);
                    v.uri = ContentUris.withAppendedId(base, v.id);
                    v.key = v.relPath + v.name + "|" + v.size;
                    list.add(v);
                }
            }
        } catch (SecurityException e) {
            // 권한 없음 — 빈 목록
        }
        for (Mega.Link l : megaLinks) {
            List<Mega.Node> nodes;
            synchronized (l) { nodes = new ArrayList<>(l.nodes); }
            for (Mega.Node n : nodes) {
                if (n.folder || !MEGA_VIDEO_EXTS.contains(ext(n.name))) continue;
                Video v = new Video();
                v.id = n.id;
                v.name = n.name;
                v.relPath = "MEGA/" + n.path;
                v.size = n.size;
                v.dateAdded = n.ts;
                v.dateModified = n.ts;
                v.mime = mimeFor(ext(n.name));
                v.key = "mega:" + n.handle;
                v.link = l;
                v.node = n;
                list.add(v);
            }
        }
        all = list;
        byId.clear();
        for (Video v : list) byId.put(v.id, v);
        lastScan = System.currentTimeMillis();
    }

    private synchronized List<Video> visible() {
        if (lastScan == 0 || System.currentTimeMillis() - lastScan > 60_000) scan();
        List<String> paths = libraryPaths();
        List<Video> out = new ArrayList<>();
        for (Video v : all) {
            if (v.node != null) {   // MEGA 영상은 폴더 설정과 관계없이 표시
                if (!meta(v).optBoolean("hidden", false)) out.add(v);
                continue;
            }
            boolean in = false;
            for (String p : paths) if (v.relPath.startsWith(p)) { in = true; break; }
            if (!in) continue;
            if (meta(v).optBoolean("hidden", false)) continue;
            out.add(v);
        }
        return out;
    }

    public synchronized int videoCount() { return visible().size(); }

    // ------------------------------------------------------------------ JSON views
    private String title(Video v) {
        String t = meta(v).optString("title", "");
        if (!t.isEmpty()) return t;
        int dot = v.name.lastIndexOf('.');
        return dot > 0 ? v.name.substring(0, dot) : v.name;
    }

    private JSONObject summary(Video v) throws JSONException {
        JSONObject m = meta(v);
        JSONObject o = new JSONObject();
        o.put("id", v.id);
        o.put("title", title(v));
        o.put("duration", v.node != null ? m.optDouble("duration", 0) : v.duration);
        o.put("width", v.width);
        o.put("height", v.height);
        o.put("size", v.size);
        o.put("rating", m.optInt("rating", 0));
        o.put("favorite", m.optBoolean("favorite", false) ? 1 : 0);
        o.put("play_count", m.optInt("play_count", 0));
        o.put("thumbs", v.node != null ? (v.node.thumbHandle != null ? 1 : 0) : N_FRAMES);
        o.put("missing", 0);
        o.put("resume_pos", m.optDouble("resume_pos", 0));
        o.put("added_at", v.dateAdded);
        return o;
    }

    private JSONArray entityRefs(JSONObject m, String field) throws JSONException {
        JSONArray ids = m.optJSONArray(field);
        JSONObject names = store.optJSONObject(field);
        List<JSONObject> out = new ArrayList<>();
        if (ids != null) for (int i = 0; i < ids.length(); i++) {
            String id = String.valueOf(ids.optLong(i));
            if (names.has(id)) out.add(new JSONObject().put("id", Long.parseLong(id)).put("name", names.optString(id)));
        }
        out.sort(Comparator.comparing(o -> o.optString("name").toLowerCase(Locale.ROOT)));
        return new JSONArray(out);
    }

    private synchronized JSONObject detail(Video v) throws JSONException {
        JSONObject m = meta(v);
        JSONObject o = summary(v);
        o.put("path", v.relPath + v.name);
        o.put("filename", v.name);
        o.put("folder", v.relPath);
        o.put("vcodec", v.mime == null ? JSONObject.NULL : v.mime);
        o.put("acodec", JSONObject.NULL);
        o.put("bitrate", v.duration > 0 ? (long) (v.size * 8 / v.duration) : 0);
        o.put("fps", 0);
        o.put("details", m.optString("details", ""));
        o.put("last_played", m.has("last_played") ? m.optLong("last_played") : JSONObject.NULL);
        o.put("tags", entityRefs(m, "tags"));
        o.put("performers", entityRefs(m, "performers"));
        JSONArray markers = m.optJSONArray("markers");
        o.put("markers", markers == null ? new JSONArray() : markers);
        String ext = v.name.contains(".") ? v.name.substring(v.name.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT) : "";
        o.put("direct_play", DIRECT_EXTS.contains(ext));
        o.put("can_transcode", false);
        o.put("can_delete", false);
        o.put("source", v.node != null ? "mega" : "local");
        return o;
    }

    private synchronized JSONObject listVideos(HttpServer.Request r) throws JSONException {
        List<Video> list = new ArrayList<>();
        String q = nz(r.param("q")).trim().toLowerCase(Locale.ROOT);
        String[] words = q.isEmpty() ? new String[0] : q.split("\\s+");
        Set<Long> tagFilter = longs(r.params("tag")), perfFilter = longs(r.params("performer"));
        boolean fav = "1".equals(r.param("fav")), unwatched = "1".equals(r.param("unwatched"));
        int minRating = parseInt(r.param("min_rating"), 0);
        if ("1".equals(r.param("missing"))) return new JSONObject().put("total", 0).put("page", 1).put("per", 40).put("items", new JSONArray());
        for (Video v : visible()) {
            JSONObject m = meta(v);
            if (fav && !m.optBoolean("favorite", false)) continue;
            if (unwatched && m.optInt("play_count", 0) > 0) continue;
            if (m.optInt("rating", 0) < minRating) continue;
            if (!containsAll(m.optJSONArray("tags"), tagFilter) || !containsAll(m.optJSONArray("performers"), perfFilter)) continue;
            if (words.length > 0) {
                StringBuilder hay = new StringBuilder(title(v)).append(' ').append(v.relPath).append(v.name).append(' ').append(m.optString("details"));
                for (String f : new String[]{"tags", "performers"}) {
                    JSONArray ids = m.optJSONArray(f);
                    if (ids != null) for (int i = 0; i < ids.length(); i++)
                        hay.append(' ').append(store.optJSONObject(f).optString(String.valueOf(ids.optLong(i))));
                }
                String h = hay.toString().toLowerCase(Locale.ROOT);
                boolean ok = true;
                for (String w : words) if (!h.contains(w)) { ok = false; break; }
                if (!ok) continue;
            }
            list.add(v);
        }
        String sort = r.param("sort") == null ? "added" : r.param("sort");
        boolean asc = "asc".equals(r.param("order"));
        if ("random".equals(sort)) {
            Collections.shuffle(list, new Random(parseInt(r.param("seed"), 7)));
        } else {
            Comparator<Video> cmp;
            switch (sort) {
                case "title": cmp = Comparator.comparing(v -> title(v).toLowerCase(Locale.ROOT)); break;
                case "duration": cmp = Comparator.comparingDouble(v -> v.duration); break;
                case "size": cmp = Comparator.comparingLong(v -> v.size); break;
                case "rating": cmp = Comparator.comparingInt(v -> meta(v).optInt("rating", 0)); break;
                case "plays": cmp = Comparator.comparingInt(v -> meta(v).optInt("play_count", 0)); break;
                case "played": cmp = Comparator.comparingLong(v -> meta(v).optLong("last_played", 0)); break;
                case "mtime": cmp = Comparator.comparingLong(v -> v.dateModified); break;
                case "resolution": cmp = Comparator.comparingInt(v -> Math.min(v.width, v.height)); break;
                default: cmp = Comparator.comparingLong(v -> v.dateAdded);
            }
            cmp = cmp.thenComparingLong(v -> v.id);
            list.sort(asc ? cmp : cmp.reversed());
        }
        int page = Math.max(1, parseInt(r.param("page"), 1));
        int per = Math.min(200, Math.max(1, parseInt(r.param("per"), 40)));
        JSONArray items = new JSONArray();
        for (int i = (page - 1) * per; i < Math.min(list.size(), page * per); i++) items.put(summary(list.get(i)));
        return new JSONObject().put("total", list.size()).put("page", page).put("per", per).put("items", items);
    }

    private static boolean containsAll(JSONArray ids, Set<Long> need) {
        if (need.isEmpty()) return true;
        Set<Long> have = new HashSet<>();
        if (ids != null) for (int i = 0; i < ids.length(); i++) have.add(ids.optLong(i));
        return have.containsAll(need);
    }

    // ------------------------------------------------------------------ tags / performers
    private synchronized long entityId(String field, String name) throws JSONException {
        JSONObject names = store.optJSONObject(field);
        Iterator<String> it = names.keys();
        while (it.hasNext()) {
            String k = it.next();
            if (names.optString(k).equalsIgnoreCase(name)) return Long.parseLong(k);
        }
        long id = nextId();
        names.put(String.valueOf(id), name);
        return id;
    }

    private synchronized void setLinks(JSONObject m, String field, JSONArray names) throws JSONException {
        JSONArray ids = new JSONArray();
        Set<Long> seen = new HashSet<>();
        for (int i = 0; i < names.length(); i++) {
            String n = names.optString(i).trim().replaceAll("\\s+", " ");
            if (n.isEmpty()) continue;
            if (n.length() > 80) n = n.substring(0, 80);
            long id = entityId(field, n);
            if (seen.add(id)) ids.put(id);
        }
        m.put(field, ids);
    }

    private synchronized JSONArray listEntities(String field) throws JSONException {
        JSONObject names = store.optJSONObject(field);
        Map<Long, Integer> counts = new HashMap<>();
        Map<Long, Video> covers = new HashMap<>();
        Map<Long, Integer> coverRating = new HashMap<>();
        for (Video v : visible()) {
            JSONObject m = meta(v);
            JSONArray ids = m.optJSONArray(field);
            if (ids == null) continue;
            int rating = m.optInt("rating", 0);
            for (int i = 0; i < ids.length(); i++) {
                long id = ids.optLong(i);
                counts.merge(id, 1, Integer::sum);
                if (!covers.containsKey(id) || rating > coverRating.get(id)) { covers.put(id, v); coverRating.put(id, rating); }
            }
        }
        List<JSONObject> out = new ArrayList<>();
        Iterator<String> it = names.keys();
        while (it.hasNext()) {
            String k = it.next();
            long id = Long.parseLong(k);
            Video cv = covers.get(id);
            out.add(new JSONObject().put("id", id).put("name", names.optString(k))
                    .put("count", counts.getOrDefault(id, 0)).put("cover", cv == null ? JSONObject.NULL : cv.id));
        }
        out.sort(Comparator.comparing(o -> o.optString("name").toLowerCase(Locale.ROOT)));
        return new JSONArray(out);
    }

    private synchronized void replaceEntity(String field, long from, Long to) throws JSONException {
        JSONObject vids = store.optJSONObject("videos");
        Iterator<String> it = vids.keys();
        while (it.hasNext()) {
            JSONObject m = vids.optJSONObject(it.next());
            JSONArray ids = m == null ? null : m.optJSONArray(field);
            if (ids == null) continue;
            JSONArray n = new JSONArray();
            Set<Long> seen = new HashSet<>();
            for (int i = 0; i < ids.length(); i++) {
                long id = ids.optLong(i);
                if (id == from) { if (to == null) continue; id = to; }
                if (seen.add(id)) n.put(id);
            }
            m.put(field, n);
        }
        store.optJSONObject(field).remove(String.valueOf(from));
    }

    // ------------------------------------------------------------------ folders
    private synchronized Set<String> allFolders() {
        if (lastScan == 0) scan();
        Set<String> out = new TreeSet<>();
        for (Video v : all) out.add(v.relPath);
        return out;
    }

    private synchronized JSONObject browse(String path) throws JSONException {
        path = nz(path);
        if (!path.isEmpty() && !path.endsWith("/")) path += "/";
        Set<String> children = new TreeSet<>();
        for (String f : allFolders()) {
            if (!f.startsWith(path) || f.equals(path)) continue;
            String rest = f.substring(path.length());
            int slash = rest.indexOf('/');
            children.add(path + (slash >= 0 ? rest.substring(0, slash + 1) : rest));
        }
        JSONArray dirs = new JSONArray();
        for (String c : children) {
            String name = c.substring(path.length()).replaceAll("/$", "");
            dirs.put(new JSONObject().put("name", name).put("path", c));
        }
        String parent;
        if (path.isEmpty()) parent = null;
        else {
            String p = path.substring(0, path.length() - 1);
            parent = p.contains("/") ? p.substring(0, p.lastIndexOf('/') + 1) : "";
        }
        JSONObject o = new JSONObject().put("path", path).put("dirs", dirs);
        o.put("parent", parent == null ? JSONObject.NULL : parent);
        return o;
    }

    private synchronized JSONObject settingsJson() throws JSONException {
        Set<String> folders = allFolders();
        List<String> paths = libraryPaths();
        JSONArray lp = new JSONArray();
        for (String p : paths) {
            boolean exists = false;
            for (String f : folders) if (f.startsWith(p)) { exists = true; break; }
            lp.put(new JSONObject().put("path", p).put("exists", exists));
        }
        Set<String> top = new TreeSet<>();
        for (String f : folders) {
            int s = f.indexOf('/');
            String t = s >= 0 ? f.substring(0, s + 1) : f;
            if (!t.isEmpty() && !paths.contains(t)) top.add(t);
        }
        return new JSONObject().put("library_paths", lp).put("suggestions", new JSONArray(top))
                .put("password_set", passwordSet()).put("data_dir", "앱 내부 저장소")
                .put("ffmpeg", false).put("ffprobe", false).put("platform", "android")
                .put("example_path", "DCIM/Camera/").put("lan", lanEnabled())
                .put("mega_supported", true).put("mega", megaJson());
    }

    // ------------------------------------------------------------------ auth
    static String hashPassword(String pw, String salt) {
        try {
            PBEKeySpec spec = new PBEKeySpec(pw.toCharArray(), salt.getBytes(StandardCharsets.UTF_8), 100_000, 256);
            byte[] h = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded();
            return hex(h);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    private synchronized String authToken() {
        String ph = settings().optString("password_hash", "");
        if (ph.isEmpty()) return null;
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(settings().optString("secret").getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return hex(mac.doFinal(ph.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            return null;
        }
    }

    private boolean authed(HttpServer.Request r) {
        String tok = authToken();
        if (tok == null) return true;
        String cookie = r.header("cookie");
        if (cookie == null) return false;
        for (String part : cookie.split(";")) {
            String p = part.trim();
            if (p.startsWith("vs_auth=") && MessageDigest.isEqual(p.substring(8).getBytes(), tok.getBytes())) return true;
        }
        return false;
    }

    // ------------------------------------------------------------------ HTTP routing
    @Override
    public void handle(HttpServer.Request r, HttpServer.Response res) throws Exception {
        String path = r.path;
        if (path.startsWith("/api/")) {
            if (!path.equals("/api/login") && !path.equals("/api/auth") && !authed(r)) { res.error(401, "login required"); return; }
            api(r, res, path.substring(5));
            return;
        }
        if (path.startsWith("/mega-file/")) {
            if (!authed(r)) { res.error(401, "login required"); return; }
            String[] p = path.split("/");
            Mega.Link l;
            Mega.Node n;
            synchronized (this) {
                int i = parseInt(p.length > 2 ? p[2] : "", -1);
                l = i >= 0 && i < megaLinks.size() ? megaLinks.get(i) : null;
                n = l == null || p.length < 4 ? null : l.byHandle.get(p[3]);
            }
            if (n == null || n.folder) { res.error(404, "not found"); return; }
            megaStream(l, n, mimeFor(ext(n.name)), r, res, "1".equals(r.param("dl")));
            return;
        }
        if (path.startsWith("/media/") || path.startsWith("/thumbs/") || path.startsWith("/transcode/")) {
            if (!authed(r)) { res.error(401, "login required"); return; }
            String[] p = path.split("/");
            if (path.startsWith("/transcode/")) { res.error(404, "이 앱에서는 실시간 변환을 지원하지 않습니다"); return; }
            Video v;
            synchronized (this) {
                if (lastScan == 0) scan();
                v = byId.get(parseLong(p.length > 2 ? p[2] : "", -1));
            }
            if (v == null) { res.error(404, "not found"); return; }
            if (path.startsWith("/media/") && v.node != null) megaStream(v.link, v.node, v.mime, r, res, false);
            else if (path.startsWith("/media/")) media(v, r, res);
            else if (v.node != null) megaThumb(v, parseInt(p.length > 3 ? p[3].replace(".jpg", "") : "0", 0), r, res);
            else thumb(v, parseInt(p.length > 3 ? p[3].replace(".jpg", "") : "0", 0), r, res);
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
                : name.endsWith(".css") ? "text/css; charset=utf-8" : "text/html; charset=utf-8";
        res.header("Cache-Control", "no-cache");
        res.send(200, type, body);
    }

    private void api(HttpServer.Request r, HttpServer.Response res, String path) throws Exception {
        String[] parts = path.split("/");
        String m = r.method;
        String p0 = parts.length > 0 ? parts[0] : "";

        if (p0.equals("auth")) {
            res.json(200, new JSONObject().put("required", authToken() != null).put("ok", authed(r)).toString());
            return;
        }
        if (p0.equals("login") && m.equals("POST")) {
            JSONObject b = body(r);
            String ph = settings().optString("password_hash", "");
            if (!ph.isEmpty() && MessageDigest.isEqual(hashPassword(b.optString("password"), settings().optString("salt")).getBytes(), ph.getBytes())) {
                res.header("Set-Cookie", "vs_auth=" + authToken() + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000");
                res.json(200, "{\"ok\":true}");
            } else res.error(403, "비밀번호가 틀렸습니다");
            return;
        }

        if (p0.equals("videos")) {
            if (parts.length == 1 && m.equals("GET")) { res.json(200, listVideos(r).toString()); return; }
            Video v;
            synchronized (this) {
                if (lastScan == 0) scan();
                v = byId.get(parseLong(parts.length > 1 ? parts[1] : "", -1));
            }
            if (v == null) { res.error(404, "not found"); return; }
            JSONObject meta = meta(v);
            String action = parts.length > 2 ? parts[2] : "";
            synchronized (this) {
                if (action.isEmpty()) {
                    if (m.equals("GET")) { res.json(200, detail(v).toString()); return; }
                    if (m.equals("PATCH")) {
                        JSONObject b = body(r);
                        if (b.has("title")) meta.put("title", b.optString("title"));
                        if (b.has("rating")) meta.put("rating", Math.max(0, Math.min(5, b.optInt("rating"))));
                        if (b.has("favorite")) meta.put("favorite", b.optBoolean("favorite"));
                        if (b.has("details")) meta.put("details", b.optString("details"));
                        if (b.has("tags")) setLinks(meta, "tags", b.optJSONArray("tags"));
                        if (b.has("performers")) setLinks(meta, "performers", b.optJSONArray("performers"));
                        save();
                        res.json(200, detail(v).toString());
                        return;
                    }
                    if (m.equals("DELETE")) {
                        if ("1".equals(r.param("file"))) { res.error(400, "이 앱에서는 파일 삭제를 지원하지 않습니다. 내 파일 앱에서 지워 주세요."); return; }
                        meta.put("hidden", true);
                        save();
                        res.json(200, "{\"ok\":true}");
                        return;
                    }
                }
                if (action.equals("play") && m.equals("POST")) {
                    meta.put("play_count", meta.optInt("play_count", 0) + 1);
                    meta.put("last_played", System.currentTimeMillis() / 1000);
                    save();
                    res.json(200, "{\"ok\":true}");
                    return;
                }
                if (action.equals("progress") && m.equals("POST")) {
                    JSONObject pb = body(r);
                    meta.put("resume_pos", pb.optDouble("pos", 0));
                    if (pb.optDouble("duration", 0) > 0) meta.put("duration", pb.optDouble("duration"));
                    save();
                    res.json(200, "{\"ok\":true}");
                    return;
                }
                if (action.equals("thumbs") && m.equals("POST")) {
                    File d = new File(thumbDir, String.valueOf(v.id));
                    File[] fs = d.listFiles();
                    if (fs != null) for (File f : fs) f.delete();
                    res.json(200, "{\"ok\":true}");
                    return;
                }
                if (action.equals("markers") && m.equals("POST")) {
                    JSONObject b = body(r);
                    JSONArray mk = meta.optJSONArray("markers");
                    if (mk == null) mk = new JSONArray();
                    List<JSONObject> l = new ArrayList<>();
                    for (int i = 0; i < mk.length(); i++) l.add(mk.optJSONObject(i));
                    String t = b.optString("title", "");
                    l.add(new JSONObject().put("id", nextId()).put("seconds", b.optDouble("seconds", 0))
                            .put("title", t.length() > 200 ? t.substring(0, 200) : t));
                    l.sort(Comparator.comparingDouble(o -> o.optDouble("seconds")));
                    meta.put("markers", new JSONArray(l));
                    save();
                    res.json(200, meta.optJSONArray("markers").toString());
                    return;
                }
            }
        }
        if (p0.equals("markers") && parts.length == 2 && m.equals("DELETE")) {
            long id = parseLong(parts[1], -1);
            synchronized (this) {
                JSONObject vids = store.optJSONObject("videos");
                Iterator<String> it = vids.keys();
                while (it.hasNext()) {
                    JSONObject mm = vids.optJSONObject(it.next());
                    JSONArray mk = mm == null ? null : mm.optJSONArray("markers");
                    if (mk == null) continue;
                    JSONArray n = new JSONArray();
                    for (int i = 0; i < mk.length(); i++) if (mk.optJSONObject(i).optLong("id") != id) n.put(mk.optJSONObject(i));
                    mm.put("markers", n);
                }
                save();
            }
            res.json(200, "{\"ok\":true}");
            return;
        }

        if (p0.equals("tags") || p0.equals("performers")) {
            String field = p0;
            synchronized (this) {
                if (parts.length == 1 && m.equals("GET")) { res.json(200, listEntities(field).toString()); return; }
                long id = parseLong(parts[1], -1);
                JSONObject names = store.optJSONObject(field);
                String key = String.valueOf(id);
                if (!names.has(key)) { res.error(404, "not found"); return; }
                if (m.equals("GET")) { res.json(200, new JSONObject().put("id", id).put("name", names.optString(key)).toString()); return; }
                if (m.equals("PATCH")) {
                    String nn = body(r).optString("name", "").trim().replaceAll("\\s+", " ");
                    if (nn.isEmpty()) { res.error(400, "이름이 비어 있습니다"); return; }
                    Long other = null;
                    Iterator<String> it = names.keys();
                    while (it.hasNext()) {
                        String k = it.next();
                        if (!k.equals(key) && names.optString(k).equalsIgnoreCase(nn)) other = Long.parseLong(k);
                    }
                    if (other != null) {
                        replaceEntity(field, id, other);
                        save();
                        res.json(200, new JSONObject().put("id", other).put("merged", true).toString());
                    } else {
                        names.put(key, nn);
                        save();
                        res.json(200, new JSONObject().put("id", id).toString());
                    }
                    return;
                }
                if (m.equals("DELETE")) {
                    replaceEntity(field, id, null);
                    save();
                    res.json(200, "{\"ok\":true}");
                    return;
                }
            }
        }

        if (p0.equals("mega")) {
            if (parts.length == 1 && m.equals("GET")) { res.json(200, megaJson().toString()); return; }
            if (parts.length == 1 && m.equals("POST")) {
                Mega.Link l;
                try {
                    l = Mega.parse(body(r).optString("url"));
                } catch (IllegalArgumentException e) {
                    res.error(400, e.getMessage());
                    return;
                }
                synchronized (this) {
                    for (Mega.Link x : megaLinks) if (x.handle.equals(l.handle)) { res.error(400, "이미 추가된 폴더입니다"); return; }
                }
                Mega.load(l);   // 네트워크 — 잠금 밖
                if (l.error != null && l.nodes.isEmpty()) { res.error(400, l.error); return; }
                synchronized (this) { megaLinks.add(l); }
                saveMegaLinks();
                scan();
                res.json(200, megaJson().toString());
                return;
            }
            if (parts.length == 2 && parts[1].equals("refresh") && m.equals("POST")) {
                refreshMega();
                res.json(200, megaJson().toString());
                return;
            }
            int idx = parts.length > 1 ? parseInt(parts[1], -1) : -1;
            if (parts.length == 2 && m.equals("DELETE")) {
                synchronized (this) { if (idx >= 0 && idx < megaLinks.size()) megaLinks.remove(idx); }
                saveMegaLinks();
                scan();
                res.json(200, megaJson().toString());
                return;
            }
            if (parts.length == 3 && parts[2].equals("browse")) {
                JSONObject b = megaBrowse(idx, r.param("folder"));
                if (b == null) res.error(404, "not found"); else res.json(200, b.toString());
                return;
            }
        }
        if (p0.equals("settings")) {
            if (m.equals("PUT")) {
                JSONObject b = body(r);
                synchronized (this) {
                    if (b.has("library_paths")) {
                        JSONArray in = b.optJSONArray("library_paths");
                        List<String> out = new ArrayList<>();
                        for (int i = 0; in != null && i < in.length(); i++) {
                            String s = in.optString(i).trim().replace('\\', '/');
                            s = s.replaceFirst("^/+", "").replaceFirst("^storage/emulated/\\d+/", "");
                            if (!s.isEmpty() && !s.endsWith("/")) s += "/";
                            if (!s.isEmpty() && !out.contains(s)) out.add(s);
                        }
                        settings().put("library_paths", new JSONArray(out));
                    }
                    save();
                }
                if (b.has("password")) setPassword(b.optString("password"));
            }
            res.json(200, settingsJson().toString());
            return;
        }
        if (p0.equals("browse")) { res.json(200, browse(r.param("path")).toString()); return; }
        if (p0.equals("scan") && m.equals("POST")) {
            scan();
            res.json(200, "{\"started\":true}");
            return;
        }
        if (p0.equals("status")) {
            JSONObject counts;
            synchronized (this) {
                long bytes = 0, favs = 0;
                double secs = 0;
                List<Video> vis = visible();
                for (Video v : vis) {
                    bytes += v.size;
                    secs += v.duration;
                    if (meta(v).optBoolean("favorite", false)) favs++;
                }
                counts = new JSONObject().put("total", vis.size()).put("bytes", bytes).put("seconds", secs).put("missing", 0).put("favorites", favs);
            }
            res.json(200, new JSONObject().put("scanning", false).put("scan_found", 0).put("scan_new", 0)
                    .put("thumb_pending", 0).put("thumb_current", "").put("last_scan", lastScan / 1000)
                    .put("counts", counts).toString());
            return;
        }
        if (p0.equals("cleanup") && m.equals("POST")) {
            int removed = 0;
            synchronized (this) {
                scan();
                Set<String> keys = new HashSet<>();
                for (Video v : all) keys.add(v.key);
                JSONObject vids = store.optJSONObject("videos");
                List<String> drop = new ArrayList<>();
                Iterator<String> it = vids.keys();
                while (it.hasNext()) { String k = it.next(); if (!keys.contains(k)) drop.add(k); }
                for (String k : drop) vids.remove(k);
                removed = drop.size();
                save();
            }
            res.json(200, new JSONObject().put("removed", removed).toString());
            return;
        }
        if (p0.equals("random")) {
            List<Video> vis = visible();
            res.json(200, vis.isEmpty() ? "{}" : new JSONObject().put("id", vis.get(new Random().nextInt(vis.size())).id).toString());
            return;
        }
        res.error(404, "unknown endpoint");
    }

    // ------------------------------------------------------------------ media streaming
    private static final Pattern RANGE = Pattern.compile("bytes=(\\d*)-(\\d*)");

    private void media(Video v, HttpServer.Request r, HttpServer.Response res) throws IOException {
        try (ParcelFileDescriptor pfd = ctx.getContentResolver().openFileDescriptor(v.uri, "r")) {
            if (pfd == null) { res.error(404, "not found"); return; }
            long size = pfd.getStatSize() > 0 ? pfd.getStatSize() : v.size;
            long start = 0, end = size - 1;
            int status = 200;
            String range = r.header("range");
            if (range != null) {
                Matcher mt = RANGE.matcher(range);
                if (mt.find()) {
                    if (!mt.group(1).isEmpty()) {
                        start = Long.parseLong(mt.group(1));
                        if (!mt.group(2).isEmpty()) end = Math.min(Long.parseLong(mt.group(2)), size - 1);
                    } else if (!mt.group(2).isEmpty()) {
                        start = Math.max(0, size - Long.parseLong(mt.group(2)));
                    }
                    if (start >= size) {
                        res.header("Content-Range", "bytes */" + size);
                        res.start(416, 0);
                        return;
                    }
                    status = 206;
                }
            }
            String type = v.mime == null ? "video/mp4" : v.mime;
            if (type.contains("matroska")) type = "video/webm";   // Chrome 은 mkv 를 webm 으로 알리면 대부분 재생
            if (type.equals("video/quicktime")) type = "video/mp4";
            long len = end - start + 1;
            res.header("Content-Type", type).header("Accept-Ranges", "bytes");
            if (status == 206) res.header("Content-Range", "bytes " + start + "-" + end + "/" + size);
            OutputStream out = res.start(status, len);
            if (r.method.equals("HEAD")) return;
            try (FileInputStream in = new FileInputStream(pfd.getFileDescriptor())) {
                FileChannel ch = in.getChannel();
                ch.position(start);
                byte[] buf = new byte[256 * 1024];
                long remaining = len;
                while (remaining > 0) {
                    int n = in.read(buf, 0, (int) Math.min(buf.length, remaining));
                    if (n < 0) break;
                    out.write(buf, 0, n);
                    remaining -= n;
                }
            }
        }
    }

    private void megaStream(Mega.Link l, Mega.Node n, String mime, HttpServer.Request r, HttpServer.Response res, boolean download) throws IOException {
        long size = n.size, start = 0, end = size - 1;
        int status = 200;
        String range = r.header("range");
        if (range != null) {
            Matcher mt = RANGE.matcher(range);
            if (mt.find()) {
                if (!mt.group(1).isEmpty()) {
                    start = Long.parseLong(mt.group(1));
                    if (!mt.group(2).isEmpty()) end = Math.min(Long.parseLong(mt.group(2)), size - 1);
                } else if (!mt.group(2).isEmpty()) start = Math.max(0, size - Long.parseLong(mt.group(2)));
                if (start >= size) {
                    res.header("Content-Range", "bytes */" + size);
                    res.start(416, 0);
                    return;
                }
                status = 206;
            }
        }
        if (mime.contains("matroska")) mime = "video/webm";
        if (size == 0) { res.header("Content-Type", mime); res.start(200, 0); return; }
        InputStream in;
        try {
            in = Mega.open(l, n, start, end);
        } catch (IOException e) {
            res.error(502, e.getMessage() == null ? "MEGA 연결 실패" : e.getMessage());
            return;
        }
        try (InputStream src = in) {
            long len = end - start + 1;
            res.header("Content-Type", mime).header("Accept-Ranges", "bytes");
            if (status == 206) res.header("Content-Range", "bytes " + start + "-" + end + "/" + size);
            if (download) res.header("Content-Disposition", "attachment; filename*=UTF-8''" + java.net.URLEncoder.encode(n.name, "UTF-8").replace("+", "%20"));
            OutputStream out = res.start(status, len);
            if (r.method.equals("HEAD")) return;
            byte[] buf = new byte[128 * 1024];
            long remaining = len;
            while (remaining > 0) {
                int k = src.read(buf, 0, (int) Math.min(buf.length, remaining));
                if (k < 0) break;
                out.write(buf, 0, k);
                remaining -= k;
            }
        }
    }

    private void megaThumb(Video v, int n, HttpServer.Request r, HttpServer.Response res) throws IOException {
        if (n != 0 || v.node.thumbHandle == null) { res.error(404, "no frame"); return; }
        File f = new File(new File(thumbDir, "mega"), v.node.handle + ".jpg");
        if (!f.exists() || f.length() == 0) {
            byte[] jpg = Mega.thumbnail(v.link, v.node);
            if (jpg == null) { res.error(404, "no thumbnail"); return; }
            f.getParentFile().mkdirs();
            try (FileOutputStream o = new FileOutputStream(f)) { o.write(jpg); }
        }
        res.header("Cache-Control", "max-age=86400");
        res.send(200, "image/jpeg", readAll(new FileInputStream(f)));
    }

    // ------------------------------------------------------------------ thumbnails
    private void thumb(Video v, int n, HttpServer.Request r, HttpServer.Response res) throws Exception {
        n = Math.max(0, Math.min(N_FRAMES - 1, n));
        File dir = new File(thumbDir, String.valueOf(v.id));
        File f = new File(dir, n + ".jpg");
        if (!f.exists() || f.length() == 0) {
            Bitmap bmp = null;
            frameLock.acquire();
            try {
                if (n == 0) {
                    try {
                        bmp = ctx.getContentResolver().loadThumbnail(v.uri, new Size(480, 270), null);
                    } catch (Exception ignored) {
                    }
                }
                if (bmp == null) bmp = frame(v, n == 0 ? 0.2 : (n - 0.5) / (N_FRAMES - 1));
            } finally {
                frameLock.release();
            }
            if (bmp == null) { res.error(404, "no frame"); return; }
            dir.mkdirs();
            try (FileOutputStream o = new FileOutputStream(f)) {
                bmp.compress(Bitmap.CompressFormat.JPEG, 75, o);
            }
            bmp.recycle();
        }
        byte[] body = readAll(new FileInputStream(f));
        res.header("Cache-Control", r.param("v") != null ? "max-age=86400" : "no-cache");
        res.send(200, "image/jpeg", body);
    }

    private Bitmap frame(Video v, double frac) {
        MediaMetadataRetriever mmr = new MediaMetadataRetriever();
        try {
            mmr.setDataSource(ctx, v.uri);
            double dur = v.duration;
            if (dur <= 0) {
                String d = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
                dur = d == null ? 0 : Long.parseLong(d) / 1000.0;
            }
            long us = (long) (dur * frac * 1_000_000);
            Bitmap b = mmr.getScaledFrameAtTime(us, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, 480, 480);
            if (b == null) b = mmr.getFrameAtTime(us);
            return b;
        } catch (Exception e) {
            return null;
        } finally {
            try { mmr.release(); } catch (Exception ignored) {}
        }
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

    private static Set<Long> longs(List<String> l) {
        Set<Long> out = new HashSet<>();
        for (String s : l) { long v = parseLong(s, -1); if (v >= 0) out.add(v); }
        return out;
    }

    static String hex(byte[] b) {
        StringBuilder sb = new StringBuilder();
        for (byte x : b) sb.append(String.format("%02x", x));
        return sb.toString();
    }

    static String randomHex(int bytes) {
        byte[] b = new byte[bytes];
        new SecureRandom().nextBytes(b);
        return hex(b);
    }
}
