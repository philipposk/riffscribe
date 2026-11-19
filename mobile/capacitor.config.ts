import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Live-URL shell. www/ is only the offline fallback; the WebView loads the
 * deployed Next app. Do not point webDir at a Next build.
 */
const config: CapacitorConfig = {
  appId: "gr.sixseven.riffscribe",
  appName: "Riffscribe",
  webDir: "www",
  backgroundColor: "#08090c",
  server: {
    url: "https://riffscribe.6x7.gr",
    cleartext: false,
  },
  ios: {
    backgroundColor: "#08090c",
    limitsNavigationsToAppBoundDomains: false,
  },
  android: {
    backgroundColor: "#08090c",
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 1200,
      backgroundColor: "#08090c",
      showSpinner: false,
      androidScaleType: "CENTER_CROP",
      splashFullScreen: true,
      splashImmersive: false,
    },
  },
};

export default config;
