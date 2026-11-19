# Riffscribe — mobile shell (Capacitor)

A thin iOS/Android wrapper around the live site. `capacitor.config.ts` sets
`server.url` to **https://riffscribe.6x7.gr** with cleartext off, so the app is
the deployed Next.js site inside a WebView. The Next server is not bundled.
`www/` is only the offline fallback.

App id: `gr.sixseven.riffscribe`. Display name: Riffscribe.

Audio for the studio stays on the device (Demucs, Basic Pitch, MediaRecorder).
The shell does not claim to capture another app's audio. `UIBackgroundModes`
`audio` only asks the OS to keep **this app's** practice playback going when it
allows it.

## Set up

Needs Node. iOS generation needs macOS, Xcode, and uses Swift Package Manager
(CocoaPods is not required). Android generation needs the Android SDK. This
repo does not install those.

```bash
cd mobile
npm install
npm run add:ios          # npx cap add ios --packagemanager SPM
npm run add:android      # npx cap add android
npm run native-config    # microphone, background audio, URL scheme, icons
npm run sync             # after the native projects exist
```

`ios/` and `android/` are generated and gitignored. Recreate them with the
`add:*` scripts, then run `npm run native-config` again. If `cap add` fails
because Xcode or the Android SDK is missing, the config, icon, and
`scripts/apply-native-config.mjs` are still the source of truth — run that
script after generating the projects on a machine that has the tools. It
prints the same snippets when the projects are absent.

## Run

Do not run `gradle assemble` or `xcodebuild` from this setup. Open the IDE when
you are ready to build:

```bash
npm run open:ios         # Xcode
npm run open:android     # Android Studio
```

## Permissions the script writes

iOS `ios/App/App/Info.plist`:

```xml
<key>NSMicrophoneUsageDescription</key>
<string>Riffscribe uses the microphone to record an overdub and to tune your instrument.</string>
<key>UIBackgroundModes</key>
<array>
  <string>audio</string>
</array>
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLName</key>
    <string>gr.sixseven.riffscribe</string>
    <key>CFBundleURLSchemes</key>
    <array>
      <string>gr.sixseven.riffscribe</string>
    </array>
  </dict>
</array>
```

Android `android/app/src/main/AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
```

and, on the launcher activity, the return scheme:

```xml
<intent-filter>
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="gr.sixseven.riffscribe" android:host="auth" android:pathPrefix="/callback" />
</intent-filter>
```

## Files, icons, splash

The studio loader is a real `<input type="file">` inside the drop label, so a
tap opens the picker. On iOS, WKWebView file inputs open the Files app (and
the photo library when the type allows it). Nothing in the loader is
desktop-only drag-and-drop.

`resources/icon.svg` is the site mark (`public/icon.svg`) as a full-bleed
square, so the OS can mask the corners. `resources/icon-1024.png` and
`resources/splash.png` are rasters of that mark. `npm run native-config`
copies them into the generated projects with `sips` when those folders exist.
Splash and status bar use `#08090c`. The status-bar and splash-screen plugins
are configured from the shell; the website hides the splash once the native
bridge is up.

## Google sign-in

Charts are optional. On the website, Google still redirects this tab to
`{origin}/studio`. Email OTP is the same on the website and in the shell
(`emailRedirectTo` `{origin}/studio`).

In the shell, Google uses `skipBrowserRedirect` and
`redirectTo` **`gr.sixseven.riffscribe://auth/callback`**, then `@capacitor/browser`
opens that URL outside the Capacitor WebView (`window.open(url, "_system")` if
the plugin is missing). `NativeShell` (root layout) listens for `appUrlOpen`
and `getLaunchUrl`, and sends the WebView to `{origin}/studio` with the same
query string — `https://riffscribe.6x7.gr/studio?code=…` when the shell is
pointed at production — so PKCE stored in the WebView can finish. There is no
separate auth callback route; `detectSessionInUrl` on the Supabase client
already completes the exchange on `/studio`.

**Supabase redirect allow-list.** Add this exact URL (Authentication → URL
configuration → Redirect URLs):

```
gr.sixseven.riffscribe://auth/callback
```

Keep `https://riffscribe.6x7.gr/studio` on the list as well. That is the
website Google redirect and the email link. Without the custom scheme on the
allow-list, the phone returns an error instead of a code.

The native branch is a dynamic import and only runs when `Capacitor.isNativePlatform()`
is true. A normal browser has no Capacitor bridge, so Google and email OTP
stay on the existing page redirect.

## Exports

MIDI, MusicXML, alphaTex, wav, and mp3 still download through an anchor on the
website. In the shell, the same `downloadBlob` path writes the file with
`@capacitor/filesystem` and opens the share sheet with `@capacitor/share`
(Save to Files, AirDrop, and the rest). PDF remains the print dialog.

## Phone limits

AI stem split (Demucs) can run out of memory or abort on a phone. When that
happens inside the shell, the studio says this phone could not finish the
split and that the desktop site is the reliable place for it. Instant vocal
removal is not blocked. If the shell is running and `navigator.deviceMemory`
is a number of 4 or less, the AI button warns first and can still continue.
iOS usually does not report `deviceMemory`, so that warning is absent there;
the failure message still covers a crash.

These web changes ship with the next deploy of riffscribe.6x7.gr. Until then
the shell shows the current live site.

## Plugins

`@capacitor/core`, `ios`, `android`, `app`, `splash-screen`, `status-bar`,
`browser`, plus `share` and `filesystem` for the export sheet. The website
depends on the same JS package versions, and only imports them when the
bridge is present.

## Not done here

No store upload, no screenshots, no Xcode or Android SDK install. See
`STORE.md` for the draft listing.
