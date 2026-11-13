// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  surfaceCache.ts
 * @brief A terrain's baked surface (a runtime virtual texture): one page per node of ground, of what the Terrain Layers shader would make
 *        of it before lighting, drawn once on the GPU and read by every frame after.
 *
 * A page is two squares side by side in one render target: the colour (its square root, so eight bits keep the dark steps) with the
 * roughness, and the normal (octahedral) with the occlusion. Each square is `texels` across with a texel of border all round, so a page
 * read bilinearly at its edge meets its neighbour. The squares are drawn by the Terrain Surface Bake shader through the ground's own
 * material (Renderer.bakeMaterial): the same params say the same thing to both.
 *
 * Pages are kept by node and by what they were made from (`source`): a node whose page of heights and paint was made again, or a ground
 * whose layers were packed again, gets a new source and its surface is drawn again. The least recently drawn page gives up its slot.
 */
import { Renderer, deviceGeneration } from '../render/renderer';
import { getResourceManager } from '../wasm/resourceManager';
import { log } from '../util/logger';

/** Render target flags: linear filtering (2), and the texture kept as drawn (4): on a device that stores targets top-down, no copy turned
 *  to bottom-up rows is made, and the Terrain Layers shader reads the page's rows as that device stores them. */
const TARGET_FLAGS = 2 | 4;

/** What a page is drawn from: the node's corner, size and level, its page of heights and paint, and what it was all made from. */
export interface SurfaceRequest {
    key: string;
    source: string;
    x0: number;
    z0: number;
    size: number;
    level: number;
    pageX: number;
    pageY: number;
}

interface Page {
    slot: number;
    source: string;
    /** The two squares' bake tickets while they are being drawn, and whether each is done. */
    tickets: [number, number] | null;
    done: [boolean, boolean];
    asked: number;
    ready: boolean;
    used: number;
}

/** Frames a bake may wait (for its program, mostly) before it is asked for again. */
const BAKE_PATIENCE = 240;

export class SurfaceCache {
    readonly texels: number;
    readonly perRow: number;
    readonly rows: number;
    readonly width: number;
    readonly height: number;
    private target_ = 0;
    private texture_ = 0;
    private generation_ = -1;
    private readonly pages_ = new Map<string, Page>();
    private readonly free_: number[] = [];
    private tick_ = 0;
    private failed_ = false;

    /** `texels` a page's side; `perRow` by `rows` pages. */
    constructor(texels: number, perRow: number, rows: number) {
        this.texels = texels;
        this.perRow = perRow;
        this.rows = rows;
        this.width = perRow * 2 * (texels + 2);
        this.height = rows * (texels + 2);
        for (let i = perRow * rows - 1; i >= 0; i--) this.free_.push(i);
    }

    /** The atlas's texture (a resource handle a material reads), made on first use; 0 when the renderer has no targets. */
    texture(): number {
        if (!this.target_) {
            this.target_ = Renderer.createRenderTarget(this.width, this.height, TARGET_FLAGS);
            const id = this.target_ ? Renderer.getTargetTexture(this.target_) : 0;
            this.texture_ = id ? getResourceManager()?.wrapDeviceTexture?.(id, this.width, this.height) ?? 0 : 0;
            this.generation_ = deviceGeneration();
        }
        return this.texture_;
    }

    /** Whether a bake failed outright (no target, shader or material that bakes): the ground is drawn from its layers. */
    get failed(): boolean { return this.failed_; }

    /** Every page is drawn again (the layers were packed again, the paint changed). */
    invalidate(): void {
        for (const page of this.pages_.values()) page.source = '';
    }

    /**
     * One frame: hands back the slot of each requested node whose page is ready, and asks for at most `budget` new pages to be drawn
     * through `material` and `shader`, nearest the front of `requests` first.
     */
    update(requests: readonly SurfaceRequest[], material: number, shader: number, budget: number): Map<string, number> {
        const ready = new Map<string, number>();
        if (this.failed_ || !this.texture()) return ready;
        const tick = ++this.tick_;
        // A lost device kept the target and zeroed it: every page is drawn again.
        if (this.generation_ !== deviceGeneration()) {
            this.generation_ = deviceGeneration();
            for (const page of this.pages_.values()) { page.source = ''; page.ready = false; page.tickets = null; }
        }
        for (const page of this.pages_.values()) this.poll(page, tick);
        if (this.failed_) return ready;
        for (const r of requests) {
            let page = this.pages_.get(r.key);
            if (page) page.used = tick;
            if (page && page.source === r.source) {
                if (page.ready) ready.set(r.key, page.slot);
                continue;
            }
            // Drawing already, from an older source: let it land, then draw again.
            if (page?.tickets) continue;
            if (budget <= 0) continue;
            if (!page) {
                const slot = this.claim(tick);
                if (slot < 0) continue;
                page = { slot, source: '', tickets: null, done: [false, false], asked: 0, ready: false, used: tick };
                this.pages_.set(r.key, page);
            }
            this.bake(page, r, material, shader, tick);
            budget--;
        }
        return ready;
    }

    release(): void {
        if (this.texture_) getResourceManager()?.releaseTexture(this.texture_);
        if (this.target_) Renderer.releaseRenderTarget(this.target_);
        this.target_ = 0;
        this.texture_ = 0;
        this.pages_.clear();
    }

    /** A free slot, or the least recently drawn page's (not one drawn this frame); -1 when every page is in use. */
    private claim(tick: number): number {
        const free = this.free_.pop();
        if (free !== undefined) return free;
        let oldest: [string, Page] | null = null;
        for (const entry of this.pages_) {
            if (entry[1].used >= tick || entry[1].tickets) continue;
            if (!oldest || entry[1].used < oldest[1].used) oldest = entry;
        }
        if (!oldest) return -1;
        this.pages_.delete(oldest[0]);
        return oldest[1].slot;
    }

    private bake(page: Page, r: SurfaceRequest, material: number, shader: number, tick: number): void {
        const side = this.texels + 2;
        const x = (page.slot % this.perRow) * 2 * side, y = Math.floor(page.slot / this.perRow) * side;
        const b = [r.pageX, r.pageY, r.level, this.texels] as const;
        page.tickets = [
            Renderer.bakeMaterial(material, shader, this.target_, x, y, side, side, [r.x0, r.z0, r.size, 0], b),
            Renderer.bakeMaterial(material, shader, this.target_, x + side, y, side, side, [r.x0, r.z0, r.size, 1], b),
        ];
        page.done = [false, false];
        page.asked = tick;
        page.source = r.source;
        page.ready = false;
    }

    private poll(page: Page, tick: number): void {
        if (!page.tickets) return;
        for (const i of [0, 1] as const) {
            if (page.done[i]) continue;
            const state = Renderer.bakeState(page.tickets[i]);
            if (state === 1) page.done[i] = true;
            else if (state < 0) {
                if (!this.failed_) log.warn('terrain', 'the engine could not bake the ground\'s surface; it is drawn from its layers');
                this.failed_ = true;
                return;
            }
        }
        if (page.done[0] && page.done[1]) {
            page.tickets = null;
            page.ready = true;
        } else if (tick - page.asked > BAKE_PATIENCE) {
            // Never drawn (its program never came, or its pass was dropped): asked for again.
            page.tickets = null;
            page.source = '';
        }
    }
}
