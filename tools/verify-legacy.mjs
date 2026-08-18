// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  verify-legacy.mjs — today's editor still opens what an older one wrote.
 *
 * The golden corpus is always current: every example is re-saved by whichever
 * editor last touched it, so it can only ever answer "does this version open its
 * own files". A person's project is not re-saved by anybody. This takes projects
 * as they were RELEASED — straight out of git, not imitated — opens each in the
 * editor of today, and holds the result against the file that went out.
 *
 * "It opened" is the weak claim. The strong one is that nothing was quietly
 * dropped: the editor's model is documented as lossless over unknown component
 * types, so every entity and every component in the released file must still be
 * there afterwards. A component the editor no longer understands must survive as
 * data, not vanish because nothing renders it.
 *
 *   node tools/verify-legacy.mjs --tier pr
 *   node tools/verify-legacy.mjs --tag v0.20.0 --id platformer
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { legacyAtTier, ROOT } from './goldenProjects.mjs';
import { runTool } from './lib/runTool.mjs';

const argv = process.argv.slice(2);
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const TIER = flag('tier', 'pr');
const DESKTOP = path.join(ROOT, 'desktop');

const cases = flag('tag', '') && flag('id', '')
  ? [{ tag: flag('tag', ''), id: flag('id', ''), tier: TIER }]
  : legacyAtTier(TIER);

/** Check out one example directory as it was at `tag`. */
function extract(tag, id, into) {
  mkdirSync(into, { recursive: true });
  const archive = spawnSync('git', ['archive', tag, `examples/${id}`], {
    cwd: ROOT, encoding: 'buffer', maxBuffer: 1 << 28,
  });
  if (archive.status !== 0) {
    // Saying "the example is not there" of a clone that never fetched the tag
    // sends the reader looking in the wrong place — which is where this spent
    // its whole CI life, on a checkout with no tags at all.
    const known = spawnSync('git', ['rev-parse', '--verify', `${tag}^{commit}`], { cwd: ROOT, encoding: 'utf8' });
    if (known.status !== 0) return `cannot resolve ${tag} — an unknown tag, or a checkout fetched without tags`;
    return `no examples/${id} at ${tag}`;
  }
  const untar = spawnSync('tar', ['-x', '-C', into, '--strip-components=2'], { input: archive.stdout });
  if (untar.status !== 0) return `could not unpack ${id} at ${tag}`;
  return existsSync(path.join(into, 'project.esproject')) ? null : `${tag} has no project.esproject for ${id}`;
}

/** Every scene the released project carried, as `{ path: parsed }`. */
function releasedScenes(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.esscene')) out[path.relative(dir, p)] = JSON.parse(readFileSync(p, 'utf8'));
    }
  };
  const assets = path.join(dir, 'assets');
  if (existsSync(assets)) walk(assets);
  return out;
}

/** Entity id → sorted component types, the shape a lossless open must preserve. */
function shapeOf(scene) {
  const out = {};
  for (const e of scene.entities ?? []) {
    out[e.id] = (e.components ?? []).map((c) => c.type).sort();
  }
  return out;
}

let failed = 0;
for (const { tag, id } of cases) {
  const work = mkdtempSync(path.join(tmpdir(), `estella-legacy-${id}-`));
  try {
    const bad = extract(tag, id, work);
    if (bad) {
      console.log(`✗ ${id} @ ${tag} — ${bad}`);
      failed++;
      continue;
    }
    const scenes = releasedScenes(work);
    const entry = JSON.parse(readFileSync(path.join(work, 'project.esproject'), 'utf8')).defaultScene;
    const released = entry && scenes[path.relative('', entry)] ? scenes[path.relative('', entry)] : Object.values(scenes)[0];
    if (!released) {
      console.log(`✗ ${id} @ ${tag} — the released project carried no scene`);
      failed++;
      continue;
    }

    // Open it in the editor of today and read back what the model holds.
    const probe = `(() => {
      const s = window.__estellaEditor.surface;
      const doc = s.serializeScene();
      const shape = {};
      for (const e of (doc && doc.entities) || []) {
        shape[e.id] = (e.components || []).map((c) => c.type).sort();
      }
      return JSON.stringify(shape);
    })()`;
    const run = runTool('npx', ['electron', '.'], {
      encoding: 'utf8',
      cwd: DESKTOP,
      env: {
        ...process.env,
        ESTELLA_SHOT: path.join(work, 'open.png'),
        ESTELLA_SHOT_PROJECT: work,
        ESTELLA_SHOT_EVAL: probe,
      },
    });
    const line = (run.stdout || '').split('\n').find((l) => l.startsWith('[eval] '));
    if (!line) {
      console.log(`✗ ${id} @ ${tag} — the editor never reported a scene`);
      for (const l of (run.stdout || run.stderr || '').split('\n').slice(-6)) if (l.trim()) console.log(`    ${l}`);
      failed++;
      continue;
    }
    const loaded = JSON.parse(line.slice(7));
    const want = shapeOf(released);

    const missingEntities = Object.keys(want).filter((k) => !(k in loaded));
    const droppedComponents = [];
    for (const [eid, types] of Object.entries(want)) {
      if (!loaded[eid]) continue;
      const have = new Set(loaded[eid]);
      for (const t of types) if (!have.has(t)) droppedComponents.push(`${eid}:${t}`);
    }

    if (missingEntities.length || droppedComponents.length) {
      console.log(`✗ ${id} @ ${tag} — opening it lost content`);
      if (missingEntities.length) console.log(`    ${missingEntities.length} entity(ies) gone: ${missingEntities.slice(0, 6).join(', ')}`);
      if (droppedComponents.length) console.log(`    ${droppedComponents.length} component(s) gone: ${droppedComponents.slice(0, 6).join(', ')}`);
      failed++;
    } else {
      console.log(`✓ ${id} @ ${tag} — ${Object.keys(want).length} entities, every component still there`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

console.log(`\nlegacy ${TIER}: ${cases.length - failed}/${cases.length} released project(s) still open`);
if (failed) process.exit(1);
