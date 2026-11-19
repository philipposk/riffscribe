/**
 * Apply microphone, background-audio, and the Google return scheme after
 * `cap add`. Safe to re-run. If ios/ or android/ are missing (no Xcode or
 * Android SDK on this machine), print that and exit 0 — the snippets below
 * are what the generated projects need.
 *
 * This does not capture other apps' audio. UIBackgroundModes audio only asks
 * the OS to keep this app's own playback alive.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const iconPng = join(root, "resources", "icon-1024.png");
const splashPng = join(root, "resources", "splash.png");

const IOS_PLIST_KEYS = `
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
	</array>`;

const ANDROID_AUTH_FILTER = `
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="gr.sixseven.riffscribe" android:host="auth" android:pathPrefix="/callback" />
            </intent-filter>`;

function plistPath() {
  for (const rel of ["ios/App/App/Info.plist", "ios/App/Info.plist"]) {
    const abs = join(root, rel);
    if (existsSync(abs)) return abs;
  }
  return null;
}

function patchPlist(file) {
  let xml = readFileSync(file, "utf8");
  const missing = [];
  if (!xml.includes("NSMicrophoneUsageDescription")) missing.push("mic");
  if (!xml.includes("<string>audio</string>")) missing.push("background");
  if (!xml.includes("gr.sixseven.riffscribe")) missing.push("scheme");
  if (missing.length === 0) {
    console.log(`ios plist already configured: ${file}`);
    return;
  }
  if (!xml.includes("</dict>")) throw new Error(`unrecognised Info.plist: ${file}`);
  const last = xml.lastIndexOf("</dict>");
  xml = `${xml.slice(0, last)}${IOS_PLIST_KEYS}\n${xml.slice(last)}`;
  writeFileSync(file, xml);
  console.log(`patched ios plist (${missing.join(", ")}): ${file}`);
}

function patchManifest(file) {
  let xml = readFileSync(file, "utf8");
  for (const perm of ["android.permission.INTERNET", "android.permission.RECORD_AUDIO"]) {
    if (xml.includes(perm)) continue;
    const open = xml.match(/<manifest\b[^>]*>/s);
    if (!open) throw new Error(`unrecognised AndroidManifest: ${file}`);
    const at = open.index + open[0].length;
    xml = `${xml.slice(0, at)}\n    <uses-permission android:name="${perm}" />${xml.slice(at)}`;
    console.log(`added ${perm}`);
  }
  if (xml.includes('android:usesCleartextTraffic="true"')) {
    xml = xml.replace(/android:usesCleartextTraffic="true"/, 'android:usesCleartextTraffic="false"');
  } else if (!xml.includes("usesCleartextTraffic")) {
    xml = xml.replace(/<application\b/, '<application\n        android:usesCleartextTraffic="false"');
  }
  if (!xml.includes("gr.sixseven.riffscribe")) {
    const launcher = xml.indexOf("android.intent.category.LAUNCHER");
    if (launcher < 0) throw new Error("AndroidManifest has no launcher activity");
    const closeFilter = xml.indexOf("</intent-filter>", launcher);
    const closeActivity = xml.indexOf("</activity>", closeFilter);
    if (closeActivity < 0) throw new Error("AndroidManifest launcher activity is missing </activity>");
    xml = `${xml.slice(0, closeActivity)}${ANDROID_AUTH_FILTER}\n        ${xml.slice(closeActivity)}`;
    console.log("added auth scheme intent-filter");
  }
  writeFileSync(file, xml);
  console.log(`patched android manifest: ${file}`);
}

function sipsResize(src, width, height, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  execFileSync("sips", ["-z", String(height), String(width), src, "--out", dest], { stdio: "ignore" });
}

function installIcons() {
  if (!existsSync(iconPng)) {
    console.log("no resources/icon-1024.png — skip icon copy");
    return;
  }
  const appIcon = join(root, "ios/App/App/Assets.xcassets/AppIcon.appiconset");
  if (existsSync(appIcon)) {
    const contentsPath = join(appIcon, "Contents.json");
    let destName = "AppIcon-512@2x.png";
    if (existsSync(contentsPath)) {
      const contents = JSON.parse(readFileSync(contentsPath, "utf8"));
      const images = Array.isArray(contents.images) ? contents.images : [];
      const slot = images.find((image) => image.size === "1024x1024" || (image.idiom === "universal" && image.platform === "ios"));
      if (slot) {
        destName = slot.filename || destName;
        slot.filename = destName;
        contents.images = images;
        writeFileSync(contentsPath, `${JSON.stringify(contents, null, 2)}\n`);
      }
    }
    const dest = join(appIcon, destName);
    sipsResize(iconPng, 1024, 1024, dest);
    console.log(`installed ios icon: ${dest}`);
  }

  const res = join(root, "android/app/src/main/res");
  if (existsSync(res)) {
    const densities = [
      ["mipmap-mdpi", 48],
      ["mipmap-hdpi", 72],
      ["mipmap-xhdpi", 96],
      ["mipmap-xxhdpi", 144],
      ["mipmap-xxxhdpi", 192],
    ];
    for (const [dir, size] of densities) {
      const folder = join(res, dir);
      mkdirSync(folder, { recursive: true });
      for (const name of ["ic_launcher.png", "ic_launcher_round.png", "ic_launcher_foreground.png"]) {
        sipsResize(iconPng, size, size, join(folder, name));
      }
    }
    const bg = join(res, "values/ic_launcher_background.xml");
    if (existsSync(bg)) {
      const xml = readFileSync(bg, "utf8").replace(
        /<color name="ic_launcher_background">[^<]*<\/color>/,
        '<color name="ic_launcher_background">#08090c</color>',
      );
      writeFileSync(bg, xml);
    }
    console.log("installed android launcher icons");
  }

  if (!existsSync(splashPng)) return;
  const splashSet = join(root, "ios/App/App/Assets.xcassets/Splash.imageset");
  if (existsSync(splashSet)) {
    const contentsPath = join(splashSet, "Contents.json");
    const names = existsSync(contentsPath)
      ? (JSON.parse(readFileSync(contentsPath, "utf8")).images ?? []).map((image) => image.filename).filter(Boolean)
      : readdirSync(splashSet).filter((name) => name.endsWith(".png"));
    for (const name of names) sipsResize(splashPng, 2732, 2732, join(splashSet, name));
    console.log("installed ios splash");
  }
  const drawable = join(res, "drawable");
  if (existsSync(res)) {
    mkdirSync(drawable, { recursive: true });
    sipsResize(splashPng, 1920, 1920, join(drawable, "splash.png"));
    console.log("installed android splash");
  }
}

const plist = plistPath();
const manifest = join(root, "android/app/src/main/AndroidManifest.xml");
let pending = false;

if (plist) patchPlist(plist);
else {
  pending = true;
  console.log("ios/ is not generated. After Xcode is available:");
  console.log("  npm run add:ios && npm run native-config");
}

if (existsSync(manifest)) patchManifest(manifest);
else {
  pending = true;
  console.log("android/ is not generated. After the Android SDK is available:");
  console.log("  npm run add:android && npm run native-config");
}

try {
  installIcons();
} catch (e) {
  console.warn(`icon copy skipped: ${e instanceof Error ? e.message : e}`);
}

if (pending) {
  console.log("\nSnippets this script writes once the native projects exist:");
  console.log("--- ios Info.plist ---");
  console.log(IOS_PLIST_KEYS.trim());
  console.log("--- android manifest (inside the launcher activity, plus uses-permission) ---");
  console.log('    <uses-permission android:name="android.permission.INTERNET" />');
  console.log('    <uses-permission android:name="android.permission.RECORD_AUDIO" />');
  console.log(ANDROID_AUTH_FILTER.trim());
}
