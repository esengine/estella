// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    plantInteraction.ts
 * @brief   Plants that are data until something comes near: a collider and an entity close by, a lean when touched, felling and harvest that last.
 *
 * @details A forest cannot be entities and does not need to be: only what stands near a `FoliageContact` can be touched. So a kind with an
 *          `interaction` stays a placement in its `MeshInstances` set, and the plants within its `activationDistance` of a contact are each also
 *          given an entity (`PlantProxy`, with a collider where the kind has one) that goes when the contact does. The picture never changes hands, so
 *          nothing pops. What happens to a plant is kept against its key, not its cell: a felled tree stays felled when its chunk is let go and
 *          grown again, and `saveState` is the same table. A tree comes down as an entity with its own meshes, and its placement is taken out for good.
 */
import type { App } from '../app/app';
import { defineSystem, Schedule } from '../ecs/system';
import { defineResource, Res, Time, type TimeData } from '../ecs/resource';
import { defineComponent, getComponent, MeshRenderer, RuntimeOnly, Transform, type ComponentDef, type MeshRendererData, type TransformData } from '../ecs/component';
import { isEditor, isPlayMode } from '../ecs/env';
import { log } from '../util/logger';
import type { Entity } from '../types';
import type { AssetLease, AssetScope } from '../asset/AssetLease';
import type { Plant } from './builder';
import type { PlacedKind } from './plantKind';
import { plantGrowthOf, type GrownCell, type PlacementSet, type PlantGrowth, type ReadyKinds } from './plantGrowth';

/** The fields of the `FoliageContact` component. @experimental */
export interface FoliageContactData {
    /** How far from the entity plants lean away, in world units. */
    radius: number;
    /** How hard: 1 is a full lean, 0 none. */
    strength: number;
    /** Seconds grass takes to stand up again behind it. */
    recovery: number;
    /** Off: it neither bends plants nor brings them near. */
    enabled: boolean;
}

/**
 * Something plants feel: grass and shrubs lean away from it, and the plants near it become entities with colliders.
 *
 * @experimental
 */
export const FoliageContact: ComponentDef<FoliageContactData> = defineComponent<FoliageContactData>('FoliageContact', {
    radius: 40, strength: 1, recovery: 0.6, enabled: true,
}, {
    fields: {
        radius: { min: 0.01, unit: 'wu', tooltip: 'How far from this entity plants lean away.' },
        strength: { min: 0, max: 2, step: 0.01, tooltip: 'How hard they lean: 1 is a full lean, 0 none.' },
        recovery: { min: 0, step: 0.05, unit: 's', tooltip: 'How long grass takes to stand up again behind it.' },
    },
});

/** The fields of the `PlantProxy` component. @experimental */
export interface PlantProxyData {
    /** The table the plant's state is kept in: a world's, or a `PlacedFoliage`'s. */
    source: string;
    /** The plant, within its source. */
    key: string;
}

/**
 * Marks the entity standing in for a plant while something is near it. What a ray or a collision hits; `PlantInteraction.of` says which plant it is.
 *
 * @experimental
 */
export const PlantProxy: ComponentDef<PlantProxyData> = defineComponent<PlantProxyData>('PlantProxy', { source: '', key: '' });

/** What has become of a plant. @experimental */
export type PlantState = 'standing' | 'felled' | 'harvested' | 'removed';

/** One plant as a game asks about it. @experimental */
export interface PlantRef {
    source: string;
    key: string;
    /** The kind it shows now: a felled tree's stump is a kind of its own. */
    kind: number;
    x: number;
    y: number;
    z: number;
    scale: number;
    state: PlantState;
    /** What is left of its `health`. */
    health: number;
    /** How many more times it can be harvested. */
    yields: number;
    /** Its `PlantProxy`, while something is near. */
    entity: Entity | null;
}

/** Something that happened to a plant. @experimental */
export interface PlantEvent {
    type: 'activated' | 'deactivated' | 'damaged' | 'felled' | 'landed' | 'harvested' | 'removed' | 'regrown';
    plant: PlantRef;
}

/** The change kept against one plant. A plant with none is as it was grown. */
interface PlantChange {
    state: PlantState;
    /** The kind it shows instead, or -1 for nothing. */
    shownAs: number;
    health: number;
    yields: number;
    /** The clock at which it stands again; 0 for never. */
    regrowAt: number;
}

interface CellPlant { plant: Plant; kind: number }

interface InteractiveCell {
    grown: GrownCell;
    source: string;
    kinds: readonly PlacedKind[];
    ready: ReadyKinds;
    plants: Map<string, CellPlant>;
    half: number;
    reach: number;
    /** The cell entity's place in the world, read once it has one. */
    at: { x: number; y: number; z: number } | null;
    /** The kinds a set has been made for, to show what a plant turned into. */
    shown: Set<number>;
}

interface ActivePlant {
    cell: InteractiveCell;
    key: string;
    proxy: Entity | null;
    /** The lean, as a shear: sideways per unit of height, and how fast it is changing. */
    leanX: number; leanZ: number; speedX: number; speedZ: number;
    /** It has come to rest and been drawn so: nothing to write until something moves it. */
    settled: boolean;
    kind: number;
}

interface Falling {
    root: Entity;
    elapsed: number;
    seconds: number;
    lie: number;
    angle: number;
    axisX: number; axisZ: number;
    landed: boolean;
    plant: PlantRef;
    assets: AssetLease<AssetScope> | null;
}

/** How much of a lean each second gives way, and how hard it is pulled to where it should be: a rustle that settles in about a second. */
const LEAN_PULL = 90, LEAN_DAMP = 9, LEAN_REST = 0.0005;
const SCAN_SECONDS = 0.1, GROW_IN_SECONDS = 1.5, SINK_SECONDS = 1.5;
const stateId = (source: string, key: string): string => `${source}\n${key}`;

/** The saved form of what has become of the plants. @experimental */
export interface PlantSaveState {
    version: 1;
    clock: number;
    plants: { source: string; key: string; state: PlantState; shownAs: number; health: number; yields: number; regrowAt: number }[];
}

/** Everything plants know about being touched. @experimental */
export class PlantInteraction {
    /** @internal */ app_: App | null = null;
    private readonly cells_ = new Map<GrownCell, InteractiveCell>();
    private readonly changes_ = new Map<string, PlantChange>();
    private readonly active_ = new Map<string, ActivePlant>();
    private readonly falling_ = new Set<Falling>();
    /** Plants coming back: when they started, on the clock. */
    private readonly growing_ = new Map<string, number>();
    private readonly listeners_ = new Set<(event: PlantEvent) => void>();
    private clock_ = 0;
    private untilScan_ = 0;

    /** The most plants that are entities at once; a contact in a thicket past this finds the furthest still data. */
    maxActive = 512;
    /** The most made per frame, so walking into a wood costs a few frames and not one long one. */
    maxActivatedPerFrame = 48;

    /** How many plants are entities now. */
    get activeCount(): number { return this.active_.size; }
    /** How many plants have had something happen to them, across every source: what a save holds. */
    get changedCount(): number { return this.changes_.size; }

    /** Hears what happens to plants. Returns what stops it. */
    on(listener: (event: PlantEvent) => void): () => void {
        this.listeners_.add(listener);
        return () => { this.listeners_.delete(listener); };
    }

    /** The plant an entity stands for, a `PlantProxy` that a ray or a collision found. */
    of(entity: Entity): PlantRef | null {
        const world = this.app_?.world;
        if (!world?.valid(entity) || !world.has(entity, PlantProxy)) return null;
        const proxy = world.get(entity, PlantProxy) as PlantProxyData;
        return this.find(proxy.source, proxy.key);
    }

    /** A plant by its source and key, where its cell is grown now. */
    find(source: string, key: string): PlantRef | null {
        for (const cell of this.cells_.values()) {
            if (cell.source !== source) continue;
            const entry = cell.plants.get(key);
            if (entry) return this.refOf(cell, key, entry);
        }
        return null;
    }

    /** The plants with an `interaction` within `radius` of a place on the ground, nearest first: what an axe swung here could reach. Cut ones are not among them. */
    near(x: number, z: number, radius: number): PlantRef[] {
        const out: { ref: PlantRef; d: number }[] = [];
        for (const cell of this.cells_.values()) {
            const at = this.cellAt(cell);
            if (!at || Math.abs(x - at.x) > cell.half + radius || Math.abs(z - at.z) > cell.half + radius) continue;
            for (const [key, entry] of cell.plants) {
                const d = Math.hypot(at.x + entry.plant.x - x, at.z + entry.plant.z - z);
                if (d > radius || this.kindNow(cell, key, entry) < 0) continue;
                out.push({ ref: this.refOf(cell, key, entry), d });
            }
        }
        return out.sort((a, b) => a.d - b.d).map((p) => p.ref);
    }

    /** Takes `amount` of a plant's `health`, and fells it at nothing left, away from `from` where given. False for a plant that cannot be hurt. */
    damage(plant: PlantRef, amount: number, from?: { x: number; z: number }): boolean {
        const found = this.located(plant);
        if (!found) return false;
        const interaction = found.cell.kinds[found.kind]?.interaction;
        const health = interaction?.health ?? 0;
        const change = this.changes_.get(stateId(plant.source, plant.key));
        if (health <= 0 || (change && change.state !== 'standing')) return false;
        const left = (change ? change.health : health) - Math.max(0, amount);
        const next = this.changeFor(found.cell, plant.key, found.kind);
        next.health = Math.max(0, left);
        const ref = this.refOf(found.cell, plant.key, found.entry);
        this.emit('damaged', ref);
        // A blow shakes what can shake.
        const active = this.active_.get(stateId(plant.source, plant.key));
        const at = this.cellAt(found.cell);
        if (active && from && at && (interaction?.bend ?? 0) > 0) {
            const dx = at.x + found.entry.plant.x - from.x, dz = at.z + found.entry.plant.z - from.z, len = Math.hypot(dx, dz) || 1;
            active.speedX += dx / len * 2; active.speedZ += dz / len * 2;
            active.settled = false;
        }
        if (left <= 0) {
            if (from && at) {
                const dx = at.x + found.entry.plant.x - from.x, dz = at.z + found.entry.plant.z - from.z;
                this.fell(ref, { x: dx, z: dz });
            } else this.fell(ref);
        }
        return true;
    }

    /** Brings a plant down, toward a direction on the ground or along its own turn. Only what still stands; false otherwise. */
    fell(plant: PlantRef, toward?: { x: number; z: number }): boolean {
        const found = this.located(plant);
        if (!found) return false;
        const id = stateId(plant.source, plant.key);
        const had = this.changes_.get(id);
        if (had && had.state !== 'standing') return false;
        const interaction = found.cell.kinds[found.kind]?.interaction;
        const change = this.changeFor(found.cell, plant.key, found.kind);
        change.state = 'felled';
        change.health = 0;
        change.shownAs = this.resolveKind(interaction?.felledKind);
        change.regrowAt = (interaction?.regrowSeconds ?? 0) > 0 ? this.clock_ + interaction!.regrowSeconds! : 0;
        this.startFall(found.cell, found.kind, found.entry.plant, toward, plant);
        this.deactivate(id);
        this.refreshCell(found.cell, found.kind, change.shownAs);
        this.writeFar(found.cell.source);
        this.emit('felled', this.refOf(found.cell, plant.key, found.entry));
        return true;
    }

    /** Takes up to `amount` from a plant, and answers how much it got. At nothing left it becomes its `harvestedKind`, or is gone until it regrows. */
    harvest(plant: PlantRef, amount = 1): number {
        const found = this.located(plant);
        if (!found) return 0;
        const interaction = found.cell.kinds[found.kind]?.interaction;
        const yields = interaction?.yields ?? 0;
        const had = this.changes_.get(stateId(plant.source, plant.key));
        if (yields <= 0 || (had && had.state !== 'standing')) return 0;
        const left = had ? had.yields : yields;
        const taken = Math.min(left, Math.max(0, Math.floor(amount)));
        if (taken === 0) return 0;
        const change = this.changeFor(found.cell, plant.key, found.kind);
        change.yields = left - taken;
        if (change.yields === 0) {
            change.state = 'harvested';
            change.shownAs = this.resolveKind(interaction?.harvestedKind);
            change.regrowAt = (interaction?.regrowSeconds ?? 0) > 0 ? this.clock_ + interaction!.regrowSeconds! : 0;
            this.deactivate(stateId(plant.source, plant.key));
            this.refreshCell(found.cell, found.kind, change.shownAs);
            this.writeFar(found.cell.source);
        }
        this.emit('harvested', this.refOf(found.cell, plant.key, found.entry));
        return taken;
    }

    /** Takes a plant away with no fall, for good: what a building placed over it or a game's own rule does. */
    remove(plant: PlantRef): boolean {
        const found = this.located(plant);
        if (!found) return false;
        const change = this.changeFor(found.cell, plant.key, found.kind);
        change.state = 'removed';
        change.shownAs = -1;
        change.regrowAt = 0;
        this.deactivate(stateId(plant.source, plant.key));
        this.refreshCell(found.cell, found.kind, -1);
        this.writeFar(found.cell.source);
        this.emit('removed', this.refOf(found.cell, plant.key, found.entry));
        return true;
    }

    /** Everything that has become of the plants, for a save. A tree coming down is saved as down. */
    saveState(): PlantSaveState {
        const plants: PlantSaveState['plants'] = [];
        for (const [id, c] of this.changes_) {
            const cut = id.indexOf('\n');
            plants.push({ source: id.slice(0, cut), key: id.slice(cut + 1), state: c.state, shownAs: c.shownAs, health: c.health, yields: c.yields, regrowAt: c.regrowAt });
        }
        return { version: 1, clock: this.clock_, plants };
    }

    /** Puts the plants back as a save has them, whatever is grown now. What had fallen and not gone yet is gone. */
    loadState(state: PlantSaveState): void {
        if (state.version !== 1) throw new Error(`plant state version ${String(state.version)} is not one this engine reads`);
        for (const f of [...this.falling_]) this.endFall(f);
        for (const id of [...this.active_.keys()]) this.deactivate(id);
        this.changes_.clear();
        this.growing_.clear();
        this.clock_ = state.clock;
        for (const p of state.plants) {
            this.changes_.set(stateId(p.source, p.key), { state: p.state, shownAs: p.shownAs, health: p.health, yields: p.yields, regrowAt: p.regrowAt });
        }
        for (const cell of this.cells_.values()) {
            for (const [key] of cell.plants) {
                const c = this.changes_.get(stateId(cell.source, key));
                if (c && c.shownAs >= 0) this.ensureShown(cell, c.shownAs);
            }
            this.writeCell(cell);
        }
    }

    /** @internal A cell of plants has been planted: the kinds with an `interaction` are known from now on. */
    addCell(grown: GrownCell, source: string, kinds: readonly PlacedKind[], ready: ReadyKinds, byKind: ReadonlyMap<number, readonly Plant[]>, half: number): void {
        const plants = new Map<string, CellPlant>();
        let reach = 0;
        for (const [kind, list] of byKind) {
            const interaction = kinds[kind]?.interaction;
            if (!interaction) continue;
            reach = Math.max(reach, interaction.activationDistance ?? 0);
            for (const plant of list) if (plant.key !== undefined) plants.set(plant.key, { plant, kind });
        }
        const cell: InteractiveCell = { grown, source, kinds, ready, plants, half, reach, at: null, shown: new Set() };
        this.cells_.set(grown, cell);
        // What became of its plants while it was away.
        for (const key of plants.keys()) {
            const c = this.changes_.get(stateId(source, key));
            if (c && c.shownAs >= 0) this.ensureShown(cell, c.shownAs);
        }
    }

    /** @internal A far cell: nothing near enough to touch, so only what stands for a felled plant needs to go. It is told apart by having no reach. */
    addFarCell(grown: GrownCell, source: string, kinds: readonly PlacedKind[], ready: ReadyKinds): void {
        this.cells_.set(grown, { grown, source, kinds, ready, plants: new Map(), half: 0, reach: 0, at: null, shown: new Set() });
    }

    /** @internal What a cell's set should show now: its plants less those that have gone, each as it leans or grows. */
    placementsOf(grown: GrownCell, set: PlacementSet): readonly Plant[] {
        const cell = this.cells_.get(grown);
        if (!cell) return set.plants;
        if (set.turned) {
            const out: Plant[] = [];
            for (const [key, entry] of cell.plants) {
                const c = this.changes_.get(stateId(cell.source, key));
                if (c && c.state !== 'standing' && c.shownAs === set.kind) out.push(entry.plant);
            }
            return out;
        }
        const out: Plant[] = [];
        for (const plant of set.plants) {
            if (plant.key === undefined) { out.push(plant); continue; }
            const id = stateId(cell.source, plant.key);
            const c = this.changes_.get(id);
            if (c && c.state !== 'standing') continue;
            const active = this.active_.get(id), started = this.growing_.get(id);
            if (!active?.leanX && !active?.leanZ && started === undefined) { out.push(plant); continue; }
            const grow = started === undefined ? 1 : Math.min(1, Math.max(0.02, (this.clock_ - started) / GROW_IN_SECONDS));
            out.push({ ...plant, scale: plant.scale * grow, ...(active ? { shear: [active.leanX, active.leanZ] as const } : {}) });
        }
        return out;
    }

    /** @internal A cell has been let go: its entities go with it, and what became of its plants stays. */
    removeCell(grown: GrownCell): void {
        const cell = this.cells_.get(grown);
        if (!cell) return;
        for (const key of cell.plants.keys()) this.deactivate(stateId(cell.source, key));
        this.cells_.delete(grown);
    }

    /** @internal */
    step(dt: number): void {
        const app = this.app_;
        if (!app || (isEditor() && !isPlayMode())) return;
        this.clock_ += dt;
        this.regrow();
        this.advanceFalls(dt);
        const contacts = this.contacts();
        this.untilScan_ -= dt;
        if (this.untilScan_ <= 0) {
            this.untilScan_ = SCAN_SECONDS;
            this.scan(contacts);
        }
        this.lean(contacts, dt);
        this.advanceGrowth();
    }

    private contacts(): { x: number; y: number; z: number; radius: number; strength: number }[] {
        const world = this.app_!.world;
        const out: { x: number; y: number; z: number; radius: number; strength: number }[] = [];
        for (const e of world.getEntitiesWithComponents([FoliageContact, Transform])) {
            const c = world.get(e, FoliageContact) as FoliageContactData;
            if (!c.enabled) continue;
            const t = world.get(e, Transform) as TransformData;
            out.push({ x: t.worldPosition.x, y: t.worldPosition.y, z: t.worldPosition.z, radius: c.radius, strength: c.strength });
        }
        return out;
    }

    /** Which plants should be entities, within what each kind says, and which no longer should. */
    private scan(contacts: readonly { x: number; z: number }[]): void {
        const wanted = new Set<string>();
        let budget = this.maxActivatedPerFrame;
        for (const cell of this.cells_.values()) {
            if (cell.reach <= 0) continue;
            const at = this.cellAt(cell);
            if (!at) continue;
            for (const contact of contacts) {
                // Past the cell by further than any of its kinds reaches.
                if (Math.abs(contact.x - at.x) > cell.half + cell.reach * 1.25 || Math.abs(contact.z - at.z) > cell.half + cell.reach * 1.25) continue;
                for (const [key, entry] of cell.plants) {
                    const kind = this.kindNow(cell, key, entry);
                    if (kind < 0) continue;
                    const reach = cell.kinds[kind]?.interaction?.activationDistance ?? 0;
                    if (reach <= 0) continue;
                    const dx = at.x + entry.plant.x - contact.x, dz = at.z + entry.plant.z - contact.z, d2 = dx * dx + dz * dz;
                    const id = stateId(cell.source, key);
                    const already = this.active_.has(id);
                    // A little further to leave than to arrive, so walking along the edge does not make and unmake them.
                    const limit = already ? reach * 1.25 : reach;
                    if (d2 > limit * limit) continue;
                    wanted.add(id);
                    if (already || budget <= 0 || this.active_.size >= this.maxActive) continue;
                    budget--;
                    this.activate(cell, key, entry, kind, id);
                }
            }
        }
        for (const id of [...this.active_.keys()]) if (!wanted.has(id)) this.deactivate(id);
    }

    private activate(cell: InteractiveCell, key: string, entry: CellPlant, kind: number, id: string): void {
        const active: ActivePlant = { cell, key, proxy: null, leanX: 0, leanZ: 0, speedX: 0, speedZ: 0, settled: true, kind };
        active.proxy = this.spawnProxy(cell, key, entry, kind);
        this.active_.set(id, active);
        this.emit('activated', this.refOf(cell, key, entry));
    }

    private spawnProxy(cell: InteractiveCell, key: string, entry: CellPlant, kind: number): Entity | null {
        const world = this.app_!.world, at = this.cellAt(cell);
        if (!at) return null;
        const e = world.spawn(`Plant ${key}`);
        world.insert(e, RuntimeOnly);
        world.insert(e, Transform, { position: { x: at.x + entry.plant.x, y: at.y + entry.plant.y, z: at.z + entry.plant.z } });
        world.insert(e, PlantProxy, { source: cell.source, key });
        this.insertCollider(e, cell.kinds[kind], entry.plant.scale, 0);
        return e;
    }

    /** A capsule standing on the plant's foot. The physics module is optional and read by name; a game without it has plants with no collision and no complaint. */
    private insertCollider(e: Entity, kind: PlacedKind | undefined, scale: number, bodyType: number): void {
        const interaction = kind?.interaction;
        const radius = (interaction?.radius ?? 0) * scale, height = (interaction?.height ?? 0) * scale;
        if (radius <= 0 || height <= 0) return;
        const body = getComponent('RigidBody3D'), capsule = getComponent('CapsuleCollider3D');
        if (!body || !capsule) return;
        const world = this.app_!.world;
        world.insert(e, body, { bodyType, gravityScale: 0 });
        world.insert(e, capsule, { radius, halfHeight: Math.max(0, height / 2 - radius), center: { x: 0, y: height / 2, z: 0 } });
    }

    private deactivate(id: string): void {
        const active = this.active_.get(id);
        if (!active) return;
        this.active_.delete(id);
        const world = this.app_?.world;
        const entry = active.cell.plants.get(active.key);
        if (entry) this.emit('deactivated', this.refOf(active.cell, active.key, entry));
        if (active.proxy !== null && world?.valid(active.proxy)) world.despawn(active.proxy);
        // It stands straight again as data.
        if ((active.leanX || active.leanZ) && entry) this.writeKind(active.cell, active.kind);
    }

    /** Each active plant toward where its contacts push it, with a spring, so it rustles on being let go. */
    private lean(contacts: readonly { x: number; z: number; radius: number; strength: number }[], dt: number): void {
        const dirty = new Map<InteractiveCell, Set<number>>();
        const h = Math.min(dt, 1 / 30);
        for (const active of this.active_.values()) {
            const entry = active.cell.plants.get(active.key), at = this.cellAt(active.cell);
            const bend = active.cell.kinds[active.kind]?.interaction?.bend ?? 0;
            if (!entry || !at || bend <= 0) continue;
            let tx = 0, tz = 0;
            for (const c of contacts) {
                const dx = at.x + entry.plant.x - c.x, dz = at.z + entry.plant.z - c.z, d = Math.hypot(dx, dz);
                if (d >= c.radius || d < 1e-5) continue;
                const f = (1 - d / c.radius) * c.strength;
                tx += dx / d * f; tz += dz / d * f;
            }
            const size = Math.hypot(tx, tz), most = Math.tan(bend);
            const scale = size > 1 ? most / size : most;
            tx *= scale; tz *= scale;
            active.speedX += ((tx - active.leanX) * LEAN_PULL - active.speedX * LEAN_DAMP) * h;
            active.speedZ += ((tz - active.leanZ) * LEAN_PULL - active.speedZ * LEAN_DAMP) * h;
            active.leanX += active.speedX * h;
            active.leanZ += active.speedZ * h;
            if (Math.abs(active.leanX - tx) + Math.abs(active.leanZ - tz) + Math.abs(active.speedX) * h + Math.abs(active.speedZ) * h < LEAN_REST) {
                active.leanX = tx; active.leanZ = tz; active.speedX = 0; active.speedZ = 0;
                if (active.settled) continue;
                active.settled = true;
            } else active.settled = false;
            let kinds = dirty.get(active.cell);
            if (!kinds) dirty.set(active.cell, kinds = new Set());
            kinds.add(active.kind);
        }
        for (const [cell, kinds] of dirty) for (const kind of kinds) this.writeKind(cell, kind);
    }

    private regrow(): void {
        for (const [id, c] of this.changes_) {
            if (c.regrowAt <= 0 || c.regrowAt > this.clock_) continue;
            this.changes_.delete(id);
            this.growing_.set(id, this.clock_);
            const cut = id.indexOf('\n'), source = id.slice(0, cut), key = id.slice(cut + 1);
            for (const cell of this.cells_.values()) {
                if (cell.source !== source) continue;
                this.writeCell(cell);
                const entry = cell.plants.get(key);
                if (entry) this.emit('regrown', this.refOf(cell, key, entry));
            }
        }
    }

    private advanceGrowth(): void {
        if (this.growing_.size === 0) return;
        const writes = new Map<InteractiveCell, Set<number>>();
        for (const [id, started] of this.growing_) {
            const cut = id.indexOf('\n'), source = id.slice(0, cut), key = id.slice(cut + 1);
            for (const cell of this.cells_.values()) {
                if (cell.source !== source) continue;
                const entry = cell.plants.get(key);
                if (!entry) continue;
                let kinds = writes.get(cell);
                if (!kinds) writes.set(cell, kinds = new Set());
                kinds.add(entry.kind);
            }
            if (this.clock_ - started >= GROW_IN_SECONDS) this.growing_.delete(id);
        }
        for (const [cell, kinds] of writes) for (const kind of kinds) this.writeKind(cell, kind);
    }

    /** It comes down as an entity with its own meshes, turning about its foot: a shape a character can be hit by and then climb over. */
    private startFall(cell: InteractiveCell, kind: number, plant: Plant, toward: { x: number; z: number } | undefined, ref: PlantRef): void {
        const world = this.app_!.world, at = this.cellAt(cell);
        const interaction = cell.kinds[kind]?.interaction;
        const seconds = interaction?.fallSeconds ?? 1.8;
        const parts = cell.ready.kinds[kind];
        if (!at || !parts || seconds <= 0) return;
        const dx = toward?.x ?? Math.sin(plant.yaw), dz = toward?.z ?? Math.cos(plant.yaw);
        const len = Math.hypot(dx, dz) || 1;
        const root = world.spawn('Felled plant');
        world.insert(root, RuntimeOnly);
        world.insert(root, Transform, { position: { x: at.x + plant.x, y: at.y + plant.y, z: at.z + plant.z } });
        world.insert(root, PlantProxy, { source: cell.source, key: plant.key ?? '' });
        // Kinematic: the fall drives the body, and what it lands on it pushes aside.
        this.insertCollider(root, cell.kinds[kind], plant.scale, 1);
        const half = plant.yaw / 2;
        for (const r of parts) {
            const e = world.spawn('Felled part');
            world.insert(e, RuntimeOnly);
            world.insert(e, Transform, {
                rotation: { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) },
                scale: { x: plant.scale, y: plant.scale, z: plant.scale },
            });
            world.insert(e, MeshRenderer, {
                mesh: r.mesh, material: r.material, texture: r.texture, lit: true, opaque: r.part.opaque !== false, cullBackfaces: false,
                castShadows: r.part.castShadows !== false,
                color: { r: r.part.tint[0], g: r.part.tint[1], b: r.part.tint[2], a: r.part.tint[3] },
            } as Partial<MeshRendererData>);
            world.setParent(e, root);
        }
        this.falling_.add({
            root, elapsed: 0, seconds, lie: interaction?.lieSeconds ?? 30,
            // A little short of flat: its crown takes the ground first, not its trunk.
            angle: (interaction?.fallAngle ?? 85) * Math.PI / 180,
            // Up crossed with where it falls.
            axisX: dz / len, axisZ: -dx / len,
            landed: false, plant: ref, assets: cell.ready.lease.retain() ?? null,
        });
    }

    private advanceFalls(dt: number): void {
        const world = this.app_!.world;
        for (const f of [...this.falling_]) {
            if (!world.valid(f.root)) { this.endFall(f); continue; }
            f.elapsed += dt;
            const t = Math.min(1, f.elapsed / f.seconds);
            // As a thing falls: slowly from standing, and fastest at the end.
            const a = f.angle * t * t;
            const transform = world.get(f.root, Transform) as TransformData;
            const s = Math.sin(a / 2);
            transform.rotation.x = f.axisX * s; transform.rotation.y = 0; transform.rotation.z = f.axisZ * s; transform.rotation.w = Math.cos(a / 2);
            if (t >= 1 && !f.landed) {
                f.landed = true;
                this.emit('landed', f.plant);
            }
            const after = f.elapsed - f.seconds - f.lie;
            if (after > 0) transform.position.y -= dt * (f.plant.scale / SINK_SECONDS);
            world.set(f.root, Transform, transform);
            if (after > SINK_SECONDS) this.endFall(f);
        }
    }

    private endFall(f: Falling): void {
        this.falling_.delete(f);
        const world = this.app_?.world;
        if (world?.valid(f.root)) world.despawn(f.root);
        f.assets?.release();
        f.assets = null;
    }

    private refreshCell(cell: InteractiveCell, kind: number, shownAs: number): void {
        if (shownAs >= 0) this.ensureShown(cell, shownAs);
        this.writeKind(cell, kind);
        if (shownAs >= 0) this.writeKind(cell, shownAs);
    }

    /** The sets that show plants as another kind than they were grown, made the first time one is wanted in a cell. */
    private ensureShown(cell: InteractiveCell, kind: number): void {
        if (cell.shown.has(kind) || kind >= cell.kinds.length) return;
        cell.shown.add(kind);
        this.growth().placeTurned(this.app_!, cell.grown, cell.kinds, cell.ready, kind);
    }

    /** The far cells of a source, which show every plant of theirs that has not gone. */
    private writeFar(source: string): void {
        for (const cell of this.cells_.values()) if (cell.source === source && cell.plants.size === 0) this.writeCell(cell);
    }

    private writeCell(cell: InteractiveCell): void {
        for (const set of cell.grown.sets ?? []) this.growth().writeSet(this.app_!, cell.grown, set);
    }

    private writeKind(cell: InteractiveCell, kind: number): void {
        for (const set of cell.grown.sets ?? []) if (set.kind === kind) this.growth().writeSet(this.app_!, cell.grown, set);
    }

    private growth(): PlantGrowth { return plantGrowthOf(this.app_!); }

    private cellAt(cell: InteractiveCell): { x: number; y: number; z: number } | null {
        if (cell.at) return cell.at;
        const world = this.app_!.world, e = cell.grown.entity;
        if (e === null || !world.valid(e)) return null;
        // Parented on publishing, so its place in the world is settled only after that.
        world.ensureTransformsComposed();
        const t = world.tryGet(e, Transform) as TransformData | null;
        if (!t) return null;
        cell.at = { x: t.worldPosition.x, y: t.worldPosition.y, z: t.worldPosition.z };
        return cell.at;
    }

    /** The kind a plant shows now, or -1 where nothing is there. */
    private kindNow(cell: InteractiveCell, key: string, entry: CellPlant): number {
        const c = this.changes_.get(stateId(cell.source, key));
        return !c || c.state === 'standing' ? entry.kind : c.shownAs;
    }

    private resolveKind(kind: number | string | undefined): number {
        return typeof kind === 'number' ? kind : -1;
    }

    private located(plant: PlantRef): { cell: InteractiveCell; entry: CellPlant; kind: number } | null {
        for (const cell of this.cells_.values()) {
            if (cell.source !== plant.source) continue;
            const entry = cell.plants.get(plant.key);
            if (entry) return { cell, entry, kind: entry.kind };
        }
        return null;
    }

    private changeFor(cell: InteractiveCell, key: string, kind: number): PlantChange {
        const id = stateId(cell.source, key);
        let c = this.changes_.get(id);
        if (!c) {
            const interaction = cell.kinds[kind]?.interaction;
            c = { state: 'standing', shownAs: kind, health: interaction?.health ?? 0, yields: interaction?.yields ?? 0, regrowAt: 0 };
            this.changes_.set(id, c);
        }
        return c;
    }

    private refOf(cell: InteractiveCell, key: string, entry: CellPlant): PlantRef {
        const at = this.cellAt(cell);
        const c = this.changes_.get(stateId(cell.source, key));
        const interaction = cell.kinds[entry.kind]?.interaction;
        return {
            source: cell.source, key, kind: c && c.state !== 'standing' ? c.shownAs : entry.kind,
            x: (at?.x ?? 0) + entry.plant.x, y: (at?.y ?? 0) + entry.plant.y, z: (at?.z ?? 0) + entry.plant.z, scale: entry.plant.scale,
            state: c?.state ?? 'standing', health: c ? c.health : interaction?.health ?? 0, yields: c ? c.yields : interaction?.yields ?? 0,
            entity: this.active_.get(stateId(cell.source, key))?.proxy ?? null,
        };
    }

    private emit(type: PlantEvent['type'], plant: PlantRef): void {
        for (const listener of this.listeners_) {
            try { listener({ type, plant }); } catch (error) { log.error('foliage', `a plant ${type} listener failed`, error); }
        }
    }
}

/** The resource plants are touched through. @experimental */
export const PlantInteractionRes = defineResource<PlantInteraction>(new PlantInteraction(), 'PlantInteraction');

/** The App's plant interaction, installed (with its system) the first time a kind wants it. */
export function plantInteractionOf(app: App): PlantInteraction {
    if (!app.hasResource(PlantInteractionRes)) {
        const interaction = new PlantInteraction();
        interaction.app_ = app;
        app.insertResource(PlantInteractionRes, interaction);
        plantGrowthOf(app).observer_ = interaction;
        app.addSystemToSchedule(Schedule.Update, defineSystem([Res(Time)], (time: TimeData) => { interaction.step(time.delta); }, { name: 'PlantInteractionSystem' }));
    }
    return app.getResource(PlantInteractionRes);
}
