// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The lightmap bake kernel (lightmap-kernel.{mjs,wasm}, built by
 *        tools/lightmap-wasm/build.mjs): uploads a scene once, then runs each
 *        pass over every lumel on the kernel's own threads.
 */

import { Buffer } from 'node:buffer';

let modulePromise = null;

export function loadBakeKernel() {
  modulePromise ??= import('./lightmap-kernel.mjs')
    .then(({ default: createModule }) => createModule())
    .then((m) => new BakeKernel(m));
  return modulePromise;
}

class BakeKernel {
  constructor(m) {
    this.m = m;
    this.held = [];
    this.lumels = null;
    /** Threads a pass runs on; any count gives the same answer. */
    this.threads = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 8;
  }

  /** The heap as it is now: a thread's allocation can grow it, and the module's
   *  own views on this thread are not renewed when it does. */
  heap() {
    return this.m.wasmMemory.buffer;
  }

  put(array) {
    const at = this.m._malloc(Math.max(4, array.byteLength));
    if (!at) throw new Error('lightmap kernel: out of memory');
    new Uint8Array(this.heap(), at, array.byteLength)
      .set(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
    return at;
  }

  release() {
    this.m._lm_cache_budget(this.cacheBudget ?? 384 * 1024 * 1024);
    for (const at of this.held) this.m._free(at);
    this.held = [];
    this.lumels = null;
    this.inputs = null;
  }

  setCacheBudget(bytes) {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > 0xffffffff) throw Error('invalid bake cache budget');
    this.cacheBudget = bytes;
    this.m._lm_cache_budget(bytes);
  }

  cacheStats() {
    return { bytes: this.m._lm_cache_bytes(), resolvedRays: this.m._lm_gather_resolved() };
  }

  /** Replaces the scene: triangles, their lookup, and the lumels every pass solves. */
  scene(s) {
    const names = ['positions', 'triUV', 'triSurface', 'patch', 'albedo', 'triNormal',
      'twoSided', 'coverage', 'lumelPosition', 'lumelNormal'];
    // Compare with the uploaded snapshot, so even mutation of the caller's
    // arrays invalidates visibility. Colour/intensity edits do not change s.
    if (this.inputs && this.triCount === s.triCount && this.backReach === s.backReach
      && this.lumels.count === s.lumelCount && names.every(name => {
        const held = this.inputs[name], a = s[name];
        return held.length === a.byteLength && Buffer.from(this.heap(), held.at, held.length)
          .equals(Buffer.from(a.buffer, a.byteOffset, a.byteLength));
      })) return;
    this.release();
    this.inputs = {};
    this.triCount = s.triCount; this.backReach = s.backReach;
    const hold = (a) => {
      const at = this.put(a); this.held.push(at);
      for (const name of names) if (s[name] === a) this.inputs[name] = { at, length: a.byteLength };
      return at;
    };
    const pos = hold(s.positions), uv = hold(s.triUV), surf = hold(s.triSurface);
    const patch = hold(s.patch), albedo = hold(s.albedo), normal = hold(s.triNormal);
    const twoSided = hold(s.twoSided), coverage = hold(s.coverage);
    this.m._lm_scene(pos, s.triCount, uv, surf, patch, albedo, normal, twoSided, coverage,
      s.coverage.length, s.backReach);
    this.lumels = { position: hold(s.lumelPosition), normal: hold(s.lumelNormal), count: s.lumelCount };
  }

  pass(write, out) {
    const at = this.m._malloc(Math.max(4, out.byteLength));
    try {
      write(at);
      out.set(new Float32Array(this.heap(), at, out.length));
    } finally {
      this.m._free(at);
    }
  }

  direct(lights, lightCount, out) {
    const L = this.lumels, lp = this.put(lights);
    try {
      this.pass((at) => this.m._lm_direct(L.position, L.normal, L.count, lp, lightCount, at, this.threads), out);
    } finally { this.m._free(lp); }
  }

  gather(atlas, atlasSize, samples, sky, out) {
    const L = this.lumels, ap = this.put(atlas), sp = this.put(sky);
    try {
      this.pass((at) => this.m._lm_gather(L.position, L.normal, L.count, ap, atlasSize, samples, sp, at,
        this.threads), out);
    } finally { this.m._free(ap); this.m._free(sp); }
  }

  /** Probes at `positions` (three doubles each) gathering `atlas`: 27 floats each into `out`, and with `skyOut`
   *  nine of how much sky each sees (see lm_probes). */
  probes(positions, atlas, atlasSize, samples, sky, out, skyOut) {
    const count = positions.length / 3;
    const pp = this.put(positions), ap = this.put(atlas), sp = this.put(sky);
    const vp = skyOut ? this.m._malloc(Math.max(4, skyOut.byteLength)) : 0;
    try {
      this.pass((at) => {
        this.m._lm_probes(pp, count, ap, atlasSize, samples, sp, at, vp, this.threads);
        if (skyOut) skyOut.set(new Float32Array(this.heap(), vp, skyOut.length));
      }, out);
    } finally {
      this.m._free(pp); this.m._free(ap); this.m._free(sp);
      if (vp) this.m._free(vp);
    }
  }

  /** Each PNG's texture stats (see lm_texture_stats), decoded side by side. */
  textureStats(files, cutoffs, toLinear) {
    const lut = this.put(toLinear);
    const held = files.map((f) => this.put(f));
    const pairs = this.put(Uint32Array.from(files.flatMap((f, i) => [held[i], f.byteLength])));
    const cut = this.put(Float64Array.from(cutoffs));
    const at = this.m._malloc(Math.max(8, files.length * 40));
    try {
      this.m._lm_texture_stats(pairs, cut, files.length, lut, at, Math.max(1, Math.min(this.threads, files.length)));
      return new Float64Array(this.heap(), at, files.length * 5).slice();
    } finally {
      for (const p of [lut, ...held, pairs, cut, at]) this.m._free(p);
    }
  }
}

