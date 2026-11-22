package app.vidshelf;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ContentValues;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;

/** 앱 화면: 앱 안의 웹 화면(WebView)으로 VidShelf 를 보여 줍니다. 브라우저는 쓰지 않습니다. */
public class MainActivity extends Activity {

    private static final int BG = 0xFF0F1115, TEXT = 0xFFE9E7E3, MUTED = 0xFF9B978F, ACCENT = 0xFFE8A33D;

    private FrameLayout root;
    private WebView web;
    private View customView;
    private WebChromeClient.CustomViewCallback customCallback;
    private int loadedPort = -1;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final Runnable watcher = this::watchServer;
    private static final int REQ_FILE = 7;
    private android.webkit.ValueCallback<Uri[]> fileCallback;

    @Override
    protected void onActivityResult(int req, int result, android.content.Intent data) {
        super.onActivityResult(req, result, data);
        if (req != REQ_FILE || fileCallback == null) return;
        Uri u = result == RESULT_OK && data != null ? data.getData() : null;
        fileCallback.onReceiveValue(u == null ? null : new Uri[]{u});
        fileCallback = null;
    }

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(BG);
        root = new FrameLayout(this);
        root.setBackgroundColor(BG);
        setContentView(root);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (!hasVideoPermission()) {
            showPermissionScreen();
            return;
        }
        if (!ServerService.running) ServerService.start(this);
        // 업데이트로 생긴 사진 권한은 한 번만 따로 요청
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.READ_MEDIA_IMAGES) != PackageManager.PERMISSION_GRANTED
                && !getPreferences(MODE_PRIVATE).getBoolean("asked_images", false)) {
            getPreferences(MODE_PRIVATE).edit().putBoolean("asked_images", true).apply();
            requestPermissions(new String[]{Manifest.permission.READ_MEDIA_IMAGES}, 2);
        }
        if (web == null) showLoading("불러오는 중…");
        else web.onResume();
        ui.removeCallbacks(watcher);
        ui.post(watcher);
    }

    @Override
    protected void onPause() {
        super.onPause();
        ui.removeCallbacks(watcher);
        if (web != null) web.onPause();
    }

    /** 서버가 뜨거나 포트가 바뀌면 웹 화면을 (다시) 불러옵니다. */
    private void watchServer() {
        if (ServerService.running) {
            int port = ServerService.port;
            if (web == null) createWebView();
            if (port != loadedPort) {
                String hash = "";
                if (web.getUrl() != null) {
                    int i = web.getUrl().indexOf('#');
                    if (i >= 0) hash = web.getUrl().substring(i);
                }
                setAppCookie(port);
                loadedPort = port;
                web.loadUrl("http://127.0.0.1:" + port + "/" + hash);
            }
        } else if (ServerService.lastError != null && web == null) {
            showError(ServerService.lastError);
        }
        ui.postDelayed(watcher, ServerService.running ? 2000 : 300);
    }

    private void setAppCookie(int port) {
        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setCookie("http://127.0.0.1:" + port, "vs_app=" + Library.get(this).appToken() + "; path=/");
        cm.flush();
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void createWebView() {
        web = new WebView(this);
        web.setBackgroundColor(BG);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);   // 영상을 누르면 바로 재생, 숏폼 자동 재생
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportMultipleWindows(false);   // target=_blank 링크도 앱 안에서 열기
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if ("vidshelf".equals(u.getScheme()) && "eh-login".equals(u.getHost())) { openEhLogin(); return true; }
                // 앱 서버 주소만 앱 안에서 열고, 그 밖의 주소는 열지 않음
                return !("127.0.0.1".equals(u.getHost()) || "localhost".equals(u.getHost()));
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {   // 영상 전체 화면
                if (customView != null) { callback.onCustomViewHidden(); return; }
                customView = view;
                customCallback = callback;
                root.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                web.setVisibility(View.GONE);
                setFullscreenBars(true);
                setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR);
            }

            @Override
            public void onHideCustomView() {
                exitFullscreen();
            }

            @Override
            public boolean onShowFileChooser(WebView view, android.webkit.ValueCallback<Uri[]> callback, FileChooserParams params) {
                // 백업 파일 고르기 (<input type=file>)
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try {
                    android.content.Intent i = new android.content.Intent(android.content.Intent.ACTION_GET_CONTENT);
                    i.addCategory(android.content.Intent.CATEGORY_OPENABLE);
                    i.setType("*/*");
                    startActivityForResult(i, REQ_FILE);
                } catch (Exception e) {
                    fileCallback = null;
                    callback.onReceiveValue(null);
                    Toast.makeText(MainActivity.this, "파일 선택 화면을 열 수 없습니다", Toast.LENGTH_LONG).show();
                }
                return true;
            }
        });
        web.setDownloadListener((url, userAgent, contentDisposition, mimetype, length) ->
                download(url, URLUtil.guessFileName(url, contentDisposition, mimetype), mimetype));
        root.removeAllViews();
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private void exitFullscreen() {
        if (customView == null) return;
        root.removeView(customView);
        customView = null;
        if (customCallback != null) customCallback.onCustomViewHidden();
        customCallback = null;
        web.setVisibility(View.VISIBLE);
        setFullscreenBars(false);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
    }

    private void setFullscreenBars(boolean on) {
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c == null) return;
            if (on) {
                c.hide(WindowInsets.Type.systemBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            } else {
                c.show(WindowInsets.Type.systemBars());
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(on
                    ? View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    : View.SYSTEM_UI_FLAG_VISIBLE);
        }
    }

    @Override
    public void onBackPressed() {
        if (ehBox != null) {
            if (ehWeb.canGoBack()) ehWeb.goBack(); else closeEhLogin();
            return;
        }
        if (customView != null) { exitFullscreen(); return; }
        if (web != null && web.canGoBack()) { web.goBack(); return; }
        moveTaskToBack(true);   // 앱만 내리고 서버는 계속 (다른 기기 접속용)
    }

    /** 파일 받기: 앱 서버에서 받아 휴대폰의 Download 폴더에 저장합니다. */
    private void download(String url, String name, String mime) {
        Toast.makeText(this, "받는 중: " + name, Toast.LENGTH_SHORT).show();
        new Thread(() -> {
            String msg;
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                c.setRequestProperty("Cookie", "vs_app=" + Library.get(this).appToken());
                ContentValues cv = new ContentValues();
                cv.put(MediaStore.Downloads.DISPLAY_NAME, name);
                cv.put(MediaStore.Downloads.MIME_TYPE, mime == null || mime.isEmpty() ? "application/octet-stream" : mime);
                cv.put(MediaStore.Downloads.IS_PENDING, 1);
                Uri dest = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                if (dest == null) throw new Exception("저장 위치를 만들 수 없습니다");
                try (InputStream in = c.getInputStream(); OutputStream out = getContentResolver().openOutputStream(dest)) {
                    byte[] buf = new byte[128 * 1024];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                } catch (Exception e) {
                    getContentResolver().delete(dest, null, null);
                    throw e;
                }
                cv.clear();
                cv.put(MediaStore.Downloads.IS_PENDING, 0);
                getContentResolver().update(dest, cv, null, null);
                msg = "Download 폴더에 저장했습니다: " + name;
            } catch (Exception e) {
                msg = "받기 실패: " + e.getMessage();
            }
            String m = msg;
            ui.post(() -> Toast.makeText(this, m, Toast.LENGTH_LONG).show());
        }).start();
    }

    // ------------------------------------------------------------------ e-hentai 로그인 (앱 안 브라우저)
    private LinearLayout ehBox;
    private WebView ehWeb;

    /** e-hentai 로그인 페이지를 앱 안에서 열고, 로그인되면 쿠키를 읽어 저장합니다. 캡차도 이 화면에서 풀 수 있음. */
    @SuppressLint("SetJavaScriptEnabled")
    private void openEhLogin() {
        if (ehBox != null) return;
        if (checkEhCookies()) return;   // 이미 로그인되어 있음
        ehBox = new LinearLayout(this);
        ehBox.setOrientation(LinearLayout.VERTICAL);
        ehBox.setBackgroundColor(BG);
        LinearLayout bar = new LinearLayout(this);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(16), dp(8), dp(8), dp(8));
        TextView title = text("e-hentai 로그인 — 로그인하면 자동으로 돌아갑니다", 14, TEXT, false);
        bar.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        Button close = button("닫기", v -> closeEhLogin());
        ((LinearLayout.LayoutParams) close.getLayoutParams()).topMargin = 0;
        bar.addView(close);
        ehBox.addView(bar);
        ehWeb = new WebView(this);
        WebSettings s = ehWeb.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(ehWeb, true);   // 로봇 확인(캡차)용
        ehWeb.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                checkEhCookies();
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, android.webkit.WebResourceError err) {
                if (!req.isForMainFrame()) return;
                // 국내 차단으로 연결이 끊기면 안내 화면을 보여 줌
                String html = "<html><body style='background:#0f1115;color:#e9e7e3;font:16px sans-serif;padding:24px;line-height:1.6'>"
                        + "<h2>e-hentai 에 접속하지 못했습니다</h2>"
                        + "<p>국내에서는 e-hentai 가 차단되어 있어 연결이 끊깁니다 (" + android.text.Html.escapeHtml(String.valueOf(err.getDescription())) + ").</p>"
                        + "<p><b>보안 폴더 안에</b> VPN 앱(예: 1.1.1.1)을 설치해 켠 뒤 다시 시도하세요. 일반 공간에서 켠 VPN 은 보안 폴더 앱에 적용되지 않습니다.</p>"
                        + "<p><a style='color:#e8a33d' href='https://forums.e-hentai.org/index.php?act=Login&amp;CODE=00'>다시 시도</a></p></body></html>";
                view.loadDataWithBaseURL("https://forums.e-hentai.org/", html, "text/html", "utf-8", null);
            }
        });
        ehBox.addView(ehWeb, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        root.addView(ehBox, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        ehWeb.loadUrl("https://forums.e-hentai.org/index.php?act=Login&CODE=00");
    }

    /** 로그인 쿠키가 있으면 저장하고 만화 탭으로 돌아갑니다. */
    private boolean checkEhCookies() {
        String c = CookieManager.getInstance().getCookie("https://forums.e-hentai.org");
        String id = "", hash = "";
        if (c != null) for (String part : c.split(";")) {
            String kv = part.trim();
            if (kv.startsWith("ipb_member_id=")) id = kv.substring(14);
            if (kv.startsWith("ipb_pass_hash=")) hash = kv.substring(14);
        }
        if (!id.matches("\\d+") || id.equals("0") || !hash.matches("[0-9a-fA-F]{32}")) return false;
        Library.get(this).ehSetLogin(id, hash);
        closeEhLogin();
        Toast.makeText(this, "e-hentai 에 로그인했습니다", Toast.LENGTH_SHORT).show();
        if (web != null) web.evaluateJavascript("location.hash = '#/comics'; route();", null);
        return true;
    }

    private void closeEhLogin() {
        if (ehBox == null) return;
        root.removeView(ehBox);
        ehWeb.destroy();
        ehWeb = null;
        ehBox = null;
        CookieManager.getInstance().flush();
    }

    // ------------------------------------------------------------------ native screens
    private boolean hasVideoPermission() {
        String perm = Build.VERSION.SDK_INT >= 33 ? Manifest.permission.READ_MEDIA_VIDEO : Manifest.permission.READ_EXTERNAL_STORAGE;
        return checkSelfPermission(perm) == PackageManager.PERMISSION_GRANTED;
    }

    private void askPermissions() {
        List<String> perms = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= 33) {
            perms.add(Manifest.permission.READ_MEDIA_VIDEO);
            perms.add(Manifest.permission.READ_MEDIA_IMAGES);
            perms.add(Manifest.permission.POST_NOTIFICATIONS);
        } else {
            perms.add(Manifest.permission.READ_EXTERNAL_STORAGE);
        }
        requestPermissions(perms.toArray(new String[0]), 1);
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        new Thread(() -> Library.get(this).scan()).start();   // 새 권한으로 목록 다시 만들기
        if (!hasVideoPermission())
            Toast.makeText(this, "영상 접근 권한이 있어야 목록을 만들 수 있습니다", Toast.LENGTH_LONG).show();
        // onResume 이 이어서 호출되며 서버를 시작합니다
    }

    private void showPermissionScreen() {
        LinearLayout box = column();
        box.addView(text("VidShelf", 26, TEXT, true));
        boolean secure = ServerService.userId() != 0;
        box.addView(text(secure ? "🔒 보안 폴더에서 실행 중 — 보안 폴더의 영상만 보입니다." : "⚠ 일반 공간에서 실행 중 — 일반 공간의 영상이 보입니다.", 15, secure ? ACCENT : 0xFFEF6A62, false));
        box.addView(text("영상과 사진 목록을 만들려면 접근 권한이 필요합니다. 권한 창에서 ‘모두 허용’을 고르세요.", 15, MUTED, false));
        box.addView(button("영상 접근 허용", v -> askPermissions()));
        show(box);
    }

    private void showLoading(String msg) {
        LinearLayout box = column();
        box.addView(text(msg, 16, MUTED, false));
        show(box);
    }

    private void showError(String err) {
        LinearLayout box = column();
        box.addView(text("서버를 시작하지 못했습니다", 18, TEXT, true));
        box.addView(text(err, 14, 0xFFEF6A62, false));
        box.addView(button("다시 시도", v -> {
            ServerService.lastError = null;
            ServerService.start(this);
            showLoading("불러오는 중…");
        }));
        show(box);
    }

    private void show(View v) {
        if (web != null) return;
        root.removeAllViews();
        root.addView(v, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private int dp(int v) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics());
    }

    private LinearLayout column() {
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.VERTICAL);
        l.setGravity(Gravity.CENTER_VERTICAL);
        int p = dp(24);
        l.setPadding(p, p, p, p);
        return l;
    }

    private TextView text(String s, int sp, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(sp);
        t.setTextColor(color);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setPadding(0, dp(4), 0, dp(4));
        return t;
    }

    private Button button(String s, View.OnClickListener onClick) {
        Button b = new Button(this);
        b.setText(s);
        b.setAllCaps(false);
        b.setTextColor(0xFF1D1304);
        GradientDrawable g = new GradientDrawable();
        g.setColor(ACCENT);
        g.setCornerRadius(dp(10));
        b.setBackground(g);
        b.setOnClickListener(onClick);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(16);
        b.setLayoutParams(lp);
        b.setPadding(dp(20), 0, dp(20), 0);
        return b;
    }
}
