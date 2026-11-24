package app.velvet;

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

/** 앱 화면: 앱 안의 웹 화면(WebView)으로 Velvet 을 보여 줍니다. 브라우저는 쓰지 않습니다. */
public class MainActivity extends Activity {

    private static final int BG = 0xFF130C11;

    private FrameLayout root;
    private WebView web;
    private View customView;
    private WebChromeClient.CustomViewCallback customCallback;
    private int loadedPort = -1;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final Runnable watcher = this::watchServer;
    private static final int REQ_FILE = 7, REQ_FAV = 8, REQ_PLAYER = 9;
    private static volatile MainActivity current;

    /** 기기 갤러리 즐겨찾기 바꾸기. ‘미디어 관리’ 권한이 있으면 바로, 없으면 안드로이드가 한 번 묻습니다. */
    /** 파일 삭제: trash 면 휴지통으로(약 30일 뒤 자동 삭제), 아니면 영구 삭제. 안드로이드가 확인 창을 띄움. */
    static boolean requestDelete(java.util.List<Uri> uris, boolean trash) {
        MainActivity a = current;
        if (a == null || Build.VERSION.SDK_INT < 30 || uris.isEmpty()) return false;
        a.ui.post(() -> {
            try {
                android.app.PendingIntent pi = trash
                        ? MediaStore.createTrashRequest(a.getContentResolver(), uris, true)
                        : MediaStore.createDeleteRequest(a.getContentResolver(), uris);
                a.startIntentSenderForResult(pi.getIntentSender(), REQ_FAV, null, 0, 0, 0);
            } catch (Exception ignored) {
            }
        });
        return true;
    }

    static void requestFavorite(java.util.List<Uri> uris, boolean fav) {
        MainActivity a = current;
        if (a == null || Build.VERSION.SDK_INT < 30 || uris.isEmpty()) return;
        a.ui.post(() -> {
            try {
                android.app.PendingIntent pi = MediaStore.createFavoriteRequest(a.getContentResolver(), uris, fav);
                a.startIntentSenderForResult(pi.getIntentSender(), REQ_FAV, null, 0, 0, 0);
            } catch (Exception ignored) {
            }
        });
    }
    private android.webkit.ValueCallback<Uri[]> fileCallback;

    @Override
    protected void onActivityResult(int req, int result, android.content.Intent data) {
        super.onActivityResult(req, result, data);
        if (req == REQ_FAV) {   // 갤러리 쪽 결과를 다시 읽어 앱과 맞춤 (취소했으면 원래대로)
            new Thread(() -> Library.get(this).scan()).start();
            return;
        }
        if (req == REQ_PLAYER) {   // 내장 플레이어를 닫으면 본 위치를 웹 화면에 알려 줌
            if (data != null && web != null) {
                long id = data.getLongExtra("id", 0);
                double pos = data.getLongExtra("pos", 0) / 1000.0;
                web.evaluateJavascript("window.onNativePlayerClosed && window.onNativePlayerClosed('" + id + "'," + pos + ")", null);
            }
            return;
        }
        if (req != REQ_FILE || fileCallback == null) return;
        Uri u = result == RESULT_OK && data != null ? data.getData() : null;
        fileCallback.onReceiveValue(u == null ? null : new Uri[]{u});
        fileCallback = null;
    }

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        root = new FrameLayout(this);
        root.setBackgroundColor(systemDark() ? DARK_BG : LIGHT_BG);
        setContentView(root);
        // 안드로이드 15부터는 화면이 상태 표시줄·내비게이션 막대 아래까지 그려짐 → 그만큼 직접 비워 둠 (키보드가 올라오면 키보드 높이도)
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            root.setOnApplyWindowInsetsListener((v, ins) -> {
                if (customView != null) { v.setPadding(0, 0, 0, 0); return WindowInsets.CONSUMED; }   // 영상 전체 화면은 끝까지
                android.graphics.Insets bars = ins.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                android.graphics.Insets ime = ins.getInsets(WindowInsets.Type.ime());
                v.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
                return WindowInsets.CONSUMED;
            });
        }
        applyBars(systemDark());
    }

    @Override
    protected void onResume() {
        super.onResume();
        current = this;
        new Thread(() -> Library.get(this).scan()).start();   // 갤러리에서 바꾼 즐겨찾기 반영
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
        if (web == null) showSplash();
        else web.onResume();
        ui.removeCallbacks(watcher);
        ui.post(watcher);
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (current == this) current = null;
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
                // 처음 화면에서 ‘폴더를 골라서’를 골랐으면 폴더 고르기 화면부터
                if (web.getUrl() == null && getPreferences(MODE_PRIVATE).getBoolean("setup_pick", false)) {
                    getPreferences(MODE_PRIVATE).edit().remove("setup_pick").apply();
                    hash = "#/setup";
                }
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
        web.addJavascriptInterface(new ThemeBridge(), "VidShelfApp");   // 테마: 시스템 다크 모드 알림, 상태 표시줄 색
        if (!systemDark()) web.setBackgroundColor(LIGHT_BG);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {   // 화면이 그려지면 아이콘 화면을 부드럽게 걷어 냄
                ui.postDelayed(MainActivity.this::hideSplash, 250);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if ("velvet".equals(u.getScheme()) && "eh-login".equals(u.getHost())) { openEhLogin(); return true; }
                if ("velvet".equals(u.getScheme()) && "manage-media".equals(u.getHost()) && Build.VERSION.SDK_INT >= 31) {
                    // ‘미디어 관리’ 권한 화면 (켜 두면 즐겨찾기를 바꿀 때마다 묻지 않음)
                    try { startActivity(new android.content.Intent(android.provider.Settings.ACTION_REQUEST_MANAGE_MEDIA, Uri.parse("package:" + getPackageName()))); } catch (Exception ignored) {}
                    return true;
                }
                // 앱 서버 주소만 앱 안에서 열고, 바깥 https 주소(개인정보처리방침 등)는 휴대폰 브라우저로
                if ("127.0.0.1".equals(u.getHost()) || "localhost".equals(u.getHost())) return false;
                if ("https".equals(u.getScheme())) {
                    try { startActivity(new android.content.Intent(android.content.Intent.ACTION_VIEW, u)); } catch (Exception ignored) {}
                }
                return true;
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
                root.requestApplyInsets();
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
        View splash = root.getChildCount() > 0 && "splash".equals(root.getChildAt(0).getTag()) ? root.getChildAt(0) : null;
        root.removeAllViews();
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        if (splash != null) root.addView(splash);   // 웹 화면이 다 불러와질 때까지 아이콘을 위에 둠
    }

    private void exitFullscreen() {
        if (customView == null) return;
        root.removeView(customView);
        customView = null;
        if (customCallback != null) customCallback.onCustomViewHidden();
        customCallback = null;
        web.setVisibility(View.VISIBLE);
        setFullscreenBars(false);
        root.requestApplyInsets();
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
        if (customView != null) { exitFullscreen(); return; }
        if (ehBox != null) {
            if (ehWeb.canGoBack()) ehWeb.goBack(); else closeEhLogin();
            return;
        }
        if (web != null && web.canGoBack()) { web.goBack(); return; }
        moveTaskToBack(true);   // 첫 화면에서 뒤로 가기: 앱을 닫지 않고 내려 두기 (다시 열 때 빠르게)
    }

    // ------------------------------------------------------------------ e-hentai 로그인 (앱 안 브라우저)
    private LinearLayout ehBox;
    private WebView ehWeb;

    /** e-hentai 로그인 페이지를 앱 안에서 열고, 로그인되면 쿠키를 읽어 저장합니다. 로봇 확인(캡차)도 이 화면에서 풀 수 있음. */
    @SuppressLint("SetJavaScriptEnabled")
    private void openEhLogin() {
        if (ehBox != null) return;
        if (checkEhCookies()) return;   // 이미 로그인되어 있음
        boolean dark = systemDark();
        int[] c = palette();
        ehBox = new LinearLayout(this);
        ehBox.setOrientation(LinearLayout.VERTICAL);
        ehBox.setBackgroundColor(c[0]);
        LinearLayout bar = new LinearLayout(this);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(16), dp(8), dp(8), dp(8));
        bar.addView(text("e-hentai 로그인 — 로그인하면 자동으로 돌아갑니다", 14, c[2], false),
                new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
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
                String bg = dark ? "#130C11" : "#F6EFEC", fg = dark ? "#F4E9EC" : "#231119", ac = dark ? "#F07A9A" : "#B4234F";
                String html = "<html><head><meta name='viewport' content='width=device-width,initial-scale=1'></head>"
                        + "<body style='background:" + bg + ";color:" + fg + ";font:16px sans-serif;padding:24px;line-height:1.6'>"
                        + "<h2>e-hentai 에 접속하지 못했습니다</h2>"
                        + "<p>국내에서는 e-hentai 가 차단되어 있어 연결이 끊깁니다 (" + android.text.Html.escapeHtml(String.valueOf(err.getDescription())) + ").</p>"
                        + "<p><b>보안 폴더 안에</b> VPN 앱(예: 1.1.1.1)을 설치해 켠 뒤 다시 시도하세요. 일반 공간에서 켠 VPN 은 보안 폴더 앱에 적용되지 않습니다.</p>"
                        + "<p><a style='color:" + ac + "' href='https://forums.e-hentai.org/index.php?act=Login&amp;CODE=00'>다시 시도</a></p></body></html>";
                view.loadDataWithBaseURL("https://forums.e-hentai.org/", html, "text/html", "utf-8", null);
            }
        });
        ehBox.addView(ehWeb, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        root.addView(ehBox, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        ehWeb.loadUrl("https://forums.e-hentai.org/index.php?act=Login&CODE=00");
    }

    /** 로그인 쿠키가 있으면 저장하고 만화 즐겨찾기로 돌아갑니다. */
    private boolean checkEhCookies() {
        String c = CookieManager.getInstance().getCookie("https://forums.e-hentai.org");
        String id = "", hash = "";
        if (c != null) for (String part : c.split(";")) {
            String kv = part.trim();
            if (kv.startsWith("ipb_member_id=")) id = kv.substring(14);
            if (kv.startsWith("ipb_pass_hash=")) hash = kv.substring(14);
        }
        if (!id.matches("\\d+") || id.equals("0") || !hash.matches("[0-9a-fA-F]{32}")) return false;
        Comics.get(this).setLogin(id, hash);
        closeEhLogin();
        Toast.makeText(this, "e-hentai 에 로그인했습니다", Toast.LENGTH_SHORT).show();
        if (web != null) web.evaluateJavascript("window.onEhLogin && window.onEhLogin()", null);
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

    // ------------------------------------------------------------------ 테마 (라이트 / 다크)
    private static final int LIGHT_BG = 0xFFF6EFEC, DARK_BG = 0xFF130C11;

    private boolean systemDark() {
        return (getResources().getConfiguration().uiMode & android.content.res.Configuration.UI_MODE_NIGHT_MASK)
                == android.content.res.Configuration.UI_MODE_NIGHT_YES;
    }

    /** 웹 화면이 부르는 함수들 (앱 안 화면에서만 쓰임). */
    private class ThemeBridge {
        @android.webkit.JavascriptInterface
        public boolean isSystemDark() { return systemDark(); }

        @android.webkit.JavascriptInterface
        public void setDark(boolean dark) { ui.post(() -> applyBars(dark)); }

        /** 웹 화면이 보관한 이미지도 지움 (만화 → 보관 이미지 지우기) */
        @android.webkit.JavascriptInterface
        public void clearWebCache() { ui.post(() -> { if (web != null) web.clearCache(true); }); }

        /** 살짝 진동 (숏폼 더블탭 하트 등) */
        @android.webkit.JavascriptInterface
        public void haptic() {
            try {
                android.os.Vibrator vib = (android.os.Vibrator) getSystemService(VIBRATOR_SERVICE);
                if (vib == null || !vib.hasVibrator()) return;
                if (Build.VERSION.SDK_INT >= 29) vib.vibrate(android.os.VibrationEffect.createPredefined(android.os.VibrationEffect.EFFECT_CLICK));
                else vib.vibrate(android.os.VibrationEffect.createOneShot(25, android.os.VibrationEffect.DEFAULT_AMPLITUDE));
            } catch (Exception ignored) {
            }
        }

        /** 사진 전체 화면: 상태 표시줄·내비게이션 막대를 숨김 (가장자리에서 쓸면 잠깐 보임) */
        @android.webkit.JavascriptInterface
        public void immersive(boolean on) {
            ui.post(() -> {
                if (Build.VERSION.SDK_INT < 30) return;
                WindowInsetsController c = getWindow().getInsetsController();
                if (c == null) return;
                if (on) {
                    c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                    c.hide(WindowInsets.Type.systemBars());
                } else c.show(WindowInsets.Type.systemBars());
            });
        }

        /** 웹 화면에서 재생할 수 없는 영상을 앱 내장 플레이어(ExoPlayer)로 재생 */
        @android.webkit.JavascriptInterface
        public void playNative(String id, String title, double pos) {
            ui.post(() -> {
                String url = "http://127.0.0.1:" + ServerService.port + "/media/" + id;
                android.content.Intent it = new android.content.Intent(MainActivity.this, PlayerActivity.class)
                        .putExtra("url", url).putExtra("title", title)
                        .putExtra("id", Long.parseLong(id)).putExtra("pos", (long) (pos * 1000))
                        .putExtra("cookie", CookieManager.getInstance().getCookie(url));
                startActivityForResult(it, REQ_PLAYER);
            });
        }
    }

    /** 상태 표시줄·내비게이션 막대 색과 아이콘 밝기를 테마에 맞춤. */
    @SuppressWarnings("deprecation")
    private void applyBars(boolean dark) {
        int bg = dark ? DARK_BG : LIGHT_BG;
        getWindow().setStatusBarColor(bg);       // 안드로이드 14 이하용 (15부터는 아래 root 배경이 막대 뒤에 보임)
        getWindow().setNavigationBarColor(bg);
        if (root != null) root.setBackgroundColor(bg);
        if (web != null) web.setBackgroundColor(bg);
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                c.setSystemBarsAppearance(dark ? 0 : mask, mask);
            }
        } else {
            View d = getWindow().getDecorView();
            int f = d.getSystemUiVisibility();
            int light = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            d.setSystemUiVisibility(dark ? f & ~light : f | light);
        }
    }

    @Override
    public void onConfigurationChanged(android.content.res.Configuration c) {
        super.onConfigurationChanged(c);
        // 휴대폰 다크 모드를 바꾸면 ‘시스템 설정’ 테마도 바로 따라감
        if (web != null) web.evaluateJavascript("window.onSystemTheme && window.onSystemTheme()", null);
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
        } else {
            perms.add(Manifest.permission.READ_EXTERNAL_STORAGE);
        }
        requestPermissions(perms.toArray(new String[0]), 1);
    }

    private boolean permDenied = false;

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        new Thread(() -> Library.get(this).scan()).start();   // 새 권한으로 목록 다시 만들기
        permDenied = code == 1 && !hasVideoPermission();
        // onResume 이 이어서 호출되며 서버를 시작하거나 (거절했으면) 안내를 다시 보여 줍니다
    }

    // ---- 처음 화면: 무엇을 가져올지 고르고 사진·영상 접근 허용
    private int[] palette() {   // 배경, 카드, 글자, 흐린 글자, 강조, 강조 위 글자, 옅은 강조, 선
        return systemDark()
                ? new int[]{DARK_BG, 0xFF1D141A, 0xFFF4E9EC, 0xFFB9A3AD, 0xFFF07A9A, 0xFF2A0A16, 0xFF3D1A2A, 0xFF3D2A35}
                : new int[]{LIGHT_BG, 0xFFFFFAF8, 0xFF231119, 0xFF6B5260, 0xFFB4234F, 0xFFFFFFFF, 0xFFF7DCE4, 0xFFE2D3CE};
    }

    private void showPermissionScreen() {
        final int[] c = palette();
        final boolean dark = systemDark();
        android.content.SharedPreferences prefs = getPreferences(MODE_PRIVATE);
        final boolean[] all = {!"pick".equals(prefs.getString("media_choice", "all"))};

        android.widget.ScrollView scroll = new android.widget.ScrollView(this);
        scroll.setFillViewport(true);
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setPadding(dp(24), dp(28), dp(24), dp(20));
        scroll.addView(col, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        col.addView(space(), new LinearLayout.LayoutParams(1, 0, 1f));
        // 앱 아이콘
        android.widget.ImageView icon = new android.widget.ImageView(this);
        icon.setImageResource(R.drawable.ic_launcher_fg);
        GradientDrawable ibg = new GradientDrawable(GradientDrawable.Orientation.TL_BR, new int[]{0xFF6A1C40, 0xFF2B0A1A});
        ibg.setCornerRadius(dp(20));
        icon.setBackground(ibg);
        icon.setClipToOutline(true);
        icon.setOutlineProvider(android.view.ViewOutlineProvider.BACKGROUND);
        icon.setElevation(dp(4));
        LinearLayout.LayoutParams ilp = new LinearLayout.LayoutParams(dp(68), dp(68));
        ilp.bottomMargin = dp(18);
        col.addView(icon, ilp);

        col.addView(label("Velvet", 30, c[2], true));
        TextView lead = label("만화·영상·사진·숏폼을 한 곳에서 보는 앱이에요. 휴대폰의 영상과 사진은 태그·사람별로 정리돼요.", 15, c[3], false);
        lead.setLineSpacing(0, 1.25f);
        col.addView(lead);

        TextView q = label("어떤 사진·영상을 가져올까요?", 16, c[2], true);
        LinearLayout.LayoutParams qlp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        qlp.topMargin = dp(30); qlp.bottomMargin = dp(10);
        col.addView(q, qlp);

        final LinearLayout[] cards = new LinearLayout[2];
        final View[] radios = new View[2];
        Runnable paint = () -> {
            for (int i = 0; i < 2; i++) {
                boolean on = (i == 0) == all[0];
                GradientDrawable g = new GradientDrawable();
                g.setColor(c[1]); g.setCornerRadius(dp(20)); g.setStroke(dp(2), on ? c[4] : c[1]);
                cards[i].setBackground(g);
                GradientDrawable r = new GradientDrawable();
                r.setShape(GradientDrawable.OVAL); r.setColor(c[1]); r.setStroke(on ? dp(7) : dp(2), on ? c[4] : c[7]);
                radios[i].setBackground(r);
                cards[i].setContentDescription((i == 0 ? "휴대폰 전체" : "폴더를 골라서") + (on ? ", 선택됨" : ""));
            }
        };
        String[][] opts = {
                {"휴대폰 전체", "카메라, 다운로드, 메신저 등 휴대폰에 있는 모든 사진과 영상을 가져와요."},
                {"폴더를 골라서", "다음 화면에서 사진·영상이 있는 폴더를 보고, 원하는 폴더만 골라요."}};
        for (int i = 0; i < 2; i++) {
            final int idx = i;
            LinearLayout card = new LinearLayout(this);
            card.setOrientation(LinearLayout.HORIZONTAL);
            card.setGravity(Gravity.CENTER_VERTICAL);
            card.setPadding(dp(14), dp(14), dp(16), dp(14));
            card.setElevation(dp(1));
            card.setClickable(true);
            card.setFocusable(true);
            // 아이콘 칸
            android.widget.ImageView ic = new android.widget.ImageView(this);
            ic.setImageResource(i == 0 ? R.drawable.ic_ob_photos : R.drawable.ic_ob_folder);
            int tint = i == 0 ? (dark ? 0xFFF07A9A : 0xFFB4234F) : (dark ? 0xFFE2B970 : 0xFF8A5A12);
            int tile = i == 0 ? (dark ? 0xFF3D1A2A : 0xFFF7DCE4) : (dark ? 0xFF3A2A1A : 0xFFF5E8D2);
            ic.setImageTintList(android.content.res.ColorStateList.valueOf(tint));
            GradientDrawable tg = new GradientDrawable(); tg.setColor(tile); tg.setCornerRadius(dp(14));
            ic.setBackground(tg);
            ic.setPadding(dp(10), dp(10), dp(10), dp(10));
            card.addView(ic, new LinearLayout.LayoutParams(dp(46), dp(46)));
            // 글
            LinearLayout txt = new LinearLayout(this);
            txt.setOrientation(LinearLayout.VERTICAL);
            LinearLayout.LayoutParams tlp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
            tlp.leftMargin = dp(14); tlp.rightMargin = dp(12);
            LinearLayout titleRow = new LinearLayout(this);
            titleRow.setGravity(Gravity.CENTER_VERTICAL);
            titleRow.addView(label(opts[i][0], 16, c[2], true));
            if (i == 0) {
                TextView badge = label("추천", 11, c[4], true);
                GradientDrawable bg = new GradientDrawable(); bg.setColor(c[6]); bg.setCornerRadius(dp(8));
                badge.setBackground(bg);
                badge.setPadding(dp(7), dp(1), dp(7), dp(1));
                LinearLayout.LayoutParams blp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
                blp.leftMargin = dp(8);
                titleRow.addView(badge, blp);
            }
            txt.addView(titleRow);
            TextView sub = label(opts[i][1], 13, c[3], false);
            sub.setLineSpacing(0, 1.2f);
            txt.addView(sub);
            card.addView(txt, tlp);
            View radio = new View(this);
            card.addView(radio, new LinearLayout.LayoutParams(dp(22), dp(22)));
            card.setOnClickListener(v -> {
                all[0] = idx == 0;
                getPreferences(MODE_PRIVATE).edit().putString("media_choice", all[0] ? "all" : "pick").apply();
                v.performHapticFeedback(android.view.HapticFeedbackConstants.CLOCK_TICK);
                paint.run();
            });
            cards[i] = card; radios[i] = radio;
            LinearLayout.LayoutParams clp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            clp.bottomMargin = dp(10);
            col.addView(card, clp);
        }
        paint.run();
        col.addView(label("나중에 설정 → 라이브러리와 미디어 폴더에서 언제든 바꿀 수 있어요.", 12.5f, c[3], false));

        col.addView(space(), new LinearLayout.LayoutParams(1, dp(28), 1f));

        // 거절했을 때 안내
        boolean blocked = permDenied && Build.VERSION.SDK_INT >= 23
                && !shouldShowRequestPermissionRationale(Build.VERSION.SDK_INT >= 33 ? Manifest.permission.READ_MEDIA_VIDEO : Manifest.permission.READ_EXTERNAL_STORAGE);
        if (permDenied) {
            TextView warn = label(blocked
                    ? "사진·영상 접근이 꺼져 있어요. 아래 버튼을 눌러 휴대폰 설정의 ‘권한 → 사진 및 동영상’에서 ‘모두 허용’으로 바꿔 주세요."
                    : "사진·영상 접근을 허용해야 목록을 만들 수 있어요. 권한 창에서 ‘모두 허용’을 눌러 주세요.", 13.5f, dark ? 0xFFFF9E70 : 0xFFA8400E, false);
            warn.setLineSpacing(0, 1.2f);
            LinearLayout.LayoutParams wlp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            wlp.bottomMargin = dp(10);
            col.addView(warn, wlp);
        }
        Button go = new Button(this);
        go.setText(blocked ? "설정에서 허용하기" : "계속");
        go.setAllCaps(false);
        go.setTextSize(16);
        go.setTypeface(Typeface.DEFAULT_BOLD);
        go.setTextColor(c[5]);
        go.setStateListAnimator(null);
        GradientDrawable gbg = new GradientDrawable(); gbg.setColor(c[4]); gbg.setCornerRadius(dp(18));
        go.setBackground(gbg);
        go.setOnClickListener(v -> {
            Library.get(this).setLibraryAll(all[0]);
            getPreferences(MODE_PRIVATE).edit().putBoolean("setup_pick", !all[0]).apply();
            if (blocked) {
                startActivity(new android.content.Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName())));
                return;
            }
            askPermissions();
        });
        col.addView(go, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(54)));
        TextView foot = label("다음 화면에서 사진·동영상 접근을 ‘모두 허용’으로 골라 주세요. 모든 정보는 이 휴대폰 안에만 저장돼요.", 12.5f, c[3], false);
        foot.setGravity(Gravity.CENTER);
        foot.setLineSpacing(0, 1.2f);
        LinearLayout.LayoutParams flp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        flp.topMargin = dp(10);
        col.addView(foot, flp);
        show(scroll);
    }

    private View space() { return new View(this); }

    private TextView label(String s, float sp, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(sp);
        t.setTextColor(color);
        t.setIncludeFontPadding(true);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    private void hideSplash() {
        for (int i = root.getChildCount() - 1; i >= 0; i--) {
            View c = root.getChildAt(i);
            if (!"splash".equals(c.getTag())) continue;
            c.setTag("splash-out");
            c.animate().alpha(0f).setDuration(220).withEndAction(() -> root.removeView(c)).start();
        }
    }

    /** 켜는 동안: 가운데에 앱 아이콘 (천천히 숨 쉬듯 커졌다 작아짐) */
    private void showSplash() {
        if (web != null || (root.getChildCount() > 0 && "splash".equals(root.getChildAt(0).getTag()))) return;
        boolean dark = systemDark();
        FrameLayout box = new FrameLayout(this);
        box.setTag("splash");
        box.setBackgroundColor(dark ? DARK_BG : LIGHT_BG);
        android.widget.ImageView icon = new android.widget.ImageView(this);
        icon.setImageResource(R.drawable.ic_launcher_fg);
        GradientDrawable bg = new GradientDrawable(GradientDrawable.Orientation.TL_BR, new int[]{0xFF6A1C40, 0xFF2B0A1A});
        bg.setCornerRadius(dp(30));
        icon.setBackground(bg);
        icon.setScaleType(android.widget.ImageView.ScaleType.FIT_CENTER);
        icon.setClipToOutline(true);
        icon.setOutlineProvider(android.view.ViewOutlineProvider.BACKGROUND);
        icon.setElevation(dp(6));
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(dp(112), dp(112), Gravity.CENTER);
        box.addView(icon, lp);
        root.removeAllViews();
        root.addView(box, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        applyBars(dark);
        android.view.animation.ScaleAnimation pulse = new android.view.animation.ScaleAnimation(1f, 1.06f, 1f, 1.06f,
                android.view.animation.Animation.RELATIVE_TO_SELF, 0.5f, android.view.animation.Animation.RELATIVE_TO_SELF, 0.5f);
        pulse.setDuration(900);
        pulse.setRepeatMode(android.view.animation.Animation.REVERSE);
        pulse.setRepeatCount(android.view.animation.Animation.INFINITE);
        icon.startAnimation(pulse);
    }

    private void showError(String err) {
        int[] c = palette();
        LinearLayout box = column();
        box.addView(text("앱을 시작하지 못했습니다", 18, c[2], true));
        box.addView(text(err, 14, systemDark() ? 0xFFFF9E70 : 0xFFA8400E, false));
        box.addView(button("다시 시도", v -> {
            ServerService.lastError = null;
            ServerService.start(this);
            showSplash();
        }));
        show(box);
    }

    private void show(View v) {
        if (web != null) return;
        root.removeAllViews();
        applyBars(systemDark());   // 앱과 같은 밝기
        root.setBackgroundColor(systemDark() ? DARK_BG : LIGHT_BG);
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
        int[] c = palette();
        b.setTextColor(c[5]);
        b.setStateListAnimator(null);
        GradientDrawable g = new GradientDrawable();
        g.setColor(c[4]);
        g.setCornerRadius(dp(16));
        b.setBackground(g);
        b.setOnClickListener(onClick);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(16);
        b.setLayoutParams(lp);
        b.setPadding(dp(20), 0, dp(20), 0);
        return b;
    }
}
