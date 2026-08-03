// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  editor-mcp-editor-e2e.mjs — end-to-end smoke for the EDITOR-host MCP mode.
 *
 * Spawns editor-mcp.mjs --editor (the real editor app with --mcp) against a TEMP
 * COPY of the platformer example and drives the full game-making loop over MCP:
 * open project → open scene → entity-template catalog → create entity → edit a
 * field → verify it reached the live World → screenshot → save → prefab round trip
 * (instance → Prefab Mode → save the asset → back → revert → unpack) → play → stop.
 * Run from desktop/ after a dist build:  node scripts/editor-mcp-editor-e2e.mjs
 * (ESTELLA_E2E_EXPORT=1 additionally runs a web export to the temp dir.)
 */
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLE = path.resolve(DESKTOP, '..', 'examples', 'platformer');

// Stage the example as a disposable project (transients filtered like the
// packaged templates are).
const tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'estella-mcp-e2e-'));
const project = path.join(tmpRoot, 'platformer');
await cp(EXAMPLE, project, {
  recursive: true,
  filter: (src) => !/[/\\](\.esengine|node_modules|dist)([/\\]|$)/.test(src),
});

// An ORPHAN texture (no `.meta`) staged before open — "I dropped my art into
// the project folder and opened it" — the open scan must adopt it into the
// registry, and a cold assignment to it must light up live (guards below).
const ORPHAN_REL = 'assets/textures/orphan-e2e.png';
const ORPHAN_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
await mkdir(path.join(project, 'assets', 'textures'), { recursive: true });
await writeFile(path.join(project, ORPHAN_REL), ORPHAN_PNG);

// A counter the hot-reload stage can read from outside: one entity, one field,
// incremented every Update. The tick DELTA doubles as a logic fingerprint — a
// swapped-in delta of 1e6 makes the value's low digits the preserved state and
// its high digits the new logic, so one number answers both "did the new code
// arrive" and "did the World survive it". `logicV` marks which bundle is live,
// which is what the poll waits on (the watcher's rebuild lands at its own pace).
const COUNTER_REL = path.join('src', 'e2e-hotreload.ts');
const counterSource = (delta, logicV, extraField = false) => `// staged by editor-mcp-editor-e2e.mjs — not a shipped example file
import {
    addStartupSystem, addSystemToSchedule, defineComponent, defineSystem,
    Query, Mut, Commands, Schedule,
} from 'esengine';

export const E2ECounter = defineComponent('E2ECounter', { value: 0${extraField ? ', extra: 0' : ''} });

const spawnCounter = defineSystem([Commands()], (cmds) => {
    cmds.spawn('E2ECounterHolder').insert(E2ECounter, { value: 0 });
}, { name: 'E2ESpawnCounter' });

const tickCounter = defineSystem([Query(Mut(E2ECounter))], (q) => {
    for (const [, c] of q) {
        c.value += ${delta};
        const g = globalThis;
        g.__e2eCounter = c.value;
        g.__e2eLogicV = ${logicV};
    }
}, { name: 'E2ETickCounter' });

addStartupSystem(spawnCounter);
addSystemToSchedule(Schedule.Update, tickCounter);
`;
await writeFile(path.join(project, COUNTER_REL), counterSource(1, 1));
const mainTs = path.join(project, 'src', 'main.ts');
await writeFile(mainTs, `${await readFile(mainTs, 'utf8')}\nimport './e2e-hotreload';\n`);

// ESTELLA_E2E_FRONT points at an alternate front (e.g. the shipped bundle,
// dist-electron/mcp/editor-mcp.mjs) to prove distribution artifacts end to end.
const front = process.env.ESTELLA_E2E_FRONT ?? 'scripts/editor-mcp.mjs';
const child = spawn(process.execPath, [front, '--editor'], {
  cwd: DESKTOP,
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, ESTELLA_MCP_ALLOW_WRITES: '1' },
});

let buf = '';
const waiters = new Map();
child.stdout.on('data', (d) => {
  buf += d.toString();
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; } // skip stray non-JSON stdout
    if (msg.id != null && waiters.has(msg.id)) { waiters.get(msg.id)(msg); waiters.delete(msg.id); }
  }
});
child.stderr.on('data', (d) => process.stderr.write(d));

const send = (msg) => child.stdin.write(JSON.stringify(msg) + '\n');
let nextId = 0;
const rpc = (method, params, timeoutMs = 60_000, label = method) => new Promise((resolve, reject) => {
  const id = ++nextId;
  const t = setTimeout(() => reject(new Error(`timeout waiting for ${label}`)), timeoutMs);
  waiters.set(id, (m) => { clearTimeout(t); resolve(m); });
  send({ jsonrpc: '2.0', id, method, params });
});
const call = async (name, args, timeoutMs) => {
  // Labelled with the tool name: a bare "timeout waiting for tools/call" leaves you
  // counting call sites to work out which step of the run wedged.
  const res = await rpc('tools/call', { name, arguments: args ?? {} }, timeoutMs, `tools/call ${name}`);
  if (res.result?.isError) throw new Error(`${name}: ${res.result?.content?.[0]?.text}`);
  return res.result?.content?.[0];
};
const cleanup = async () => {
  child.kill();
  await new Promise((r) => setTimeout(r, 500));
  await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
};
const fail = async (m) => { console.log('EDITOR-E2E FAIL:', m); await cleanup(); process.exit(1); };
// Whatever kills THIS process must still take the front (and its editor) along.
process.on('exit', () => { try { child.kill(); } catch { /* gone */ } });

try {
  const init = await rpc('initialize', {
    protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'editor-e2e', version: '0' },
  }, 180_000);
  if (!init.result?.serverInfo) await fail('no serverInfo in initialize');
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  console.log('initialize OK');

  const list = await rpc('tools/list', {});
  const names = (list.result?.tools ?? []).map((t) => t.name);
  for (const need of ['open_project', 'open_scene', 'list_entity_templates', 'create_entity', 'save_scene', 'screenshot', 'export_game',
    'open_asset', 'get_document', 'exit_prefab_mode', 'edit_prefab', 'apply_prefab', 'revert_prefab', 'unpack_prefab', 'create_prefab_variant'])
    if (!names.includes(need)) await fail(`tools/list missing ${need}`);
  console.log(`tools/list OK — ${names.length} tools`);

  await call('open_project', { root: project }, 120_000);
  console.log('open_project OK');

  // Opening a project stages the SDK types mirror — the project tsconfig's
  // `esengine` path must resolve for the IDE from the very first open (a
  // silently skipped mirror shipped "cannot find module 'esengine'" in 0.22).
  const sdkTypes = await stat(path.join(project, '.esengine', 'sdk', 'index.d.ts')).catch(() => null);
  if (!sdkTypes) await fail('.esengine/sdk/index.d.ts missing after open_project — SDK types staging broken');
  console.log('sdk types staged OK — .esengine/sdk/index.d.ts present');

  // No polling: open_scene's contract is "resolved = adopted", so the very next
  // tree read must already be populated (this line is the contract's regression
  // guard — do not add a retry loop here).
  await call('open_scene', { path: 'assets/scenes/main.esscene' }, 60_000);
  const tree = JSON.parse((await call('get_scene_tree')).text);
  if (!Array.isArray(tree) || tree.length === 0) await fail('scene tree empty after open_scene');
  console.log(`open_scene OK — ${tree.length} roots`);

  const templates = JSON.parse((await call('list_entity_templates')).text);
  if (!templates.some((t) => t.id === 'anchor:Sprite')) await fail('anchor:Sprite missing from entity templates');
  console.log(`list_entity_templates OK — ${templates.length} templates`);

  const before = JSON.parse((await call('get_stats')).text).entities;
  const created = Number((await call('create_entity', { template: 'anchor:Sprite', x: 64, y: 96 })).text);
  const after = JSON.parse((await call('get_stats')).text).entities;
  if (!Number.isFinite(created) || after <= before) await fail(`create_entity did not spawn (${before} -> ${after})`);
  console.log(`create_entity OK — id ${created} (${before} -> ${after} entities)`);

  // The fresh Sprite has no texture — the diagnostics sweep must flag it (the
  // same truth as the Details red asterisk, queryable instead of pixel-only).
  const diags = JSON.parse((await call('get_diagnostics')).text);
  if (!diags.some((d) => d.entity === created && d.problem === 'required-empty' && d.field === 'texture'))
    await fail(`get_diagnostics missed the fresh Sprite's empty texture (${JSON.stringify(diags).slice(0, 200)})`);
  console.log(`get_diagnostics OK — flagged Sprite.texture on the new entity`);

  // — Hot-asset chain guards (the white-box family) —
  // The orphan staged before open had no `.meta`: the open scan must have
  // adopted it, and a COLD texture assignment must light up the live World with
  // NO project reopen (set_field → touch → async load → re-project). Polling is
  // the contract here: the load is async, but it must CONVERGE.
  await call('set_field', { entity: created, component: 'Sprite', key: 'texture', type: 'asset', value: ORPHAN_REL });
  let handle = 0;
  for (let i = 0; i < 50 && handle === 0; i++) {
    const sprite = JSON.parse((await call('world_component', { id: created, component: 'Sprite' })).text);
    handle = sprite?.texture ?? 0;
    if (handle === 0) await new Promise((r) => setTimeout(r, 100));
  }
  if (handle === 0) await fail('cold Sprite.texture never resolved to a live handle — hot-load chain broken');
  console.log(`hot texture OK — orphan adopted at open + cold set_field lit up (handle ${handle})`);

  // A ref to a file that does NOT exist must surface as a queryable diagnostic:
  // the model value looks healthy — only the registry knows the ref is dead.
  await call('set_field', { entity: created, component: 'Sprite', key: 'texture', type: 'asset', value: 'assets/textures/does-not-exist.png' });
  const deadDiags = JSON.parse((await call('get_diagnostics')).text);
  if (!deadDiags.some((d) => d.entity === created && d.problem === 'asset-unresolved'))
    await fail(`get_diagnostics missed the dead texture ref (${JSON.stringify(deadDiags).slice(0, 200)})`);
  await call('set_field', { entity: created, component: 'Sprite', key: 'texture', type: 'asset', value: ORPHAN_REL });
  console.log('asset-unresolved diagnostic OK — a dead ref is queryable, not just a white box');

  await call('set_field', { entity: created, component: 'Transform', key: 'position', type: 'vec3', value: [64, 96, 0] });
  const live = JSON.parse((await call('world_component', { id: created, component: 'Transform' })).text);
  if (!live) await fail('world_component returned null — edit did not reach the World');
  console.log('set_field + world_component OK — edit reached the live World');

  const shot = await call('screenshot');
  if (shot.type !== 'image' || (shot.data?.length ?? 0) < 100) await fail('screenshot not a PNG image block');
  console.log(`screenshot OK — ${shot.data.length} base64 chars`);

  const scenePath = path.join(project, 'assets', 'scenes', 'main.esscene');
  const mtimeBefore = (await stat(scenePath)).mtimeMs;
  await call('save_scene', {}, 60_000);
  const mtimeAfter = (await stat(scenePath)).mtimeMs;
  if (mtimeAfter <= mtimeBefore) await fail('save_scene did not rewrite the scene file');
  console.log('save_scene OK — scene file rewritten');

  // — Prefabs: the identity surface, end to end (make one → instance it → edit it in
  //   Prefab Mode → save the ASSET → come back → revert → unpack) —
  // Every tool result is JSON-encoded, so a string ref comes back quoted.
  const prefabRef = JSON.parse((await call('create_prefab_from_entity', { entity: created }, 60_000)).text);
  const prefabAsset = JSON.parse((await call('list_assets', { type: 'prefab' })).text)
    .assets.find((a) => a.ref === prefabRef);
  if (!prefabAsset) await fail(`the new prefab ${prefabRef} is not in list_assets`);
  const instance = Number((await call('create_entity', { template: `prefab:${prefabAsset.path}` })).text);
  const instanceInfo = JSON.parse((await call('get_entity', { id: instance })).text);
  if (instanceInfo?.prefab?.ref !== prefabRef)
    await fail(`get_entity does not report the prefab link (${JSON.stringify(instanceInfo)})`);
  console.log(`prefab instance OK — get_entity reports ${prefabRef}`);

  await call('save_scene', {}, 60_000); // Prefab Mode refuses to discard unsaved work
  const prefabDoc = JSON.parse((await call('edit_prefab', { entity: instance }, 60_000)).text);
  if (prefabDoc.kind !== 'prefab' || prefabDoc.path !== prefabAsset.path)
    await fail(`edit_prefab did not enter Prefab Mode (${JSON.stringify(prefabDoc)})`);
  if (JSON.parse((await call('get_document')).text).kind !== 'prefab')
    await fail('get_document does not report Prefab Mode — a driver cannot tell what it is editing');
  const prefabTree = JSON.parse((await call('get_scene_tree')).text);
  if (prefabTree.length !== 1) await fail(`Prefab Mode should show the prefab alone (${JSON.stringify(prefabTree)})`);
  await call('set_field', { entity: prefabTree[0].id, component: 'Sprite', key: 'layer', type: 'number', value: 3 });
  await call('save_scene', {}, 60_000); // in Prefab Mode this writes the .esprefab
  const prefabFile = path.join(project, prefabAsset.path);
  if (!/"layer":\s*3/.test(await readFile(prefabFile, 'utf8')))
    await fail('save_scene in Prefab Mode did not write the edit into the .esprefab');
  const backDoc = JSON.parse((await call('exit_prefab_mode', {}, 60_000)).text);
  if (backDoc.kind !== 'scene') await fail(`exit_prefab_mode did not return to the scene (${JSON.stringify(backDoc)})`);
  console.log('prefab mode OK — edit_prefab → set_field → save wrote the asset → exit_prefab_mode');

  // Apply rewrites the shared asset for every instance, so it refuses until the
  // caller states the intent (a person is shown a diff dialog instead).
  let refused = false;
  try { await call('apply_prefab', { entity: instance, confirm: false }); } catch { refused = true; }
  if (!refused) await fail('apply_prefab committed without confirm');
  console.log('apply_prefab OK — refuses without confirm');

  // A UI prefab is opened inside an editing-environment Canvas so its percentage
  // boxes resolve. The environment must be invisible: no Outliner row, and not one
  // byte of it in the asset.
  const uiEntity = Number((await call('create_entity', { template: 'ui-image' })).text);
  const uiRef = JSON.parse((await call('create_prefab_from_entity', { entity: uiEntity }, 60_000)).text);
  const uiAsset = JSON.parse((await call('list_assets', { type: 'prefab' })).text)
    .assets.find((a) => a.ref === uiRef);
  if (!uiAsset) await fail(`the new UI prefab ${uiRef} is not in list_assets`);
  await call('save_scene', {}, 60_000);
  const uiFile = path.join(project, uiAsset.path);
  const uiAssetBefore = await readFile(uiFile, 'utf8');
  const uiDoc = JSON.parse((await call('open_asset', { path: uiAsset.path }, 60_000)).text);
  if (uiDoc.kind !== 'prefab') await fail(`open_asset did not enter Prefab Mode (${JSON.stringify(uiDoc)})`);
  const uiTree = JSON.parse((await call('get_scene_tree')).text);
  if (uiTree.length !== 1 || /canvas/i.test(uiTree[0].name))
    await fail(`the editing environment leaked into the Outliner (${JSON.stringify(uiTree)})`);
  await call('save_scene', {}, 60_000);
  if ((await readFile(uiFile, 'utf8')) !== uiAssetBefore)
    await fail('saving a hosted UI prefab changed the asset — the editing environment leaked into it');
  await call('exit_prefab_mode', {}, 60_000);
  console.log('ui prefab OK — hosted for layout, absent from the tree and from the asset');

  // The rest of the identity surface: revert re-syncs the instance (fresh ids),
  // unpack cuts the link for good.
  const reverted = Number((await call('revert_prefab', { entity: instance }, 60_000)).text);
  if (!Number.isFinite(reverted)) await fail('revert_prefab returned no fresh instance root');
  await call('unpack_prefab', { entity: reverted });
  if (JSON.parse((await call('get_entity', { id: reverted })).text)?.prefab)
    await fail('unpack_prefab left the prefab link in place');
  console.log('revert_prefab + unpack_prefab OK — re-synced, then detached');

  await call('toggle_play', {}, 60_000);
  let play = null;
  for (let i = 0; i < 60; i++) {
    play = JSON.parse((await call('get_play_state')).text);
    if (play.ready || play.error) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!play?.ready) await fail(`play realm never became ready (${JSON.stringify(play)})`);
  const playShot = await call('screenshot');
  if (playShot.type !== 'image') await fail('screenshot during play failed');
  // The gameplay-state probe reaches the estella:// OOPIF and sees __estellaPlay.
  const probe = JSON.parse((await call('play_probe', { code: 'typeof window.__estellaPlay' })).text);
  if (probe !== 'object') await fail(`play_probe: __estellaPlay not present (${probe})`);

  // ---- Hot reload, live (REARCH_HOT_RELOAD's one unverified claim) ----------
  // The realm's rAF is throttled in an unfocused window, so frames are driven
  // by hand: each sample ticks the app a few frames, then reads the counter.
  const sample = async () => JSON.parse((await call('play_probe', {
    code: `(async () => {
      const p = window.__estellaPlay; const g = globalThis;
      for (let i = 0; i < 3; i++) await p.app.tick(1 / 60);
      return { v: g.__e2eCounter ?? null, lv: g.__e2eLogicV ?? null };
    })()`,
  }, 30_000)).text);
  const until = async (what, pred, tries = 45) => {
    for (let i = 0; i < tries; i++) {
      const s = await sample();
      if (pred(s)) return s;
      await new Promise((r) => setTimeout(r, 1000));
    }
    return fail(`hot reload: timed out waiting for ${what}`);
  };

  const s1 = await until('the staged counter to tick', (s) => s.lv === 1 && s.v >= 2);
  if (s1.v >= 100000) await fail(`counter ran away before the swap (${s1.v}) — the low-digit invariant needs v1 << 1e6`);

  // Logic-only edit: same component, delta 1 → 1e6. The watcher rebuild must
  // hot-swap: the value's low digits are the pre-swap count, still there.
  await writeFile(path.join(project, COUNTER_REL), counterSource(1000000, 2));
  const s2 = await until('the swapped logic to arrive', (s) => s.lv === 2);
  if (s2.v % 1000000 === 0) {
    const logs = JSON.parse((await call('get_logs', { tail: 30 })).text);
    for (const l of logs) {
      const line = typeof l === 'string' ? l : JSON.stringify(l);
      if (/reload|play|swap/i.test(line)) console.log('  log:', line.slice(0, 520));
    }
    await fail(`logic edit lost the World: counter restarted at ${s2.v} — hot swap fell back to a full reload (or swapped a rebooted realm)`);
  }
  if (s2.v % 1000000 < s1.v) await fail(`counter went backwards across the swap (${s1.v} -> ${s2.v})`);
  console.log(`hot swap OK — logic replaced, state preserved (${s1.v} -> ${s2.v})`);

  // Schema edit: a new component field. The fingerprint gate must refuse the
  // swap and full-reload instead — preserved state would be the WRONG outcome
  // here, so the assertion flips: the count restarts as a clean multiple.
  await writeFile(path.join(project, COUNTER_REL), counterSource(1000000, 3, true));
  const s3 = await until('the schema edit to land', (s) => s.lv === 3);
  if (s3.v % 1000000 !== 0) {
    await fail(`schema edit kept the old World: counter carried ${s3.v % 1000000} across a component redefinition`);
  }
  console.log(`schema change OK — fingerprint gate forced a clean restart (${s2.v} -> ${s3.v})`);

  await call('toggle_play', {}, 60_000);
  console.log('play OK — realm ready, screenshot + probe captured, hot reload exercised, stopped');

  if (process.env.ESTELLA_E2E_EXPORT === '1') {
    const outDir = path.join(tmpRoot, 'export-web');
    const result = JSON.parse((await call('export_game', { platform: 'web', outDir }, 300_000)).text);
    const index = await stat(path.join(outDir, 'index.html')).catch(() => null);
    if (!index) await fail(`export_game produced no index.html (${JSON.stringify(result).slice(0, 200)})`);
    console.log('export_game OK — web export written');
  }

  console.log('\nEDITOR-E2E PASS — MCP drives the real editor end-to-end (project → scene → entity → save → play)');
  await cleanup();
  process.exit(0);
} catch (e) {
  await fail(String(e?.message ?? e));
}
