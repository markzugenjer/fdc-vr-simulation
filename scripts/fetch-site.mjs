#!/usr/bin/env node
/**
 * Downloads the FDC Solo 3D simulation from https://simulation.fdc.co.id/
 *   original/index.html   the page exactly as published (never edited; the VR build reads it)
 *   public/assets/...     every 3D model, character and texture it loads
 *
 * Run again any time to pick up changes from the live site:  npm run fetch
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://simulation.fdc.co.id/';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Every asset the live page loads (captured from the browser on 2026-11-05).
// .gltf files are also scanned for the .bin and texture files they reference.
const ASSETS = `
models/calathea_orbifolia_01/calathea_orbifolia_01.gltf
models/calathea_orbifolia_01/textures/calathea_orbifolia_01_arm_1k.jpg
models/calathea_orbifolia_01/textures/calathea_orbifolia_01_diff_1k.jpg
models/calathea_orbifolia_01/textures/calathea_orbifolia_01_nor_gl_1k.jpg
models/modern_arm_chair_01/modern_arm_chair_01.bin
models/modern_arm_chair_01/modern_arm_chair_01.gltf
models/modern_arm_chair_01/textures/modern_arm_chair_01_legs_arm_1k.jpg
models/modern_arm_chair_01/textures/modern_arm_chair_01_legs_diff_1k.jpg
models/modern_arm_chair_01/textures/modern_arm_chair_01_legs_nor_gl_1k.jpg
models/modern_arm_chair_01/textures/modern_arm_chair_01_pillow_arm_1k.jpg
models/modern_arm_chair_01/textures/modern_arm_chair_01_pillow_diff_1k.jpg
models/modern_arm_chair_01/textures/modern_arm_chair_01_pillow_nor_gl_1k.jpg
models/pachira_aquatica_01/pachira_aquatica_01.bin
models/pachira_aquatica_01/pachira_aquatica_01.gltf
models/pachira_aquatica_01/textures/pachira_aquatica_01_bark_arm_1k.jpg
models/pachira_aquatica_01/textures/pachira_aquatica_01_bark_diff_1k.jpg
models/pachira_aquatica_01/textures/pachira_aquatica_01_bark_nor_gl_1k.jpg
models/pachira_aquatica_01/textures/pachira_aquatica_01_leaves_arm_1k.jpg
models/pachira_aquatica_01/textures/pachira_aquatica_01_leaves_diff_1k.jpg
models/pachira_aquatica_01/textures/pachira_aquatica_01_leaves_nor_gl_1k.jpg
models/potted_plant_01/potted_plant_01.gltf
models/potted_plant_01/textures/potted_plant_01_leaves_diff_1k.jpg
models/potted_plant_01/textures/potted_plant_01_leaves_nor_gl_1k.jpg
models/potted_plant_01/textures/potted_plant_01_leaves_rough_1k.jpg
models/potted_plant_01/textures/potted_plant_01_pot_diff_1k.jpg
models/potted_plant_01/textures/potted_plant_01_pot_nor_gl_1k.jpg
models/potted_plant_01/textures/potted_plant_01_pot_rough_1k.jpg
models/potted_plant_02/potted_plant_02.bin
models/potted_plant_02/potted_plant_02.gltf
models/potted_plant_02/textures/potted_plant_02_leaves_diff_1k.jpg
models/potted_plant_02/textures/potted_plant_02_leaves_nor_gl_1k.jpg
models/potted_plant_02/textures/potted_plant_02_leaves_rough_1k.jpg
models/potted_plant_02/textures/potted_plant_02_pot_diff_1k.jpg
models/potted_plant_02/textures/potted_plant_02_pot_nor_gl_1k.jpg
models/potted_plant_02/textures/potted_plant_02_pot_rough_1k.jpg
people/Ca.glb
people/Doctor.glb
people/Hoc.glb
people/PaPria.glb
people/PaWanita.glb
people/PatientF.glb
people/PatientF2.glb
people/PatientM.glb
people/PatientM2.glb
people/anims.glb
solo/grid.json
solo/solo.glb
tex/asphalt_02/diff.jpg
tex/asphalt_02/nor.jpg
tex/asphalt_02/rough.jpg
tex/brown_leather/diff.jpg
tex/brown_leather/nor.jpg
tex/brown_leather/rough.jpg
tex/concrete_floor_02/diff.jpg
tex/concrete_floor_02/nor.jpg
tex/concrete_floor_02/rough.jpg
tex/marble_01/diff.jpg
tex/marble_01/nor.jpg
tex/marble_01/rough.jpg
tex/oak_veneer_01/diff.jpg
tex/oak_veneer_01/nor.jpg
tex/oak_veneer_01/rough.jpg
tex/patterned_paving_02/diff.jpg
tex/patterned_paving_02/nor.jpg
tex/patterned_paving_02/rough.jpg
tex/rough_linen/diff.jpg
tex/rough_linen/nor.jpg
tex/rough_linen/rough.jpg
tex/velour_velvet/diff.jpg
tex/velour_velvet/nor.jpg
tex/velour_velvet/rough.jpg
tex/walnut_veneer/diff.jpg
tex/walnut_veneer/nor.jpg
tex/walnut_veneer/rough.jpg
tex/white_plaster_02/diff.jpg
tex/white_plaster_02/nor.jpg
tex/white_plaster_02/rough.jpg
tex/white_stucco/diff.jpg
tex/white_stucco/nor.jpg
tex/white_stucco/rough.jpg
tex/wood_floor_deck/diff.jpg
tex/wood_floor_deck/nor.jpg
tex/wood_floor_deck/rough.jpg
`.trim().split('\n');

const mb = (n) => (n / 1048576).toFixed(1) + ' MB';

async function download(url, dest) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buf);
      return buf;
    } catch (err) {
      if (attempt === 3) throw new Error(`${url}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

async function main() {
  console.log('Downloading the page…');
  const html = await download(BASE, path.join(ROOT, 'original', 'index.html'));
  console.log(`  original/index.html (${mb(html.length)})`);

  const queue = [...ASSETS];
  const seen = new Set(queue);
  const failed = [];
  let total = html.length;
  let done = 0;

  const worker = async () => {
    while (queue.length) {
      const rel = queue.shift();
      try {
        const buf = await download(BASE + 'assets/' + rel.split('/').map(encodeURIComponent).join('/'), path.join(ROOT, 'public', 'assets', rel));
        total += buf.length;
        done++;
        process.stdout.write(`\r  ${done} files, ${mb(total)}   `);
        if (rel.endsWith('.gltf')) {
          const json = JSON.parse(buf.toString('utf8'));
          const dir = path.posix.dirname(rel);
          for (const item of [...(json.buffers || []), ...(json.images || [])]) {
            if (!item.uri || item.uri.startsWith('data:')) continue;
            const dep = path.posix.normalize(path.posix.join(dir, decodeURIComponent(item.uri)));
            if (!seen.has(dep)) { seen.add(dep); queue.push(dep); }
          }
        }
      } catch (err) {
        failed.push(err.message);
      }
    }
  };
  console.log('Downloading assets…');
  await Promise.all(Array.from({ length: 6 }, worker));
  console.log(`\n\n✔ ${done} assets + page, ${mb(total)} in total.`);
  if (failed.length) {
    console.log(`\n✖ ${failed.length} failed:\n  ` + failed.join('\n  '));
    process.exitCode = 1;
  } else {
    console.log('Next: npm run build   (creates the VR version in public/index.html)');
  }
}

main();
