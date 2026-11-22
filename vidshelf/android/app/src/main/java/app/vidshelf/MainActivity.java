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
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(BG);
        root = new FrameLayout(this);
        root.setBackgroundColor(BG);
        setContentView(root);
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
        if (web == null) showLoading("불러오는 중…");
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
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if ("vidshelf".equals(u.getScheme()) && "manage-media".equals(u.getHost()) && Build.VERSION.SDK_INT >= 31) {
                    // ‘미디어 관리’ 권한 화면 (켜 두면 즐겨찾기를 바꿀 때마다 묻지 않음)
                    try { startActivity(new android.content.Intent(android.provider.Settings.ACTION_REQUEST_MANAGE_MEDIA, Uri.parse("package:" + getPackageName()))); } catch (Exception ignored) {}
                    return true;
                }
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

    // ------------------------------------------------------------------ 테마 (라이트 / 다크)
    private static final int LIGHT_BG = 0xFFF4F3EF, DARK_BG = 0xFF121316;

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
        getWindow().setStatusBarColor(bg);
        getWindow().setNavigationBarColor(bg);
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
