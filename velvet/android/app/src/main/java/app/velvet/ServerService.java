package app.velvet;

import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.IBinder;

/** 앱 화면에 영상을 보내 주는 이 폰 안의 작은 웹 서버. 이 폰 안(127.0.0.1)에서만 열리고, 알림 없이 앱을 쓰는 동안만 돔. */
public class ServerService extends Service {

    public static final int PORT = 8929;
    /** 실제로 열린 포트. 8929 를 다른 공간(보안 폴더 등)의 Velvet 이 쓰고 있으면 다음 번호를 씀. */
    static volatile int port = PORT;
    static final String ACTION_STOP = "app.velvet.STOP";

    static volatile boolean running = false;
    static volatile String lastError = null;

    private HttpServer server;

    public static void start(Context ctx) {
        try {
            ctx.startService(new Intent(ctx, ServerService.class));
        } catch (Exception ignored) {   // 앱이 뒤에 있을 때는 시작이 막힘 → 앱을 다시 열면 시작됨
        }
    }

    public static void stop(Context ctx) {
        try { ctx.startService(new Intent(ctx, ServerService.class).setAction(ACTION_STOP)); } catch (Exception ignored) {}
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            shutdown();
            stopSelf();
            return START_NOT_STICKY;
        }
        clearOldNotifications();
        Library lib = Library.get(this);
        try {
            if (server == null) server = new HttpServer(lib);
            if (!running) {
                Exception last = null;
                boolean ok = false;
                for (int p = PORT; p < PORT + 10 && !ok; p++) {
                    try {
                        server.start("127.0.0.1", p);
                        port = p;
                        ok = true;
                    } catch (java.net.BindException e) {
                        last = e;
                    }
                }
                if (!ok) throw last;
            }
            running = true;
            lastError = null;
            new Thread(lib::scan).start();
        } catch (Exception e) {
            running = false;
            lastError = e.getMessage();
        }
        return START_NOT_STICKY;
    }

    /** 예전 버전이 띄우던 ‘실행 중’ 알림과 알림 항목을 지움. */
    private void clearOldNotifications() {
        try {
            NotificationManager nm = getSystemService(NotificationManager.class);
            nm.cancelAll();
            for (String ch : new String[]{"server", "server_quiet", "vidshelf"}) nm.deleteNotificationChannel(ch);
        } catch (Exception ignored) {
        }
    }

    private void shutdown() {
        running = false;
        if (server != null) server.stop();
    }

    @Override
    public void onDestroy() {
        shutdown();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    /** 안드로이드 사용자 번호: 0 = 일반 공간, 그 외(보통 150 이상) = 보안 폴더 등 별도 공간. */
    static int userId() { return android.os.Process.myUid() / 100000; }
}
