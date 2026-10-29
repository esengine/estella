// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/node.ts
 * @brief   `Node`: a Cocos scene-graph node, as a thin handle on an Estella entity.
 *
 * There is one scene graph — the engine's. A `Node` owns nothing: it is `(world, entity)`, cached so the same entity is the
 * same `Node` (scripts compare nodes with `===`), and every property reads or writes the entity's own components. A node a
 * script makes with `new Node('name')` is an entity spawned in the world the host is currently running.
 *
 * Transform values cross the boundary as Cocos's value classes (`Vec3`, `Quat`) in and out; the engine's components are plain
 * objects and a copy comes back from a read, so a write is always a `set` of the whole component.
 */
import { Children, Disabled, Name, Parent, Transform, type TransformData } from '../ecs/component';
import { setEntityActive } from '../ecs/entityUtils';
import type { World } from '../ecs/world';
import { INVALID_ENTITY, type Entity } from '../types';
import { Quat, Vec3 } from './math';
import {
    classInfoNamed, classInfoOf, ensureInstance, instancesOn, nodeOf, setNodeFactory,
    type ComponentCtor,
} from './registry';
import type { Component } from './component';
import { builtinAdapterFor } from './builtins';
import { log } from '../util/logger';

/** The world a `new Node()` spawns into: set by whatever is running script code (the host, a test). */
let currentWorld: World | null = null;
/** Make @p world current, and return the one that was, so a caller can put it back. */
// A node made by `instantiate` is not in the scene until it is given a parent. The entity exists in the world from the start, so it
// is held switched off, and `active` keeps answering what the node itself was made as; the first `addChild` lets it in.
const detached = new WeakMap<World, Map<Entity, boolean>>();

/** Hold a freshly instantiated root out of the scene until it has a parent. @internal */
export function markDetached(world: World, entity: Entity): void {
    let perWorld = detached.get(world);
    if (!perWorld) detached.set(world, (perWorld = new Map()));
    perWorld.set(entity, !world.has(entity, Disabled));
    setEntityActive(world, entity, false);
}
function detachedActive(world: World, entity: Entity): boolean | undefined { return detached.get(world)?.get(entity); }
function setDetachedActive(world: World, entity: Entity, value: boolean): boolean {
    const perWorld = detached.get(world);
    if (!perWorld?.has(entity)) return false;
    perWorld.set(entity, value);
    return true;
}
function releaseDetached(world: World, entity: Entity): void {
    const perWorld = detached.get(world);
    const wasActive = perWorld?.get(entity);
    if (wasActive === undefined) return;
    perWorld!.delete(entity);
    setEntityActive(world, entity, wasActive);
}

export function setCurrentWorld(world: World | null): World | null { const previous = currentWorld; currentWorld = world; return previous; }
export function getCurrentWorld(): World | null { return currentWorld; }

const cache = new WeakMap<World, Map<Entity, Node>>();

/** The entities that have registered a touch listener: the only ones a touch has to be tested against. */
const touchListeners = new WeakMap<World, Set<Entity>>();
export function touchListeningEntities(world: World): Iterable<Entity> {
    return touchListeners.get(world) ?? [];
}

type Listener = { callback: (...args: any[]) => void; target?: unknown; once: boolean };

export class Node {
    /** The event names Cocos scripts register for. Only the ones the engine raises are delivered; see the host. */
    static readonly EventType = Object.freeze({
        TOUCH_START: 'touch-start', TOUCH_MOVE: 'touch-move', TOUCH_END: 'touch-end', TOUCH_CANCEL: 'touch-cancel',
        MOUSE_DOWN: 'mouse-down', MOUSE_MOVE: 'mouse-move', MOUSE_UP: 'mouse-up', MOUSE_WHEEL: 'mouse-wheel',
        MOUSE_ENTER: 'mouse-enter', MOUSE_LEAVE: 'mouse-leave',
        TRANSFORM_CHANGED: 'transform-changed', SIZE_CHANGED: 'size-changed', ANCHOR_CHANGED: 'anchor-changed',
        CHILD_ADDED: 'child-added', CHILD_REMOVED: 'child-removed',
        PARENT_CHANGED: 'parent-changed', ACTIVE_IN_HIERARCHY_CHANGED: 'active-in-hierarchy-changed',
        SIBLING_ORDER_CHANGED: 'sibling-order-changed', LAYER_CHANGED: 'layer-changed',
    });

    /** @internal */ readonly _world: World;
    /** @internal */ readonly _entity: Entity;
    private listeners_: Map<string, Listener[]> | null = null;
    /** Cocos's `layer` bitmask: carried, not interpreted. */
    layer = 1 << 25;

    /** The node for an entity; the same object every time. */
    static for(world: World, entity: Entity): Node {
        let perWorld = cache.get(world);
        if (!perWorld) cache.set(world, (perWorld = new Map()));
        let node = perWorld.get(entity);
        if (!node) {
            node = new Node(undefined, world, entity);
            perWorld.set(entity, node);
        }
        return node;
    }

    /**
     * A new, parentless node in the world the running script is in. The `world` and `entity` parameters are how the engine side
     * builds a handle on one that already exists; a script never passes them.
     */
    constructor(name?: string, world?: World, entity?: Entity) {
        if (world && entity !== undefined) {
            this._world = world;
            this._entity = entity;
            return;
        }
        if (!currentWorld) throw new Error('cocos compat: new Node() outside a running scene (no world is current)');
        this._world = currentWorld;
        this._entity = currentWorld.spawn(name ?? 'New Node');
        let perWorld = cache.get(currentWorld);
        if (!perWorld) cache.set(currentWorld, (perWorld = new Map()));
        perWorld.set(this._entity, this);
    }

    // ---- identity --------------------------------------------------------------------------------------------------

    get uuid(): string { return String(this._entity); }
    get isValid(): boolean { return this._world.valid(this._entity); }

    /**
     * What a node prints and serializes as. Without it `console.log(node)` and a failed assertion walk `_world` — the whole
     * engine — and the process runs out of memory before it says anything.
     */
    toJSON(): { node: string; entity: number } { return { node: this.name, entity: this._entity }; }
    [Symbol.for('nodejs.util.inspect.custom')](): string { return `Node(${this.name}#${this._entity})`; }

    get name(): string { return this._world.tryGet(this._entity, Name)?.value ?? ''; }
    set name(value: string) { this._world.set(this._entity, Name, { value }); }

    // ---- activity --------------------------------------------------------------------------------------------------

    /** This node's own switch. */
    get active(): boolean { return detachedActive(this._world, this._entity) ?? !this._world.has(this._entity, Disabled); }
    set active(value: boolean) {
        if (setDetachedActive(this._world, this._entity, value)) return;
        setEntityActive(this._world, this._entity, value);
    }

    /** This node's switch and every ancestor's. */
    get activeInHierarchy(): boolean { return this._world.isEntityActive(this._entity); }

    // ---- hierarchy -------------------------------------------------------------------------------------------------

    get parent(): Node | null {
        const p = this._world.tryGet(this._entity, Parent)?.entity;
        return p && p !== INVALID_ENTITY ? Node.for(this._world, p) : null;
    }
    set parent(value: Node | null) { this.setParent(value); }

    get children(): Node[] {
        const ids = this._world.tryGet(this._entity, Children)?.entities ?? [];
        return ids.map((id) => Node.for(this._world, id));
    }
    get childrenCount(): number { return this._world.tryGet(this._entity, Children)?.entities.length ?? 0; }

    setParent(parent: Node | null, _keepWorldTransform = false): void {
        if (parent) {
            this._world.setParent(this._entity, parent._entity);
            releaseDetached(this._world, this._entity);
        } else this._world.removeParent(this._entity);
    }

    addChild(child: Node): void { child.setParent(this); }
    removeChild(child: Node): void { if (child.parent === this) child.setParent(null); }
    removeFromParent(): void { this.setParent(null); }
    removeAllChildren(): void { for (const c of this.children) c.setParent(null); }

    getChildByName(name: string): Node | null {
        for (const c of this.children) if (c.name === name) return c;
        return null;
    }

    /** `a/b/c`, each segment a child's name; an empty path is this node. */
    getChildByPath(path: string): Node | null {
        let node: Node | null = this;
        for (const segment of path.split('/')) {
            if (segment === '') continue;
            node = node.getChildByName(segment);
            if (!node) return null;
        }
        return node;
    }

    getSiblingIndex(): number {
        const p = this.parent;
        return p ? (this._world.tryGet(p._entity, Children)?.entities.indexOf(this._entity) ?? -1) : 0;
    }
    setSiblingIndex(_index: number): void {
        warnOnce('setSiblingIndex', 'Node.setSiblingIndex does not reorder yet: the engine owns the child order');
    }

    /** Whether @p other is this node or below it. */
    isChildOf(other: Node): boolean {
        for (let n: Node | null = this; n; n = n.parent) if (n === other) return true;
        return false;
    }

    /** Remove this node and everything under it; its components get `onDestroy` on the next frame. */
    destroy(): boolean {
        if (!this.isValid) return false;
        this._world.despawn(this._entity);
        return true;
    }
    destroyAllChildren(): void { for (const c of this.children) c.destroy(); }

    // ---- transform -------------------------------------------------------------------------------------------------

    private transform_(): TransformData { return this._world.get(this._entity, Transform); }
    /** The transform with its world fields current: a script that moves a node and reads where it ended up in the same frame must see the move. */
    private composedTransform_(): TransformData {
        this._world.ensureTransformsComposed();
        return this.transform_();
    }
    private writeTransform_(patch: Partial<Pick<TransformData, 'position' | 'rotation' | 'scale'>>): void {
        this._world.set(this._entity, Transform, { ...this.transform_(), ...patch });
    }

    get position(): Vec3 { const p = this.transform_().position; return new Vec3(p.x, p.y, p.z); }
    set position(v: Vec3) { this.setPosition(v); }

    /** `setPosition(vec3)` or `setPosition(x, y, z?)`; z is left alone when omitted. */
    setPosition(x: number | Vec3, y?: number, z?: number): void {
        const cur = this.transform_().position;
        const next = typeof x === 'object' ? { x: x.x, y: x.y, z: x.z } : { x, y: y ?? cur.y, z: z ?? cur.z };
        this.writeTransform_({ position: next });
    }
    getPosition(out?: Vec3): Vec3 { const p = this.transform_().position; return (out ?? new Vec3()).set(p.x, p.y, p.z); }

    get scale(): Vec3 { const s = this.transform_().scale; return new Vec3(s.x, s.y, s.z); }
    set scale(v: Vec3) { this.setScale(v); }
    setScale(x: number | Vec3, y?: number, z?: number): void {
        const cur = this.transform_().scale;
        const next = typeof x === 'object' ? { x: x.x, y: x.y, z: x.z } : { x, y: y ?? cur.y, z: z ?? cur.z };
        this.writeTransform_({ scale: next });
    }
    getScale(out?: Vec3): Vec3 { const s = this.transform_().scale; return (out ?? new Vec3()).set(s.x, s.y, s.z); }

    get rotation(): Quat { const q = this.transform_().rotation; return new Quat(q.x, q.y, q.z, q.w); }
    set rotation(q: Quat) { this.setRotation(q); }
    setRotation(x: number | Quat, y?: number, z?: number, w?: number): void {
        const q = typeof x === 'object' ? x : new Quat(x, y, z, w);
        this.writeTransform_({ rotation: { x: q.x, y: q.y, z: q.z, w: q.w } });
    }
    getRotation(out?: Quat): Quat { const q = this.transform_().rotation; return (out ?? new Quat()).set(q.x, q.y, q.z, q.w); }

    get eulerAngles(): Vec3 { return Quat.toEuler(new Vec3(), this.rotation); }
    set eulerAngles(v: Vec3) { this.setRotationFromEuler(v.x, v.y, v.z); }
    setRotationFromEuler(x: number, y: number, z: number): void { this.setRotation(Quat.fromEuler(new Quat(), x, y, z)); }

    /** The rotation about z, in degrees: the one that matters for a 2D node. */
    get angle(): number { return this.eulerAngles.z; }
    set angle(degrees: number) { const e = this.eulerAngles; this.setRotationFromEuler(e.x, e.y, degrees); }

    get worldPosition(): Vec3 { const p = this.composedTransform_().worldPosition; return new Vec3(p.x, p.y, p.z); }
    set worldPosition(v: Vec3) { this.setWorldPosition(v); }
    getWorldPosition(out?: Vec3): Vec3 { const p = this.composedTransform_().worldPosition; return (out ?? new Vec3()).set(p.x, p.y, p.z); }

    /** Place this node so its world position is @p x. Under a parent that is rotated or scaled, the local position is solved for. */
    setWorldPosition(x: number | Vec3, y?: number, z?: number): void {
        const world = typeof x === 'object' ? x : new Vec3(x, y ?? 0, z ?? 0);
        const parent = this.parent;
        if (!parent) { this.setPosition(world); return; }
        const pt = parent.composedTransform_();
        const dx = world.x - pt.worldPosition.x, dy = world.y - pt.worldPosition.y, dz = world.z - pt.worldPosition.z;
        // inverse parent rotation, then inverse parent scale
        const { x: qx, y: qy, z: qz, w: qw } = pt.worldRotation;
        const ix = -qx, iy = -qy, iz = -qz;
        const tx = 2 * (iy * dz - iz * dy), ty = 2 * (iz * dx - ix * dz), tz = 2 * (ix * dy - iy * dx);
        const rx = dx + qw * tx + (iy * tz - iz * ty);
        const ry = dy + qw * ty + (iz * tx - ix * tz);
        const rz = dz + qw * tz + (ix * ty - iy * tx);
        const s = pt.worldScale;
        this.setPosition(rx / (s.x || 1), ry / (s.y || 1), rz / (s.z || 1));
    }

    // ---- components ------------------------------------------------------------------------------------------------

    /** The component of a class (or class name) on this node, or null. */
    getComponent<T extends Component>(type: ComponentCtor<T> | string): T | null {
        const ctor = this.resolveCtor_(type);
        if (ctor) {
            const info = classInfoOf(ctor);
            if (info) return this._world.has(this._entity, info.def) ? (ensureInstance(this._world, this._entity, ctor) as T | null) : null;
        }
        return (builtinAdapterFor(type)?.get(this._world, this._entity) as T | null | undefined) ?? null;
    }

    getComponents<T extends Component>(type: ComponentCtor<T> | string): T[] {
        const one = this.getComponent<T>(type);
        return one ? [one] : [];
    }

    getComponentInChildren<T extends Component>(type: ComponentCtor<T> | string): T | null {
        const own = this.getComponent<T>(type);
        if (own) return own;
        for (const c of this.children) {
            const found = c.getComponentInChildren<T>(type);
            if (found) return found;
        }
        return null;
    }

    getComponentsInChildren<T extends Component>(type: ComponentCtor<T> | string): T[] {
        const out = this.getComponents<T>(type);
        for (const c of this.children) out.push(...c.getComponentsInChildren<T>(type));
        return out;
    }

    /** Add a component of a class to this node and return it, its `onLoad` already run. */
    addComponent<T extends Component>(type: ComponentCtor<T> | string): T | null {
        const ctor = this.resolveCtor_(type);
        const info = ctor ? classInfoOf(ctor) : undefined;
        if (ctor && info) {
            if (!this._world.has(this._entity, info.def)) this._world.insert(this._entity, info.def, structuredClone(info.def._default));
            return ensureInstance(this._world, this._entity, ctor) as T | null;
        }
        const adapter = builtinAdapterFor(type);
        if (adapter) return adapter.add(this._world, this._entity) as T | null;
        throw new Error(`cocos compat: addComponent: no component class "${typeof type === 'string' ? type : type?.name}"`);
    }

    private resolveCtor_(type: ComponentCtor | string): ComponentCtor | undefined {
        if (typeof type === 'string') return classInfoNamed(type)?.ctor;
        return type;
    }

    /** @internal Every live script component on this node. */
    _allInstances(): Component[] { return [...(instancesOn(this._world, this._entity)?.values() ?? [])]; }

    // ---- events ----------------------------------------------------------------------------------------------------

    on(type: string, callback: (...args: any[]) => void, target?: unknown, _useCapture?: boolean): typeof callback {
        this.addListener_(type, { callback, target, once: false });
        return callback;
    }
    once(type: string, callback: (...args: any[]) => void, target?: unknown): void {
        this.addListener_(type, { callback, target, once: true });
    }
    off(type: string, callback?: (...args: any[]) => void, target?: unknown): void {
        const list = this.listeners_?.get(type);
        if (!list) return;
        this.listeners_!.set(type, list.filter((l) => (callback && l.callback !== callback) || (target !== undefined && l.target !== target)));
    }
    /** Remove every listener that was registered with @p target. */
    targetOff(target: unknown): void {
        if (!this.listeners_) return;
        for (const [type, list] of this.listeners_) this.listeners_.set(type, list.filter((l) => l.target !== target));
    }
    hasEventListener(type: string): boolean { return (this.listeners_?.get(type)?.length ?? 0) > 0; }
    emit(type: string, ...args: any[]): void {
        const list = this.listeners_?.get(type);
        if (!list) return;
        for (const l of [...list]) {
            if (l.once) this.off(type, l.callback, l.target);
            l.callback.call(l.target, ...args);
        }
    }
    dispatchEvent(event: { type: string }): void { this.emit(event.type, event); }

    private addListener_(type: string, listener: Listener): void {
        if (type.startsWith('touch-')) {
            let set = touchListeners.get(this._world);
            if (!set) touchListeners.set(this._world, (set = new Set()));
            set.add(this._entity);
        }
        if (!this.listeners_) this.listeners_ = new Map();
        const list = this.listeners_.get(type);
        if (list) list.push(listener); else this.listeners_.set(type, [listener]);
    }
}

setNodeFactory((world, entity) => Node.for(world, entity));


const warned = new Set<string>();
function warnOnce(key: string, message: string): void {
    if (warned.has(key)) return;
    warned.add(key);
    log.warn('cocos', message);
}

/** The node for an entity, for the parts of the layer that hold only an entity id. */
export function nodeForEntity(world: World, entity: Entity): Node { return nodeOf(world, entity); }
