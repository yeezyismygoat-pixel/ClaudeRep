package app.vidshelf;

import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import javax.crypto.Cipher;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * MEGA 폴더 공유 링크(https://mega.nz/folder/핸들#키) 읽기 전용 클라이언트.
 * 파일 목록·이름 복호화, 구간(Range) 스트리밍 복호화(AES-CTR), 썸네일을 지원합니다.
 */
public class Mega {

    private static final String API = "https://g.api.mega.co.nz/cs";
    /** 전송량 한도에 걸린 시각과 풀리는 시각 (모르면 0). 정상적으로 받으면 0 으로 돌아감. */
    static volatile long quotaHitAt = 0, quotaUntil = 0;
    private static final AtomicLong seq = new AtomicLong(System.currentTimeMillis() % 1_000_000);

    public static class Node {
        public String handle, parent, name, path = "";
        public boolean folder;
        public long size, ts;
        public byte[] aesKey, nonce;      // 파일: 16바이트 키 + 8바이트 nonce, 폴더: 16바이트 키
        public String thumbHandle;        // 썸네일 파일 속성 핸들 (정사각형 120px, 없으면 null)
        public String previewHandle;      // 미리보기 파일 속성 핸들 (원래 비율, 큰 이미지)
        public long id;                   // 라이브러리에서 쓰는 숫자 id
    }

    public static class Link {
        public final String url, handle;
        public final byte[] key;
        public String name = "MEGA", error;
        public long loadedAt;
        public List<Node> nodes = new ArrayList<>();
        public final Map<String, Node> byHandle = new HashMap<>();
        final Map<String, String[]> dlCache = new HashMap<>();   // handle -> {url, expiresAtMillis}

        Link(String url, String handle, byte[] key) {
            this.url = url;
            this.handle = handle;
            this.key = key;
        }
    }

    // ------------------------------------------------------------------ link parsing
    private static final Pattern NEW_LINK = Pattern.compile("mega\\.(?:nz|co\\.nz)/folder/([A-Za-z0-9_-]{8})#([A-Za-z0-9_-]{22})");
    private static final Pattern OLD_LINK = Pattern.compile("mega\\.(?:nz|co\\.nz)/#F!([A-Za-z0-9_-]{8})!([A-Za-z0-9_-]{22})");

    /** 폴더 링크를 해석합니다. 형식이 틀리면 IllegalArgumentException. */
    public static Link parse(String url) {
        String u = url.trim();
        Matcher m = NEW_LINK.matcher(u);
        if (!m.find()) {
            m = OLD_LINK.matcher(u);
            if (!m.find()) throw new IllegalArgumentException("MEGA 폴더 링크 형식이 아닙니다. https://mega.nz/folder/…#… 형태의 링크를 붙여넣으세요.");
        }
        byte[] key = b64(m.group(2));
        if (key.length != 16) throw new IllegalArgumentException("링크의 키(# 뒤 부분)가 올바르지 않습니다.");
        // 하위 폴더 링크(/folder/xxx#key/folder/yyy)는 루트 폴더 전체로 취급
        return new Link("https://mega.nz/folder/" + m.group(1) + "#" + m.group(2), m.group(1), key);
    }

    // ------------------------------------------------------------------ API
    private static Object api(Link link, JSONObject cmd) throws IOException {
        String url = API + "?id=" + seq.incrementAndGet() + "&n=" + link.handle;
        try {
        for (int attempt = 0; attempt < 4; attempt++) {
            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(20000);
            c.setReadTimeout(60000);
            c.setDoOutput(true);
            c.setRequestMethod("POST");
            c.setRequestProperty("Content-Type", "application/json");
            byte[] body = new JSONArray().put(cmd).toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream o = c.getOutputStream()) {
                o.write(body);
            }
            int code = c.getResponseCode();
            if (code == 402) throw new IOException("MEGA 가 추가 인증을 요구했습니다. 잠시 후 다시 시도하세요.");
            if (code >= 500) {
                sleep(1000L << attempt);
                continue;
            }
            String text;
            try (InputStream in = c.getInputStream()) {
                text = new String(Library.readAll(in), StandardCharsets.UTF_8).trim();
            }
            Object r = text.startsWith("[") ? new JSONArray(text) : Long.parseLong(text);
            if (r instanceof JSONArray) {
                Object first = ((JSONArray) r).opt(0);
                if (first instanceof Number) r = ((Number) first).longValue();
                else return first;
            }
            long err = (Long) r;
            if (err == -3) {   // EAGAIN: 잠시 후 재시도
                sleep(1000L << attempt);
                continue;
            }
            throw new IOException(errorText(err));
        }
        } catch (org.json.JSONException e) {
            throw new IOException("MEGA 응답을 읽지 못했습니다");
        }
        throw new IOException("MEGA 서버가 응답하지 않습니다. 잠시 후 다시 시도하세요.");
    }

    static String errorText(long code) {
        switch ((int) code) {
            case -2: return "MEGA: 잘못된 요청입니다";
            case -9: return "MEGA: 폴더를 찾을 수 없습니다 (링크가 삭제되었거나 틀렸습니다)";
            case -11: return "MEGA: 접근이 거부되었습니다";
            case -16: return "MEGA: 이 폴더는 차단되었습니다";
            case -17: return "MEGA: 전송량 한도를 넘었습니다. 시간이 지나면 다시 재생할 수 있습니다";
            case -18: return "MEGA: 일시적으로 사용할 수 없습니다";
            default: return "MEGA 오류 " + code;
        }
    }

    // ------------------------------------------------------------------ listing
    public static void load(Link link) {
        try {
            JSONObject r = (JSONObject) api(link, new JSONObject().put("a", "f").put("c", 1).put("r", 1).put("ca", 1));
            JSONArray f = r.getJSONArray("f");
            List<Node> nodes = new ArrayList<>();
            Map<String, Node> byHandle = new HashMap<>();
            for (int i = 0; i < f.length(); i++) {
                JSONObject o = f.getJSONObject(i);
                int t = o.optInt("t", -1);
                if (t != 0 && t != 1) continue;
                Node n = new Node();
                n.handle = o.optString("h");
                n.parent = o.optString("p");
                n.folder = t == 1;
                n.size = o.optLong("s", 0);
                n.ts = o.optLong("ts", 0);
                try {
                    if (!decryptNode(link, n, o.optString("k"), o.optString("a"))) continue;
                } catch (Exception e) {
                    continue;
                }
                String fa = o.optString("fa", "");
                for (String part : fa.split("/")) {
                    int star = part.indexOf('*');
                    if (star > 0 && part.substring(0, star).endsWith(":0")) n.thumbHandle = part.substring(star + 1);
                    if (star > 0 && part.substring(0, star).endsWith(":1")) n.previewHandle = part.substring(star + 1);
                }
                n.id = (1L << 52) | handleToLong(n.handle);
                nodes.add(n);
                byHandle.put(n.handle, n);
            }
            // 경로 계산
            for (Node n : nodes) {
                StringBuilder p = new StringBuilder();
                Node cur = byHandle.get(n.parent);
                int guard = 0;
                while (cur != null && guard++ < 64) {
                    p.insert(0, cur.name + "/");
                    cur = byHandle.get(cur.parent);
                }
                n.path = p.toString();
            }
            Node root = byHandle.get(link.handle);
            if (root == null) for (Node n : nodes) if (n.folder && !byHandle.containsKey(n.parent)) { root = n; break; }
            if (root != null) link.name = root.name;
            synchronized (link) {
                link.nodes = nodes;
                link.byHandle.clear();
                link.byHandle.putAll(byHandle);
                link.dlCache.clear();
            }
            link.error = null;
            link.loadedAt = System.currentTimeMillis();
        } catch (Exception e) {
            link.error = e.getMessage() == null ? e.toString() : e.getMessage();
            link.loadedAt = System.currentTimeMillis();
        }
    }

    static boolean decryptNode(Link link, Node n, String k, String a) throws Exception {
        if (k.isEmpty() || a.isEmpty()) return false;
        byte[] enc = null;
        for (String part : k.split("/")) {
            int colon = part.indexOf(':');
            if (colon > 0) { enc = b64(part.substring(colon + 1)); break; }
        }
        if (enc == null || enc.length % 16 != 0) return false;
        byte[] dec = aes("AES/ECB/NoPadding", link.key, null, Cipher.DECRYPT_MODE, enc);
        if (n.folder) {
            if (dec.length < 16) return false;
            n.aesKey = slice(dec, 0, 16);
        } else {
            if (dec.length < 32) return false;
            byte[] key = new byte[16];
            for (int i = 0; i < 16; i++) key[i] = (byte) (dec[i] ^ dec[i + 16]);
            n.aesKey = key;
            n.nonce = slice(dec, 16, 8);
        }
        byte[] attr = aes("AES/CBC/NoPadding", n.aesKey, new byte[16], Cipher.DECRYPT_MODE, b64(a));
        String s = new String(attr, StandardCharsets.UTF_8);
        if (!s.startsWith("MEGA{")) return false;
        int end = s.lastIndexOf('}');
        JSONObject at = new JSONObject(s.substring(4, end + 1));
        n.name = at.optString("n", n.handle).replace("/", "_");
        return true;
    }

    // ------------------------------------------------------------------ download
    private static String downloadUrl(Link link, Node n) throws IOException {
        synchronized (link) {
            String[] c = link.dlCache.get(n.handle);
            if (c != null && Long.parseLong(c[1]) > System.currentTimeMillis()) return c[0];
        }
        try {
            JSONObject r = (JSONObject) api(link, new JSONObject().put("a", "g").put("g", 1).put("ssl", 2).put("n", n.handle));
            String g = r.optString("g", "");
            if (g.isEmpty()) {
                if (r.has("e")) throw new IOException(errorText(r.optLong("e")));
                throw new IOException("MEGA 다운로드 주소를 받지 못했습니다");
            }
            synchronized (link) {
                link.dlCache.put(n.handle, new String[]{g, String.valueOf(System.currentTimeMillis() + 10 * 60_000)});
            }
            return g;
        } catch (org.json.JSONException e) {
            throw new IOException(e.getMessage());
        }
    }

    /** start..end(포함) 구간을 복호화해서 읽는 스트림. */
    public static InputStream open(Link link, Node n, long start, long end) throws IOException {
        long aligned = start - (start % 16);
        String url = downloadUrl(link, n) + "/" + aligned + "-" + end;
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(20000);
        c.setReadTimeout(60000);
        int code = c.getResponseCode();
        if (code == 509) {
            // 한도가 풀릴 때까지 남은 시간(초)을 알려 주는 경우가 있음
            long left = 0;
            try { left = Long.parseLong(c.getHeaderField("X-MEGA-Time-Left").trim()); } catch (Exception ignored) {}
            quotaHitAt = System.currentTimeMillis();
            quotaUntil = left > 0 ? quotaHitAt + left * 1000 : 0;
            throw new IOException(errorText(-17));
        }
        quotaHitAt = 0;
        quotaUntil = 0;
        if (code >= 400) {
            synchronized (link) { link.dlCache.remove(n.handle); }
            throw new IOException("MEGA 다운로드 실패 (HTTP " + code + ")");
        }
        return decrypting(c.getInputStream(), n, aligned, start);
    }

    /** aligned 위치부터 시작하는 암호문 스트림을 복호화하고, start 위치부터 읽히게 합니다. */
    static InputStream decrypting(InputStream raw, Node n, long aligned, long start) throws IOException {
        byte[] iv = new byte[16];
        System.arraycopy(n.nonce, 0, iv, 0, 8);
        ByteBuffer.wrap(iv, 8, 8).order(ByteOrder.BIG_ENDIAN).putLong(aligned / 16);
        final Cipher cipher;
        try {
            cipher = Cipher.getInstance("AES/CTR/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(n.aesKey, "AES"), new IvParameterSpec(iv));
        } catch (Exception e) {
            throw new IOException(e);
        }
        InputStream dec = new FilterInputStream(raw) {
            @Override
            public int read() throws IOException {
                byte[] b = new byte[1];
                int k;
                while ((k = read(b, 0, 1)) == 0) { }
                return k < 0 ? -1 : b[0] & 0xff;
            }

            @Override
            public int read(byte[] b, int off, int len) throws IOException {
                int k = super.read(b, off, len);
                if (k <= 0) return k;
                byte[] out = cipher.update(b, off, k);
                if (out != null) System.arraycopy(out, 0, b, off, out.length);
                return out == null ? 0 : out.length;
            }

            @Override
            public long skip(long n) throws IOException {   // 카운터가 어긋나지 않게 읽어서 버림
                byte[] buf = new byte[(int) Math.min(n, 8192)];
                long left = n;
                while (left > 0) {
                    int k = read(buf, 0, (int) Math.min(buf.length, left));
                    if (k < 0) break;
                    left -= k;
                }
                return n - left;
            }
        };
        int skip = (int) (start - aligned);
        byte[] junk = new byte[16];
        while (skip > 0) {
            int k = dec.read(junk, 0, skip);
            if (k < 0) break;
            skip -= k;
        }
        return dec;
    }

    // ------------------------------------------------------------------ thumbnails
    public static byte[] thumbnail(Link link, Node n) throws IOException {
        return fileAttr(link, n, n.thumbHandle);
    }

    /** 원래 비율을 유지한 미리보기를 먼저, 없으면 정사각형 썸네일. */
    public static byte[] preview(Link link, Node n) throws IOException {
        byte[] b = null;
        if (n.previewHandle != null) {
            try { b = fileAttr(link, n, n.previewHandle); } catch (IOException ignored) {}
        }
        return b != null ? b : fileAttr(link, n, n.thumbHandle);
    }

    static byte[] fileAttr(Link link, Node n, String handle) throws IOException {
        if (handle == null) return null;
        try {
            JSONObject r = (JSONObject) api(link, new JSONObject().put("a", "ufa").put("fah", handle).put("ssl", 2).put("r", 1));
            String p = r.optString("p", "");
            if (p.isEmpty()) return null;
            HttpURLConnection c = (HttpURLConnection) new URL(p).openConnection();
            c.setConnectTimeout(20000);
            c.setReadTimeout(30000);
            c.setDoOutput(true);
            c.setRequestMethod("POST");
            try (OutputStream o = c.getOutputStream()) {
                o.write(b64(handle));
            }
            byte[] resp;
            try (InputStream in = c.getInputStream()) {
                resp = Library.readAll(in);
            }
            if (resp.length < 12) return null;
            int len = ByteBuffer.wrap(resp, 8, 4).order(ByteOrder.LITTLE_ENDIAN).getInt();
            if (len <= 0 || 12 + len > resp.length) return null;
            byte[] enc = slice(resp, 12, len - (len % 16));
            return aes("AES/CBC/NoPadding", n.aesKey, new byte[16], Cipher.DECRYPT_MODE, enc);
        } catch (org.json.JSONException e) {
            return null;
        } catch (IOException e) {
            throw e;
        } catch (Exception e) {
            return null;
        }
    }

    // ------------------------------------------------------------------ utils
    static byte[] b64(String s) {
        return Base64.decode(s.replace('+', '-').replace('/', '_'), Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP);
    }

    static long handleToLong(String h) {
        byte[] b = b64(h);
        long v = 0;
        for (int i = 0; i < Math.min(6, b.length); i++) v = (v << 8) | (b[i] & 0xff);
        return v;
    }

    private static byte[] aes(String mode, byte[] key, byte[] iv, int op, byte[] data) throws Exception {
        Cipher c = Cipher.getInstance(mode);
        if (iv == null) c.init(op, new SecretKeySpec(key, "AES"));
        else c.init(op, new SecretKeySpec(key, "AES"), new IvParameterSpec(iv));
        return c.doFinal(data);
    }

    private static byte[] slice(byte[] b, int off, int len) {
        byte[] o = new byte[len];
        System.arraycopy(b, off, o, 0, len);
        return o;
    }

    private static void sleep(long ms) {
        try { Thread.sleep(ms); } catch (InterruptedException ignored) {}
    }
}
