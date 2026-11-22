package app.vidshelf;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * iCloud 공유 앨범(웹 공유를 켠 링크: https://www.icloud.com/sharedalbum/#토큰) 읽기 전용 클라이언트.
 * 로그인 없이 사진·영상 목록과 파일 주소를 받습니다. 파일 주소는 몇 시간 뒤 만료되어 필요할 때 다시 받습니다.
 */
class ICloud {

    static final long ID_BASE = 1L << 52;   // 라이브러리 id (기기·MEGA·사진 id 와 겹치지 않게)

    static class Item {
        String guid, name, mediaChecksum, thumbChecksum;
        boolean video;
        int width, height;
        long size, ts, id;
    }

    static class Album {
        final String url, token;
        String host, name = "iCloud", error;
        long loadedAt;
        List<Item> items = new ArrayList<>();
        final Map<String, Item> byGuid = new HashMap<>();
        final Map<String, String[]> urlCache = new HashMap<>();   // checksum -> {url, 만료시각}

        Album(String url, String token) {
            this.url = url;
            this.token = token;
        }
    }

    private static final Pattern LINK = Pattern.compile("icloud\\.com/sharedalbum/(?:[a-z-]+/)?#([A-Za-z0-9]{10,})");
    private static final String B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

    /** 공유 앨범 링크를 해석합니다. 형식이 틀리면 IllegalArgumentException. */
    static Album parse(String url) {
        Matcher m = LINK.matcher(url.trim());
        if (!m.find()) throw new IllegalArgumentException("iCloud 공유 앨범 링크 형식이 아닙니다. 사진 앱 → 공유 앨범 → 사람 아이콘 → ‘공개 웹사이트’를 켜고 나오는 https://www.icloud.com/sharedalbum/#… 링크를 붙여넣으세요.");
        String token = m.group(1);
        return new Album("https://www.icloud.com/sharedalbum/#" + token, token);
    }

    /** 토큰으로 앨범이 있는 서버 번호를 계산 (틀려도 서버가 맞는 주소를 알려 줌). */
    private static String guessHost(String token) {
        int p = 0;
        String part = token.charAt(0) == 'A' ? token.substring(1, 2) : token.substring(1, 3);
        for (char c : part.toCharArray()) p = p * 62 + Math.max(0, B62.indexOf(c));
        return String.format(Locale.ROOT, "p%02d-sharedstreams.icloud.com", p);
    }

    private static JSONObject post(Album a, String what, JSONObject body) throws IOException {
        if (a.host == null) a.host = guessHost(a.token);
        for (int attempt = 0; attempt < 3; attempt++) {
            HttpURLConnection c = (HttpURLConnection) new URL("https://" + a.host + "/" + a.token + "/sharedstreams/" + what).openConnection();
            c.setConnectTimeout(20000);
            c.setReadTimeout(40000);
            c.setDoOutput(true);
            c.setRequestMethod("POST");
            c.setRequestProperty("Content-Type", "text/plain");
            c.setRequestProperty("Origin", "https://www.icloud.com");
            try (OutputStream o = c.getOutputStream()) { o.write(body.toString().getBytes(StandardCharsets.UTF_8)); }
            int code = c.getResponseCode();
            InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
            String text = in == null ? "" : new String(Library.readAll(in), StandardCharsets.UTF_8);
            if (code == 330) {   // 다른 서버에 있음
                try {
                    String host = new JSONObject(text).optString("X-Apple-MMe-Host", "");
                    if (!host.isEmpty()) { a.host = host; continue; }
                } catch (Exception ignored) {}
            }
            if (code == 404) throw new IOException("공유 앨범을 찾을 수 없습니다 (링크가 삭제되었거나 ‘공개 웹사이트’가 꺼져 있습니다)");
            if (code >= 400) throw new IOException("iCloud 응답 오류 (HTTP " + code + ")");
            try {
                return new JSONObject(text);
            } catch (Exception e) {
                throw new IOException("iCloud 응답을 읽지 못했습니다");
            }
        }
        throw new IOException("iCloud 서버를 찾지 못했습니다");
    }

    private static long num(JSONObject o, String k) {
        try { return Long.parseLong(o.optString(k, "0").trim()); } catch (Exception e) { return 0; }
    }

    private static long parseDate(String s) {
        if (s == null || s.isEmpty()) return 0;
        for (String f : new String[]{"yyyy-MM-dd'T'HH:mm:ss'Z'", "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"}) {
            try {
                SimpleDateFormat d = new SimpleDateFormat(f, Locale.ROOT);
                d.setTimeZone(TimeZone.getTimeZone("UTC"));
                return d.parse(s).getTime() / 1000;
            } catch (Exception ignored) {}
        }
        return 0;
    }

    /** 앨범의 사진·영상 목록을 받습니다. 실패하면 album.error 에 이유. */
    static void load(Album a) {
        try {
            JSONObject r = post(a, "webstream", new JSONObject().put("streamCtag", JSONObject.NULL));
            List<Item> items = new ArrayList<>();
            JSONArray photos = r.optJSONArray("photos");
            SimpleDateFormat nameFmt = new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.ROOT);
            for (int i = 0; photos != null && i < photos.length(); i++) {
                JSONObject p = photos.optJSONObject(i);
                JSONObject ders = p == null ? null : p.optJSONObject("derivatives");
                if (ders == null) continue;
                Item it = new Item();
                it.guid = p.optString("photoGuid");
                it.video = "video".equalsIgnoreCase(p.optString("mediaAssetType"));
                it.ts = parseDate(p.optString("dateCreated", p.optString("batchDateCreated")));
                // 원본에 가장 가까운 파일(영상: 가장 큰 영상, 사진: 가장 큰 사진)과 미리보기(작은 사진 / 영상 포스터)
                String best = null, thumb = null;
                long bestSize = -1, thumbW = Long.MAX_VALUE;
                Iterator<String> keys = ders.keys();
                while (keys.hasNext()) {
                    String k = keys.next();
                    JSONObject d = ders.optJSONObject(k);
                    if (d == null) continue;
                    long size = num(d, "fileSize"), w = num(d, "width");
                    boolean poster = k.equalsIgnoreCase("PosterFrame");
                    if (it.video && poster) { thumb = d.optString("checksum"); continue; }
                    if (size > bestSize) {
                        bestSize = size; best = d.optString("checksum");
                        it.width = (int) w; it.height = (int) num(d, "height"); it.size = size;
                    }
                    if (!it.video && w >= 300 && w < thumbW) { thumbW = w; thumb = d.optString("checksum"); }
                }
                if (best == null || it.guid.isEmpty()) continue;
                it.mediaChecksum = best;
                it.thumbChecksum = thumb != null ? thumb : best;
                String caption = p.optString("caption", "").trim();
                it.name = (caption.isEmpty() ? (it.video ? "VID_" : "IMG_") + nameFmt.format(new java.util.Date(it.ts * 1000)) : caption.replaceAll("[\\\\/:*?\"<>|]", "_"))
                        + (it.video ? ".mp4" : ".jpg");
                it.id = ID_BASE | ((it.guid.hashCode() & 0xFFFFFFFFL) << 8) | (Math.abs(a.token.hashCode()) & 0xFF);
                items.add(it);
            }
            synchronized (a) {
                a.items = items;
                a.byGuid.clear();
                for (Item it : items) a.byGuid.put(it.guid, it);
                a.name = r.optString("streamName", a.name).isEmpty() ? a.name : r.optString("streamName");
                a.loadedAt = System.currentTimeMillis();
                a.error = null;
            }
        } catch (Exception e) {
            a.error = e.getMessage() == null ? "iCloud 연결 실패" : e.getMessage();
        }
    }

    /** 파일의 다운로드 주소 (만료 전이면 기억해 둔 것). */
    static String assetUrl(Album a, Item it, String checksum) throws IOException {
        synchronized (a) {
            String[] c = a.urlCache.get(checksum);
            if (c != null && Long.parseLong(c[1]) > System.currentTimeMillis()) return c[0];
        }
        JSONObject r;
        try {
            r = post(a, "webasseturls", new JSONObject().put("photoGuids", new JSONArray().put(it.guid)));
        } catch (org.json.JSONException e) {
            throw new IOException(e);
        }
        JSONObject items = r.optJSONObject("items"), locs = r.optJSONObject("locations");
        if (items == null) throw new IOException("iCloud 파일 주소를 받지 못했습니다");
        long expires = System.currentTimeMillis() + 50 * 60 * 1000L;
        synchronized (a) {
            Iterator<String> keys = items.keys();
            while (keys.hasNext()) {
                String k = keys.next();
                JSONObject u = items.optJSONObject(k);
                if (u == null) continue;
                String loc = u.optString("url_location"), path = u.optString("url_path"), scheme = "https", host = loc;
                JSONObject l = locs == null ? null : locs.optJSONObject(loc);
                if (l != null) {
                    scheme = l.optString("scheme", "https");
                    JSONArray hosts = l.optJSONArray("hosts");
                    if (hosts != null && hosts.length() > 0) host = hosts.optString(0, loc);
                }
                a.urlCache.put(k, new String[]{scheme + "://" + host + path, String.valueOf(expires)});
            }
            String[] c = a.urlCache.get(checksum);
            if (c == null) throw new IOException("iCloud 파일 주소를 받지 못했습니다");
            return c[0];
        }
    }

    /** 파일을 엽니다 (Range 그대로 전달). 만료된 주소면 한 번 다시 받음. */
    static HttpURLConnection open(Album a, Item it, String checksum, String range) throws IOException {
        for (int attempt = 0; attempt < 2; attempt++) {
            String url = assetUrl(a, it, checksum);
            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(20000);
            c.setReadTimeout(60000);
            if (range != null) c.setRequestProperty("Range", range);
            int code = c.getResponseCode();
            if (code == 403 || code == 404 || code == 410) {   // 주소 만료
                synchronized (a) { a.urlCache.remove(checksum); }
                continue;
            }
            if (code >= 400) throw new IOException("iCloud 파일을 받지 못했습니다 (HTTP " + code + ")");
            return c;
        }
        throw new IOException("iCloud 파일 주소가 만료되었습니다. 잠시 후 다시 시도하세요.");
    }
}
