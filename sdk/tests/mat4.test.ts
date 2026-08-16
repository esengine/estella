// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Correctness of the camera/projection matrix math. These functions are
 *        exercised indirectly whenever CameraPlugin builds a view/projection,
 *        but nothing asserted the numbers were right — a sign flip in ortho or a
 *        transposed multiply would render "fine" and be silently wrong. Column
 *        major throughout: element (row r, col c) lives at m[c * 4 + r], and a
 *        point transforms as out[r] = Σ_c m[c*4+r] · v[c].
 */
import { describe, it, expect } from 'vitest';
import {
  ortho, perspective, invertTranslation, invertViewZ, multiply, frustumCornersWorld, IDENTITY,
} from '../src/math/mat4';

const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThanOrEqual(eps);

/** Column-major matrix · (x,y,z,w) → [x',y',z',w']. */
function apply(m: Float32Array, x: number, y: number, z: number, w = 1): [number, number, number, number] {
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (let r = 0; r < 4; r++) {
    out[r] = m[0 * 4 + r] * x + m[1 * 4 + r] * y + m[2 * 4 + r] * z + m[3 * 4 + r] * w;
  }
  return out;
}

// Every builder returns a shared module-level scratch array, so a second call
// clobbers the first. Snapshot before comparing — this mirrors how callers must
// treat the results and guards the shared-buffer contract itself.
const snap = (m: Float32Array): Float32Array => Float32Array.from(m);

describe('mat4.ortho', () => {
  it('maps the box corners to the NDC cube and the center to the origin', () => {
    const m = snap(ortho(-10, 10, -5, 5, 1, 100));
    // x: [-10,10] → [-1,1]; y: [-5,5] → [-1,1] (z picked in-range, does not affect x/y).
    expect(apply(m, 10, 5, -1)[0]).toBeCloseTo(1, 6);
    expect(apply(m, -10, -5, -1)[0]).toBeCloseTo(-1, 6);
    expect(apply(m, 10, 5, -1)[1]).toBeCloseTo(1, 6);
    expect(apply(m, -10, -5, -1)[1]).toBeCloseTo(-1, 6);
    const c = apply(m, 0, 0, -50.5); // (center x, center y, mid eye-depth)
    close(c[0], 0); close(c[1], 0); close(c[2], 0);
  });

  it('uses the OpenGL depth convention: near plane → -1, far plane → +1', () => {
    const m = snap(ortho(-1, 1, -1, 1, 1, 100));
    // Eye space looks down -Z, so the near plane sits at z = -near, far at z = -far.
    close(apply(m, 0, 0, -1)[2], -1);
    close(apply(m, 0, 0, -100)[2], 1);
  });

  it('is affine in w and leaves the perspective row untouched (w stays 1)', () => {
    const m = snap(ortho(-3, 7, -2, 8, 0.5, 20));
    expect(apply(m, 4, 4, -4)[3]).toBe(1);
  });
});

describe('mat4.perspective', () => {
  it('emits w = -z (the perspective divide) and keeps the optical axis centered', () => {
    const m = snap(perspective(Math.PI / 2, 16 / 9, 0.1, 1000));
    const p = apply(m, 0, 0, -5);
    close(p[0], 0);
    close(p[1], 0);
    close(p[3], 5); // w = -z = -(-5)
  });

  it('scales x by 1/aspect and y by the focal length at fov=90°', () => {
    // fov = 90° → f = 1/tan(45°) = 1, so m[0] = 1/aspect, m[5] = 1.
    const aspect = 2;
    const m = snap(perspective(Math.PI / 2, aspect, 1, 100));
    close(m[0], 1 / aspect);
    close(m[5], 1);
    close(m[11], -1);
  });
});

describe('mat4.invertTranslation', () => {
  it('sends the camera position to the origin', () => {
    const m = snap(invertTranslation(3, -4, 5));
    const o = apply(m, 3, -4, 5);
    close(o[0], 0); close(o[1], 0); close(o[2], 0); close(o[3], 1);
  });
});

describe('mat4.invertViewZ', () => {
  it('equals invertTranslation when the camera is unrotated (θ=0)', () => {
    const t = snap(invertTranslation(7, -2, 3));
    const v = snap(invertViewZ(7, -2, 3, 1, 0)); // cosθ=1, sinθ=0
    for (let i = 0; i < 16; i++) close(v[i], t[i]);
  });

  it('sends the camera position to the origin under rotation', () => {
    const th = Math.PI / 3;
    const m = snap(invertViewZ(5, 8, -2, Math.cos(th), Math.sin(th)));
    const o = apply(m, 5, 8, -2);
    close(o[0], 0); close(o[1], 0); close(o[2], 0);
  });

  it('rotates world into view space: a +90° camera turns +X into -Y', () => {
    // Camera at origin rotated +90° (cos=0, sin=1). A world point on +X should
    // land on the view-space -Y axis (the world rotates by -θ into the view).
    const m = snap(invertViewZ(0, 0, 0, 0, 1));
    const o = apply(m, 1, 0, 0);
    close(o[0], 0); close(o[1], -1);
  });
});

describe('mat4.multiply', () => {
  it('IDENTITY is the two-sided identity', () => {
    const a = snap(invertTranslation(2, 3, 4));
    const left = snap(multiply(IDENTITY, a));
    const right = snap(multiply(a, IDENTITY));
    for (let i = 0; i < 16; i++) { close(left[i], a[i]); close(right[i], a[i]); }
  });

  it('composes transforms in column-major order (M·v applies the right operand first)', () => {
    // ortho ∘ view: projecting the camera-space origin of a translated camera
    // must equal projecting (0,0,0) directly — the camera sits at its own origin.
    const proj = snap(ortho(-10, 10, -10, 10, 1, 100));
    const view = snap(invertTranslation(4, -6, -50));
    const vp = snap(multiply(proj, view));
    const throughCombined = apply(vp, 4, -6, -50);
    const throughSeparate = apply(proj, ...(apply(view, 4, -6, -50).slice(0, 3) as [number, number, number]));
    for (let i = 0; i < 4; i++) close(throughCombined[i], throughSeparate[i]);
  });

  it('matches a hand-computed product on a non-symmetric pair', () => {
    // Two distinct translations compose additively: T(a)·T(b) = T(a+b).
    const A = snap(invertTranslation(-1, -2, -3)); // translate(+1,+2,+3)
    const B = snap(invertTranslation(-4, -5, -6)); // translate(+4,+5,+6)
    const AB = snap(multiply(A, B));
    // Combined translation column (m[12..14]) must be the sum (+5,+7,+9).
    close(AB[12], 5); close(AB[13], 7); close(AB[14], 9); close(AB[15], 1);
  });
});

describe('mat4 shared scratch buffers (footgun contract)', () => {
  it('reuses one array per builder — callers must snapshot before the next call', () => {
    const first = ortho(-1, 1, -1, 1, 1, 10);
    const second = ortho(-2, 2, -2, 2, 1, 20);
    expect(first).toBe(second); // same reference: the first result was overwritten
    expect(first[0]).toBeCloseTo(2 / 4, 6); // now holds the SECOND box's 2/(r-l)
  });

  it('IDENTITY is a genuine identity matrix and is not a scratch target', () => {
    expect(Array.from(IDENTITY)).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    multiply(IDENTITY, IDENTITY); // multiply writes its own buffer, never IDENTITY
    expect(IDENTITY[0]).toBe(1);
    expect(IDENTITY[5]).toBe(1);
  });
});

describe('mat4.frustumCornersWorld', () => {
  // Corner i: near face bl, br, tr, tl (i = 0..3), then the far face.
  const corner = (c: Float32Array, i: number): [number, number, number] =>
    [c[i * 3]!, c[i * 3 + 1]!, c[i * 3 + 2]!];

  it('undoes an orthographic view-projection back to its own box', () => {
    // The camera sits at z = 10 looking down -Z; the symmetric ortho depth range
    // puts the near face BEHIND it, which is what the box really is.
    const vp = snap(multiply(snap(ortho(-400, 400, -300, 300, -1000, 1000)),
                             snap(invertViewZ(0, 0, 10, 1, 0))));
    const c = frustumCornersWorld(vp);
    expect(corner(c, 0).map((v) => Math.round(v))).toEqual([-400, -300, 1010]);
    expect(corner(c, 2).map((v) => Math.round(v))).toEqual([400, 300, 1010]);
    expect(corner(c, 4).map((v) => Math.round(v))).toEqual([-400, -300, -990]);
    expect(corner(c, 6).map((v) => Math.round(v))).toEqual([400, 300, -990]);
  });

  it('opens out with distance under a perspective projection', () => {
    // 90° vertical fov, aspect 2: the near face is 2x1 half-extents at z = -1,
    // and the far face ten times that at z = -10.
    const vp = snap(perspective(Math.PI / 2, 2, 1, 10));
    const c = frustumCornersWorld(vp);
    const [nx, ny, nz] = corner(c, 2);
    close(nx, 2, 1e-4); close(ny, 1, 1e-4); close(nz, -1, 1e-4);
    const [fx, fy, fz] = corner(c, 6);
    close(fx, 20, 1e-3); close(fy, 10, 1e-3); close(fz, -10, 1e-3);
  });

  it('collapses to the origin for a matrix with no inverse', () => {
    // Not "whatever the scratch held": a singular matrix has no frustum, and the
    // previous camera's corners would be indistinguishable from this one's.
    frustumCornersWorld(snap(perspective(Math.PI / 2, 2, 1, 10)));
    expect(Array.from(frustumCornersWorld(new Float32Array(16)))).toEqual(new Array(24).fill(0));
  });
});
