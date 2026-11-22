package app.mangaviewer;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** 의존성 없는 작은 HTTP/1.1 서버. 요청마다 연결을 닫습니다 (Connection: close). */
public class HttpServer {

    public interface Handler {
        void handle(Request req, Response res) throws Exception;
    }

    public static class Request {
        public String method;
        public String path;                       // 디코딩된 경로
        public final Map<String, List<String>> query = new LinkedHashMap<>();
        public final Map<String, String> headers = new LinkedHashMap<>();
        public byte[] body = new byte[0];
        public String remote;

        public String param(String k) {
            List<String> v = query.get(k);
            return v == null || v.isEmpty() ? null : v.get(v.size() - 1);
        }

        public List<String> params(String k) {
            List<String> v = query.get(k);
            return v == null ? new ArrayList<>() : v;
        }

        public String header(String k) {
            return headers.get(k.toLowerCase(Locale.ROOT));
        }

        public String bodyText() {
            return new String(body, StandardCharsets.UTF_8);
        }
    }

    public static class Response {
        final OutputStream out;
        boolean headersSent = false;
        int status = 200;
        final Map<String, String> headers = new LinkedHashMap<>();

        Response(OutputStream out) { this.out = out; }

        public Response header(String k, String v) { headers.put(k, v); return this; }

        public OutputStream start(int status, long length) throws IOException {
            this.status = status;
            StringBuilder sb = new StringBuilder();
            sb.append("HTTP/1.1 ").append(status).append(' ').append(reason(status)).append("\r\n");
            if (length >= 0) headers.put("Content-Length", String.valueOf(length));
            headers.put("Connection", "close");
            for (Map.Entry<String, String> e : headers.entrySet())
                sb.append(e.getKey()).append(": ").append(e.getValue()).append("\r\n");
            sb.append("\r\n");
            out.write(sb.toString().getBytes(StandardCharsets.UTF_8));
            headersSent = true;
            return out;
        }

        public void send(int status, String type, byte[] body) throws IOException {
            header("Content-Type", type);
            start(status, body.length).write(body);
        }

        public void json(int status, String json) throws IOException {
            header("Cache-Control", "no-store");
            send(status, "application/json; charset=utf-8", json.getBytes(StandardCharsets.UTF_8));
        }

        public void error(int status, String msg) throws IOException {
            json(status, "{\"error\":" + org.json.JSONObject.quote(msg) + "}");
        }
    }

    private final Handler handler;
    private ServerSocket socket;
    private ExecutorService pool;
    private volatile boolean running;

    public HttpServer(Handler handler) { this.handler = handler; }

    public synchronized void start(String host, int port) throws IOException {
        stop();
        socket = new ServerSocket();
        socket.setReuseAddress(true);
        socket.bind(new InetSocketAddress(InetAddress.getByName(host), port));
        pool = Executors.newFixedThreadPool(16);
        running = true;
        Thread t = new Thread(this::acceptLoop, "http-accept");
        t.setDaemon(true);
        t.start();
    }

    public synchronized void stop() {
        running = false;
        try { if (socket != null) socket.close(); } catch (IOException ignored) {}
        if (pool != null) pool.shutdownNow();
        socket = null;
        pool = null;
    }

    public boolean isRunning() { return running && socket != null && !socket.isClosed(); }

    private void acceptLoop() {
        ServerSocket s = socket;
        while (running && s != null && !s.isClosed()) {
            try {
                Socket c = s.accept();
                c.setSoTimeout(30000);
                pool.execute(() -> serve(c));
            } catch (Exception e) {
                if (!running) break;
            }
        }
    }

    private void serve(Socket c) {
        try (Socket sock = c) {
            InputStream in = new BufferedInputStream(sock.getInputStream());
            OutputStream out = sock.getOutputStream();
            Request req = parse(in);
            if (req == null) return;
            req.remote = sock.getInetAddress().getHostAddress();
            Response res = new Response(out);
            try {
                handler.handle(req, res);
            } catch (SocketException e) {
                // 브라우저가 연결을 끊음 — 정상
            } catch (Exception e) {
                if (!res.headersSent) res.error(500, String.valueOf(e.getMessage()));
            }
            out.flush();
        } catch (Exception ignored) {
        }
    }

    private static String readLine(InputStream in) throws IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        int ch;
        while ((ch = in.read()) != -1) {
            if (ch == '\n') break;
            if (ch != '\r') b.write(ch);
            if (b.size() > 16384) throw new IOException("line too long");
        }
        if (ch == -1 && b.size() == 0) return null;
        return b.toString("UTF-8");
    }

    private static Request parse(InputStream in) throws IOException {
        String line = readLine(in);
        if (line == null || line.isEmpty()) return null;
        String[] parts = line.split(" ");
        if (parts.length < 2) return null;
        Request r = new Request();
        r.method = parts[0].toUpperCase(Locale.ROOT);
        String target = parts[1];
        int q = target.indexOf('?');
        String rawPath = q >= 0 ? target.substring(0, q) : target;
        r.path = decode(rawPath);
        if (q >= 0) {
            for (String kv : target.substring(q + 1).split("&")) {
                if (kv.isEmpty()) continue;
                int eq = kv.indexOf('=');
                String k = decodeQuery(eq >= 0 ? kv.substring(0, eq) : kv);
                String v = eq >= 0 ? decodeQuery(kv.substring(eq + 1)) : "";
                r.query.computeIfAbsent(k, x -> new ArrayList<>()).add(v);
            }
        }
        String h;
        while ((h = readLine(in)) != null && !h.isEmpty()) {
            int i = h.indexOf(':');
            if (i > 0) r.headers.put(h.substring(0, i).trim().toLowerCase(Locale.ROOT), h.substring(i + 1).trim());
        }
        String cl = r.headers.get("content-length");
        if (cl != null) {
            int n = Integer.parseInt(cl.trim());
            if (n > 10 * 1024 * 1024) throw new IOException("body too large");
            byte[] body = new byte[n];
            int off = 0;
            while (off < n) {
                int k = in.read(body, off, n - off);
                if (k < 0) break;
                off += k;
            }
            r.body = body;
        }
        return r;
    }

    private static String decode(String s) {
        try {
            return URLDecoder.decode(s.replace("+", "%2B"), "UTF-8");
        } catch (Exception e) {
            return s;
        }
    }

    private static String decodeQuery(String s) {   // 쿼리에서는 + 가 공백
        try {
            return URLDecoder.decode(s, "UTF-8");
        } catch (Exception e) {
            return s;
        }
    }

    static String reason(int s) {
        switch (s) {
            case 200: return "OK";
            case 206: return "Partial Content";
            case 304: return "Not Modified";
            case 400: return "Bad Request";
            case 401: return "Unauthorized";
            case 403: return "Forbidden";
            case 404: return "Not Found";
            case 416: return "Range Not Satisfiable";
            default: return s >= 500 ? "Internal Server Error" : "OK";
        }
    }
}
