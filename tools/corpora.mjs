// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  corpora.mjs — published scenes and models the checks run on, fetched at a
 *        pinned revision, verified by hash, and never committed.
 *
 * Hand-made fixtures only exercise what their author thought of; an asset someone
 * else authored for their own engine carries the conventions we did not. Each
 * entry names its source, licence and every file's sha256, so a changed upstream
 * fails loudly instead of quietly testing something else.
 *
 *   node tools/corpora.mjs fetch [id …]     fetch (all by default) into the cache
 *   node tools/corpora.mjs list
 *
 * Cache: `.cache/corpora/<id>/` at the repository root, or `ESTELLA_CORPORA_DIR`.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const KHRONOS_SAMPLES = 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/7d4ba189827916452eeadc82d4b712dbc6280a6f';

export const CORPORA = {
  'khronos-water-bottle': {
    what: 'Khronos glTF sample: a PBR bottle with base colour, normal, packed occlusion/roughness/metal and emissive maps',
    license: 'CC0-1.0',
    source: 'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/7d4ba189827916452eeadc82d4b712dbc6280a6f/Models/WaterBottle',
    base: `${KHRONOS_SAMPLES}/Models/WaterBottle/glTF`,
    files: {
      'WaterBottle.gltf': '0596f4e61dc781439d254fdfb5e3462daf1762c18715e3e3ac13001aa8f3f547',
      'WaterBottle.bin': 'e4921f2d0c0a03cf65286bd195f3688d4f99d7b6a58f25935e70d516d744156e',
      'WaterBottle_baseColor.png': '62d0ad9b4e2c75e9bc7d67644a50d697563000ffa586d2e185ea38f5000e0a63',
      'WaterBottle_emissive.png': 'e9b03ea395b0182917f876befda2d31639ce46058c832dd64e5ad02cde5bddb9',
      'WaterBottle_normal.png': '284883ce27cc22351557616bad247ef88de4ad42c7a74b493205c92dbd23e536',
      'WaterBottle_occlusionRoughnessMetallic.png': '10cc809d9762e8c671f1ae73618dd5fdd07792d2c6ec9c4691cdb991617c9369',
    },
  },
};

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Where a corpus lives once fetched. */
export function corpusDir(id) {
  const base = process.env.ESTELLA_CORPORA_DIR || path.join(ROOT, '.cache', 'corpora');
  return path.join(base, id);
}

async function fetchVerified(url, want) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const got = sha256(bytes);
      if (got !== want) throw new Error(`sha256 ${got}, expected ${want} — the upstream file changed`);
      return bytes;
    } catch (e) {
      last = e;
    }
  }
  throw new Error(`${url}: ${last?.message ?? last}`);
}

/** The corpus's directory, every file present and matching its hash; fetches what is not. */
export async function corpus(id) {
  const entry = CORPORA[id];
  if (!entry) throw new Error(`no corpus "${id}" (have: ${Object.keys(CORPORA).join(', ')})`);
  const dir = corpusDir(id);
  await mkdir(dir, { recursive: true });
  for (const [file, want] of Object.entries(entry.files)) {
    const abs = path.join(dir, file);
    if (existsSync(abs) && sha256(await readFile(abs)) === want) continue;
    const bytes = await fetchVerified(`${entry.base}/${file}`, want);
    await writeFile(`${abs}.part`, bytes);
    await rename(`${abs}.part`, abs);
  }
  return dir;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd = 'list', ...ids] = process.argv.slice(2);
  if (cmd === 'list') {
    for (const [id, e] of Object.entries(CORPORA)) console.log(`${id}  ${e.license}  ${e.what}\n  ${e.source}`);
  } else if (cmd === 'fetch') {
    for (const id of ids.length ? ids : Object.keys(CORPORA)) console.log(`${id}: ${await corpus(id)}`);
  } else {
    console.error('usage: node tools/corpora.mjs fetch [id …] | list');
    process.exit(2);
  }
}
