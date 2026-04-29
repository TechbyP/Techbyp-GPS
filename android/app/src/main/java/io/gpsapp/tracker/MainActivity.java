package io.gpsapp.tracker;

import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.WebSettings;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Register custom plugins
        registerPlugin(GpsDeviceManagerPlugin.class);
        registerPlugin(MockLocationDetectorPlugin.class);
        
        super.onCreate(savedInstanceState);

        // Keep the tablet screen awake while the app is open.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        
        // Enable Web Bluetooth API in WebView (for fallback support)
        try {
            WebSettings webSettings = this.bridge.getWebView().getSettings();
            webSettings.setJavaScriptEnabled(true);
            webSettings.setDomStorageEnabled(true);
            webSettings.setDatabaseEnabled(true);
            
            // Enable Bluetooth in WebView (Android 12+)
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
                webSettings.setJavaScriptCanOpenWindowsAutomatically(true);
            }
            
            android.util.Log.d("MainActivity", "WebView settings configured for GPS device support");
        } catch (Exception e) {
            android.util.Log.e("MainActivity", "Failed to configure WebView settings", e);
        }
    }
}
