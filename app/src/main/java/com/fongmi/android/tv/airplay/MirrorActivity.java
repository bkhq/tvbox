package com.fongmi.android.tv.airplay;

import android.os.Bundle;
import android.view.SurfaceHolder;
import android.view.WindowManager;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.media3.ui.AspectRatioFrameLayout;

import com.fongmi.android.tv.App;
import com.fongmi.android.tv.databinding.ActivityMirrorBinding;

/** Full-screen surface for AirPlay screen mirroring. Closes when the sender stops. */
public class MirrorActivity extends AppCompatActivity implements SurfaceHolder.Callback, VideoSink.Listener {

    private ActivityMirrorBinding binding;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        binding = ActivityMirrorBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        hideSystemBars();
        binding.surface.getHolder().addCallback(this);
    }

    private void hideSystemBars() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.hide(WindowInsetsCompat.Type.systemBars());
    }

    @Override
    public void surfaceCreated(@NonNull SurfaceHolder holder) {
        AirPlay.get().attach(holder.getSurface(), this, this::finish);
    }

    @Override
    public void surfaceChanged(@NonNull SurfaceHolder holder, int format, int width, int height) {
    }

    @Override
    public void surfaceDestroyed(@NonNull SurfaceHolder holder) {
        AirPlay.get().detach();
    }

    @Override
    public void onVideoSize(int width, int height) {
        if (width <= 0 || height <= 0) return;
        App.post(() -> {
            AspectRatioFrameLayout frame = binding.frame;
            frame.setAspectRatio((float) width / height);
        });
    }
}
