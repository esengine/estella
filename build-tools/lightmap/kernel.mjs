// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The lightmap bake kernel (lightmap-kernel.{mjs,wasm}, built by
 *        tools/lightmap-wasm/build.mjs): uploads a scene once, then runs each
 *        pass over every lumel on the kernel's own threads.
 */

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

  put(array) {
    const at = this.m._malloc(Math.max(4, array.byteLength));
    if (!at) throw new Error('lightmap kernel: out of memory');
    new Uint8Array(this.m.HEAPU8.buffer, at, array.byteLength)
      .set(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
    return at;
  }

  release() {
    for (const at of this.held) this.m._free(at);
    this.held = [];
    this.lumels = null;
  }

  /** Replaces the scene: triangles, their lookup, and the lumels every pass solves. */
  scene(s) {
    this.release();
    const hold = (a) => { const at = this.put(a); this.held.push(at); return at; };
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
      out.set(new Float32Array(this.m.HEAPU8.buffer, at, out.length));
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
}
