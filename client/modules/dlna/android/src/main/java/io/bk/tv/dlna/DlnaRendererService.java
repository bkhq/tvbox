package io.bk.tv.dlna;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

import org.jupnp.UpnpServiceConfiguration;
import org.jupnp.android.AndroidUpnpServiceImpl;
import org.jupnp.binding.annotations.AnnotationLocalServiceBinder;
import org.jupnp.model.DefaultServiceManager;
import org.jupnp.model.meta.DeviceDetails;
import org.jupnp.model.meta.DeviceIdentity;
import org.jupnp.model.meta.LocalDevice;
import org.jupnp.model.meta.LocalService;
import org.jupnp.model.meta.ManufacturerDetails;
import org.jupnp.model.meta.ModelDetails;
import org.jupnp.model.types.UDADeviceType;
import org.jupnp.model.types.UDN;
import org.jupnp.support.avtransport.lastchange.AVTransportLastChangeParser;
import org.jupnp.support.connectionmanager.ConnectionManagerService;
import org.jupnp.support.lastchange.LastChangeAwareServiceManager;
import org.jupnp.support.renderingcontrol.lastchange.RenderingControlLastChangeParser;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

/** Foreground service hosting the UPnP stack and the MediaRenderer device. */
public class DlnaRendererService extends AndroidUpnpServiceImpl {

    static final String EXTRA_NAME = "name";

    private static final String TAG = "DlnaRendererService";
    private static final String CHANNEL = "dlna";
    private static final int NOTIFICATION_ID = 0x444c4e41;

    private UDN udn;
    private String name;
    private AvTransport avTransport;
    private boolean running;

    @Override
    protected UpnpServiceConfiguration createConfiguration() {
        return new DlnaServiceConfiguration();
    }

    @Override
    public void onCreate() {
        super.onCreate();
        startForeground();
        udn = new UDN(UUID.nameUUIDFromBytes((Build.MANUFACTURER + Build.MODEL + getPackageName() + "-MediaRenderer").getBytes(StandardCharsets.UTF_8)));
        try {
            upnpService.startup();
            running = true;
        } catch (RuntimeException e) {
            // A failed UPnP stack must not take the app down: log it and give up on DLNA.
            Log.e(TAG, "UPnP startup failed", e);
            stopSelf();
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (!running) return START_NOT_STICKY;
        String requested = intent != null ? intent.getStringExtra(EXTRA_NAME) : null;
        if (requested != null && !requested.equals(name)) registerLocalDevice(requested);
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        if (avTransport != null) {
            avTransport.reset();
            Dlna.get().detach(avTransport);
        }
        avTransport = null;
        stopForeground(true);
        // The parent shuts the UPnP stack down, which throws when startup never completed.
        if (running) super.onDestroy();
        running = false;
    }

    /** Registers the renderer, replacing the one announced under a previous name. */
    private void registerLocalDevice(String name) {
        if (this.name != null) upnpService.getRegistry().removeDevice(udn);
        if (avTransport != null) Dlna.get().detach(avTransport);
        this.name = name;
        avTransport = new AvTransport();
        RenderingControl renderingControl = new RenderingControl(this);
        DeviceIdentity identity = new DeviceIdentity(udn);
        UDADeviceType type = new UDADeviceType("MediaRenderer", 1);
        DeviceDetails details = new DeviceDetails(name, new ManufacturerDetails(Build.MANUFACTURER), new ModelDetails(Build.MODEL, "DLNA Renderer", "1.0"));
        try {
            LocalDevice device = new LocalDevice(identity, type, details, new LocalService[]{createAvTransport(avTransport), createConnectionManager(), createRenderingControl(renderingControl)});
            upnpService.getRegistry().addDevice(device);
            Dlna.get().attach(avTransport);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @SuppressWarnings("unchecked")
    private static LocalService<AvTransport> createAvTransport(AvTransport impl) {
        LocalService<AvTransport> service = new AnnotationLocalServiceBinder().read(AvTransport.class);
        service.setManager(new LastChangeAwareServiceManager<>(service, new AVTransportLastChangeParser()) {
            @Override
            protected AvTransport createServiceInstance() {
                return impl;
            }
        });
        return service;
    }

    @SuppressWarnings("unchecked")
    private static LocalService<ConnectionManagerService> createConnectionManager() {
        LocalService<ConnectionManagerService> service = new AnnotationLocalServiceBinder().read(ConnectionManagerService.class);
        service.setManager(new DefaultServiceManager<>(service, ConnectionManagerService.class));
        return service;
    }

    @SuppressWarnings("unchecked")
    private static LocalService<RenderingControl> createRenderingControl(RenderingControl impl) {
        LocalService<RenderingControl> service = new AnnotationLocalServiceBinder().read(RenderingControl.class);
        service.setManager(new LastChangeAwareServiceManager<>(service, new RenderingControlLastChangeParser()) {
            @Override
            protected RenderingControl createServiceInstance() {
                return impl;
            }
        });
        return service;
    }

    private void startForeground() {
        try {
            Notification.Builder builder;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationManager manager = getSystemService(NotificationManager.class);
                manager.createNotificationChannel(new NotificationChannel(CHANNEL, "投屏", NotificationManager.IMPORTANCE_MIN));
                builder = new Notification.Builder(this, CHANNEL);
            } else {
                builder = new Notification.Builder(this);
            }
            CharSequence label = getApplicationInfo().loadLabel(getPackageManager());
            Notification notification = builder.setSmallIcon(getApplicationInfo().icon).setContentTitle(label).setContentText("DLNA").setOngoing(true).build();
            startForeground(NOTIFICATION_ID, notification);
        } catch (Exception e) {
            // Not allowed from the background on Android 12+: keep running as a started service.
            e.printStackTrace();
        }
    }
}
