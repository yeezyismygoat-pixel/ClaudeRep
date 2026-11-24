package app.velvet;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.widget.Toast;

import androidx.annotation.OptIn;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.VideoSize;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.ui.PlayerView;

import java.util.HashMap;
import java.util.Map;

/** 앱 내장 플레이어: 웹 화면(WebView)이 재생하지 못하는 MKV·HEVC 등을 기기의 코덱으로 재생. */
@OptIn(markerClass = UnstableApi.class)
public class PlayerActivity extends Activity {
    private ExoPlayer player;
    private PlayerView view;
    private long id;
    private boolean oriented;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setStatusBarColor(Color.BLACK);
        getWindow().setNavigationBarColor(Color.BLACK);
        Intent in = getIntent();
        id = in.getLongExtra("id", 0);

        Map<String, String> headers = new HashMap<>();
        String cookie = in.getStringExtra("cookie");
        if (cookie != null) headers.put("Cookie", cookie);
        DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
                .setDefaultRequestProperties(headers)
                .setConnectTimeoutMs(30000).setReadTimeoutMs(60000)
                .setAllowCrossProtocolRedirects(true);
        DefaultRenderersFactory renderers = new DefaultRenderersFactory(this)
                .setEnableDecoderFallback(true);
        player = new ExoPlayer.Builder(this, renderers)
                .setMediaSourceFactory(new DefaultMediaSourceFactory(http))
                .build();

        view = new PlayerView(this);
        view.setBackgroundColor(Color.BLACK);
        view.setKeepScreenOn(true);
        view.setShowNextButton(false);
        view.setShowPreviousButton(false);
        view.setControllerShowTimeoutMs(2800);
        view.setFullscreenButtonClickListener(full -> toggleOrientation());
        view.setPlayer(player);
        setContentView(view);
        hideBars();

        player.addListener(new Player.Listener() {
            @Override
            public void onVideoSizeChanged(VideoSize s) {   // 가로 영상은 가로 화면으로
                if (oriented || s.width == 0 || s.height == 0) return;
                oriented = true;
                float w = s.width * s.pixelWidthHeightRatio;
                setRequestedOrientation(w > s.height ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE : ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
            }

            @Override
            public void onPlayerError(PlaybackException e) {
                Toast.makeText(PlayerActivity.this, "재생하지 못했습니다: " + e.getErrorCodeName(), Toast.LENGTH_LONG).show();
            }
        });
        player.setMediaItem(MediaItem.fromUri(Uri.parse(in.getStringExtra("url"))), in.getLongExtra("pos", 0));
        player.prepare();
        player.setPlayWhenReady(true);
    }

    private void toggleOrientation() {
        boolean land = getResources().getConfiguration().orientation == android.content.res.Configuration.ORIENTATION_LANDSCAPE;
        setRequestedOrientation(land ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT : ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
    }

    @SuppressWarnings("deprecation")
    private void hideBars() {
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.systemBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean focus) {
        super.onWindowFocusChanged(focus);
        if (focus) hideBars();
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (player != null) player.pause();
    }

    @Override
    public void finish() {
        if (player != null) setResult(RESULT_OK, new Intent().putExtra("id", id).putExtra("pos", player.getCurrentPosition()));
        super.finish();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (player != null) { player.release(); player = null; }
    }
}
