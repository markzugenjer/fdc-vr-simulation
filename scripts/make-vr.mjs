#!/usr/bin/env node
/**
 * Builds the VR version of the FDC Solo 3D simulation.
 *
 *   reads   original/index.html   (downloaded by `npm run fetch`, never edited)
 *   writes  public/index.html     (the same page + a handful of small VR hooks)
 *           public/vendor/...     (three.js and effect libraries, served locally instead of a CDN)
 *
 * Each edit below looks for an exact piece of the original code. If FDC changes the live site
 * and a piece is no longer found, the build stops and names the edit, so nothing breaks silently.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'original', 'index.html');
const OUT = path.join(ROOT, 'public', 'index.html');

if (!fs.existsSync(SRC)) {
  console.error('✖ original/index.html is missing. Run: npm run fetch');
  process.exit(1);
}
let html = fs.readFileSync(SRC, 'utf8');

const EDITS = [
  {
    why: 'enable WebXR on the renderer',
    find: 'renderer.shadowMap.type = THREE.PCFSoftShadowMap;',
    replace: `renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.xr.enabled = true; renderer.xr.setReferenceSpaceType('local-floor'); renderer.xr.setFoveation(1); // [VR]`,
  },
  {
    why: 'drive the loop with setAnimationLoop (requestAnimationFrame stops inside VR)',
    find: '  requestAnimationFrame(frame);\n}\nlet last = performance.now();',
    replace: '  renderer.setAnimationLoop(frame); // [VR]\n}\nlet last = performance.now();',
  },
  {
    why: 'read the controllers before each simulation step',
    find: '  tick(dt);\n  requestAnimationFrame(frame);\n}',
    replace: '  window.__vrPre?.(dt); // [VR]\n  tick(dt);\n}',
  },
  {
    why: 'move the VR rig after the simulation has placed its camera',
    find: '  updatePool(player.x, player.y, player.z);\n  hudRoom();',
    replace: '  window.__vrSync?.(dt); // [VR]\n  updatePool(player.x, player.y, player.z);\n  hudRoom();',
  },
  {
    why: 'skip post-processing in VR (it cannot render stereo)',
    find: 'else if (composer && quality > 0) {',
    replace: 'else if (composer && quality > 0 && !renderer.xr.isPresenting) {',
  },
  {
    why: 'do not resize the canvas while the headset owns it',
    find: 'function resize() {\n',
    replace: 'function resize() {\n  if (renderer.xr.isPresenting) return; // [VR]\n',
  },
  {
    why: 'no head-bob in VR (it causes motion sickness)',
    find: 'if (ml > 0.05 && player.ground) bob +=',
    replace: 'if (ml > 0.05 && player.ground && !renderer.xr.isPresenting) bob +=',
  },
  {
    why: 'expose what the VR module needs',
    find: 'window.__fdc = { doors,',
    replace: 'window.__fdc = { camera, joy, THREE, get patientMode() { return patientMode; }, get plan() { return plan; }, setPlanXR: v => setPlan(v), doors,',
  },
  {
    why: 'load the VR module',
    find: '\nboot();',
    replace: "\nboot();\n(new URLSearchParams(location.search).has('emulate') ? import('./vr/emulator.js') : Promise.resolve())\n  .then(() => import('./vr/vr.js')).then(m => { window.__vr = m.setupVR(window.__fdc); }).catch(e => console.error('[VR]', e)); // [VR]",
  },
  {
    why: 'app manifest and icons (needed for the Quest app)',
    find: '</head>',
    replace: `<link rel="manifest" href="./manifest.webmanifest"><meta name="theme-color" content="#6f8a3c"><link rel="icon" href="./icons/icon-192.png">
</head>`,
  },
];

let failed = 0;
for (const e of EDITS) {
  const count = html.split(e.find).length - 1;
  if (count !== 1) {
    console.error(`✖ Edit "${e.why}": expected the original code once, found it ${count} times.`);
    failed++;
    continue;
  }
  html = html.replace(e.find, () => e.replace);
}
if (failed) {
  console.error('\nThe live site has changed in a way this build does not know yet. Ask for the VR edits to be updated.');
  process.exit(1);
}

// ---- serve three.js and friends locally instead of from cdn.jsdelivr.net
const NM = path.join(ROOT, 'node_modules');
const VENDOR = path.join(ROOT, 'public', 'vendor');
const need = (p) => {
  if (!fs.existsSync(p)) { console.error(`✖ ${path.relative(ROOT, p)} is missing. Run: npm install`); process.exit(1); }
  return p;
};
fs.rmSync(VENDOR, { recursive: true, force: true });
const copy = (from, to, filter) => fs.cpSync(need(from), path.join(VENDOR, to), { recursive: true, filter });
copy(path.join(NM, 'three', 'build', 'three.module.js'), 'three/build/three.module.js');
// all of three's add-ons except the big optional decoders this page never uses
const SKIP = ['libs/draco', 'libs/basis', 'libs/ammo', 'libs/rhino3dm', 'libs/tween', 'offscreen', 'loaders/ifc'];
copy(path.join(NM, 'three', 'examples', 'jsm'), 'three/examples/jsm', (src) => !SKIP.some((s) => src.includes(path.join('jsm', s))));
copy(path.join(NM, 'postprocessing', 'build', 'index.js'), 'postprocessing/index.js');
copy(path.join(NM, 'n8ao', 'dist', 'N8AO.js'), 'n8ao/N8AO.js');

const importMap = /<script type="importmap">[\s\S]*?<\/script>/;
if (!importMap.test(html)) { console.error('✖ import map not found in the page'); process.exit(1); }
html = html.replace(importMap, `<script type="importmap">
{ "imports": {
  "three": "./vendor/three/build/three.module.js",
  "three/addons/": "./vendor/three/examples/jsm/",
  "three/examples/jsm/": "./vendor/three/examples/jsm/",
  "postprocessing": "./vendor/postprocessing/index.js",
  "n8ao": "./vendor/n8ao/N8AO.js"
} }
</script>`);

fs.writeFileSync(OUT, html);
console.log(`✔ Built public/index.html with ${EDITS.length} VR edits, libraries in public/vendor/.`);
console.log('  Try it: npm run dev  →  http://localhost:5174');
