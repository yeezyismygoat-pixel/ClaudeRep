package app.vidshelf;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;

/** 서버 상태와 접속 주소, 권한·비밀번호·다른 기기 접속 설정을 보여 주는 화면. */
public class MainActivity extends Activity {

    private static final int BG = 0xFF111214, PANEL = 0xFF1B1D22, TEXT = 0xFFE9E7E3, MUTED = 0xFF9B978F, ACCENT = 0xFFE8A33D;

    private LinearLayout root;
    private final Handler ui = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(BG);
        ScrollView sv = new ScrollView(this);
        sv.setBackgroundColor(BG);
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int p = dp(20);
        root.setPadding(p, p, p, p);
        sv.addView(root);
        setContentView(sv);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (hasVideoPermission() && !ServerService.running) ServerService.start(this);
        render();
        ui.postDelayed(this::render, 800);   // 서버가 뜬 뒤 상태 갱신
    }

    private boolean hasVideoPermission() {
        String perm = Build.VERSION.SDK_INT >= 33 ? Manifest.permission.READ_MEDIA_VIDEO : Manifest.permission.READ_EXTERNAL_STORAGE;
        return checkSelfPermission(perm) == PackageManager.PERMISSION_GRANTED;
    }

    private void requestPermissions() {
        List<String> perms = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= 33) {
            perms.add(Manifest.permission.READ_MEDIA_VIDEO);
            perms.add(Manifest.permission.POST_NOTIFICATIONS);
        } else {
            perms.add(Manifest.permission.READ_EXTERNAL_STORAGE);
        }
        requestPermissions(perms.toArray(new String[0]), 1);
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        if (hasVideoPermission()) {
            ServerService.start(this);
            ui.postDelayed(this::render, 800);
        } else {
            Toast.makeText(this, "영상 접근 권한이 있어야 목록을 만들 수 있습니다", Toast.LENGTH_LONG).show();
        }
        render();
    }

    private void render() {
        root.removeAllViews();
        Library lib = Library.get(this);

        TextView title = text("VidShelf", 26, TEXT);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        root.addView(title);
        root.addView(text("이 앱이 설치된 공간의 영상만 보여 줍니다. 보안 폴더에 설치하면 보안 폴더의 영상만 연결됩니다.", 14, MUTED));
        boolean secure = ServerService.userId() != 0;
        LinearLayout where = panel();
        where.addView(text(secure ? "🔒 보안 폴더에서 실행 중" : "⚠ 일반 공간에서 실행 중", 17, secure ? ACCENT : 0xFFEF6A62));
        where.addView(text(secure
                ? "보안 폴더의 영상만 보입니다."
                : "지금은 일반 공간의 영상이 보입니다. 보안 폴더 영상만 보려면 보안 폴더 안의 VidShelf 를 쓰고, 이 앱은 지우거나 서버를 중지하세요.", 14, MUTED));
        root.addView(where);
        space(16);

        // --- 권한
        if (!hasVideoPermission()) {
            LinearLayout box = panel();
            box.addView(text("영상 접근 권한이 필요합니다", 17, TEXT));
            box.addView(text("권한 창에서 ‘모두 허용’을 고르세요. 일부만 허용하면 고른 영상만 보입니다.", 14, MUTED));
            box.addView(button("영상 접근 허용", true, v -> requestPermissions()));
            root.addView(box);
            return;
        }

        // --- 서버 상태
        LinearLayout status = panel();
        boolean running = ServerService.running;
        boolean lan = lib.lanEnabled() && lib.passwordSet();
        status.addView(text(running ? "● 실행 중" : "○ 꺼짐", 17, running ? ACCENT : MUTED));
        if (ServerService.lastError != null) status.addView(text("오류: " + ServerService.lastError, 14, 0xFFEF6A62));
        status.addView(text("영상 " + lib.videoCount() + "개 · 폴더: " + String.join(", ", lib.libraryPaths()), 14, MUTED));
        status.addView(label("이 폰에서"));
        status.addView(selectable("http://localhost:" + ServerService.port));
        if (running && ServerService.port != ServerService.PORT)
            status.addView(text("8899 번은 다른 공간의 VidShelf 가 쓰고 있어 " + ServerService.port + " 번으로 열었습니다. 8899 번 주소로 열면 다른 공간의 영상이 보이니 주의하세요.", 13, 0xFFEF6A62));
        if (lan) {
            status.addView(label("같은 Wi-Fi 의 다른 기기에서"));
            List<String> ips = ServerService.lanAddresses();
            if (ips.isEmpty()) status.addView(text("Wi-Fi 에 연결되어 있지 않습니다", 14, MUTED));
            for (String ip : ips) status.addView(selectable("http://" + ip + ":" + ServerService.port));
        }
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.addView(button("브라우저로 열기", true, v -> startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("http://localhost:" + ServerService.port)))));
        row.addView(button(running ? "서버 중지" : "서버 시작", false, v -> {
            if (ServerService.running) ServerService.stop(this); else ServerService.start(this);
            ui.postDelayed(this::render, 800);
        }));
        status.addView(row);
        root.addView(status);

        // --- 다른 기기 접속
        LinearLayout net = panel();
        net.addView(text("다른 기기에서 보기", 17, TEXT));
        net.addView(text("켜면 같은 Wi-Fi 에 있는 폰·태블릿·PC 브라우저에서 위 주소로 접속할 수 있습니다. 비밀번호를 먼저 정해야 켤 수 있습니다.", 14, MUTED));
        Switch sw = new Switch(this);
        sw.setText("다른 기기 접속 허용");
        sw.setTextColor(TEXT);
        sw.setChecked(lib.lanEnabled() && lib.passwordSet());
        sw.setOnCheckedChangeListener((btn, on) -> {
            if (on && !lib.passwordSet()) {
                btn.setChecked(false);
                Toast.makeText(this, "먼저 아래에서 비밀번호를 정하세요", Toast.LENGTH_LONG).show();
                return;
            }
            lib.setLan(on);
            ServerService.start(this);   // 새 설정으로 다시 시작
            ui.postDelayed(this::render, 800);
        });
        net.addView(sw);

        net.addView(label(lib.passwordSet() ? "비밀번호 바꾸기 (비우고 저장하면 해제)" : "비밀번호 정하기"));
        EditText pw = new EditText(this);
        pw.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        pw.setTextColor(TEXT);
        pw.setHintTextColor(MUTED);
        pw.setHint("비밀번호");
        net.addView(pw);
        net.addView(button("비밀번호 저장", false, v -> {
            String s = pw.getText().toString();
            lib.setPassword(s);
            if (s.isEmpty() && lib.lanEnabled()) lib.setLan(false);
            Toast.makeText(this, s.isEmpty() ? "비밀번호를 해제했습니다" : "비밀번호를 저장했습니다", Toast.LENGTH_SHORT).show();
            ServerService.start(this);
            ui.postDelayed(this::render, 800);
        }));
        root.addView(net);

        root.addView(text("영상 폴더는 브라우저 화면의 ‘설정’ 탭에서 바꿀 수 있습니다. 기본값은 DCIM 과 Download 입니다.", 13, MUTED));
    }

    // ------------------------------------------------------------------ view helpers
    private int dp(int v) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics());
    }

    private void space(int h) {
        View v = new View(this);
        root.addView(v, new LinearLayout.LayoutParams(1, dp(h)));
    }

    private TextView text(String s, int sp, int color) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(sp);
        t.setTextColor(color);
        t.setPadding(0, dp(2), 0, dp(2));
        return t;
    }

    private TextView label(String s) {
        TextView t = text(s, 13, MUTED);
        t.setPadding(0, dp(12), 0, 0);
        return t;
    }

    private TextView selectable(String s) {
        TextView t = text(s, 18, TEXT);
        t.setTypeface(Typeface.MONOSPACE);
        t.setTextIsSelectable(true);
        return t;
    }

    private LinearLayout panel() {
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.VERTICAL);
        int p = dp(16);
        l.setPadding(p, p, p, p);
        GradientDrawable g = new GradientDrawable();
        g.setColor(PANEL);
        g.setCornerRadius(dp(12));
        l.setBackground(g);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.bottomMargin = dp(14);
        l.setLayoutParams(lp);
        return l;
    }

    private Button button(String s, boolean primary, View.OnClickListener onClick) {
        Button b = new Button(this);
        b.setText(s);
        b.setAllCaps(false);
        b.setTextColor(primary ? 0xFF1D1304 : TEXT);
        GradientDrawable g = new GradientDrawable();
        g.setColor(primary ? ACCENT : 0xFF2A2E36);
        g.setCornerRadius(dp(10));
        b.setBackground(g);
        b.setOnClickListener(onClick);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(10);
        lp.rightMargin = dp(8);
        b.setLayoutParams(lp);
        b.setPadding(dp(16), 0, dp(16), 0);
        b.setGravity(Gravity.CENTER);
        return b;
    }
}
