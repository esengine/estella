// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { spawn, spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const [mode, front, executable, project, evidence, example] = process.argv.slice(2);
assert(['seed', 'verify'].includes(mode) && front && executable && project && evidence,
  'Usage: seed|verify <installed-front> <installed-exe> <project> <evidence> [old-example]');
await mkdir(evidence, { recursive: true });
if (mode === 'seed') {
  assert(example, 'Seed needs the previous installed version’s example');
  await cp(example, project, { recursive: true,
    filter: file => !/[/\\](\.esengine|node_modules|dist)([/\\]|$)/.test(file) });
}
const child = spawn(process.execPath, [front, '--editor', '--hidden', '--editor-exe', executable], {
  stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32',
  env: { ...process.env, ESTELLA_MCP_ALLOW_WRITES: '1' },
});
let buffer = '', stderr = '', sequence = 0;
const pending = new Map();
child.stderr.on('data', data => { stderr += data; });
child.stdout.on('data', data => {
  buffer += data;
  let newline;
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
    let message;
    try { message = JSON.parse(line); } catch { continue; }
    pending.get(message.id)?.(message);
  }
});
const rpc = (method, params) => new Promise((resolve, reject) => {
  const id = ++sequence;
  const timer = setTimeout(() => { pending.delete(id); reject(Error(`Timeout ${method}`)); }, 180000);
  pending.set(id, message => {
    clearTimeout(timer); pending.delete(id);
    if (message.error || message.result?.isError) reject(Error(JSON.stringify(message)));
    else resolve(message.result);
  });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
});
const call = (name, args = {}) => rpc('tools/call', { name, arguments: args });
const json = async (name, args) => JSON.parse((await call(name, args)).content[0].text);
const sceneFile = path.join(project, 'assets/scenes/main.esscene');
const snapshotFile = path.join(evidence, 'previous-scene.json');
try {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {},
    clientInfo: { name: 'installer-upgrade-acceptance', version: '1' } });
  await call('open_project', { root: project });
  await call('open_scene', { path: 'assets/scenes/main.esscene' });
  const idle = await json('wait_idle', { timeoutMs: 120000 });
  assert(idle.idle, `Installed project never became idle: ${JSON.stringify(idle)}`);
  if (mode === 'seed') {
    const id = await json('add_entity');
    assert(Number.isFinite(id), 'Previous installed editor did not create an entity');
    await call('rename_entity', { id, name: 'UpgradeSavedMarker' });
    await call('save_scene');
    // Saving collapses live prefab instances into on-disk deltas. Reopen with
    // the previous editor so the comparison names what was actually saved,
    // including its entity order, rather than an unsaved expanded model.
    await call('open_scene', { path: 'assets/scenes/main.esscene' });
    const reopened = await json('wait_idle', { timeoutMs: 120000 });
    assert(reopened.idle, `Previous saved scene did not settle: ${JSON.stringify(reopened)}`);
    const snapshot = await json('serialize_scene');
    assert(JSON.stringify(snapshot).includes('UpgradeSavedMarker'), 'Saved marker absent from scene');
    await writeFile(snapshotFile, JSON.stringify(snapshot));
    await writeFile(path.join(evidence, 'previous-scene.esscene'), await readFile(sceneFile));
  } else {
    const expected = JSON.parse(await readFile(snapshotFile, 'utf8'));
    const opened = await json('serialize_scene');
    await writeFile(path.join(evidence, 'upgraded-opened-scene.json'), JSON.stringify(opened, null, 2));
    assert.deepEqual(opened, expected, 'Upgrade changed the saved scene model');
    await call('set_play', { state: 'playing' });
    const deadline = Date.now() + 120000;
    let state;
    do {
      state = await json('get_play_state');
      assert(!state.error, `Installed Play failed: ${JSON.stringify(state)}`);
      if (state.ready) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    } while (Date.now() < deadline);
    assert(state.ready, `Installed Play never became ready: ${JSON.stringify(state)}`);
    await call('set_play', { state: 'stopped' });
    assert.deepEqual(await json('serialize_scene'), expected, 'Installed Play/Stop changed authored state');
    await call('save_scene');
    assert.deepEqual(JSON.parse(await readFile(sceneFile, 'utf8')),
      JSON.parse(await readFile(path.join(evidence, 'previous-scene.esscene'), 'utf8')),
      'Upgrade rewrote saved scene content');
  }
  const result = { mode, executable, project, savedScenePreserved: true };
  await writeFile(path.join(evidence, `${mode}.json`), JSON.stringify(result, null, 2));
  console.log(`PASS upgrade project ${JSON.stringify(result)}`);
} finally {
  // The front says why its editor went away on stderr, a moment before the call that
  // finds it gone answers on stdout. Read the pipe to its end before keeping the log,
  // or the one line that explains a failure is the line that is lost.
  const closed = new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve();
    else child.once('close', resolve);
  });
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already stopped */ }
  }
  await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 5000))]);
  await writeFile(path.join(evidence, `${mode}-host.log`), stderr);
}
