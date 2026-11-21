// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    ripples.ts
 * @brief   The disturbance a thing makes in water: a wave equation on a grid, and the foam it leaves.
 *
 * @details A water zone that is asked to ripple keeps a square window of its surface, a few hundred world units across, as a grid of heights, and each
 *          step moves it by the wave equation (every cell is pulled toward the mean of its four neighbours, and carries the velocity it had), with a little
 *          damping so a ripple dies. A disturbance (a body entering, a body moving, a script's `disturb`) is a smooth bump put into the grid; it spreads
 *          as a ring at the wave speed. Beside the height the grid keeps a foam: fed where a disturbance was and where the water moves, and fading with time.
 *
 *          It is the CPU's, and a plain array: it runs wherever the app does, is the same on every backend, and can be read back. The window follows the camera
 *          (it is re-centred in whole cells and the contents shift with it), so a lake or an ocean of any size has ripples where they are seen, for the
 *          price of one grid. The Water shader reads it as a texture (`encode`) for the slope it adds to the waves' and for the foam.
 *
 *          The wave equation is stepped in substeps of one fixed length, short enough that the wave crosses at most half a cell in one (past that it would
 *          not be stable), and what is left of a frame carries to the next. The length must not change from one step to the next: the scheme reads the last
 *          step's height as a velocity, so a long step after a short one multiplies every wave by their ratio, and frames of uneven length grew a ripple
 *          without bound (a hitch every few frames took one past 1e29 in twelve seconds).
 */

/** A ripple grid over a square window of a body's own xz plane. */
export class RippleField {
    /** Cells along a side. */
    readonly n: number;
    /** World size of the window along a side. */
    readonly size: number;
    /** World size of one cell. */
    readonly cell: number;
    /** The window's minimum corner in the body's xz plane. */
    originX = 0;
    originZ = 0;
    /** The most height a cell may hold, either way: disturbances that go on (a body moving) saturate here instead of piling up. */
    limit = Infinity;
    private height: Float32Array;
    private previous: Float32Array;
    private next: Float32Array;
    private foam: Float32Array;
    /** Time stepped by no substep yet: the part of a frame shorter than one. */
    private carry = 0;

    constructor(n: number, size: number) {
        this.n = Math.max(8, Math.floor(n));
        this.size = Math.max(1e-3, size);
        this.cell = this.size / this.n;
        const cells = this.n * this.n;
        this.height = new Float32Array(cells);
        this.previous = new Float32Array(cells);
        this.next = new Float32Array(cells);
        this.foam = new Float32Array(cells);
    }

    /** The cell index holding (x, z), or -1 outside the window. */
    private index(x: number, z: number): number {
        const i = Math.floor((x - this.originX) / this.cell), j = Math.floor((z - this.originZ) / this.cell);
        return i < 0 || j < 0 || i >= this.n || j >= this.n ? -1 : j * this.n + i;
    }

    /**
     * Moves the window so it is centred on (x, z), in whole cells: the grid shifts under it, what was on the side it leaves is gone and what comes in is still water.
     * Returns whether it moved.
     */
    recenter(x: number, z: number): boolean {
        const wantX = Math.round((x - this.size / 2) / this.cell) * this.cell;
        const wantZ = Math.round((z - this.size / 2) / this.cell) * this.cell;
        const di = Math.round((wantX - this.originX) / this.cell), dj = Math.round((wantZ - this.originZ) / this.cell);
        if (di === 0 && dj === 0) return false;
        if (Math.abs(di) >= this.n || Math.abs(dj) >= this.n) {
            this.height.fill(0); this.previous.fill(0); this.foam.fill(0);
        } else {
            for (const field of [this.height, this.previous, this.foam]) this.shift(field, di, dj);
        }
        this.originX = wantX;
        this.originZ = wantZ;
        return true;
    }

    /** Shifts a grid so the cell that was at (i + di, j + dj) is at (i, j): the window moving by (di, dj) cells. */
    private shift(field: Float32Array, di: number, dj: number): void {
        const n = this.n, copy = field.slice();
        field.fill(0);
        for (let j = 0; j < n; j++) {
            const sj = j + dj;
            if (sj < 0 || sj >= n) continue;
            for (let i = 0; i < n; i++) {
                const si = i + di;
                if (si >= 0 && si < n) field[j * n + i] = copy[sj * n + si]!;
            }
        }
    }

    /**
     * A smooth bump of `strength` (a height in world units; negative is a dip) and `radius` put into the water at (x, z). It is put into the current heights and the
     * last step's alike, so it starts at rest and spreads, and it feeds the foam by as much as it is strong.
     */
    disturb(x: number, z: number, radius: number, strength: number): void {
        const r = Math.max(radius, this.cell);
        const i0 = Math.floor((x - r - this.originX) / this.cell), i1 = Math.ceil((x + r - this.originX) / this.cell);
        const j0 = Math.floor((z - r - this.originZ) / this.cell), j1 = Math.ceil((z + r - this.originZ) / this.cell);
        for (let j = Math.max(j0, 0); j <= Math.min(j1, this.n - 1); j++) {
            for (let i = Math.max(i0, 0); i <= Math.min(i1, this.n - 1); i++) {
                const dx = this.originX + (i + 0.5) * this.cell - x, dz = this.originZ + (j + 0.5) * this.cell - z;
                const d2 = (dx * dx + dz * dz) / (r * r);
                if (d2 >= 1) continue;
                const falloff = (1 - d2) * (1 - d2);
                const at = j * this.n + i;
                const room = this.limit;
                this.height[at] = Math.min(Math.max(this.height[at]! + strength * falloff, -room), room);
                this.previous[at] = Math.min(Math.max(this.previous[at]! + strength * falloff, -room), room);
                this.foam[at] = Math.min(this.foam[at]! + Math.min(Math.abs(strength) / Math.max(r * 0.25, 1e-6), 1) * falloff, 1);
            }
        }
    }

    /**
     * Steps the grid `dt` seconds on: waves travelling at `speed` (world units a second), losing `damping` of their height a second, and the foam fading by `foamFade` a second.
     * The window's edge lets waves out (the heights there are held at rest) rather than reflecting them.
     */
    step(dt: number, speed: number, damping: number, foamFade: number): void {
        if (!(dt > 0)) return;
        const n = this.n;
        const h = Math.min((0.5 * this.cell) / Math.max(speed, 1e-6), 1 / 60);
        this.carry += dt;
        // A frame longer than a quarter second steps a quarter second: the rest is dropped rather than paid for in one frame.
        const substeps = Math.min(Math.floor(this.carry / h), Math.ceil(0.25 / h));
        this.carry = Math.min(this.carry - substeps * h, h);
        const k = (speed * h / this.cell) ** 2;
        const keep = Math.max(1 - damping * h, 0);
        for (let s = 0; s < substeps; s++) {
            const a = this.height, b = this.previous, out = this.next;
            for (let j = 1; j < n - 1; j++) {
                for (let i = 1; i < n - 1; i++) {
                    const at = j * n + i;
                    const around = a[at - 1]! + a[at + 1]! + a[at - n]! + a[at + n]! - 4 * a[at]!;
                    out[at] = (2 * a[at]! - b[at]! + k * around) * keep;
                }
            }
            // The edge is held at rest: the water beyond it is still water.
            for (let i = 0; i < n; i++) { out[i] = 0; out[(n - 1) * n + i] = 0; out[i * n] = 0; out[i * n + n - 1] = 0; }
            this.previous = this.height;
            this.height = out;
            this.next = b;
        }
        const fade = Math.exp(-Math.max(foamFade, 0) * dt);
        for (let q = 0; q < this.foam.length; q++) this.foam[q]! *= fade;
    }

    /** The height of the ripples at (x, z) in world units, 0 outside the window. */
    heightAt(x: number, z: number): number {
        const at = this.index(x, z);
        return at < 0 ? 0 : this.height[at]!;
    }

    /** The foam at (x, z), 0 to 1, 0 outside the window. */
    foamAt(x: number, z: number): number {
        const at = this.index(x, z);
        return at < 0 ? 0 : this.foam[at]!;
    }

    /** The greatest height anywhere in the grid, for a caller asking whether the water is still. */
    peak(): number {
        let m = 0;
        for (let q = 0; q < this.height.length; q++) m = Math.max(m, Math.abs(this.height[q]!));
        return m;
    }

    /**
     * The grid as RGBA8 for the shader: red the height (0.5 at rest, `range` above or below at 1 and 0), green the foam, blue and alpha unused (255).
     * Row j of the grid is row j of the image, so the shader's uv is (x - originX) / size, (z - originZ) / size.
     */
    encode(range: number, into?: Uint8Array): Uint8Array {
        const out = into && into.length === this.n * this.n * 4 ? into : new Uint8Array(this.n * this.n * 4);
        for (let q = 0; q < this.height.length; q++) {
            out[q * 4] = Math.round(Math.min(Math.max(this.height[q]! / (2 * range) + 0.5, 0), 1) * 255);
            out[q * 4 + 1] = Math.round(Math.min(Math.max(this.foam[q]!, 0), 1) * 255);
            out[q * 4 + 2] = 0;
            out[q * 4 + 3] = 255;
        }
        return out;
    }
}
