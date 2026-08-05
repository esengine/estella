// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  editor-25d-check.mjs — the 2.5D AUTHORING surface, driven for real.
 *
 * The engine half of 2.5D is covered by verify:render:depth (a paired pixel check
 * that painter's order cannot pass). What no unit test can cover is whether the
 * editor shows a person what the game will show, and every seam between the
 * project setting and the viewport is a place that can be wired wrong while every
 * test stays green — which is exactly what happened: depth layers reached the play
 * realm and never the edit viewport, so the setting was real everywhere except
 * where it is set.
 *
 * Two opaque squares occupy the SAME place: near red at z = +150 in sorting layer
 * 1, far blue at z = -150 in the HIGHER layer 2. Paint order draws blue over red;
 * only the depth buffer puts red in front. So the centre pixel of the viewport
 * names the answer with no coordinate mapping to get wrong, and the same scene
 * asks two more questions of the editor:
 *
 *   depth  — the centre of the EDIT viewport is red, not blue
 *   pick   — a click anywhere on the pair selects the near sprite, never the far
 *            one (ranking hits by list order used to select what is hidden)
 *   grid   — under the perspective eye the grid still reaches the frame's border
 *            (it was sized from orthoSize, a field that view does not render
 *            through, and became a bounded island in the middle of the panel)
 *
 * Run from desktop/ after a dist build:  node scripts/editor-25d-check.mjs
 * OUT=<dir> writes the captures out, since a pixel assertion is worth looking at.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.OUT ?? null;

// ── the project ──────────────────────────────────────────────────────────────

const MATERIAL = JSON.stringify({
  version: '1.0', type: 'material', shader: 'opaque.esshader',
  blendMode: 9, depthTest: false, properties: {},
}, null, 2);

// Fragment-only: the vertex stage is the one ShaderParser injects, which is the
// stage that has to carry z for any of this to mean anything.
const SHADER = `#pragma shader "Opaque Unlit"
#pragma version 300 es
#pragma domain Unlit2D

#pragma fragment
precision mediump float;
in vec4 v_color;
in vec2 v_texCoord;
uniform sampler2D u_textures[8];
out vec4 fragColor;
void main() {
    fragColor = texture(u_textures[0], v_texCoord) * v_color;
}
#pragma end
`;

const sprite = (name, z, layer, color) => ({
  id: layer, name, parent: null, children: [],
  visible: true,
  components: [
    { type: 'Transform', data: { position: { x: 0, y: 0, z } } },
    {
      type: 'Sprite',
      data: {
        size: { x: 260, y: 260 }, color, layer,
        material: 'assets/materials/opaque.esmaterial',
      },
    },
  ],
});

const SCENE = JSON.stringify({
  version: '1.0', name: 'Main',
  entities: [
    {
      id: 0, name: 'Camera', parent: null, children: [], visible: true,
      components: [
        { type: 'Transform', data: { position: { x: 0, y: 0, z: 10 } } },
        { type: 'Camera', data: { projectionType: 1, orthoSize: 300, isActive: true, priority: 0 } },
      ],
    },
    sprite('NearRed', 150, 1, { r: 1, g: 0, b: 0, a: 1 }),
    sprite('FarBlue', -150, 2, { r: 0, g: 0, b: 1, a: 1 }),
  ],
}, null, 1);

const PROJECT = JSON.stringify({
  formatVersion: '1', name: 'Depth 2.5D Check', version: '0.1.0',
  defaultScene: 'assets/scenes/main.esscene',
  designResolution: { width: 800, height: 600 },
  features: { rendering: { sortingLayers: ['Default', 'Near', 'Far'], depthLayers: [1, 2] } },
}, null, 2);

const tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'estella-25d-'));
const project = path.join(tmpRoot, 'proj');
const write = async (rel, text) => {
  const file = path.join(project, rel);
  await rm(file, { force: true });
  await writeFile(file, text);
};
const { mkdir } = await import('node:fs/promises');
await mkdir(path.join(project, 'assets', 'scenes'), { recursive: true });
await mkdir(path.join(project, 'assets', 'materials'), { recursive: true });
await write('project.esproject', PROJECT);
await write('assets/scenes/main.esscene', SCENE);
await write('assets/materials/opaque.esmaterial', MATERIAL);
await write('assets/materials/opaque.esshader', SHADER);

// ── a PNG reader, for the two pixels the claims live in ──────────────────────

/** Decode an 8-bit RGB/RGBA PNG into { w, h, px(x, y) → [r,g,b] }. */
function readPNG(buf) {
  let pos = 8; // skip the signature
  let w = 0, h = 0, colorType = 6;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      if (data[8] !== 8) throw new Error(`unsupported bit depth ${data[8]}`);
      colorType = data[9];
      if (colorType !== 2 && colorType !== 6) throw new Error(`unsupported colour type ${colorType}`);
      if (data[12] !== 0) throw new Error('interlaced PNG');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + x] = v & 0xff;
    }
  }
  return {
    w, h,
    px: (x, y) => {
      const i = y * stride + x * bpp;
      return [out[i], out[i + 1], out[i + 2]];
    },
  };
}

const near = (got, want, tol = 60) => got.every((v, i) => Math.abs(v - want[i]) <= tol);
const isBlack = (p) => p[0] < 12 && p[1] < 12 && p[2] < 12;

// ── the driver ───────────────────────────────────────────────────────────────

const child = spawn(process.execPath, ['scripts/editor-mcp.mjs', '--editor'], {
  cwd: DESKTOP, stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, ESTELLA_MCP_ALLOW_WRITES: '1' },
});
let buf = ''; const waiters = new Map();
child.stdout.on('data', (d) => {
  buf += d.toString();
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
    if (!line) continue;
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (m.id != null && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
  }
});
child.stderr.on('data', (d) => { if (process.env.V) process.stderr.write(d); });
const send = (m) => child.stdin.write(JSON.stringify(m) + '\n');
let nextId = 0;
const rpc = (method, params, ms = 120000) => new Promise((res, rej) => {
  const id = ++nextId;
  const t = setTimeout(() => rej(new Error(`timeout ${method}`)), ms);
  waiters.set(id, (m) => { clearTimeout(t); res(m); });
  send({ jsonrpc: '2.0', id, method, params });
});
const call = async (name, args, ms) => {
  const r = await rpc('tools/call', { name, arguments: args ?? {} }, ms);
  if (r.result?.isError) throw new Error(`${name}: ${r.result?.content?.[0]?.text}`);
  return r.result?.content?.[0];
};
const json = async (name, args, ms) => JSON.parse((await call(name, args, ms))?.text ?? 'null');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); return ok; };

const done = async (code, msg) => {
  console.log(msg);
  child.kill();
  await sleep(400);
  await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  process.exit(code);
};
process.on('exit', () => { try { child.kill(); } catch {} });

async function capture(label) {
  await call('step', { frames: 3 }, 30000);
  const block = await call('capture_viewport', {}, 60000);
  const png = Buffer.from(block.data ?? '', 'base64');
  if (OUT) await writeFile(path.join(OUT, `25d-${label}.png`), png);
  return readPNG(png);
}

try {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: '25d', version: '0' } }, 180000);
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  await call('open_project', { root: project }, 180000);
  await call('open_scene', { path: 'assets/scenes/main.esscene' }, 120000);
  await sleep(2000);

  // 1. Depth reaches the edit viewport. The two squares coincide, so the centre
  //    pixel IS the answer — no canvas geometry to get wrong.
  const ortho = await capture('edit-ortho');
  const centre = ortho.px(Math.floor(ortho.w / 2), Math.floor(ortho.h / 2));
  check(
    near(centre, [255, 0, 0]),
    `depth: the edit viewport centre is rgb(${centre}), expected the NEAR sprite's red — `
    + 'the project\'s depth layers are not reaching the edit World (blue = paint order).',
  );

  // 2. Picking ranks by what was drawn. Both squares cover the same pixels, so
  //    every hit on them must be the near one; the far one being pickable at all
  //    means the ranking is on list order rather than on depth.
  const tree = await json('get_scene_tree', {}, 30000);
  const nearId = tree.find((e) => e.name === 'NearRed')?.id;
  const farId = tree.find((e) => e.name === 'FarBlue')?.id;
  const picked = new Set();
  for (let x = 200; x <= 1500; x += 20) {
    for (const y of [300, 400]) {
      const id = await json('pick', { clientX: x, clientY: y }, 30000);
      if (id != null) picked.add(id);
    }
  }
  check(picked.has(nearId), `pick: no click anywhere on the pair selected the near sprite (${[...picked]})`);
  check(!picked.has(farId), 'pick: a click selected the FAR sprite, which is behind the near one everywhere');

  // 3. The grid covers the frame under the perspective eye, not a bounded island.
  await call('run_editor_command', { id: 'view.toggleViewPerspective' }, 30000);
  await sleep(800);
  const persp = await capture('edit-perspective');
  const band = Math.max(2, Math.floor(persp.h * 0.04));
  let lit = 0;
  for (let x = 0; x < persp.w; x += 2) {
    for (const y of [band, persp.h - 1 - band]) if (!isBlack(persp.px(x, y))) lit++;
  }
  check(lit > 0, 'grid: the top/bottom border of the perspective viewport is empty — the grid quad is not covering what this projection sees');

  const centreP = persp.px(Math.floor(persp.w / 2), Math.floor(persp.h / 2));
  check(near(centreP, [255, 0, 0]), `depth: the perspective viewport centre is rgb(${centreP}), expected red`);

  if (failures.length) await done(1, `FAIL\n  - ${failures.join('\n  - ')}`);
  await done(0, 'PASS: depth resolves in the edit viewport, picking follows it, and the grid covers the perspective frame');
} catch (e) {
  await done(1, `FAIL: ${e.message}`);
}
