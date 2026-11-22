package app.mangaviewer;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

/** 앱 안 화면이 쓰는 작은 웹 서버 (이 휴대폰 안에서만 접속 가능). 만화 저장을 화면이 꺼져도 이어 갑니다. */
public class ServerService extends Service {

    /** VidShelf(8899)와 함께 쓸 수 있게 다른 번호. 이미 쓰이고 있으면 다음 번호를 씀. */
    public static final int PORT = 8909;
    static volatile int port = PORT;
    static final String ACTION_STOP = "app.mangaviewer.STOP";
    private static final String CHANNEL = "server";

    static volatile boolean running = false;
    static volatile String lastError = null;

    private HttpServer server;
    private PowerManager.WakeLock wakeLock;

    public static void start(Context ctx) {
        ctx.startForegroundService(new Intent(ctx, ServerService.class));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            shutdown();
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
            return START_NOT_STICKY;
        }
        if (Build.VERSION.SDK_INT >= 34)
            startForeground(1, buildNotification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else
            startForeground(1, buildNotification());
        if (running) return START_STICKY;
        try {
            if (server == null) server = new HttpServer(Comics.get(this));
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
            running = true;
            lastError = null;
            if (wakeLock == null) {
                PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "mangaviewer:server");
                wakeLock.acquire();
            }
        } catch (Exception e) {
            running = false;
            lastError = e.getMessage();
        }
        return START_STICKY;
    }

    private void shutdown() {
        running = false;
        if (server != null) server.stop();
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
    }

    @Override
    public void onDestroy() {
        shutdown();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    private Notification buildNotification() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Manga Viewer", NotificationManager.IMPORTANCE_LOW));
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
        PendingIntent stop = PendingIntent.getService(this, 1, new Intent(this, ServerService.class).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(this, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_menu_gallery)
                .setContentTitle("Manga Viewer 실행 중")
                .setContentText("저장 중인 만화는 화면을 꺼도 계속 받습니다")
                .setContentIntent(open)
                .addAction(new Notification.Action.Builder(null, "중지", stop).build())
                .setOngoing(true)
                .build();
    }
}
