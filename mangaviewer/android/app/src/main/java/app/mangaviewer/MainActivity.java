package app.mangaviewer;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsetsController;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

/** 앱 화면: 앱 안의 웹 화면(WebView)으로 만화 목록과 뷰어를 보여 줍니다. */
public class MainActivity extends Activity {

    private static final int LIGHT_BG = 0xFFF4F3EF, DARK_BG = 0xFF121316;
    private static final int LIGHT_TEXT = 0xFF16161A, DARK_TEXT = 0xFFEEEDEA;
    private static final int LIGHT_MUTED = 0xFF5E5D66, DARK_MUTED = 0xFFA3A2A9;
    private static final int LIGHT_ACCENT = 0xFF2F5BEA, DARK_ACCENT = 0xFF7C9CFF;

    private FrameLayout root;
    private WebView web;
    private int loadedPort = -1;
    private boolean dark;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final Runnable watcher = this::watchServer;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        root = new FrameLayout(this);
        setContentView(root);
        applyBars(systemDark());
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (!ServerService.running) ServerService.start(this);
        if (web == null) showLoading();
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
                CookieManager cm = CookieManager.getInstance();
                cm.setAcceptCookie(true);
                cm.setCookie("http://127.0.0.1:" + port, "mv_app=" + Comics.get(this).appToken() + "; path=/");
                cm.flush();
                loadedPort = port;
                web.loadUrl("http://127.0.0.1:" + port + "/" + hash);
            }
        } else if (ServerService.lastError != null && web == null) {
            showError(ServerService.lastError);
        }
        ui.postDelayed(watcher, ServerService.running ? 2000 : 300);
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void createWebView() {
        web = new WebView(this);
        web.setBackgroundColor(dark ? DARK_BG : LIGHT_BG);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportMultipleWindows(false);
        web.addJavascriptInterface(new Bridge(), "MangaApp");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if ("mangaviewer".equals(u.getScheme()) && "eh-login".equals(u.getHost())) { openEhLogin(); return true; }
                // 앱 서버 주소만 앱 안에서 열고, 그 밖의 주소는 열지 않음
                return !("127.0.0.1".equals(u.getHost()) || "localhost".equals(u.getHost()));
            }
        });
        root.removeAllViews();
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    @Override
    public void onBackPressed() {
        if (ehBox != null) {
            if (ehWeb.canGoBack()) ehWeb.goBack(); else closeEhLogin();
            return;
        }
        if (web != null && web.canGoBack()) { web.goBack(); return; }
        moveTaskToBack(true);   // 앱만 내리고 저장은 계속
    }

    // ------------------------------------------------------------------ 테마 (라이트 / 다크)
    private boolean systemDark() {
        return (getResources().getConfiguration().uiMode & android.content.res.Configuration.UI_MODE_NIGHT_MASK)
                == android.content.res.Configuration.UI_MODE_NIGHT_YES;
    }

    /** 웹 화면이 부르는 함수들 */
    private class Bridge {
        @android.webkit.JavascriptInterface
        public boolean isSystemDark() { return systemDark(); }

        @android.webkit.JavascriptInterface
        public void setDark(boolean d) { ui.post(() -> applyBars(d)); }

        /** 웹 화면이 보관한 이미지도 지움 (설정 → 보관 이미지 지우기) */
        @android.webkit.JavascriptInterface
        public void clearWebCache() { ui.post(() -> { if (web != null) web.clearCache(true); }); }
    }

    /** 상태 표시줄·내비게이션 막대 색과 아이콘 밝기를 테마에 맞춤. */
    @SuppressWarnings("deprecation")
    private void applyBars(boolean d) {
        dark = d;
        int bg = d ? DARK_BG : LIGHT_BG;
        getWindow().setStatusBarColor(bg);
        getWindow().setNavigationBarColor(bg);
        root.setBackgroundColor(bg);
        if (web != null) web.setBackgroundColor(bg);
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                c.setSystemBarsAppearance(d ? 0 : mask, mask);
            }
        } else {
            View v = getWindow().getDecorView();
            int f = v.getSystemUiVisibility();
            int light = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            v.setSystemUiVisibility(d ? f & ~light : f | light);
        }
    }

    @Override
    public void onConfigurationChanged(android.content.res.Configuration c) {
        super.onConfigurationChanged(c);
        // 휴대폰 다크 모드를 바꾸면 ‘시스템 설정’ 테마도 바로 따라감
        if (web != null) web.evaluateJavascript("window.onSystemTheme && window.onSystemTheme()", null);
        else applyBars(systemDark());
    }

    // ------------------------------------------------------------------ e-hentai 로그인 (앱 안 브라우저)
    private LinearLayout ehBox;
    private WebView ehWeb;

    /** e-hentai 로그인 페이지를 앱 안에서 열고, 로그인되면 쿠키를 읽어 저장합니다. 로봇 확인(캡차)도 이 화면에서 풀 수 있음. */
    @SuppressLint("SetJavaScriptEnabled")
    private void openEhLogin() {
        if (ehBox != null) return;
        if (checkEhCookies()) return;   // 이미 로그인되어 있음
        ehBox = new LinearLayout(this);
        ehBox.setOrientation(LinearLayout.VERTICAL);
        ehBox.setBackgroundColor(dark ? DARK_BG : LIGHT_BG);
        LinearLayout bar = new LinearLayout(this);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(16), dp(8), dp(8), dp(8));
        bar.addView(text("e-hentai 로그인 — 로그인하면 자동으로 돌아갑니다", 14, dark ? DARK_TEXT : LIGHT_TEXT, false),
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
                String bg = dark ? "#121316" : "#F4F3EF", fg = dark ? "#EEEDEA" : "#16161A", ac = dark ? "#7C9CFF" : "#2F5BEA";
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

    /** 로그인 쿠키가 있으면 저장하고 즐겨찾기 탭으로 돌아갑니다. */
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
        if (web != null) web.evaluateJavascript("location.hash = '#/fav'; route();", null);
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

    // ------------------------------------------------------------------ 시작 화면
    private void showLoading() {
        LinearLayout box = column();
        box.addView(text("Manga Viewer", 24, dark ? DARK_TEXT : LIGHT_TEXT, true));
        box.addView(text("불러오는 중…", 15, dark ? DARK_MUTED : LIGHT_MUTED, false));
        show(box);
    }

    private void showError(String err) {
        LinearLayout box = column();
        box.addView(text("앱을 시작하지 못했습니다", 18, dark ? DARK_TEXT : LIGHT_TEXT, true));
        box.addView(text(String.valueOf(err), 14, 0xFFC92A2A, false));
        box.addView(button("다시 시도", v -> {
            ServerService.lastError = null;
            ServerService.start(this);
            showLoading();
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
        b.setTextColor(dark ? 0xFF0B1430 : 0xFFFFFFFF);
        GradientDrawable g = new GradientDrawable();
        g.setColor(dark ? DARK_ACCENT : LIGHT_ACCENT);
        g.setCornerRadius(dp(999));
        b.setBackground(g);
        b.setOnClickListener(onClick);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(16);
        b.setLayoutParams(lp);
        b.setPadding(dp(20), 0, dp(20), 0);
        return b;
    }
}
