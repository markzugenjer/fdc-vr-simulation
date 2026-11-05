#!/usr/bin/env node
/**
 * Package FDC Solo VR as a Meta Quest app (.apk) with Bubblewrap.
 *
 *   npm run apk:setup                  once: Bubblewrap config + adds this app to assetlinks.json
 *   npm run apk:build                  every time you want a new .apk
 *   npm run apk:build -- --version 2   bump the app version (needed to update an installed app)
 *
 * The app opens https://markzugenjer.github.io/fdc-vr-simulation/ full screen, straight into VR.
 *
 * It shares the signing key of the vr-games-1 project (../vr-games-1/android). The Quest checks
 * https://markzugenjer.github.io/.well-known/assetlinks.json, which that project publishes, so
 * setup adds this app's package name there. Push vr-games-1 after setup.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GAMES = path.resolve(ROOT, '..', 'vr-games-1');
const KEYSTORE = path.join(GAMES, 'android', 'fdc-vr.keystore');
const SECRETS = path.join(GAMES, 'android', 'signing.json');
const ASSETLINKS = path.join(GAMES, 'public', '.well-known', 'assetlinks.json');
const ANDROID = path.join(ROOT, 'android');
const CONFIG = path.join(ROOT, 'apk.config.json');
const OUTPUT = path.join(ROOT, 'fdc-solo-vr.apk');

const HOST = 'markzugenjer.github.io';
const BASE = '/fdc-vr-simulation/';
const APP = {
  packageId: 'id.co.fdc.vrsimulation',
  name: 'FDC Solo VR',
  launcherName: 'FDC Solo VR',
  themeColor: '#6f8a3c',
  backgroundColor: '#1f2a17',
};

const fail = (msg) => { console.error(`\n✖ ${msg}\n`); process.exit(1); };
const step = (msg) => console.log(`\n▸ ${msg}`);
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const writeJson = (f, d) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(d, null, 2) + '\n'); };

function keytool() {
  try {
    const { jdkPath } = readJson(path.join(os.homedir(), '.bubblewrap', 'config.json'));
    const exe = process.platform === 'win32' ? 'keytool.exe' : 'keytool';
    for (const p of [path.join(jdkPath, 'bin', exe), path.join(jdkPath, 'Contents', 'Home', 'bin', exe)]) if (fs.existsSync(p)) return p;
  } catch { /* fall through */ }
  return 'keytool';
}
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts });
  if (r.error) fail(`Could not run ${cmd}: ${r.error.message}`);
  if (r.status !== 0) fail(`${cmd} ${args[0] ?? ''} stopped with exit code ${r.status}.`);
}
function secrets() {
  if (!fs.existsSync(KEYSTORE) || !fs.existsSync(SECRETS)) {
    fail(`The shared signing key was not found in ${path.relative(ROOT, path.dirname(KEYSTORE))}/.\n  Run "npm run apk:setup -- ${HOST}" in vr-games-1 first.`);
  }
  return readJson(SECRETS);
}
function fingerprint(s) {
  const out = execFileSync(keytool(), ['-list', '-v', '-keystore', KEYSTORE, '-alias', s.alias, '-storepass', s.storePassword], { encoding: 'utf8' });
  const m = out.match(/SHA256:\s*([0-9A-F]{2}(?::[0-9A-F]{2}){31})/i);
  if (!m) fail('Could not read the SHA-256 fingerprint from the signing key.');
  return m[1].toUpperCase();
}

function twaManifest(version) {
  const origin = `https://${HOST}`;
  return {
    packageId: APP.packageId,
    host: HOST,
    name: APP.name,
    launcherName: APP.launcherName,
    display: 'standalone',
    themeColor: APP.themeColor,
    themeColorDark: '#000000',
    navigationColor: '#000000',
    navigationColorDark: '#000000',
    navigationDividerColor: '#00000000',
    navigationDividerColorDark: '#00000000',
    backgroundColor: APP.backgroundColor,
    enableNotifications: false,
    startUrl: BASE,
    iconUrl: `${origin}${BASE}icons/icon-512.png`,
    maskableIconUrl: `${origin}${BASE}icons/icon-maskable-512.png`,
    splashScreenFadeOutDuration: 300,
    signingKey: { path: KEYSTORE, alias: 'fdcvr' },
    appVersionName: String(version),
    appVersionCode: version,
    appVersion: String(version),
    shortcuts: [],
    generatorApp: 'bubblewrap-cli',
    webManifestUrl: `${origin}${BASE}manifest.webmanifest`,
    fallbackType: 'customtabs',
    features: {},
    alphaDependencies: { enabled: false },
    enableSiteSettingsShortcut: false,
    isChromeOSOnly: false,
    isMetaQuest: true,
    horizonOSAppMode: 'immersive',
    fullScopeUrl: `${origin}${BASE}`,
    orientation: 'default',
    fingerprints: [],
    additionalTrustedOrigins: [],
    retainedBundles: [],
  };
}

function setup() {
  const s = secrets();
  const fp = fingerprint(s);

  step('Digital Asset Links (in vr-games-1)');
  let links = fs.existsSync(ASSETLINKS) ? readJson(ASSETLINKS) : [];
  links = links.filter((l) => l?.target?.package_name !== APP.packageId);
  links.push({
    relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: APP.packageId, sha256_cert_fingerprints: [fp] },
  });
  writeJson(ASSETLINKS, links);
  console.log(`  ${path.relative(ROOT, ASSETLINKS)} now lists: ${links.map((l) => l.target.package_name).join(', ')}`);

  step('Bubblewrap config');
  writeJson(CONFIG, { packageId: APP.packageId, version: 1 });
  writeJson(path.join(ANDROID, 'twa-manifest.json'), twaManifest(1));
  console.log(`  App will open https://${HOST}${BASE}`);

  console.log(`
✔ Setup done. Next:
  1. Publish the updated app links from the games project:
       cd ../vr-games-1 && git add -A && git commit -m "Add FDC Solo VR to assetlinks" && git push && cd -
  2. Make sure https://${HOST}${BASE} opens (GitHub Pages for fdc-vr-simulation).
  3. Run: npm run apk:build
`);
}

async function get(url) {
  try { const r = await fetch(url); return r.ok ? await r.text() : null; } catch { return null; }
}

async function build(argv) {
  if (!fs.existsSync(CONFIG)) fail('Run setup first:  npm run apk:setup');
  const cfg = readJson(CONFIG);
  const s = secrets();
  const vi = argv.indexOf('--version');
  if (vi !== -1) {
    const v = Number(argv[vi + 1]);
    if (!Number.isInteger(v) || v < 1) fail('--version needs a whole number, for example --version 2');
    cfg.version = v;
    writeJson(CONFIG, cfg);
  }

  step(`Checking https://${HOST}${BASE} is live`);
  if (!(await get(`https://${HOST}${BASE}manifest.webmanifest`))) {
    fail(`https://${HOST}${BASE} is not online yet. Turn on GitHub Pages (Source: GitHub Actions) for fdc-vr-simulation and re-run the deploy.`);
  }
  const links = await get(`https://${HOST}/.well-known/assetlinks.json`);
  if (!links || !links.includes(APP.packageId)) {
    fail(`https://${HOST}/.well-known/assetlinks.json does not list ${APP.packageId} yet. Push vr-games-1 after apk:setup and wait for its deploy.`);
  }
  if (!links.toUpperCase().includes(fingerprint(s))) fail('assetlinks.json does not match the signing key. Run apk:setup again and push vr-games-1.');
  console.log('  Site, manifest and assetlinks.json all OK');

  step('Generating the Android project');
  writeJson(path.join(ANDROID, 'twa-manifest.json'), twaManifest(cfg.version));
  run('bubblewrap', ['update', '--skipVersionUpgrade'], { cwd: ANDROID });

  step('Building and signing the APK');
  run('bubblewrap', ['build'], {
    cwd: ANDROID,
    env: { ...process.env, BUBBLEWRAP_KEYSTORE_PASSWORD: s.storePassword, BUBBLEWRAP_KEY_PASSWORD: s.keyPassword },
  });
  const built = path.join(ANDROID, 'app-release-signed.apk');
  if (!fs.existsSync(built)) fail('Bubblewrap finished but android/app-release-signed.apk is missing.');
  fs.copyFileSync(built, OUTPUT);
  console.log(`
✔ Built fdc-solo-vr.apk (version ${cfg.version})
  Install:  adb install -r fdc-solo-vr.apk
  Open it from App Library → Unknown Sources → FDC Solo VR.
`);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'setup') setup();
else if (cmd === 'build') await build(rest);
else fail('Use "setup" or "build".');
