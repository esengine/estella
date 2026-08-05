// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  editorDriver.mjs — drive a REAL editor over MCP, from a script.
 *
 * The editor's authoring surface has failures no unit test can reach: a project
 * setting that never arrives, a click that selects what is behind what you can
 * see, an overlay drawn on the wrong plane. Each of those is only provable by
 * opening the editor and looking, so the checks that prove them are scripts —
 * and every one of them was re-implementing the same forty lines of JSON-RPC
 * plumbing, which is how the fourth copy ends up with a different timeout and
 * no stderr on failure.
 *
 * This is that plumbing, once: spawn, line-framed RPC, the tool wrappers, a PNG
 * reader for pixel assertions, and a temp project builder. A check is then only
 * its claim.
 *
 * One script keeps its own copy on purpose: editor-mcp-editor-e2e drives an
 * ALTERNATE front (`ESTELLA_E2E_FRONT` points at the shipped bundle, to prove
 * the distribution artifact end to end), which is a different question than
 * "open the editor and look".
 */
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Write a temp project from `{ 'project-relative/path': text }` and return its root. */
export async function makeProject(files) {
  const root = path.join(await mkdtemp(path.join(os.tmpdir(), 'estella-check-')), 'proj');
  for (const [rel, text] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, text);
  }
  return root;
}

/**
 * Decode an 8-bit RGB/RGBA PNG into `{ w, h, px(x, y) → [r,g,b] }`.
 *
 * Pixel assertions are the point of capturing anything: "the picture changed" is
 * what a byte-length comparison can say, and it is not the same claim as "this
 * is the right colour" — a hidden panel changes bytes too.
 */
export function readPNG(buf) {
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

/** Whether a pixel is within `tol` of the wanted colour, per channel. */
export const near = (got, want, tol = 60) => got.every((v, i) => Math.abs(v - want[i]) <= tol);
/** Whether a pixel is (near enough to) the clear colour. */
export const isBlack = (p) => p[0] < 12 && p[1] < 12 && p[2] < 12;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Open a real editor, hand it to `body`, and always shut it down.
 *
 * `mode: 'editor'` (default) launches the app itself — the only mode that can
 * answer a question about the viewport. `'headless'` is the dev-repo host, which
 * is enough for surface/protocol questions.
 *
 * On a thrown error the editor's last stderr is printed: a check that fails in
 * CI with only "timeout tools/call" has cost somebody the debugging session that
 * this line pays for.
 */
export async function withEditor(body, opts = {}) {
  const args = ['scripts/editor-mcp.mjs'];
  if ((opts.mode ?? 'editor') === 'editor') args.push('--editor');
  const child = spawn(process.execPath, args, {
    cwd: DESKTOP, stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ESTELLA_MCP_ALLOW_WRITES: '1' },
  });

  let buf = '';
  const waiters = new Map();
  const errLines = [];
  child.stdout.on('data', (d) => {
    buf += d.toString();
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let m;
      try { m = JSON.parse(line); } catch { continue; }
      if (m.id != null && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
    }
  });
  child.stderr.on('data', (d) => {
    const text = d.toString();
    if (process.env.V) process.stderr.write(text);
    errLines.push(...text.split('\n').filter(Boolean));
    if (errLines.length > 60) errLines.splice(0, errLines.length - 60);
  });

  let nextId = 0;
  const rpc = (method, params, ms = 120000) => new Promise((res, rej) => {
    const id = ++nextId;
    const timer = setTimeout(() => rej(new Error(`timeout ${method} ${params?.name ?? ''}`.trim())), ms);
    waiters.set(id, (m) => { clearTimeout(timer); res(m); });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });

  const call = async (name, args_, ms) => {
    const r = await rpc('tools/call', { name, arguments: args_ ?? {} }, ms);
    if (r.result?.isError) throw new Error(`${name}: ${r.result?.content?.[0]?.text}`);
    return r.result?.content?.[0];
  };

  const out = process.env.OUT ?? null;
  const editor = {
    /** The raw JSON-RPC door, for the protocol itself (tools/list, resources/*). */
    rpc,
    call,
    /** A tool whose reply is JSON text (the scene tree, a pick, the play state). */
    json: async (name, args_, ms) => JSON.parse((await call(name, args_, ms))?.text ?? 'null'),
    sleep,
    /** Step to a settled frame, capture the viewport, decode it. `OUT=dir` keeps the PNG. */
    capture: async (label, frames = 3) => {
      await call('step', { frames }, 30000);
      const block = await call('capture_viewport', {}, 60000);
      const png = Buffer.from(block.data ?? '', 'base64');
      if (out) await writeFile(path.join(out, `${label}.png`), png);
      return readPNG(png);
    },
    /** The composited window (the only way to see gizmo overlays or the play realm). */
    screenshot: async (label) => {
      const block = await call('screenshot', {}, 60000);
      const png = Buffer.from(block.data ?? '', 'base64');
      if (out) await writeFile(path.join(out, `${label}.png`), png);
      return readPNG(png);
    },
    /** Open a project and its scene, settled. */
    open: async (root, scene) => {
      await call('open_project', { root }, 180000);
      if (scene) await call('open_scene', { path: scene }, 120000);
      await sleep(2000);
    },
  };

  try {
    await rpc('initialize', {
      protocolVersion: '2024-11-05', capabilities: {},
      clientInfo: { name: opts.client ?? 'check', version: '0' },
    }, 180000);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    return await body(editor);
  } catch (err) {
    if (errLines.length) {
      console.error(`--- editor stderr (last ${errLines.length} lines) ---`);
      for (const l of errLines) console.error(l);
      console.error('--- end editor stderr ---');
    }
    throw err;
  } finally {
    child.kill();
    await sleep(400);
  }
}

/** Collect failures without stopping at the first: one run, every claim tested. */
export function checker() {
  const failures = [];
  const check = (ok, message) => { if (!ok) failures.push(message); return ok; };
  check.failures = failures;
  return check;
}
