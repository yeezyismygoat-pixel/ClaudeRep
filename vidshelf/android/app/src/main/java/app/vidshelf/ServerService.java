package app.vidshelf;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** 화면을 꺼도 계속 동작하는 웹 서버 (상단 알림이 떠 있는 동안 실행). */
public class ServerService extends Service {

    public static final int PORT = 8899;
    /** 실제로 열린 포트. 8899 를 다른 공간(일반 공간 등)의 VidShelf 가 쓰고 있으면 다음 번호를 씀. */
    static volatile int port = PORT;
    static final String ACTION_STOP = "app.vidshelf.STOP";
    private static final String CHANNEL = "server";

    static volatile boolean running = false;
    static volatile String lastError = null;

    private HttpServer server;
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;

    /** 다른 기기 접속이 켜져 있을 때만 ‘실행 중’ 알림과 함께 계속 돌고, 아니면 알림 없이 앱을 쓰는 동안만 돔. */
    public static void start(Context ctx) {
        Library lib = Library.get(ctx);
        boolean lan = lib.lanEnabled() && lib.passwordSet();
        Intent i = new Intent(ctx, ServerService.class);
        try {
            if (lan) ctx.startForegroundService(i); else ctx.startService(i);
        } catch (Exception ignored) {   // 앱이 뒤에 있을 때는 시작이 막힘 → 앱을 다시 열면 시작됨
        }
    }

    public static void stop(Context ctx) {
        ctx.startService(new Intent(ctx, ServerService.class).setAction(ACTION_STOP));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            shutdown();
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
            return START_NOT_STICKY;
        }
        Library lib = Library.get(this);
        boolean lan = lib.lanEnabled() && lib.passwordSet();
        if (lan) {   // 다른 기기에서 접속할 수 있게 뒤에서도 계속 돌아야 하므로 알림 표시 (안드로이드 규칙)
            if (Build.VERSION.SDK_INT >= 34)
                startForeground(1, buildNotification(lan), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
            else
                startForeground(1, buildNotification(lan));
        } else {
            stopForeground(STOP_FOREGROUND_REMOVE);   // 알림 없이
        }
        try {
            if (server == null) server = new HttpServer(lib);
            Exception last = null;
            boolean ok = false;
            for (int p = PORT; p < PORT + 10 && !ok; p++) {
                try {
                    server.start(lan ? "0.0.0.0" : "127.0.0.1", p);
                    port = p;
                    ok = true;
                } catch (java.net.BindException e) {
                    last = e;
                }
            }
            if (!ok) throw last;
            getSystemService(NotificationManager.class).notify(1, buildNotification(lan));
            running = true;
            lastError = null;
            acquireLocks(lan);
            new Thread(lib::scan).start();
        } catch (Exception e) {
            running = false;
            lastError = e.getMessage();
        }
        return START_STICKY;
    }

    private void acquireLocks(boolean lan) {
        if (wakeLock == null) {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "vidshelf:server");
            wakeLock.acquire();
        }
        if (lan && wifiLock == null) {
            WifiManager wm = (WifiManager) getApplicationContext().getSystemService(WIFI_SERVICE);
            if (wm != null) {
                wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "vidshelf:wifi");
                wifiLock.acquire();
            }
        } else if (!lan && wifiLock != null) {
            wifiLock.release();
            wifiLock = null;
        }
    }

    private void shutdown() {
        running = false;
        if (server != null) server.stop();
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
        wakeLock = null;
        wifiLock = null;
    }

    @Override
    public void onDestroy() {
        shutdown();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    private Notification buildNotification(boolean lan) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel(CHANNEL, "VidShelf 서버", NotificationManager.IMPORTANCE_LOW));
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
        PendingIntent stop = PendingIntent.getService(this, 1, new Intent(this, ServerService.class).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE);
        String text = "앱을 열어 영상을 보세요";
        List<String> ips = lanAddresses();
        if (lan) text = ips.isEmpty() ? "다른 기기 접속: Wi-Fi 에 연결되어 있지 않습니다" : "다른 기기 접속: http://" + ips.get(0) + ":" + port;
        return new Notification.Builder(this, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setContentTitle("VidShelf 실행 중 · " + spaceName())
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setContentIntent(open)
                .addAction(new Notification.Action.Builder(null, "중지", stop).build())
                .setOngoing(true)
                .build();
    }

    /** 안드로이드 사용자 번호: 0 = 일반 공간, 그 외(보통 150 이상) = 보안 폴더 등 별도 공간. */
    static int userId() { return android.os.Process.myUid() / 100000; }

    static String spaceName() { return userId() == 0 ? "일반 공간" : "보안 폴더"; }

    /** 같은 Wi-Fi 의 다른 기기가 접속할 수 있는 이 폰의 주소들. */
    static List<String> lanAddresses() {
        List<String> out = new ArrayList<>();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                    if (a instanceof Inet4Address && a.isSiteLocalAddress()) {
                        String ip = a.getHostAddress();
                        if (ni.getName().startsWith("wlan")) out.add(0, ip);
                        else out.add(ip);
                    }
                }
            }
        } catch (Exception ignored) {
        }
        return out;
    }
}
