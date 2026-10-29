#!/usr/bin/env node
/**
 * Build the Android APK on this laptop (no EAS queue).
 *
 *   npm run build:apk:local              -> builds/glide-<version>-<date>.apk
 *   npm run build:apk:local -- --install also installs it on the phone connected by USB
 *   npm run build:apk:local -- --clean   starts from scratch (deletes android/ and native build caches)
 *   npm run build:apk:local -- --force   skip the Windows long-path check
 *
 * Needs Android Studio's SDK and Java (found automatically in their default Windows folders,
 * or set ANDROID_HOME / JAVA_HOME). Signs with the same key as your EAS builds when
 * credentials.json is present (download it once: npx eas-cli@latest credentials -p android →
 * credentials.json → Download), so it installs over EAS builds.
 * credentials.json and the keystore are git-ignored.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const isWin = process.platform === 'win32';
const args = process.argv.slice(2);
const install = args.includes('--install');
const clean = args.includes('--clean');
const force = args.includes('--force');

class BuildError extends Error {}
function fail(msg) {
  throw new BuildError(msg);
}
function run(cmd, cmdArgs, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, { stdio: 'inherit', shell: isWin, ...opts });
  if (r.status !== 0) fail(`${cmd} ${cmdArgs.join(' ')} failed (exit ${r.status}).`);
}
const exists = (p) => !!p && fs.existsSync(p);
// Windows can briefly hold files open (a Gradle daemon, antivirus): retry, then carry on.
let skipped = 0;
const rmrf = (p) => {
  try {
    fs.rmSync(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  } catch (err) {
    if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(err.code)) throw err;
    skipped++;
  }
};

const cmpVer = (a, b) => {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
};
const goodCmake = (v) => cmpVer(v, '3.30.0') >= 0 && cmpVer(v, '4.0.0') < 0;

/*
 * Windows: React Native's C++ build creates very long paths inside node_modules. The CMake 3.22
 * that Gradle picks by default ships an old ninja that can't handle paths over 260 characters
 * ("ninja: manifest 'build.ninja' still dirty after 100 tries"). Newer CMake (3.30+, ninja 1.12)
 * can, once Windows long paths are switched on.
 */
function pickCmake(sdk, env) {
  const dir = path.join(sdk, 'cmake');
  const installed = (exists(dir) ? fs.readdirSync(dir) : []).filter((v) => /^\d+\.\d+\.\d+$/.test(v) && goodCmake(v)).sort(cmpVer);
  if (installed.length) return installed[installed.length - 1];
  const sm = path.join(sdk, 'cmdline-tools', 'latest', 'bin', isWin ? 'sdkmanager.bat' : 'sdkmanager');
  if (!exists(sm)) fail('CMake 3.30+ is needed. Install it in Android Studio → SDK Manager → SDK Tools → CMake (tick "Show Package Details").');
  // `sdkmanager --list` output is large; give it room, and fall back to known versions if parsing finds none.
  const list = spawnSync(sm, ['--list'], { encoding: 'utf8', env, shell: isWin, maxBuffer: 64 * 1024 * 1024 });
  const listed = [...new Set([...`${list.stdout || ''}${list.stderr || ''}`.matchAll(/cmake;(\d+\.\d+\.\d+)/g)].map((m) => m[1]))]
    .filter(goodCmake)
    .sort(cmpVer)
    .reverse();
  const candidates = listed.length ? listed : ['3.31.6', '3.31.5', '3.31.4', '3.31.1', '3.31.0', '3.30.5', '3.30.4', '3.30.3'];
  for (const v of candidates) {
    console.log(`Installing:  CMake ${v} (one time)`);
    const r = spawnSync(sm, ['--install', `cmake;${v}`], { env, shell: isWin, input: 'y\ny\ny\n', stdio: ['pipe', 'inherit', 'inherit'] });
    if (r.status === 0 && exists(path.join(dir, v, 'bin'))) return v;
  }
  fail(
    'Couldn’t install CMake 3.30+ automatically.\n' +
      '  Install it in Android Studio → More Actions → SDK Manager → SDK Tools tab → tick "Show Package Details"\n' +
      '  (bottom right) → under CMake tick the newest 3.31.x → Apply. Then run this again.',
  );
}

function longPathsEnabled() {
  const r = spawnSync('reg', ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem', '/v', 'LongPathsEnabled'], { encoding: 'utf8', shell: true });
  return /LongPathsEnabled\s+REG_DWORD\s+0x1\b/.test(r.stdout || '');
}

function main() {

// 1. Find the Android SDK and Java.
const local = process.env.LOCALAPPDATA || '';
const sdk = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, local && path.join(local, 'Android', 'Sdk'), path.join(require('os').homedir(), 'Android', 'Sdk')]
  .find((p) => exists(p) && exists(path.join(p, 'platforms')));
if (!sdk) fail('Android SDK not found. Open Android Studio → More Actions → SDK Manager and install an Android SDK Platform, or set ANDROID_HOME.');
// Gradle needs Java 17 or newer. Prefer Android Studio's own Java; skip older ones (e.g. a JAVA_HOME pointing at Java 8).
const javaMajor = (home) => {
  const r = spawnSync(path.join(home, 'bin', isWin ? 'java.exe' : 'java'), ['-version'], { encoding: 'utf8' });
  const m = /version "(\d+)(?:\.(\d+))?/.exec(`${r.stderr || ''}${r.stdout || ''}`);
  if (!m) return 0;
  return m[1] === '1' ? Number(m[2]) : Number(m[1]); // "1.8.0" -> 8, "21.0.3" -> 21
};
const javaCandidates = [
  'C:\\Program Files\\Android\\Android Studio\\jbr',
  '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
  process.env.JAVA_HOME,
].filter((p) => exists(p) && exists(path.join(p, 'bin', isWin ? 'java.exe' : 'java')));
const java = javaCandidates.find((p) => javaMajor(p) >= 17);
if (!java) {
  fail(
    `Java 17 or newer not found${javaCandidates.length ? ` (found: ${javaCandidates.map((p) => `${p} = Java ${javaMajor(p)}`).join(', ')})` : ''}.\n` +
      '  Android Studio includes one in "C:\\Program Files\\Android\\Android Studio\\jbr".',
  );
}
console.log(`Android SDK: ${sdk}\nJava:        ${java} (Java ${javaMajor(java)})`);

// 2. Signing key from EAS (optional).
const env = { ...process.env, ANDROID_HOME: sdk, JAVA_HOME: java, PATH: `${path.join(java, 'bin')}${path.delimiter}${process.env.PATH}` };
const credsFile = path.join(root, 'credentials.json');
let signed = false;
if (exists(credsFile)) {
  const k = JSON.parse(fs.readFileSync(credsFile, 'utf8')).android?.keystore;
  if (!k?.keystorePath) fail('credentials.json has no android.keystore section.');
  const store = path.resolve(root, k.keystorePath);
  if (!exists(store)) fail(`Keystore not found: ${store}`);
  // Passed as Gradle properties through the environment, so they never appear in a command line.
  Object.assign(env, {
    ORG_GRADLE_PROJECT_GLIDE_STORE_FILE: store,
    ORG_GRADLE_PROJECT_GLIDE_STORE_PASSWORD: k.keystorePassword,
    ORG_GRADLE_PROJECT_GLIDE_KEY_ALIAS: k.keyAlias,
    ORG_GRADLE_PROJECT_GLIDE_KEY_PASSWORD: k.keyPassword,
  });
  signed = true;
  console.log('Signing:     your EAS key (credentials.json)');
} else {
  console.log(
    'Signing:     debug key (no credentials.json)\n' +
      '             It won’t install over EAS builds (different signing key).\n' +
      '             Fix: npx eas-cli@latest credentials -p android → credentials.json → Download credentials from EAS',
  );
}

// 3. Windows: a CMake/ninja that copes with long paths.
let cmakeVersion = null;
if (isWin) {
  // Short project folders (e.g. C:\dev\glide) stay under the limit without the setting.
  const SHORT_ENOUGH = 25;
  if (root.length > SHORT_ENOUGH && !longPathsEnabled() && !force) {
    fail(
      `This folder's path is long (${root.length} characters) and Windows long paths are off, so React Native's\n` +
        '  C++ build will fail partway. Either:\n\n' +
        `  A) Move or clone the project to a short folder (up to ${SHORT_ENOUGH} characters), e.g. C:\\dev\\glide\n` +
        '     (no admin rights needed), or\n' +
        '  B) Turn on long paths once, in PowerShell run as Administrator:\n' +
        '     New-ItemProperty -Path "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\FileSystem" -Name LongPathsEnabled -Value 1 -PropertyType DWORD -Force\n\n' +
        '  Or use the cloud build, which needs neither: npm run build:apk\n' +
        '  (Add -- --force to try anyway.)',
    );
  }
  cmakeVersion = pickCmake(sdk, env);
  const ninja = spawnSync(path.join(sdk, 'cmake', cmakeVersion, 'bin', 'ninja.exe'), ['--version'], { encoding: 'utf8' });
  console.log(`CMake:       ${cmakeVersion} (ninja ${(ninja.stdout || '?').trim()})`);
}

// 4. Generate the native project (android/ is git-ignored). Prebuild rewrites package.json scripts; put them back.
// The Gradle daemon from the last build keeps files in android/ and node_modules open (on Windows that
// makes prebuild fail with EBUSY when it replaces android/), so stop it before touching anything.
const oldGradlew = path.join(root, 'android', isWin ? 'gradlew.bat' : 'gradlew');
if (exists(oldGradlew)) {
  spawnSync(oldGradlew, ['--stop'], { cwd: path.join(root, 'android'), env, shell: isWin, stdio: 'ignore' });
}
if (clean) {
  console.log('Cleaning:    android/ and native build caches');
  rmrf(path.join(root, 'android'));
  const nm = path.join(root, 'node_modules');
  const walk = (dir, depth) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (name.startsWith('@') && depth === 0) walk(full, 1);
      else if (exists(path.join(full, 'android'))) {
        rmrf(path.join(full, 'android', '.cxx'));
        rmrf(path.join(full, 'android', 'build'));
      }
    }
  };
  walk(nm, 0);
  if (skipped) console.log(`             (${skipped} folder(s) were in use and kept; the build refreshes them)`);
}
const buildRoot = root;
const pkgPath = path.join(root, 'package.json');
const pkgBefore = fs.readFileSync(pkgPath, 'utf8');
try {
  const r = spawnSync('npx', ['expo', 'prebuild', '--platform', 'android', '--no-install'], { cwd: buildRoot, env, stdio: 'inherit', shell: isWin });
  if (r.status !== 0) {
    fail(
      'npx expo prebuild --platform android --no-install failed.\n' +
        '  If it says EBUSY / "resource busy or locked": a program still has android/ open.\n' +
        '  Close Android Studio (or any terminal / Explorer window inside android/), then run this again.\n' +
        '  Still stuck? Restart the computer, or run this again with -- --clean.',
    );
  }
} finally {
  fs.writeFileSync(pkgPath, pkgBefore);
}

// 5. Make release builds use the EAS key when it's provided.
const gradleFile = path.join(root, 'android', 'app', 'build.gradle');
let gradle = fs.readFileSync(gradleFile, 'utf8');
const MARK = '// glide: local release signing';
if (!gradle.includes(MARK)) {
  gradle = gradle.replace(
    /signingConfigs\s*\{/,
    `signingConfigs {
        ${MARK}
        release {
            if (project.hasProperty('GLIDE_STORE_FILE')) {
                storeFile file(GLIDE_STORE_FILE)
                storePassword GLIDE_STORE_PASSWORD
                keyAlias GLIDE_KEY_ALIAS
                keyPassword GLIDE_KEY_PASSWORD
            }
        }`,
  );
  const patched = gradle.replace(
    /(release\s*\{[^{}]*?)signingConfig signingConfigs\.debug/,
    "$1signingConfig project.hasProperty('GLIDE_STORE_FILE') ? signingConfigs.release : signingConfigs.debug",
  );
  if (patched === gradle || !gradle.includes(MARK)) fail('Couldn’t set up signing in android/app/build.gradle (template changed?).');
  gradle = patched;
  fs.writeFileSync(gradleFile, gradle);
}
const propPath = (p) => p.replace(/\\/g, '\\\\').replace(/:/g, '\\:');
fs.writeFileSync(
  path.join(root, 'android', 'local.properties'),
  `sdk.dir=${propPath(sdk)}\n${cmakeVersion ? `cmake.dir=${propPath(path.join(sdk, 'cmake', cmakeVersion))}\n` : ''}`,
);
// More memory for Gradle (the default 512 MB metaspace runs out on this project).
const propsFile = path.join(root, 'android', 'gradle.properties');
fs.writeFileSync(
  propsFile,
  fs.readFileSync(propsFile, 'utf8').replace(/^org\.gradle\.jvmargs=.*$/m, 'org.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1024m'),
);

// 6. Build (phone CPUs only, which is much faster than all four).
const gradlew = isWin ? 'gradlew.bat' : './gradlew';
const androidDir = path.join(buildRoot, 'android');
try {
  run(gradlew, ['assembleRelease', '-PreactNativeArchitectures=arm64-v8a,armeabi-v7a'], { cwd: androidDir, env });
} catch (err) {
  if (isWin) {
    console.error(
      '\nIf the error mentions "still dirty" or very long paths, move the project to a short folder' +
        ' such as C:\\dev\\glide and run this again with -- --clean.',
    );
  }
  throw err;
}

// 7. Copy the APK somewhere easy to find.
const apk = path.join(root, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
if (!exists(apk)) fail(`Build finished but ${apk} is missing.`);
const version = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8')).expo.version;
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const outDir = path.join(root, 'builds');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `glide-${version}-${stamp}${signed ? '' : '-debugsigned'}.apk`);
fs.copyFileSync(apk, out);
console.log(`\n✔ APK ready: ${path.relative(root, out)} (${(fs.statSync(out).size / 1048576).toFixed(1)} MB)`);

// 8. Optionally install on the phone over USB.
if (install) {
  const adb = [path.join(sdk, 'platform-tools', isWin ? 'adb.exe' : 'adb')].find(exists) || 'adb';
  run(adb, ['install', '-r', out], { env });
  console.log('✔ Installed on the phone');
} else {
  console.log('  Install: copy it to the phone, or run  npm run build:apk:local -- --install  with the phone on USB.');
}
}

try {
  main();
} catch (err) {
  console.error(`\n✖ ${err instanceof BuildError ? err.message : err.stack || err}\n`);
  process.exitCode = 1;
}
