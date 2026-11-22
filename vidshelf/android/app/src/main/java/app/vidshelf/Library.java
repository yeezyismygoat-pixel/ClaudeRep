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
        boolean sysFav;      // 기기 갤러리(안드로이드)의 즐겨찾기
        Mega.Link link;      // MEGA 영상이면 설정됨
        Mega.Node node;
        ICloud.Album album;  // iCloud 공유 앨범 항목이면 설정됨
        ICloud.Item item;

        boolean cloud() { return node != null || item != null; }
        String source() { return node != null ? "mega" : item != null ? "icloud" : "local"; }
        long taken;          // 사진: 촬영 시각 (초)
    }

    static final long PHOTO_ID_BASE = 1L << 51;   // 기기 사진 id (영상 id 와 겹치지 않게)
    private List<Video> allPhotos = new ArrayList<>();
    private final Map<Long, Video> photoById = new HashMap<>();
    private static final Set<String> MEGA_IMAGE_EXTS = new HashSet<>(java.util.Arrays.asList(
            "jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "bmp"));

    private final Context ctx;
    private final File storeFile, thumbDir;
    private JSONObject store;                         // settings, videos(meta), tags, performers, seq
    private List<Video> all = new ArrayList<>();      // MediaStore 의 모든 영상
    private final Map<Long, Video> byId = new HashMap<>();
    private long lastScan = 0;
    private final Semaphore frameLock = new Semaphore(2);
    private final List<Mega.Link> megaLinks = new ArrayList<>();
    private final List<ICloud.Album> icloudAlbums = new ArrayList<>();
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
        loadICloudLinks();
        new Thread(this::refreshMega).start();
        // MEGA 목록 자동 새로고침: 15분마다 확인해서 정한 시간이 지났으면 새로 받음
        bg.scheduleWithFixedDelay(() -> {
            try {
                int hours = megaRefreshHours();
                if (hours > 0 && (!megaLinks.isEmpty() || !icloudAlbums.isEmpty()) && System.currentTimeMillis() - lastMegaRefresh > hours * 3600_000L)
                    new Thread(this::refreshMega).start();
            } catch (Exception ignored) {}
        }, 15, 15, java.util.concurrent.TimeUnit.MINUTES);
    }

    private final java.util.concurrent.ScheduledExecutorService bg = java.util.concurrent.Executors.newSingleThreadScheduledExecutor();
    private volatile long lastMegaRefresh = 0;

    private synchronized int megaRefreshHours() { return settings().optInt("mega_refresh_hours", 6); }

    // ------------------------------------------------------------------ MEGA
    /** 모든 MEGA 링크의 파일 목록을 다시 받습니다 (네트워크 작업, 잠금 밖에서 실행). */
    public void refreshMega() {
        List<Mega.Link> links;
        synchronized (this) { links = new ArrayList<>(megaLinks); }
        lastMegaRefresh = System.currentTimeMillis();
        for (Mega.Link l : links) Mega.load(l);
        List<ICloud.Album> albums;
        synchronized (this) { albums = new ArrayList<>(icloudAlbums); }
        for (ICloud.Album a : albums) ICloud.load(a);   // iCloud 공유 앨범도 함께 새로 받음
        scan();
        autoPerformers();
        lookupMissingSoon();
        megaThumbsSoon();
    }

    // ------------------------------------------------------------------ MEGA 썸네일 직접 만들기
    private final java.util.concurrent.atomic.AtomicBoolean genRunning = new java.util.concurrent.atomic.AtomicBoolean();
    private volatile int genPending = 0;
    private volatile String genCurrent = "";
    private volatile long genPausedUntil = 0;
    private static final int GEN_MAX_FAILS = 2;

    private File megaGenFile(Mega.Node n) { return new File(new File(thumbDir, "mega"), n.handle + "-g.jpg"); }

    private boolean megaHasThumb(Mega.Node n) {
        return n.thumbHandle != null || n.previewHandle != null || megaGenFile(n).length() > 0;
    }

    private synchronized boolean megaThumbsOn() { return settings().optBoolean("mega_thumbs", true); }

    /** 썸네일을 만들어야 할 MEGA 영상 (MEGA 썸네일 없음, 아직 안 만듦, 실패 횟수 미만). */
    private synchronized List<Video> megaThumbTodo() {
        List<Video> out = new ArrayList<>();
        for (Video v : all) {
            if (v.node == null || megaHasThumb(v.node)) continue;
            JSONObject m = meta(v);
            if (m.optBoolean("hidden", false) || m.optInt("gen_fail", 0) >= GEN_MAX_FAILS) continue;
            out.add(v);
        }
        out.sort(Comparator.comparingLong((Video v) -> v.dateAdded).reversed());   // 최근 영상부터
        return out;
    }

    /** 썸네일이 없는 MEGA 영상의 장면을 백그라운드에서 하나씩 뽑습니다. */
    public void megaThumbsSoon() {
        if (!megaThumbsOn() || System.currentTimeMillis() < genPausedUntil) return;
        if (!genRunning.compareAndSet(false, true)) return;
        new Thread(() -> {
            try {
                List<Video> todo = megaThumbTodo();
                for (int i = 0; i < todo.size(); i++) {
                    if (!megaThumbsOn()) break;
                    Video v = todo.get(i);
                    genPending = todo.size() - i;
                    genCurrent = v.name;
                    MegaFrame.Result r;
                    try {
                        r = MegaFrame.grab(v.link, v.node);
                    } catch (MegaFrame.QuotaException e) {
                        genPausedUntil = System.currentTimeMillis() + 60 * 60 * 1000L;   // 한도에 걸리면 한 시간 쉼
                        break;
                    }
                    synchronized (this) {
                        JSONObject m = meta(v);
                        try {
                            if (r.duration > 0 && m.optDouble("duration", 0) <= 0) m.put("duration", r.duration);
                            if (r.width > 0 && r.height > 0 && m.optInt("width", 0) <= 0) { m.put("width", r.width); m.put("height", r.height); }
                            if (r.bitmap == null) m.put("gen_fail", m.optInt("gen_fail", 0) + 1);
                        } catch (JSONException ignored) {}
                        save();
                    }
                    if (r.bitmap != null) {
                        File f = megaGenFile(v.node);
                        f.getParentFile().mkdirs();
                        File tmp = new File(f.getPath() + ".tmp");
                        try (FileOutputStream o = new FileOutputStream(tmp)) {
                            r.bitmap.compress(Bitmap.CompressFormat.JPEG, 80, o);
                        } catch (IOException ignored) {}
                        r.bitmap.recycle();
                        tmp.renameTo(f);
                    }
                }
            } catch (Exception ignored) {
            } finally {
                genPending = 0;
                genCurrent = "";
                genRunning.set(false);
            }
        }, "mega-thumbs").start();
    }

    // ------------------------------------------------------------------ 숨긴 영상
    private synchronized JSONArray hiddenVideos() throws JSONException {
        if (lastScan == 0) scan();
        JSONArray out = new JSONArray();
        for (Video v : all) {
            if (!meta(v).optBoolean("hidden", false)) continue;
            out.put(summary(v).put("filename", v.name).put("folder", v.relPath).put("source", v.source()));
        }
        return out;
    }

    // ------------------------------------------------------------------ 중복 영상: 하나만 남기고 정보 합치기
    /** others 의 태그·출연자·별점·즐겨찾기·재생 기록·북마크·메모를 keep 에 합치고 others 는 숨김. */
    private synchronized void mergeInto(Video keep, List<Video> others) throws JSONException {
        JSONObject k = meta(keep);
        for (Video o : others) {
            if (o == keep) continue;
            JSONObject m = meta(o);
            for (String f : new String[]{"tags", "performers"}) {
                Set<Long> ids = new java.util.LinkedHashSet<>();
                for (JSONArray a : new JSONArray[]{k.optJSONArray(f), m.optJSONArray(f)})
                    for (int i = 0; a != null && i < a.length(); i++) ids.add(a.optLong(i));
                k.put(f, new JSONArray(ids));
            }
            k.put("rating", Math.max(k.optInt("rating", 0), m.optInt("rating", 0)));
            if (m.optBoolean("favorite", false)) k.put("favorite", true);
            k.put("play_count", k.optInt("play_count", 0) + m.optInt("play_count", 0));
            if (m.optLong("last_played", 0) > k.optLong("last_played", 0)) k.put("last_played", m.optLong("last_played"));
            if (k.optDouble("resume_pos", 0) <= 0 && m.optDouble("resume_pos", 0) > 0) k.put("resume_pos", m.optDouble("resume_pos"));
            String d1 = k.optString("details", "").trim(), d2 = m.optString("details", "").trim();
            if (!d2.isEmpty() && !d1.contains(d2)) k.put("details", d1.isEmpty() ? d2 : d1 + "\n" + d2);
            JSONArray mk = k.optJSONArray("markers"), om = m.optJSONArray("markers");
            if (om != null && om.length() > 0) {
                List<JSONObject> l = new ArrayList<>();
                Set<Long> secs = new HashSet<>();
                for (JSONArray a : new JSONArray[]{mk, om})
                    for (int i = 0; a != null && i < a.length(); i++) {
                        JSONObject x = a.optJSONObject(i);
                        if (x != null && secs.add(Math.round(x.optDouble("seconds")))) l.add(x);
                    }
                l.sort(Comparator.comparingDouble(o2 -> o2.optDouble("seconds")));
                k.put("markers", new JSONArray(l));
            }
            m.put("hidden", true);
        }
        save();
    }

    // ------------------------------------------------------------------ 백업 / 복원
    private static final String[] BACKUP_KEYS = {"videos", "tags", "performers", "performer_info", "seq"};
    private static final String[] BACKUP_SETTINGS = {"library_paths", "mega_links", "icloud_links", "mega_thumbs", "mega_refresh_hours"};

    /** 태그·별점·출연자 등 사용자 정보. 비밀번호와 로그인 쿠키는 넣지 않음. */
    private synchronized JSONObject backupJson() throws JSONException {
        JSONObject o = new JSONObject().put("app", "vidshelf").put("backup_version", 1).put("exported_at", System.currentTimeMillis() / 1000);
        for (String k : BACKUP_KEYS) if (store.has(k)) o.put(k, store.get(k));
        JSONObject st = new JSONObject();
        for (String k : BACKUP_SETTINGS) if (settings().has(k)) st.put(k, settings().get(k));
        return o.put("settings", st);
    }

    /** 백업을 불러와 지금 정보를 바꿉니다. 돌려주는 값: 불러온 영상 정보 수. */
    private synchronized int restore(JSONObject b) throws JSONException {
        if (!"vidshelf".equals(b.optString("app")) || !b.has("videos")) throw new JSONException("VidShelf 백업 파일이 아닙니다");
        for (String k : BACKUP_KEYS) if (b.has(k)) store.put(k, b.get(k));
        if (!store.has("tags")) store.put("tags", new JSONObject());
        if (!store.has("performers")) store.put("performers", new JSONObject());
        long maxId = store.optLong("seq", 1);   // 새로 만들 번호가 기존 번호와 겹치지 않게
        for (String f : new String[]{"tags", "performers"}) {
            Iterator<String> it = store.optJSONObject(f).keys();
            while (it.hasNext()) maxId = Math.max(maxId, Long.parseLong(it.next()) + 1);
        }
        store.put("seq", maxId);
        JSONObject st = b.optJSONObject("settings");
        if (st != null) for (String k : BACKUP_SETTINGS) if (st.has(k)) settings().put(k, st.get(k));
        megaLinks.clear();
        JSONArray il = settings().optJSONArray("icloud_links");
        icloudAlbums.clear();
        for (int i = 0; il != null && i < il.length(); i++) {
            try { icloudAlbums.add(ICloud.parse(il.optString(i))); } catch (Exception ignored) {}
        }
        JSONArray links = settings().optJSONArray("mega_links");
        for (int i = 0; links != null && i < links.length(); i++) {
            try { megaLinks.add(Mega.parse(links.optString(i))); } catch (Exception ignored) {}
        }
        writeNow();
        return store.optJSONObject("videos").length();
    }

    /** 파일 크기가 똑같은 영상 묶음 (기기와 MEGA, 여러 폴더에 같은 영상이 있을 때). */
    private synchronized JSONObject duplicates() throws JSONException {
        Map<Long, List<Video>> bySize = new HashMap<>();
        for (Video v : visible()) if (v.size > 1024 * 1024) bySize.computeIfAbsent(v.size, k -> new ArrayList<>()).add(v);
        List<List<Video>> groups = new ArrayList<>();
        for (List<Video> g : bySize.values()) if (g.size() > 1) groups.add(g);
        groups.sort((a, b) -> Long.compare(b.get(0).size, a.get(0).size));
        JSONArray out = new JSONArray();
        for (List<Video> g : groups) {
            boolean mega = false, local = false;
            Set<String> folders = new HashSet<>();
            JSONArray items = new JSONArray();
            g.sort(Comparator.comparing((Video v) -> v.node != null).thenComparing(v -> v.relPath + v.name));   // 기기 영상 먼저
            for (Video v : g) {
                if (v.node != null) mega = true; else local = true;
                folders.add(v.relPath);
                items.put(summary(v).put("filename", v.name).put("folder", v.relPath).put("source", v.source()));
            }
            String reason = mega && local ? "이 기기 + MEGA" : folders.size() > 1 ? "여러 폴더" : "같은 폴더";
            out.put(new JSONObject().put("size", g.get(0).size).put("reason", reason).put("items", items));
        }
        return new JSONObject().put("groups", out);
    }

    // ------------------------------------------------------------------ 출연자 자동 지정 · 정보 찾기
    private static final Pattern FOLDER_PERSON = Pattern.compile("^\\s*[\\[［【]([^\\]］】]+)[\\]］】]\\s*(.+?)\\s*$");
    private final java.util.concurrent.atomic.AtomicBoolean lookupRunning = new java.util.concurrent.atomic.AtomicBoolean();
    private volatile String lookupStatus = "";

    /** ‘[그룹] 이름’ 형식의 MEGA 폴더 안 영상에 출연자를 지정합니다. 이미 처리한 영상은 건너뜀 (사용자가 지운 출연자를 되살리지 않도록). */
    public synchronized JSONObject autoPerformers() {
        int assigned = 0;
        Set<String> people = new TreeSet<>();
        try {
            List<Video> targets = new ArrayList<>(all);
            targets.addAll(allPhotos);
            for (Video v : targets) {
                if (v.node == null) continue;
                JSONObject m = meta(v);
                if (m.optBoolean("auto_perf", false)) continue;
                String[] parts = v.node.path.split("/");
                for (int i = parts.length - 1; i >= 0; i--) {
                    Matcher fm = FOLDER_PERSON.matcher(parts[i]);
                    if (!fm.find()) continue;
                    String group = fm.group(1).trim(), name = fm.group(2).trim();
                    if (name.isEmpty()) break;
                    JSONArray cur = entityRefs(m, "performers");
                    JSONArray names = new JSONArray();
                    boolean has = false;
                    for (int k = 0; k < cur.length(); k++) {
                        String n = cur.getJSONObject(k).optString("name");
                        names.put(n);
                        if (n.equalsIgnoreCase(name)) has = true;
                    }
                    if (!has) { names.put(name); setLinks(m, "performers", names); assigned++; }
                    JSONObject info = performerInfo(entityId("performers", name));
                    if (info.optString("group").isEmpty()) info.put("group", group);
                    people.add(name);
                    break;
                }
                m.put("auto_perf", true);
            }
            save();
            return new JSONObject().put("assigned", assigned).put("performers", new JSONArray(people));
        } catch (JSONException e) {
            return new JSONObject();
        }
    }

    private synchronized JSONObject performerInfo(long id) throws JSONException {
        JSONObject all = store.optJSONObject("performer_info");
        if (all == null) { all = new JSONObject(); store.put("performer_info", all); }
        JSONObject o = all.optJSONObject(String.valueOf(id));
        if (o == null) { o = new JSONObject(); all.put(String.valueOf(id), o); }
        return o;
    }

    /** 정보를 아직 찾아보지 않은 출연자를 백그라운드에서 인터넷으로 찾습니다. */
    public void lookupMissingSoon() {
        if (!lookupRunning.compareAndSet(false, true)) return;
        new Thread(() -> {
            try {
                List<long[]> todo = new ArrayList<>();
                synchronized (this) {
                    Iterator<String> it = store.optJSONObject("performers").keys();
                    while (it.hasNext()) {
                        long id = Long.parseLong(it.next());
                        if (!performerInfo(id).has("lookup_at")) todo.add(new long[]{id});
                    }
                }
                int i = 0;
                for (long[] t : todo) {
                    lookupStatus = "출연자 정보 찾는 중… " + (++i) + "/" + todo.size();
                    lookupPerformer(t[0], false);
                }
            } catch (Exception ignored) {
            } finally {
                lookupStatus = "";
                lookupRunning.set(false);
            }
        }).start();
    }

    /** 한 출연자의 정보를 찾아 저장합니다. overwrite 가 false 면 비어 있는 항목만 채움. */
    public JSONObject lookupPerformer(long id, boolean overwrite) throws JSONException {
        String name, group;
        synchronized (this) {
            name = store.optJSONObject("performers").optString(String.valueOf(id), "");
            group = performerInfo(id).optString("group", "");
        }
        if (name.isEmpty()) return null;
        PersonLookup.Result r = PersonLookup.find(name, group);
        synchronized (this) {
            JSONObject info = performerInfo(id);
            String[][] f = {{"real_name", r.realName}, {"birthdate", r.birthdate}, {"height", r.height}};
            for (String[] kv : f) if (kv[1] != null && (overwrite || info.optString(kv[0]).isEmpty())) info.put(kv[0], kv[1]);
            if (r.source != null) { info.put("source", r.source); info.put("source_url", r.sourceUrl); }
            info.put("lookup_at", System.currentTimeMillis() / 1000);
            info.put("lookup_found", !r.empty());
            save();
            return entityJson("performers", id);
        }
    }

    private synchronized JSONObject entityJson(String field, long id) throws JSONException {
        JSONObject o = new JSONObject().put("id", id).put("name", store.optJSONObject(field).optString(String.valueOf(id)));
        if (field.equals("performers")) {
            JSONObject info = performerInfo(id);
            for (String k : new String[]{"group", "real_name", "birthdate", "height", "source", "source_url"})
                o.put(k, info.optString(k, ""));
            o.put("looked_up", info.has("lookup_at"));
            o.put("lookup_found", info.optBoolean("lookup_found", false));
        }
        return o;
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
                    .put("id", kind.equals("video") ? n.id : JSONObject.NULL).put("thumb", kind.equals("video") ? megaHasThumb(n) : n.thumbHandle != null || n.previewHandle != null)
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
            if (!st.has("app_token")) st.put("app_token", randomHex(32));
        } catch (JSONException ignored) {
        }
        save();
    }

    private boolean savePending = false;

    /** 저장을 잠시 모아서 한 번에 씀 (재생 위치처럼 자주 바뀌는 값 때문에 파일 전체를 계속 쓰지 않도록). */
    private synchronized void save() {
        if (savePending) return;
        savePending = true;
        bg.schedule(this::writeNow, 1500, java.util.concurrent.TimeUnit.MILLISECONDS);
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

    /** 앱 화면(WebView)만 가진 쿠키 값. 앱 밖(브라우저·다른 앱)에서는 비밀번호로만 들어올 수 있음. */
    public synchronized String appToken() { return settings().optString("app_token"); }

    /** 설정이 바뀐 뒤 서버를 새 설정(접속 범위)으로 다시 엽니다. 진행 중인 응답을 마치도록 잠시 뒤에 실행. */
    private void restartServerSoon() {
        new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> ServerService.start(ctx), 500);
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
                MediaStore.Video.Media.MIME_TYPE, android.os.Build.VERSION.SDK_INT >= 30 ? MediaStore.MediaColumns.ORIENTATION : MediaStore.Video.Media._ID,
                android.os.Build.VERSION.SDK_INT >= 30 ? MediaStore.MediaColumns.IS_FAVORITE : MediaStore.Video.Media._ID};
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
                    // 세로로 찍은 영상은 회전 정보가 따로 있어서, 화면비를 맞추려면 가로·세로를 바꿔야 함
                    if (android.os.Build.VERSION.SDK_INT >= 30 && (c.getInt(10) == 90 || c.getInt(10) == 270)) {
                        int t = v.width; v.width = v.height; v.height = t;
                    }
                    v.uri = ContentUris.withAppendedId(base, v.id);
                    v.sysFav = android.os.Build.VERSION.SDK_INT >= 30 && c.getInt(11) == 1;
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
        for (ICloud.Album a : icloudAlbums) addICloud(a, list, true);
        all = list;
        byId.clear();
        for (Video v : list) byId.put(v.id, v);
        scanPhotos();
        lastScan = System.currentTimeMillis();
    }

    private synchronized void scanPhotos() {
        List<Video> list = new ArrayList<>();
        Uri base = MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
        String[] proj = {
                MediaStore.Images.Media._ID, MediaStore.Images.Media.DISPLAY_NAME, MediaStore.Images.Media.RELATIVE_PATH,
                MediaStore.Images.Media.SIZE, MediaStore.Images.Media.WIDTH, MediaStore.Images.Media.HEIGHT,
                MediaStore.Images.Media.DATE_ADDED, MediaStore.Images.Media.DATE_TAKEN, MediaStore.Images.Media.MIME_TYPE,
                MediaStore.Images.Media.ORIENTATION,
                android.os.Build.VERSION.SDK_INT >= 30 ? MediaStore.MediaColumns.IS_FAVORITE : MediaStore.Images.Media._ID};
        try (Cursor c = ctx.getContentResolver().query(base, proj, null, null, null)) {
            if (c != null) {
                while (c.moveToNext()) {
                    Video v = new Video();
                    long mid = c.getLong(0);
                    v.id = PHOTO_ID_BASE | mid;
                    v.name = nz(c.getString(1));
                    v.relPath = nz(c.getString(2));
                    v.size = c.getLong(3);
                    v.width = c.getInt(4);
                    v.height = c.getInt(5);
                    if (c.getInt(9) == 90 || c.getInt(9) == 270) { int t = v.width; v.width = v.height; v.height = t; }
                    v.dateAdded = c.getLong(6);
                    v.taken = c.getLong(7) > 0 ? c.getLong(7) / 1000 : v.dateAdded;
                    v.mime = c.getString(8);
                    v.uri = ContentUris.withAppendedId(base, mid);
                    v.sysFav = android.os.Build.VERSION.SDK_INT >= 30 && c.getInt(10) == 1;
                    v.key = v.relPath + v.name + "|" + v.size;
                    list.add(v);
                }
            }
        } catch (SecurityException e) {
            // 사진 권한 없음 — 빈 목록
        }
        for (Mega.Link l : megaLinks) {
            List<Mega.Node> nodes;
            synchronized (l) { nodes = new ArrayList<>(l.nodes); }
            for (Mega.Node n : nodes) {
                if (n.folder || !MEGA_IMAGE_EXTS.contains(ext(n.name))) continue;
                Video v = new Video();
                v.id = n.id;
                v.name = n.name;
                v.relPath = "MEGA/" + n.path;
                v.size = n.size;
                v.dateAdded = n.ts;
                v.taken = n.ts;
                v.mime = mimeFor(ext(n.name));
                v.key = "mega:" + n.handle;
                v.link = l;
                v.node = n;
                list.add(v);
            }
        }
        for (ICloud.Album a : icloudAlbums) addICloud(a, list, false);
        allPhotos = list;
        photoById.clear();
        for (Video v : list) photoById.put(v.id, v);
        syncGalleryFavorites();
    }

    // ------------------------------------------------------------------ 갤러리 즐겨찾기 연동
    /** 갤러리에서 즐겨찾기를 바꾼 항목은 앱에도 반영. (마지막으로 본 갤러리 값과 다를 때만 — 앱에서 바꾼 값을 덮어쓰지 않도록) */
    private synchronized void syncGalleryFavorites() {
        if (android.os.Build.VERSION.SDK_INT < 30) return;
        boolean changed = false;
        List<Video> local = new ArrayList<>(all);
        local.addAll(allPhotos);
        for (Video v : local) {
            if (v.cloud() || v.uri == null) continue;
            JSONObject m = meta(v);
            boolean seen = m.optBoolean("sys_fav_seen", false);
            if (v.sysFav == seen && m.has("sys_fav_seen")) continue;
            try {
                if (!m.has("sys_fav_seen") && !v.sysFav) { m.put("sys_fav_seen", false); changed = true; continue; }   // 처음: 앱 값 유지
                m.put("favorite", v.sysFav);
                m.put("sys_fav_seen", v.sysFav);
                changed = true;
            } catch (JSONException ignored) {}
        }
        if (changed) save();
    }

    /** 앱에서 즐겨찾기를 바꾸면 기기 갤러리에도 반영 (안드로이드 11 이상, 기기 파일만). */
    private void pushGalleryFavorite(Video v, boolean fav) {
        if (android.os.Build.VERSION.SDK_INT < 30 || v.cloud() || v.uri == null) return;
        try { meta(v).put("sys_fav_seen", fav); } catch (JSONException ignored) {}
        v.sysFav = fav;
        MainActivity.requestFavorite(v.uri, fav);
    }

    static boolean canManageMedia(Context ctx) {
        return android.os.Build.VERSION.SDK_INT >= 31 && MediaStore.canManageMedia(ctx);
    }

    /** iCloud 공유 앨범의 영상(videos=true) 또는 사진을 목록에 넣음 */
    private void addICloud(ICloud.Album a, List<Video> list, boolean videos) {
        List<ICloud.Item> items;
        synchronized (a) { items = new ArrayList<>(a.items); }
        for (ICloud.Item it : items) {
            if (it.video != videos) continue;
            Video v = new Video();
            v.id = it.id;
            v.name = it.name;
            v.relPath = "iCloud/" + a.name + "/";
            v.size = it.size;
            v.width = it.width;
            v.height = it.height;
            v.dateAdded = it.ts;
            v.dateModified = it.ts;
            v.taken = it.ts;
            v.mime = it.video ? "video/mp4" : "image/jpeg";
            v.key = "icloud:" + it.guid;
            v.album = a;
            v.item = it;
            list.add(v);
        }
    }

    // ------------------------------------------------------------------ iCloud 공유 앨범
    private synchronized void loadICloudLinks() {
        icloudAlbums.clear();
        JSONArray a = settings().optJSONArray("icloud_links");
        for (int i = 0; a != null && i < a.length(); i++) {
            try { icloudAlbums.add(ICloud.parse(a.optString(i))); } catch (Exception ignored) {}
        }
    }

    private synchronized void saveICloudLinks() {
        JSONArray a = new JSONArray();
        for (ICloud.Album x : icloudAlbums) a.put(x.url);
        try { settings().put("icloud_links", a); } catch (JSONException ignored) {}
        save();
    }

    private synchronized JSONArray icloudJson() throws JSONException {
        JSONArray out = new JSONArray();
        for (int i = 0; i < icloudAlbums.size(); i++) {
            ICloud.Album a = icloudAlbums.get(i);
            int photos = 0, vids = 0;
            synchronized (a) { for (ICloud.Item it : a.items) if (it.video) vids++; else photos++; }
            out.put(new JSONObject().put("index", i).put("name", a.name).put("photos", photos).put("videos", vids)
                    .put("loaded", a.loadedAt > 0).put("error", a.error == null ? JSONObject.NULL : a.error));
        }
        return out;
    }

    /** iCloud 파일을 앱을 거쳐 보냄 (재생 위치 이동을 위해 Range 그대로 전달) */
    private void icloudStream(Video v, HttpServer.Request r, HttpServer.Response res, boolean download) throws IOException {
        java.net.HttpURLConnection c;
        try {
            c = ICloud.open(v.album, v.item, v.item.mediaChecksum, r.header("range"));
        } catch (IOException e) {
            res.error(502, e.getMessage() == null ? "iCloud 연결 실패" : e.getMessage());
            return;
        }
        try (InputStream in = c.getInputStream()) {
            int code = c.getResponseCode();
            long len = c.getContentLengthLong();
            res.header("Content-Type", v.mime).header("Accept-Ranges", "bytes");
            String cr = c.getHeaderField("Content-Range");
            if (cr != null) res.header("Content-Range", cr);
            if (download) res.header("Content-Disposition", "attachment; filename*=UTF-8''" + java.net.URLEncoder.encode(v.name, "UTF-8").replace("+", "%20"));
            OutputStream out = res.start(code == 206 ? 206 : 200, len);
            if (r.method.equals("HEAD")) return;
            byte[] buf = new byte[128 * 1024];
            int k;
            while ((k = in.read(buf)) > 0) out.write(buf, 0, k);
        }
    }

    /** iCloud 미리보기 이미지 (작은 사진 / 영상 포스터), 기기에 보관 */
    private void icloudThumb(Video v, HttpServer.Response res) throws IOException {
        File f = new File(new File(thumbDir, "icloud"), v.item.guid + ".jpg");
        if (f.length() == 0) {
            java.net.HttpURLConnection c;
            try {
                c = ICloud.open(v.album, v.item, v.item.thumbChecksum, null);
            } catch (IOException e) {
                res.error(502, e.getMessage() == null ? "iCloud 연결 실패" : e.getMessage());
                return;
            }
            byte[] data;
            try (InputStream in = c.getInputStream()) { data = readAll(in); }
            f.getParentFile().mkdirs();
            try (FileOutputStream o = new FileOutputStream(f)) { o.write(data); }
        }
        res.header("Cache-Control", "max-age=86400");
        res.send(200, "image/jpeg", readAll(new FileInputStream(f)));
    }

    private synchronized List<Video> visiblePhotos() {
        if (lastScan == 0 || System.currentTimeMillis() - lastScan > 60_000) scan();
        List<String> paths = libraryPaths();
        List<Video> out = new ArrayList<>();
        for (Video v : allPhotos) {
            if (meta(v).optBoolean("hidden", false)) continue;
            if (!v.cloud()) {
                boolean in = false;
                for (String p : paths) if (v.relPath.startsWith(p)) { in = true; break; }
                if (!in) continue;
            }
            out.add(v);
        }
        return out;
    }

    private JSONArray performerNames(JSONObject m) throws JSONException {
        JSONArray refs = entityRefs(m, "performers"), out = new JSONArray();
        for (int i = 0; i < refs.length(); i++) out.put(refs.getJSONObject(i).optString("name"));
        return out;
    }

    private JSONObject photoSummary(Video v) throws JSONException {
        JSONObject m = meta(v);
        int[] wh = dims(v, m);
        return new JSONObject().put("id", v.id).put("title", title(v)).put("width", wh[0]).put("height", wh[1])
                .put("size", v.size).put("favorite", m.optBoolean("favorite", false) ? 1 : 0).put("rating", m.optInt("rating", 0))
                .put("performers", performerNames(m)).put("added_at", v.dateAdded).put("taken", v.taken)
                .put("source", v.source());
    }

    private synchronized JSONObject photoDetail(Video v) throws JSONException {
        return photoSummary(v).put("filename", v.name).put("folder", v.relPath)
                .put("performer_refs", entityRefs(meta(v), "performers")).put("tags", entityRefs(meta(v), "tags"));
    }

    private synchronized JSONObject listPhotos(HttpServer.Request r) throws JSONException {
        String q = nz(r.param("q")).trim().toLowerCase(Locale.ROOT);
        String[] words = q.isEmpty() ? new String[0] : q.split("\\s+");
        Set<Long> perfFilter = longs(r.params("performer")), tagFilter = longs(r.params("tag"));
        boolean fav = "1".equals(r.param("fav"));
        List<Video> list = new ArrayList<>();
        for (Video v : visiblePhotos()) {
            JSONObject m = meta(v);
            if (fav && !m.optBoolean("favorite", false)) continue;
            if (!containsAll(m.optJSONArray("performers"), perfFilter) || !containsAll(m.optJSONArray("tags"), tagFilter)) continue;
            if (words.length > 0) {
                String hay = (title(v) + " " + v.relPath + v.name + " " + performerNames(m).join(" ")).toLowerCase(Locale.ROOT);
                boolean ok = true;
                for (String w : words) if (!hay.contains(w)) { ok = false; break; }
                if (!ok) continue;
            }
            list.add(v);
        }
        String sort = r.param("sort") == null ? "taken" : r.param("sort");
        boolean asc = "asc".equals(r.param("order"));
        if ("random".equals(sort)) {
            Collections.shuffle(list, new Random(parseInt(r.param("seed"), 7)));
        } else {
            Comparator<Video> cmp;
            switch (sort) {
                case "title": cmp = Comparator.comparing(v -> title(v).toLowerCase(Locale.ROOT)); break;
                case "size": cmp = Comparator.comparingLong(v -> v.size); break;
                case "added": cmp = Comparator.comparingLong(v -> v.dateAdded); break;
                case "rating": cmp = Comparator.comparingInt(v -> meta(v).optInt("rating", 0)); break;
                default: cmp = Comparator.comparingLong(v -> v.taken);
            }
            cmp = cmp.thenComparingLong(v -> v.id);
            list.sort(asc ? cmp : cmp.reversed());
        }
        int page = Math.max(1, parseInt(r.param("page"), 1));
        int per = Math.min(300, Math.max(1, parseInt(r.param("per"), 60)));
        JSONArray items = new JSONArray();
        for (int i = (page - 1) * per; i < Math.min(list.size(), page * per); i++) items.put(photoSummary(list.get(i)));
        return new JSONObject().put("total", list.size()).put("page", page).put("per", per).put("items", items);
    }

    /** 미디어 탭 ‘전체’: 영상과 사진을 한 목록으로. type = all | video | photo */
    private synchronized JSONObject listMedia(HttpServer.Request r) throws JSONException {
        String type = nz(r.param("type"));
        String q = nz(r.param("q")).trim().toLowerCase(Locale.ROOT);
        String[] words = q.isEmpty() ? new String[0] : q.split("\\s+");
        Set<Long> perfFilter = longs(r.params("performer")), tagFilter = longs(r.params("tag"));
        boolean fav = "1".equals(r.param("fav")), unwatched = "1".equals(r.param("unwatched"));
        List<Video> list = new ArrayList<>();
        Set<Long> photoIds = new HashSet<>();
        List<Video> src = new ArrayList<>();
        if (!type.equals("photo")) src.addAll(visible());
        if (!type.equals("video")) for (Video p : visiblePhotos()) { src.add(p); photoIds.add(p.id); }
        for (Video v : src) {
            JSONObject m = meta(v);
            if (fav && !m.optBoolean("favorite", false)) continue;
            if (unwatched && (photoIds.contains(v.id) || m.optInt("play_count", 0) > 0)) continue;
            if (!containsAll(m.optJSONArray("performers"), perfFilter) || !containsAll(m.optJSONArray("tags"), tagFilter)) continue;
            if (words.length > 0) {
                String hay = (title(v) + " " + v.relPath + v.name + " " + performerNames(m).join(" ")).toLowerCase(Locale.ROOT);
                boolean ok = true;
                for (String w : words) if (!hay.contains(w)) { ok = false; break; }
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
                case "size": cmp = Comparator.comparingLong(v -> v.size); break;
                case "rating": cmp = Comparator.comparingInt(v -> meta(v).optInt("rating", 0)); break;
                case "duration": cmp = Comparator.comparingDouble(v -> v.node != null ? meta(v).optDouble("duration", 0) : v.duration); break;
                case "plays": cmp = Comparator.comparingInt(v -> meta(v).optInt("play_count", 0)); break;
                case "played": cmp = Comparator.comparingLong(v -> meta(v).optLong("last_played", 0)); break;
                default: cmp = Comparator.comparingLong(v -> v.dateAdded);
            }
            cmp = cmp.thenComparingLong(v -> v.id);
            list.sort(asc ? cmp : cmp.reversed());
        }
        int page = Math.max(1, parseInt(r.param("page"), 1));
        int per = Math.min(300, Math.max(1, parseInt(r.param("per"), 60)));
        JSONArray items = new JSONArray();
        for (int i = (page - 1) * per; i < Math.min(list.size(), page * per); i++) {
            Video v = list.get(i);
            boolean photo = photoIds.contains(v.id);
            items.put((photo ? photoSummary(v) : summary(v)).put("kind", photo ? "photo" : "video"));
        }
        return new JSONObject().put("total", list.size()).put("page", page).put("per", per).put("items", items);
    }

    private void photoThumb(Video v, HttpServer.Request r, HttpServer.Response res) throws Exception {
        File f = new File(new File(thumbDir, "photos"), Long.toHexString(v.id) + ".jpg");
        if (!f.exists() || f.length() == 0) {
            byte[] jpg = null;
            if (v.node != null) {
                jpg = Mega.preview(v.link, v.node);
                if (jpg == null) { megaStream(v.link, v.node, v.mime, r, res, false); return; }   // 썸네일이 없으면 원본
                rememberPreviewSize(v, jpg);
            } else {
                Bitmap bmp = null;
                frameLock.acquire();
                try {
                    bmp = ctx.getContentResolver().loadThumbnail(v.uri, new Size(512, 512), null);
                } catch (Exception ignored) {
                } finally {
                    frameLock.release();
                }
                if (bmp == null) { res.error(404, "no thumbnail"); return; }
                ByteArrayOutputStream bo = new ByteArrayOutputStream();
                bmp.compress(Bitmap.CompressFormat.JPEG, 80, bo);
                bmp.recycle();
                jpg = bo.toByteArray();
            }
            f.getParentFile().mkdirs();
            try (FileOutputStream o = new FileOutputStream(f)) { o.write(jpg); }
        }
        res.header("Cache-Control", "max-age=86400");
        res.send(200, "image/jpeg", readAll(new FileInputStream(f)));
    }

    private void photoFull(Video v, HttpServer.Request r, HttpServer.Response res) throws Exception {
        String mime = v.mime == null ? "image/jpeg" : v.mime;
        boolean heic = mime.contains("heic") || mime.contains("heif");
        if (v.node != null) { megaStream(v.link, v.node, mime, r, res, "1".equals(r.param("dl"))); return; }
        if (!heic) { media(v, r, res); return; }
        // 웹 화면은 HEIC 를 못 보여 주므로 JPEG 로 바꿔서 보냄
        File f = new File(new File(thumbDir, "photos"), Long.toHexString(v.id) + "-full.jpg");
        if (!f.exists() || f.length() == 0) {
            Bitmap bmp = android.graphics.ImageDecoder.decodeBitmap(android.graphics.ImageDecoder.createSource(ctx.getContentResolver(), v.uri),
                    (decoder, info, src) -> {
                        int w = info.getSize().getWidth(), h = info.getSize().getHeight(), max = Math.max(w, h);
                        if (max > 2560) decoder.setTargetSize(w * 2560 / max, h * 2560 / max);
                    });
            f.getParentFile().mkdirs();
            try (FileOutputStream o = new FileOutputStream(f)) { bmp.compress(Bitmap.CompressFormat.JPEG, 88, o); }
            bmp.recycle();
        }
        res.header("Cache-Control", "max-age=86400");
        res.send(200, "image/jpeg", readAll(new FileInputStream(f)));
    }

    private synchronized List<Video> visible() {
        if (lastScan == 0 || System.currentTimeMillis() - lastScan > 60_000) scan();
        List<String> paths = libraryPaths();
        List<Video> out = new ArrayList<>();
        for (Video v : all) {
            if (v.cloud()) {   // MEGA·iCloud 영상은 폴더 설정과 관계없이 표시
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
        int[] wh = dims(v, m);
        o.put("width", wh[0]);
        o.put("height", wh[1]);
        o.put("size", v.size);
        o.put("rating", m.optInt("rating", 0));
        o.put("favorite", m.optBoolean("favorite", false) ? 1 : 0);
        o.put("play_count", m.optInt("play_count", 0));
        o.put("thumbs", v.node != null ? (megaHasThumb(v.node) ? 1 : 0) : v.item != null ? 1 : N_FRAMES);
        o.put("missing", 0);
        o.put("resume_pos", m.optDouble("resume_pos", 0));
        o.put("added_at", v.dateAdded);
        o.put("performers", performerNames(m));
        return o;
    }

    /** 화면비: 실제 해상도 → (MEGA) 재생 때 저장한 해상도 → 미리보기 이미지 크기 순. */
    private static int[] dims(Video v, JSONObject m) {
        if (v.width > 0 && v.height > 0) return new int[]{v.width, v.height};
        if (m.optInt("width", 0) > 0 && m.optInt("height", 0) > 0) return new int[]{m.optInt("width"), m.optInt("height")};
        return new int[]{m.optInt("pw", 0), m.optInt("ph", 0)};
    }

    /** 미리보기 JPEG 의 크기를 비율 정보로 저장. */
    private synchronized void rememberPreviewSize(Video v, byte[] jpg) {
        android.graphics.BitmapFactory.Options o = new android.graphics.BitmapFactory.Options();
        o.inJustDecodeBounds = true;
        android.graphics.BitmapFactory.decodeByteArray(jpg, 0, jpg.length, o);
        if (o.outWidth > 0 && o.outHeight > 0 && o.outWidth != o.outHeight) {   // 정사각형 썸네일은 비율 정보가 아님
            try {
                JSONObject m = meta(v);
                m.put("pw", o.outWidth);
                m.put("ph", o.outHeight);
                save();
            } catch (JSONException ignored) {}
        }
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
        o.put("source", v.source());
        return o;
    }

    private synchronized JSONObject listVideos(HttpServer.Request r) throws JSONException {
        List<Video> list = new ArrayList<>();
        String q = nz(r.param("q")).trim().toLowerCase(Locale.ROOT);
        String[] words = q.isEmpty() ? new String[0] : q.split("\\s+");
        Set<Long> tagFilter = longs(r.params("tag")), perfFilter = longs(r.params("performer"));
        boolean fav = "1".equals(r.param("fav")), unwatched = "1".equals(r.param("unwatched"));
        int minRating = parseInt(r.param("min_rating"), 0);
        double maxDur = parseInt(r.param("max_dur"), 0);   // 숏폼: 이 길이(초) 이하만
        if ("1".equals(r.param("missing"))) return new JSONObject().put("total", 0).put("page", 1).put("per", 40).put("items", new JSONArray());
        for (Video v : visible()) {
            JSONObject m = meta(v);
            if (fav && !m.optBoolean("favorite", false)) continue;
            if (unwatched && m.optInt("play_count", 0) > 0) continue;
            if (m.optInt("rating", 0) < minRating) continue;
            if (maxDur > 0) {
                double d = v.node != null ? m.optDouble("duration", 0) : v.duration;
                if (d <= 0 || d > maxDur) continue;
            }
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
        Map<Long, Integer> photoCounts = new HashMap<>();
        Map<Long, Video> photoCovers = new HashMap<>();
        for (Video v : visiblePhotos()) {
            JSONArray ids = meta(v).optJSONArray(field);
            if (ids == null) continue;
            for (int i = 0; i < ids.length(); i++) {
                photoCounts.merge(ids.optLong(i), 1, Integer::sum);
                photoCovers.putIfAbsent(ids.optLong(i), v);
            }
        }
        List<JSONObject> out = new ArrayList<>();
        Iterator<String> it = names.keys();
        while (it.hasNext()) {
            String k = it.next();
            long id = Long.parseLong(k);
            Video cv = covers.get(id), pc = photoCovers.get(id);
            JSONObject row = field.equals("performers") ? entityJson(field, id) : new JSONObject().put("id", id).put("name", names.optString(k));
            out.add(row
                    .put("count", counts.getOrDefault(id, 0)).put("cover", cv == null ? JSONObject.NULL : cv.id)
                    .put("photo_count", photoCounts.getOrDefault(id, 0)).put("photo_cover", pc == null ? JSONObject.NULL : pc.id));
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
                .put("mega_supported", true).put("mega", megaJson()).put("icloud", icloudJson())
                .put("server", serverJson()).put("performer_info", true).put("photos", true)
                .put("fav_sync", android.os.Build.VERSION.SDK_INT >= 30).put("manage_media", canManageMedia(ctx))
                .put("manage_media_supported", android.os.Build.VERSION.SDK_INT >= 31)
                .put("duplicates", true).put("backup", true).put("mega_refresh_hours", megaRefreshHours())
                .put("mega_last_refresh", lastMegaRefresh / 1000).put("hidden_count", hiddenCount()).put("mega_thumbs", megaThumbsOn())
                .put("mega_thumb_missing", megaThumbMissing()[0]).put("mega_thumb_failed", megaThumbMissing()[1]);
    }

    private synchronized int hiddenCount() {
        int n = 0;
        for (Video v : all) if (meta(v).optBoolean("hidden", false)) n++;
        return n;
    }

    /** {썸네일 없는 MEGA 영상 수, 그중 만들기에 실패한 수} */
    private synchronized int[] megaThumbMissing() {
        int missing = 0, failed = 0;
        for (Video v : all) {
            if (v.node == null || megaHasThumb(v.node)) continue;
            missing++;
            if (meta(v).optInt("gen_fail", 0) >= GEN_MAX_FAILS) failed++;
        }
        return new int[]{missing, failed};
    }

    private JSONObject serverJson() throws JSONException {
        boolean lan = lanEnabled() && passwordSet();
        JSONArray addrs = new JSONArray();
        if (lan) for (String ip : ServerService.lanAddresses()) addrs.put("http://" + ip + ":" + ServerService.port);
        return new JSONObject().put("secure_folder", ServerService.userId() != 0).put("port", ServerService.port)
                .put("lan", lan).put("lan_addresses", addrs);
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
        String cookie = r.header("cookie");
        if (cookie == null) return false;
        String app = appToken(), tok = authToken();
        for (String part : cookie.split(";")) {
            String p = part.trim();
            if (p.startsWith("vs_app=") && MessageDigest.isEqual(p.substring(7).getBytes(), app.getBytes())) return true;
            if (tok != null && p.startsWith("vs_auth=") && MessageDigest.isEqual(p.substring(8).getBytes(), tok.getBytes())) return true;
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
        if (path.startsWith("/photo/") || path.startsWith("/photothumb/")) {
            if (!authed(r)) { res.error(401, "login required"); return; }
            String[] p = path.split("/");
            Video v;
            synchronized (this) {
                if (lastScan == 0) scan();
                v = photoById.get(parseLong(p.length > 2 ? p[2].replace(".jpg", "") : "", -1));
            }
            if (v == null) { res.error(404, "not found"); return; }
            if (v.item != null) { if (path.startsWith("/photo/")) icloudStream(v, r, res, "1".equals(r.param("dl"))); else icloudThumb(v, res); }
            else if (path.startsWith("/photo/")) photoFull(v, r, res); else photoThumb(v, r, res);
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
            if (path.startsWith("/media/") && v.item != null) icloudStream(v, r, res, "1".equals(r.param("dl")));
            else if (v.item != null) icloudThumb(v, res);
            else if (path.startsWith("/media/") && v.node != null) megaStream(v.link, v.node, v.mime, r, res, "1".equals(r.param("dl")));
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
            res.json(200, new JSONObject().put("required", true).put("ok", authed(r)).put("password_set", authToken() != null).toString());
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
                        if (b.has("favorite")) { meta.put("favorite", b.optBoolean("favorite")); pushGalleryFavorite(v, b.optBoolean("favorite")); }
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
                if (action.equals("unhide") && m.equals("POST")) {
                    meta.remove("hidden");
                    save();
                    res.json(200, "{\"ok\":true}");
                    return;
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
                    if (pb.optInt("width", 0) > 0 && pb.optInt("height", 0) > 0) { meta.put("width", pb.optInt("width")); meta.put("height", pb.optInt("height")); }
                    save();
                    res.json(200, "{\"ok\":true}");
                    return;
                }
                if (action.equals("thumbs") && m.equals("POST")) {
                    if (v.node != null) {
                        megaGenFile(v.node).delete();
                        meta.remove("gen_fail");
                        save();
                        megaThumbsSoon();
                    }
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

        if (p0.equals("photos")) {
            if (parts.length == 1 && m.equals("GET")) { res.json(200, listPhotos(r).toString()); return; }
            Video v;
            synchronized (this) {
                if (lastScan == 0) scan();
                v = photoById.get(parseLong(parts.length > 1 ? parts[1] : "", -1));
            }
            if (v == null) { res.error(404, "not found"); return; }
            synchronized (this) {
                if (m.equals("GET")) { res.json(200, photoDetail(v).toString()); return; }
                if (m.equals("PATCH")) {
                    JSONObject b = body(r), meta = meta(v);
                    if (b.has("favorite")) { meta.put("favorite", b.optBoolean("favorite")); pushGalleryFavorite(v, b.optBoolean("favorite")); }
                    if (b.has("rating")) meta.put("rating", Math.max(0, Math.min(5, b.optInt("rating"))));
                    if (b.has("performers")) setLinks(meta, "performers", b.optJSONArray("performers"));
                    if (b.has("tags")) setLinks(meta, "tags", b.optJSONArray("tags"));
                    save();
                    res.json(200, photoDetail(v).toString());
                    return;
                }
            }
        }
        if (p0.equals("performers") && parts.length >= 2) {
            if (parts[1].equals("auto") && m.equals("POST")) {          // MEGA 폴더 이름으로 다시 지정 + 정보 찾기
                synchronized (this) {
                    JSONObject vids = store.optJSONObject("videos");
                    Iterator<String> it = vids.keys();
                    while (it.hasNext()) { JSONObject mm = vids.optJSONObject(it.next()); if (mm != null) mm.remove("auto_perf"); }
                }
                JSONObject r0 = autoPerformers();
                lookupMissingSoon();
                res.json(200, r0.toString());
                return;
            }
            if (parts.length == 3 && parts[2].equals("lookup") && m.equals("POST")) {   // 인터넷에서 다시 찾기 (네트워크, 잠금 밖)
                JSONObject e = lookupPerformer(parseLong(parts[1], -1), true);
                if (e == null) res.error(404, "not found"); else res.json(200, e.toString());
                return;
            }
            if (parts.length == 2 && m.equals("PATCH")) {
                JSONObject b = body(r);
                JSONObject info = b.optJSONObject("info");
                if (info != null) {
                    long id = parseLong(parts[1], -1);
                    synchronized (this) {
                        if (!store.optJSONObject("performers").has(String.valueOf(id))) { res.error(404, "not found"); return; }
                        JSONObject cur = performerInfo(id);
                        for (String k : new String[]{"group", "real_name", "birthdate", "height"})
                            if (info.has(k)) cur.put(k, info.optString(k, "").trim());
                        save();
                    }
                    if (!b.has("name")) { res.json(200, entityJson("performers", id).toString()); return; }
                }
            }
        }
        if (p0.equals("tags") || p0.equals("performers")) {
            String field = p0;
            synchronized (this) {
                if (parts.length == 1 && m.equals("GET")) { res.json(200, listEntities(field).toString()); return; }
                long id = parseLong(parts[1], -1);
                JSONObject names = store.optJSONObject(field);
                String key = String.valueOf(id);
                if (!names.has(key)) { res.error(404, "not found"); return; }
                if (m.equals("GET")) { res.json(200, entityJson(field, id).toString()); return; }
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

        if (p0.equals("icloud")) {
            if (parts.length == 1 && m.equals("GET")) { res.json(200, icloudJson().toString()); return; }
            if (parts.length == 1 && m.equals("POST")) {
                ICloud.Album a;
                try {
                    a = ICloud.parse(body(r).optString("url"));
                } catch (IllegalArgumentException e) {
                    res.error(400, e.getMessage());
                    return;
                }
                synchronized (this) {
                    for (ICloud.Album x : icloudAlbums) if (x.token.equals(a.token)) { res.error(400, "이미 추가된 앨범입니다"); return; }
                }
                ICloud.load(a);   // 네트워크 — 잠금 밖
                if (a.error != null) { res.error(400, a.error); return; }
                synchronized (this) { icloudAlbums.add(a); }
                saveICloudLinks();
                scan();
                res.json(200, icloudJson().toString());
                return;
            }
            int idx = parts.length > 1 ? parseInt(parts[1], -1) : -1;
            if (parts.length == 2 && m.equals("DELETE")) {
                synchronized (this) { if (idx >= 0 && idx < icloudAlbums.size()) icloudAlbums.remove(idx); }
                saveICloudLinks();
                scan();
                res.json(200, icloudJson().toString());
                return;
            }
            if (parts.length == 3 && parts[2].equals("items") && m.equals("GET")) {   // 앨범 안 사진·영상
                JSONArray items = new JSONArray();
                synchronized (this) {
                    if (idx < 0 || idx >= icloudAlbums.size()) { res.error(404, "not found"); return; }
                    ICloud.Album a = icloudAlbums.get(idx);
                    if (lastScan == 0) scan();
                    List<Video> vs = new ArrayList<>();
                    for (Video v : all) if (v.album == a) vs.add(v);
                    for (Video v : allPhotos) if (v.album == a) vs.add(v);
                    vs.sort(Comparator.comparingLong((Video v) -> v.dateAdded).reversed());
                    for (Video v : vs) items.put((v.item.video ? summary(v) : photoSummary(v)).put("kind", v.item.video ? "video" : "photo"));
                    res.json(200, new JSONObject().put("name", a.name).put("error", a.error == null ? JSONObject.NULL : a.error).put("items", items).toString());
                }
                return;
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
                megaThumbsSoon();
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
                if (b.has("mega_refresh_hours")) {
                    synchronized (this) { settings().put("mega_refresh_hours", Math.max(0, Math.min(168, b.optInt("mega_refresh_hours")))); save(); }
                }
                if (b.has("mega_thumbs")) {
                    synchronized (this) { settings().put("mega_thumbs", b.optBoolean("mega_thumbs")); save(); }
                    if (b.optBoolean("mega_thumbs")) { genPausedUntil = 0; megaThumbsSoon(); }
                }
                if (b.has("password")) {
                    setPassword(b.optString("password"));
                    if (!passwordSet() && lanEnabled()) { setLan(false); restartServerSoon(); }
                }
                if (b.has("lan")) {
                    boolean on = b.optBoolean("lan");
                    if (on && !passwordSet()) { res.error(400, "먼저 비밀번호를 정해야 다른 기기 접속을 켤 수 있습니다"); return; }
                    setLan(on);
                    restartServerSoon();
                }
            }
            res.json(200, settingsJson().toString());
            return;
        }
        if (p0.equals("duplicates") && m.equals("GET")) { res.json(200, duplicates().toString()); return; }
        if (p0.equals("duplicates") && parts.length == 2 && parts[1].equals("keep") && m.equals("POST")) {
            JSONObject b = body(r);
            synchronized (this) {
                if (lastScan == 0) scan();
                Video keep = byId.get(b.optLong("keep", -1));
                JSONArray oa = b.optJSONArray("others");
                List<Video> others = new ArrayList<>();
                for (int i = 0; oa != null && i < oa.length(); i++) { Video o = byId.get(oa.optLong(i)); if (o != null) others.add(o); }
                if (keep == null || others.isEmpty()) { res.error(400, "영상을 찾지 못했습니다"); return; }
                mergeInto(keep, others);
            }
            res.json(200, "{\"ok\":true}");
            return;
        }
        if (p0.equals("media") && m.equals("GET")) { res.json(200, listMedia(r).toString()); return; }
        if (p0.equals("hidden") && m.equals("GET")) { res.json(200, hiddenVideos().toString()); return; }
        if (p0.equals("backup") && m.equals("GET")) {
            String day = new java.text.SimpleDateFormat("yyyyMMdd-HHmm", Locale.ROOT).format(new java.util.Date());
            res.header("Content-Disposition", "attachment; filename=\"vidshelf-backup-" + day + ".json\"");
            res.send(200, "application/json; charset=utf-8", backupJson().toString().getBytes(StandardCharsets.UTF_8));
            return;
        }
        if (p0.equals("restore") && m.equals("POST")) {
            int n;
            try {
                n = restore(new JSONObject(r.bodyText()));
            } catch (JSONException e) {
                res.error(400, e.getMessage() != null && e.getMessage().startsWith("VidShelf") ? e.getMessage() : "백업 파일을 읽지 못했습니다");
                return;
            }
            new Thread(this::refreshMega).start();
            res.json(200, new JSONObject().put("videos", n).toString());
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
            String job = lookupStatus;
            res.json(200, new JSONObject().put("scanning", !job.isEmpty()).put("scan_found", 0).put("scan_new", 0)
                    .put("scan_current", job)
                    .put("mega_quota_hit", Mega.quotaHitAt > 0 && System.currentTimeMillis() - Mega.quotaHitAt < 6 * 3600_000L ? Mega.quotaHitAt / 1000 : 0)
                    .put("mega_quota_until", Mega.quotaUntil > System.currentTimeMillis() ? Mega.quotaUntil / 1000 : 0)
                    .put("thumb_pending", genPending).put("thumb_current", genCurrent).put("last_scan", lastScan / 1000)
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
        if (n != 0) { res.error(404, "no frame"); return; }
        if (v.node.thumbHandle == null && v.node.previewHandle == null) {   // 앱이 직접 만든 썸네일
            File g = megaGenFile(v.node);
            if (g.length() == 0) { res.error(404, "no thumbnail"); return; }
            res.header("Cache-Control", r.param("v") != null && !"x".equals(r.param("v")) ? "max-age=86400" : "no-cache");
            res.send(200, "image/jpeg", readAll(new FileInputStream(g)));
            return;
        }
        File f = new File(new File(thumbDir, "mega"), v.node.handle + "-p.jpg");
        if (!f.exists() || f.length() == 0) {
            byte[] jpg = Mega.preview(v.link, v.node);
            if (jpg == null) { res.error(404, "no thumbnail"); return; }
            rememberPreviewSize(v, jpg);
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
                        bmp = ctx.getContentResolver().loadThumbnail(v.uri, new Size(640, 640), null);   // 비율 유지 (세로 영상도)
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
