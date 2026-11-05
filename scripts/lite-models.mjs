/**
 * Makes lighter copies of the furniture and plant models for the Quest.
 *
 *   reads   public/assets/models/<name>/<name>.gltf        (the originals, untouched)
 *   writes  public/assets/lite/models/<name>/<name>.gltf   (same look, far fewer triangles)
 *
 * The Poly Haven plants are photo-scan quality: about 1.5 million triangles across the clinic,
 * 700,000 of them just the soil in the pots. Each mesh is capped at CAP triangles with
 * meshoptimizer, which keeps the outline and texture mapping. The Quest profile loads these.
 */
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplifyPrimitive, prune } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const PLANT_CAP = 3000; // max triangles per plant / furniture mesh on the Quest
const PERSON_CAP = 8000; // max triangles per character mesh (faces stay readable up close)

const triangles = (prim) => {
  const idx = prim.getIndices();
  return (idx ? idx.getCount() : prim.getAttribute('POSITION').getCount()) / 3;
};

async function simplifyFile(io, file, outFile, cap, totals) {
  const doc = await io.read(file);
  await doc.transform(weld({ cleanup: false }));
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const t = triangles(prim);
      totals.before += t;
      if (t > cap) simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio: cap / t, error: 0.02 });
      totals.after += triangles(prim);
    }
  }
  // drop only the replaced vertex data; keep every node so skeletons and animation targets stay intact
  await doc.transform(prune({ propertyTypes: [PropertyType.ACCESSOR], keepAttributes: true }));
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  await io.write(outFile, doc);
}

export async function buildLiteModels(root) {
  const assets = path.join(root, 'public', 'assets');
  const lite = path.join(assets, 'lite');
  if (!fs.existsSync(path.join(assets, 'models'))) return null;
  fs.rmSync(lite, { recursive: true, force: true });
  await MeshoptSimplifier.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const plants = { before: 0, after: 0 };
  const people = { before: 0, after: 0 };

  for (const name of fs.readdirSync(path.join(assets, 'models'))) {
    const file = path.join(assets, 'models', name, `${name}.gltf`);
    if (fs.existsSync(file)) await simplifyFile(io, file, path.join(lite, 'models', name, `${name}.gltf`), PLANT_CAP, plants);
  }
  const peopleDir = path.join(assets, 'people');
  if (fs.existsSync(peopleDir)) {
    for (const f of fs.readdirSync(peopleDir).filter((x) => x.endsWith('.glb'))) {
      const out = path.join(lite, 'people', f);
      if (f === 'anims.glb') { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.copyFileSync(path.join(peopleDir, f), out); continue; }
      await simplifyFile(io, path.join(peopleDir, f), out, PERSON_CAP, people);
    }
  }
  return { plants, people };
}
