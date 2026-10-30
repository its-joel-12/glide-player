#!/usr/bin/env node
/**
 * Puts the APK signing key into the GitHub repository's secrets, for the "Android APK" workflow
 * (.github/workflows/android-apk.yml).
 *
 *   npm run ci:secrets            sets the 4 secrets with the GitHub CLI (gh), if it's installed and logged in
 *   npm run ci:secrets -- --print prints them instead, to paste in GitHub → Settings → Secrets and variables → Actions
 *
 * Reads credentials.json and the keystore it points to (download them once with
 * `npx eas-cli@latest credentials -p android` → credentials.json → Download). Both stay git-ignored.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const printOnly = process.argv.includes('--print');
const isWin = process.platform === 'win32';

function fail(msg) {
  console.error(`\n${msg}\n`);
  process.exit(1);
}

const credsFile = path.join(root, 'credentials.json');
if (!fs.existsSync(credsFile)) {
  fail(
    'credentials.json not found in the project folder.\n' +
      'Download it once:  npx eas-cli@latest credentials -p android\n' +
      '  → choose the "preview" profile → (if asked) "Set up a new keystore" → "credentials.json: Upload/Download"\n' +
      '  → "Download credentials from EAS to credentials.json". Then run this again.',
  );
}
const k = (JSON.parse(fs.readFileSync(credsFile, 'utf8')).android || {}).keystore || {};
if (!k.keystorePath || !k.keystorePassword || !k.keyAlias) fail('credentials.json has no android.keystore section.');
const store = path.resolve(root, k.keystorePath);
if (!fs.existsSync(store)) fail(`The keystore ${k.keystorePath} (from credentials.json) is missing.`);

const secrets = {
  KEYSTORE_BASE64: fs.readFileSync(store).toString('base64'),
  KEYSTORE_PASSWORD: k.keystorePassword,
  KEY_ALIAS: k.keyAlias,
  KEY_PASSWORD: k.keyPassword || k.keystorePassword,
};

const gh = !printOnly && spawnSync('gh', ['auth', 'status'], { encoding: 'utf8', shell: isWin });
if (printOnly || !gh || gh.status !== 0) {
  if (!printOnly) console.log('GitHub CLI (gh) not found or not logged in, so here are the values to add by hand.\n');
  console.log('GitHub → your repo → Settings → Secrets and variables → Actions → New repository secret:\n');
  for (const [name, value] of Object.entries(secrets)) console.log(`${name}\n${value}\n`);
  console.log('(These are your signing passwords: don’t paste them anywhere else.)');
  process.exit(0);
}

for (const [name, value] of Object.entries(secrets)) {
  const r = spawnSync('gh', ['secret', 'set', name], { cwd: root, input: value, encoding: 'utf8', shell: isWin });
  if (r.status !== 0) fail(`gh secret set ${name} failed:\n${r.stderr || r.stdout}`);
  console.log(`✓ ${name}`);
}
console.log('\nDone. Push to main (or run "Android APK" from the Actions tab) to build the APK.');
