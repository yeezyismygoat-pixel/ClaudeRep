package app.vidvault;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.SystemClock;
import android.view.WindowManager;

import org.json.JSONObject;

/**
 * 사생활 보호 설정과 ‘잠금이 필요한지’ 판단.
 * - 앱 잠금: 처음 열 때, 그리고 정한 시간보다 오래 다른 앱에 다녀오면 다시 잠금 (지문·얼굴 또는 휴대폰 PIN)
 * - 화면 캡처 막기(FLAG_SECURE): 스크린샷·녹화 차단, 최근 앱 목록에서 내용 가림
 * - 뒤집어 숨기기: 휴대폰을 엎어 놓으면 바로 평범한 시계 화면으로
 * 썸네일 흐림(blur)은 웹 화면이 처리하지만 설정은 여기에 함께 저장.
 */
final class Privacy {
    private Privacy() {}

    // 앱 전체에서 보이는 화면 수 (MainActivity + PlayerActivity). 0 이 되면 앱이 뒤로 간 것
    private static int started = 0;
    private static long hiddenAt = 0;
    /** 이번 실행에서 잠금을 풀었는지 (앱을 새로 켜면 false 라 잠금부터) */
    static boolean unlocked = false;
    /** 잠금 해제 창(PIN 화면 등)이 떠 있는 동안은 ‘앱이 뒤로 갔다’고 보지 않음 */
    static boolean authenticating = false;
    /** 파일 고르기·권한 설정처럼 앱이 일부러 연 다른 화면: 다녀와도 잠그지 않음 */
    static boolean expectExternal = false;
    /** 내장 플레이어에서 뒤집어 숨겼을 때: 앱 화면으로 돌아오면 바로 숨김 화면 */
    static boolean pendingHide = false;

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences("privacy", Context.MODE_PRIVATE);
    }

    static boolean lockOn(Context c) { return prefs(c).getBoolean("lock", true); }
    static int timeout(Context c) { return prefs(c).getInt("timeout", 30); }
    static boolean secureOn(Context c) { return prefs(c).getBoolean("secure", true); }
    static boolean flipOn(Context c) { return prefs(c).getBoolean("flip", false); }

    static boolean deviceSecure(Context c) {
        try {
            KeyguardManager km = (KeyguardManager) c.getSystemService(Context.KEYGUARD_SERVICE);
            return km != null && km.isDeviceSecure();
        } catch (Exception e) {
            return false;
        }
    }

    /** 잠금을 실제로 쓸 수 있는지 (켜져 있고, 휴대폰에 화면 잠금이 있음) */
    static boolean lockActive(Context c) { return lockOn(c) && deviceSecure(c); }

    static String json(Context c) {
        try {
            SharedPreferences p = prefs(c);
            return new JSONObject()
                    .put("lock", p.getBoolean("lock", true))
                    .put("timeout", p.getInt("timeout", 30))
                    .put("secure", p.getBoolean("secure", true))
                    .put("blur", p.getBoolean("blur", true))
                    .put("flip", p.getBoolean("flip", false))
                    .toString();
        } catch (Exception e) {
            return "{}";
        }
    }

    static void set(Context c, String key, String value) {
        SharedPreferences.Editor e = prefs(c).edit();
        switch (key) {
            case "lock": case "secure": case "blur": case "flip":
                boolean on = "true".equals(value);
                e.putBoolean(key, on);
                if ("lock".equals(key) && on) unlocked = true;   // 지금 앱 안에 있으니 바로 잠그지는 않음
                break;
            case "timeout":
                try { e.putInt(key, Math.max(0, Math.min(3600, Integer.parseInt(value.trim())))); } catch (NumberFormatException ignored) {}
                break;
            default:
                return;
        }
        e.apply();
    }

    /** 스크린샷 막기 + 최근 앱 목록 미리보기 가리기 */
    static void applySecure(Activity a) {
        boolean on = secureOn(a);
        if (on) a.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        else a.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
        if (Build.VERSION.SDK_INT >= 33) a.setRecentsScreenshotEnabled(!on);
    }

    static void activityStarted() { started++; }

    static void activityStopped() {
        started = Math.max(0, started - 1);
        if (started > 0 || authenticating) return;
        if (expectExternal) { expectExternal = false; return; }
        hiddenAt = SystemClock.elapsedRealtime();
    }

    /** 앱이 다른 화면을 일부러 열지 않고 돌아왔으면 표시를 지움 (권한 창처럼 앱이 멈추지 않는 경우) */
    static void resumed() { expectExternal = false; }

    /** 지금 잠가야 하는지 (부작용 없음) */
    static boolean wouldLock(Context c) {
        if (!lockActive(c)) return false;
        if (!unlocked) return true;
        return hiddenAt > 0 && SystemClock.elapsedRealtime() - hiddenAt >= timeout(c) * 1000L;
    }

    /** 앱 화면이 다시 보일 때 부름: 잠가야 하면 true (다녀온 시간 기록은 지움) */
    static boolean checkLock(Context c) {
        if (!lockActive(c)) { hiddenAt = 0; return false; }
        boolean lock = wouldLock(c);
        hiddenAt = 0;
        if (lock) unlocked = false;
        return lock;
    }
}
