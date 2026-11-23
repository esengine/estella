// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    rippleGpu.ts
 * @brief   The water's ripples, stepped on the GPU: the wave equation of {@link RippleField} in passes over a float texture.
 *
 * @details The grid is a pair of RGBA16F targets the passes ping-pong between: red the height (world units), green the foam, blue the height
 *          one step before (the scheme's velocity). Each frame runs, as material bakes before the scene:
 *            - one INJECT pass: moves the window by whole cells (the contents shift with it), puts the frame's disturbances into the height
 *              and the step before alike (so each starts at rest and spreads), feeds and fades the foam;
 *            - as many STEP passes as the frame needs substeps of one fixed length (see {@link RippleField.step} for why it is fixed);
 *            - one PACK pass into an RGBA8 target: the height as 16 bits either side of rest, read back for {@link GpuRipples.heightAt}.
 *          The Water shader reads the last state for the height it lifts each vertex by, the slope it shades with and the foam: what is
 *          drawn and what is read back are one texture. The read back lands a frame or two late; it is for what looks at the ripples (a
 *          float that bobs on a wake), not for physics, which the waves alone hold up (`Waters.sample`): the window follows the camera, so
 *          ripples are not the same on every machine and a server has none.
 *
 *          {@link RippleField} is the same arithmetic on the CPU, kept as the reference the GPU passes are checked against.
 */
import { Material, type MaterialHandle, type ShaderHandle } from '../render/material';
import { Renderer, deviceGeneration } from '../render/renderer';
import { RenderTexture, type RenderTextureHandle } from '../render/renderTexture';
import { captureTargetPixels, canCaptureTargetPixels } from '../render/framePixels';
import { createTextureFromPixels, updateTextureSubregion } from '../runtime/runtimeAssets';
import { getResourceManager, provideTextureContent, withdrawTextureContent } from '../wasm/resourceManager';
import { TextureContent, type ESEngineModule } from '../wasm';
import { log } from '../util/logger';

/** The most disturbances one frame puts in; past it the weakest are left out. */
export const MAX_RIPPLE_DROPS = 128;
/** Texels a disturbance takes in the drop texture: centre, radius and strength, foam. */
const DROP_TEXELS = 3;
/** Strengths are written as a share of this many times the grid's limit. */
const STRENGTH_SPAN = 4;

const MODE_STEP = 0, MODE_INJECT = 1, MODE_PACK = 2;

/** The passes, one shader: u_bakeA = (shift i, shift j, drops, mode), u_bakeB = (k, keep, limit, foam keep). */
export const RIPPLE_SHADER = `#pragma shader "Water Ripples"
#pragma version 300 es
#pragma domain PostProcess
#pragma param u_rippleState texture default(black) texel(data)
#pragma param u_rippleDrops texture default(black) texel(data)
#pragma param u_bakeA vec4 default(0,0,0,0)
#pragma param u_bakeB vec4 default(0,1,1,1)
#pragma fragment
precision highp float;
in vec2 v_texCoord;
out vec4 fragColor;
vec4 rippleCell(ivec2 q, int n) {
    return (q.x < 0 || q.y < 0 || q.x >= n || q.y >= n) ? vec4(0.0) : texelFetch(u_rippleState, q, 0);
}
float rippleWord(vec2 bytes) { return (floor(bytes.x * 255.0 + 0.5) * 256.0 + floor(bytes.y * 255.0 + 0.5)) / 65535.0; }
void main() {
    int n = textureSize(u_rippleState, 0).x;
    ivec2 p = ivec2(gl_FragCoord.xy);
    float mode = u_bakeA.w;
    float limit = u_bakeB.z;
    if (mode > 1.5) {
        vec4 c = rippleCell(p, n);
        // 65534 steps, so rest is a code of its own (32767) and reads back as exactly 0.
        float code = floor(clamp(c.r / (2.0 * limit) + 0.5, 0.0, 1.0) * 65534.0 + 0.5);
        fragColor = vec4(floor(code / 256.0) / 255.0, mod(code, 256.0) / 255.0, clamp(c.g, 0.0, 1.0), 1.0);
        return;
    }
    if (mode > 0.5) {
        // The window moved by whole cells: what is at p now was at p + shift. Then the frame's disturbances, each a smooth bump.
        vec4 c = rippleCell(p + ivec2(u_bakeA.xy), n);
        vec2 at = vec2(p) + 0.5;
        float add = 0.0, foam = 0.0;
        int drops = int(u_bakeA.z + 0.5);
        for (int i = 0; i < ${MAX_RIPPLE_DROPS}; ++i) {
            if (i >= drops) break;
            vec4 a = texelFetch(u_rippleDrops, ivec2(${DROP_TEXELS} * i, 0), 0);
            vec4 b = texelFetch(u_rippleDrops, ivec2(${DROP_TEXELS} * i + 1, 0), 0);
            vec4 f = texelFetch(u_rippleDrops, ivec2(${DROP_TEXELS} * i + 2, 0), 0);
            vec2 centre = (vec2(rippleWord(a.rg), rippleWord(a.ba)) * 2.0 - 0.5) * float(n);
            float radius = max(rippleWord(b.rg) * float(n), 1.0);
            float strength = (rippleWord(b.ba) * 2.0 - 1.0) * ${STRENGTH_SPAN}.0 * limit;
            vec2 d = at - centre;
            float d2 = dot(d, d) / (radius * radius);
            if (d2 >= 1.0) continue;
            float falloff = (1.0 - d2) * (1.0 - d2);
            add += strength * falloff;
            foam += rippleWord(f.rg) * falloff;
        }
        fragColor = vec4(clamp(c.r + add, -limit, limit), min(c.g + foam, 1.0) * u_bakeB.w, clamp(c.b + add, -limit, limit), 1.0);
        return;
    }
    // A step of the wave equation: pulled toward the mean of four neighbours, carrying the velocity it had, a little damped. The edge is
    // held at rest, which lets waves out of the window rather than reflecting them.
    vec4 c = rippleCell(p, n);
    if (p.x == 0 || p.y == 0 || p.x == n - 1 || p.y == n - 1) { fragColor = vec4(0.0, c.g, c.r, 1.0); return; }
    float around = rippleCell(p - ivec2(1, 0), n).r + rippleCell(p + ivec2(1, 0), n).r
                 + rippleCell(p - ivec2(0, 1), n).r + rippleCell(p + ivec2(0, 1), n).r - 4.0 * c.r;
    fragColor = vec4((2.0 * c.r - c.b + u_bakeB.x * around) * u_bakeB.y, c.g, c.r, 1.0);
}
#pragma end
`;

/** A 16-bit fraction as two bytes. */
function word(v: number, out: Uint8Array, at: number): void {
    const code = Math.round(Math.min(Math.max(v, 0), 1) * 65535);
    out[at] = code >> 8;
    out[at + 1] = code & 255;
}

interface Drop { x: number; z: number; radius: number; strength: number }

/** The ripple grid on the GPU: one per water zone that keeps ripples. */
export class GpuRipples {
    readonly n: number;
    readonly size: number;
    readonly cell: number;
    originX = 0;
    originZ = 0;
    /** The most height a cell may hold either way (world units): disturbances that go on saturate here. */
    limit = 1;
    private shader: ShaderHandle = 0;
    private states: [RenderTextureHandle | null, RenderTextureHandle | null] = [null, null];
    private materials: [MaterialHandle, MaterialHandle] = [0, 0];
    private pack: RenderTextureHandle | null = null;
    private dropTexture = 0;
    private dropBytes: Uint8Array;
    private drops: Drop[] = [];
    private current = 0;
    private carry = 0;
    private shiftI = 0;
    private shiftJ = 0;
    private generation = -1;
    private failed = false;
    private warned = false;
    /** The last height read back, and the window and limit it was packed with. */
    private readback: { heights: Float32Array; originX: number; originZ: number; frame: number } | null = null;
    private pending = false;
    private packed: { originX: number; originZ: number; limit: number; frame: number } | null = null;
    /** Frames stepped: which frame's state a read back holds. */
    private frame = 0;

    constructor(n: number, size: number) {
        this.n = Math.max(8, Math.floor(n));
        this.size = Math.max(1e-3, size);
        this.cell = this.size / this.n;
        this.dropBytes = new Uint8Array(MAX_RIPPLE_DROPS * DROP_TEXELS * 4);
    }

    /** The texture the Water shader reads: the state the last frame's passes ended on. 0 before the GPU holds one. */
    get texture(): number {
        return this.states[this.current]?.texture ?? 0;
    }

    /** How many frames have been queued: a disturbance made now goes in with frame `frames + 1`. */
    get frames(): number {
        return this.frame;
    }

    /** Whether the passes could be made on this device. */
    get usable(): boolean {
        return !this.failed;
    }

    /** Centres the window on (x, z), in whole cells; the contents move with it on the next frame's inject pass. */
    recenter(x: number, z: number): boolean {
        const wantX = Math.round((x - this.size / 2) / this.cell) * this.cell;
        const wantZ = Math.round((z - this.size / 2) / this.cell) * this.cell;
        const di = Math.round((wantX - this.originX) / this.cell), dj = Math.round((wantZ - this.originZ) / this.cell);
        if (di === 0 && dj === 0) return false;
        this.shiftI += di;
        this.shiftJ += dj;
        this.originX = wantX;
        this.originZ = wantZ;
        // Ripples move with the water, not the window: drops already queued keep their world place.
        return true;
    }

    /** A smooth bump of `strength` world units (negative a dip) over `radius`, put in on the next frame. */
    disturb(x: number, z: number, radius: number, strength: number): void {
        if (strength === 0 || !(radius > 0)) return;
        this.drops.push({ x, z, radius, strength });
    }

    /** The ripples' height at (x, z) as last read back from the GPU (a frame or two old), 0 outside the window or before any. */
    heightAt(x: number, z: number): number {
        const r = this.readback;
        if (!r) return 0;
        const i = Math.floor((x - r.originX) / this.cell), j = Math.floor((z - r.originZ) / this.cell);
        return i < 0 || j < 0 || i >= this.n || j >= this.n ? 0 : r.heights[j * this.n + i]!;
    }

    /**
     * The last read back whole: the heights (row j, column i is the cell at originX + i * cell, originZ + j * cell) and the frame they
     * are the state after (the first update is frame 1). For checks against {@link RippleField}. @internal
     */
    lastReadback(): { heights: Float32Array; originX: number; originZ: number; frame: number } | null {
        return this.readback;
    }

    /**
     * Queues this frame's passes: `dt` seconds of waves at `speed` world units a second, losing `damping` of their height a second, the
     * foam fading by `foamFade` a second. False where the device cannot run them.
     */
    update(module: ESEngineModule | null, dt: number, speed: number, damping: number, foamFade: number): boolean {
        if (this.failed) return false;
        if (!this.ensure(module)) return false;
        const h = Math.min((0.5 * this.cell) / Math.max(speed, 1e-6), 1 / 60);
        this.carry += Math.max(dt, 0);
        const substeps = Math.min(Math.floor(this.carry / h), Math.ceil(0.25 / h));
        this.carry = Math.min(this.carry - substeps * h, h);
        const k = (speed * h / this.cell) ** 2;
        const keep = Math.max(1 - damping * h, 0);
        const foamKeep = Math.exp(-Math.max(foamFade, 0) * Math.max(dt, 0));
        this.frame++;
        const count = this.writeDrops(module);
        const b: [number, number, number, number] = [k, keep, this.limit, foamKeep];
        let ok = this.pass([this.shiftI, this.shiftJ, count, MODE_INJECT], b);
        this.shiftI = this.shiftJ = 0;
        for (let s = 0; ok && s < substeps; s++) ok = this.pass([0, 0, 0, MODE_STEP], b);
        if (ok) ok = this.packAndRead(module, b);
        if (!ok) { this.failed = true; log.warn('water', 'ripples: the GPU passes could not be queued; the water keeps none'); }
        return ok;
    }

    release(): void {
        for (const s of this.states) if (s) RenderTexture.release(s);
        if (this.pack) RenderTexture.release(this.pack);
        for (const m of this.materials) if (m) Material.release(m);
        if (this.shader) Material.releaseShader(this.shader);
        if (this.dropTexture) { withdrawTextureContent(this.dropTexture); getResourceManager()?.releaseTexture(this.dropTexture); }
        this.states = [null, null];
        this.pack = null;
        this.materials = [0, 0];
        this.shader = this.dropTexture = 0;
        this.readback = null;
        this.packed = null;
    }

    /** Makes the targets and materials, again after the device was lost (the ripples start still). */
    private ensure(module: ESEngineModule | null): boolean {
        const generation = deviceGeneration();
        if (generation !== this.generation) { this.release(); this.generation = generation; }
        if (this.shader) return true;
        this.shader = Material.compileShader(RIPPLE_SHADER);
        const make = (floatColor: boolean) => RenderTexture.create({ width: this.n, height: this.n, depth: false, filter: floatColor ? 'linear' : 'nearest', floatColor });
        this.states = [make(true), make(true)];
        this.pack = make(false);
        const bytes = this.dropBytes;
        this.dropTexture = createTextureFromPixels(module, { width: MAX_RIPPLE_DROPS * DROP_TEXELS, height: 1, pixels: bytes }, TextureContent.Retained, false,
            { filterMode: 'nearest', wrapMode: 'clamp', srgb: false });
        const drops = this.dropTexture;
        if (drops) provideTextureContent(drops, () => { updateTextureSubregion(module, drops, 0, 0, MAX_RIPPLE_DROPS * DROP_TEXELS, 1, bytes); return true; });
        if (!this.shader || !this.states[0]?.texture || !this.states[1]?.texture || !this.pack?._handle || !drops) {
            this.failed = true;
            log.warn('water', 'ripples: this device cannot keep them on the GPU');
            return false;
        }
        for (const i of [0, 1] as const) {
            const m = Material.create({ shader: this.shader });
            Material.setUniform(m, 'u_rippleState', Material.tex(this.states[i]!.texture));
            Material.setUniform(m, 'u_rippleDrops', Material.tex(drops));
            this.materials[i] = m;
        }
        this.current = 0;
        return true;
    }

    /** Writes the queued disturbances into the drop texture, in window coordinates; returns how many. */
    private writeDrops(module: ESEngineModule | null): number {
        let list = this.drops;
        this.drops = [];
        const size = this.size;
        list = list.filter((d) => d.x + d.radius > this.originX && d.z + d.radius > this.originZ
            && d.x - d.radius < this.originX + size && d.z - d.radius < this.originZ + size);
        if (list.length > MAX_RIPPLE_DROPS) {
            if (!this.warned) { this.warned = true; log.warn('water', `ripples: more than ${MAX_RIPPLE_DROPS} disturbances in a frame; the weakest are left out`); }
            list.sort((a, b) => Math.abs(b.strength) - Math.abs(a.strength));
            list.length = MAX_RIPPLE_DROPS;
        }
        if (list.length === 0) return 0;
        const out = this.dropBytes;
        list.forEach((d, i) => {
            const at = i * DROP_TEXELS * 4;
            // The centre as a share of the window, from -0.5 to 1.5 (a drop beside the window still reaches into it), in 16 bits each.
            word(((d.x - this.originX) / size + 0.5) / 2, out, at);
            word(((d.z - this.originZ) / size + 0.5) / 2, out, at + 2);
            const r = Math.max(d.radius, this.cell);
            word(r / size, out, at + 4);
            word(d.strength / (STRENGTH_SPAN * this.limit) / 2 + 0.5, out, at + 6);
            word(Math.min(Math.abs(d.strength) / Math.max(r * 0.25, 1e-6), 1), out, at + 8);
        });
        updateTextureSubregion(module, this.dropTexture, 0, 0, list.length * DROP_TEXELS, 1, out.subarray(0, list.length * DROP_TEXELS * 4));
        return list.length;
    }

    /** One pass from the current state into the other; the other is current after it. */
    private pass(a: [number, number, number, number], b: [number, number, number, number]): boolean {
        const from = this.current, to = 1 - this.current;
        const ticket = Renderer.bakeMaterial(this.materials[from], this.shader, this.states[to]!._handle, 0, 0, this.n, this.n, a, b);
        if (!ticket) return false;
        // Asked once so the renderer forgets it: the passes are fire and forget, and a failed one shows in the next frame's queue.
        void Renderer.bakeState(ticket);
        this.current = to;
        return true;
    }

    /** Packs the state for reading back, and reads back the last frame's pack when none is on its way. */
    private packAndRead(module: ESEngineModule | null, b: [number, number, number, number]): boolean {
        const ticket = Renderer.bakeMaterial(this.materials[this.current], this.shader, this.pack!._handle, 0, 0, this.n, this.n, [0, 0, 0, MODE_PACK], b);
        if (!ticket) return false;
        void Renderer.bakeState(ticket);
        // The target holds what the passes queued LAST frame drew: read it with the window and limit it was packed with.
        const drawn = this.packed;
        this.packed = { originX: this.originX, originZ: this.originZ, limit: this.limit, frame: this.frame };
        if (!drawn || this.pending || !module || !canCaptureTargetPixels(module)) return true;
        this.pending = true;
        const n = this.n, generation = this.generation;
        void captureTargetPixels(module, this.pack!._handle, n, n).then((pixels) => {
            this.pending = false;
            if (!pixels || generation !== this.generation) return;
            const heights = new Float32Array(n * n);
            for (let q = 0; q < n * n; q++) {
                const code = pixels.rgba[q * 4]! * 256 + pixels.rgba[q * 4 + 1]!;
                heights[q] = (code / 65534 - 0.5) * 2 * drawn.limit;
            }
            this.readback = { heights, originX: drawn.originX, originZ: drawn.originZ, frame: drawn.frame };
        }, () => { this.pending = false; });
        return true;
    }
}
