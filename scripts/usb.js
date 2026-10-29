#!/usr/bin/env node
/**
 * Start Expo for an Android phone connected by USB cable.
 *
 *   npm run usb
 *
 * 1. Finds adb (ANDROID_HOME, the default Android Studio SDK, or winget Platform-Tools)
 * 2. Forwards the phone's port 8081 to this laptop over the cable (adb reverse)
 * 3. Starts Expo with 127.0.0.1 URLs, so the phone uses the cable instead of Wi-Fi
 */
const { spawnSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = process.env.RCT_METRO_PORT || '8081';
const isWin = process.platform === 'win32';
const adbExe = isWin ? 'adb.exe' : 'adb';

function findSdkRoot() {
  const candidates = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT].filter(Boolean);
  const local = process.env.LOCALAPPDATA;
  if (local) {
    candidates.push(path.join(local, 'Android', 'Sdk'));
    const winget = path.join(local, 'Microsoft', 'WinGet', 'Packages');
    if (fs.existsSync(winget)) {
      for (const dir of fs.readdirSync(winget)) {
        if (dir.startsWith('Google.PlatformTools')) candidates.push(path.join(winget, dir));
      }
    }
  }
  return candidates.find((c) => fs.existsSync(path.join(c, 'platform-tools', adbExe)));
}

const sdk = findSdkRoot();
const adb = sdk ? path.join(sdk, 'platform-tools', adbExe) : 'adb';
const env = { ...process.env, REACT_NATIVE_PACKAGER_HOSTNAME: '127.0.0.1' };
if (sdk) env.ANDROID_HOME = sdk; // silences Expo's "Failed to resolve the Android SDK path"

const list = spawnSync(adb, ['devices'], { encoding: 'utf8' });
if (list.error) {
  console.error('✗ Could not run adb. Install Android Platform-Tools: winget install Google.PlatformTools');
  process.exit(1);
}
const rows = list.stdout.split(/\r?\n/).slice(1).map((l) => l.trim().split(/\s+/)).filter((r) => r[0]);
const ready = rows.filter((r) => r[1] === 'device');
if (!ready.length) {
  if (rows.some((r) => r[1] === 'unauthorized')) {
    console.error('✗ Phone is connected but not authorized. Unlock it and tap "Allow" on the USB debugging prompt.');
  } else {
    console.error('✗ No phone found. Check the cable (must support data) and that USB debugging is on.');
  }
  process.exit(1);
}

const rev = spawnSync(adb, ['reverse', `tcp:${PORT}`, `tcp:${PORT}`], { stdio: 'inherit' });
if (rev.status !== 0) {
  console.error('✗ adb reverse failed.');
  process.exit(1);
}
console.log(`✓ ${ready.map((r) => r[0]).join(', ')} connected, port ${PORT} forwarded over USB`);
console.log(`  Press "a" to open the app on the phone, or enter exp://127.0.0.1:${PORT} in Expo Go.\n`);

const child = spawn('npx', ['expo', 'start', ...process.argv.slice(2)], { stdio: 'inherit', env, shell: isWin });
child.on('exit', (code) => process.exit(code ?? 0));
