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

// window.__questPerf is true on a Meta Quest (or with ?quest in the address, to try it on a computer).
// It switches the page to a lighter profile: fewer lights, no shadows, no post-processing, plain mirrors.
const Q = 'window.__questPerf';

const EDITS = [
  {
    why: 'enable WebXR on the renderer',
    find: 'renderer.shadowMap.type = THREE.PCFSoftShadowMap;',
    replace: `renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.xr.enabled = true; renderer.xr.setReferenceSpaceType('local-floor'); renderer.xr.setFoveation(1); // [VR]
if (${Q}) renderer.xr.setFramebufferScaleFactor(0.85); // [Quest] 85% VR resolution
const _vrCamW = new THREE.Vector3(); // [VR] camera position in the clinic (in VR the camera sits inside a rig)`,
  },
  {
    why: 'people, speech bubbles and signs use the real head position in VR',
    find: 'tickPeople(playing || !patientMode ? dt : 0, camera.position);',
    replace: 'tickPeople(playing || !patientMode ? dt : 0, renderer.xr.isPresenting ? camera.getWorldPosition(_vrCamW) : camera.position);',
  },
  {
    why: 'smaller speech bubbles in VR (desktop sizes them for a flat screen)',
    find: 'const d = camPos.distanceTo(a.bubble.position), sc = Math.max(1.0, Math.min(2.4, d * 0.3));',
    replace: 'const d = camPos.distanceTo(a.bubble.position), sc = renderer.xr.isPresenting ? Math.max(0.55, Math.min(1.35, d * 0.2)) : Math.max(1.0, Math.min(2.4, d * 0.3));',
  },
  {
    why: '[Quest] render at 1x pixel ratio',
    find: 'renderer.setPixelRatio(Math.min(devicePixelRatio, isTouch ? 1.5 : 1.75));',
    replace: `renderer.setPixelRatio(${Q} ? 1 : Math.min(devicePixelRatio, isTouch ? 1.5 : 1.75));`,
  },
  {
    why: '[Quest] no shadow maps',
    find: 'renderer.shadowMap.enabled = true;',
    replace: `renderer.shadowMap.enabled = !${Q};`,
  },
  {
    why: '[Quest] sun casts no shadow',
    find: 'sun.castShadow = true;',
    replace: `sun.castShadow = !${Q};`,
  },
  {
    why: '[Quest] lighter texture filtering',
    find: 'const ANISO = Math.min(8,',
    replace: `const ANISO = Math.min(${Q} ? 4 : 8,`,
  },
  {
    why: '[Quest] 4 moving room lights instead of 12',
    find: 'const POOL = isTouch ? 6 : 12;',
    replace: `const POOL = ${Q} ? 4 : isTouch ? 6 : 12;`,
  },
  {
    why: '[Quest] brighter ambient light to make up for fewer lamps',
    find: 'const hemi = new THREE.HemisphereLight(0xfff4e6, 0x7a6a55, 0.18);',
    replace: `const hemi = new THREE.HemisphereLight(0xfff4e6, 0x7a6a55, ${Q} ? 0.34 : 0.18);`,
  },
  {
    why: '[Quest] start with post-processing off',
    find: 'let composer, bloom, smaa, ao, grade, quality = isTouch ? 1 : 2;',
    replace: `let composer, bloom, smaa, ao, grade, quality = ${Q} ? 0 : isTouch ? 1 : 2;`,
  },
  {
    why: '[Quest] load the simplified plant and furniture models',
    find: "gltf.load(ASSET_BASE + 'models/' + name",
    replace: `gltf.load(ASSET_BASE + (${Q} ? 'lite/models/' : 'models/') + name`,
  },
  {
    why: '[Quest] load the simplified people',
    find: "L.load(ASSET_BASE + 'people/' + n + '.glb'",
    replace: `L.load(ASSET_BASE + (${Q} ? 'lite/people/' : 'people/') + n + '.glb'`,
  },
  {
    why: '[Quest] merge the 129 soft furniture shadows into one draw call',
    find: '  for (const m of shadowGroup.children) m.scale.set(FS, 1, FS);',
    replace: `  for (const m of shadowGroup.children) m.scale.set(FS, 1, FS);
  if (${Q}) { mergeStatic(shadowGroup, shadowGroup); for (const m of shadowGroup.children) m.renderOrder = 1; } // [Quest]`,
  },
  {
    why: '[Quest] only draw people who are in view',
    find: '    m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true;',
    replace: `    m.frustumCulled = !!${Q}; m.castShadow = true; m.receiveShadow = true;`,
  },
  {
    why: '[Quest] mirrors become a shiny surface (a live mirror redraws the whole clinic)',
    find: '  const ref = new Reflector(geo, {',
    replace: `  const ref = ${Q} ? new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xc9d2d4, metalness: 0.9, roughness: 0.12 })) : new Reflector(geo, {`,
  },
  {
    why: 'drive the loop with setAnimationLoop (requestAnimationFrame stops inside VR), and survive errors',
    find: '  requestAnimationFrame(frame);\n}\nlet last = performance.now();',
    replace: '  renderer.setAnimationLoop((t, f) => { try { frame(t, f); } catch (e) { window.__vrOnError?.(e); try { renderer.render(scene, camera); } catch {} } }); // [VR] an error must not stop drawing (black screen in VR)\n}\nlet last = performance.now();',
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
<script>window.__questPerf = /OculusBrowser|Quest/i.test(navigator.userAgent) || new URLSearchParams(location.search).has('quest');</script>
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

const { buildLiteModels } = await import('./lite-models.mjs');
const lite = await buildLiteModels(ROOT);
if (lite) {
  const k = (n) => `${Math.round(n / 1000)}k`;
  console.log(`✔ Quest models in public/assets/lite/: plants & furniture ${k(lite.plants.before)} → ${k(lite.plants.after)} triangles, `
    + `people ${k(lite.people.before)} → ${k(lite.people.after)} (one of each file).`);
}
console.log(`✔ Built public/index.html with ${EDITS.length} VR and Quest edits, libraries in public/vendor/.`);
console.log('  Try it: npm run dev  →  http://localhost:5174');
