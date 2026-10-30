// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    cocos/director.ts
 * @brief   The scene-level entry points of Cocos: `director`, `find`, `isValid`.
 *
 * Cocos has one active scene with a root; the engine has a world with several root entities. `Scene` is the view a script
 * expects over that: its children are the world's parentless named entities, so `director.getScene().getChildByName('Canvas')`
 * and `find('Canvas/Panel')` mean what they say.
 */
import { Name, Parent } from '../ecs/component';
import type { World } from '../ecs/world';
import { INVALID_ENTITY, type Entity } from '../types';
import { Node, getCurrentWorld } from './node';

/** The root of the running scene: a stand-in for the parent the world's top-level entities do not have. */
export class Scene {
    constructor(private readonly world: World) {}

    get name(): string { return 'Scene'; }
    get active(): boolean { return true; }
    get isValid(): boolean { return true; }

    get children(): Node[] {
        const roots: Entity[] = [];
        for (const e of this.world.getEntitiesWithComponents([Name])) {
            const parent = this.world.tryGet(e, Parent)?.entity;
            if (!parent || parent === INVALID_ENTITY) roots.push(e);
        }
        return roots.map((e) => Node.for(this.world, e));
    }
    get childrenCount(): number { return this.children.length; }

    getChildByName(name: string): Node | null {
        return this.children.find((c) => c.name === name) ?? null;
    }

    /** `Canvas/Panel/Button`: the first segment names a root, the rest descend. */
    getChildByPath(path: string): Node | null {
        const [first, ...rest] = path.split('/').filter((s) => s.length > 0);
        if (first === undefined) return null;
        const root = this.getChildByName(first);
        return root ? (rest.length ? root.getChildByPath(rest.join('/')) : root) : null;
    }
}

type DirectorListener = { callback: (...args: any[]) => void; target?: unknown };

const directorListeners = new Map<string, DirectorListener[]>();

function requireWorld(what: string): World {
    const world = getCurrentWorld();
    if (!world) throw new Error(`cocos compat: ${what} outside a running scene (no world is current)`);
    return world;
}

/** The parts of `director` scripts actually call. Scene loading and the persistent-root list are the engine's, and are not simulated. */
export const director = {
    getScene(): Scene | null {
        const world = getCurrentWorld();
        return world ? new Scene(world) : null;
    },
    /** The time of the last frame, in seconds. */
    getDeltaTime(): number { return lastDelta; },
    getTotalFrames(): number { return totalFrames; },
    on(type: string, callback: (...args: any[]) => void, target?: unknown): void {
        const list = directorListeners.get(type);
        if (list) list.push({ callback, target }); else directorListeners.set(type, [{ callback, target }]);
    },
    once(type: string, callback: (...args: any[]) => void, target?: unknown): void {
        const wrapper = (...args: any[]): void => { director.off(type, wrapper, target); callback.apply(target, args); };
        director.on(type, wrapper, target);
    },
    off(type: string, callback?: (...args: any[]) => void, target?: unknown): void {
        const list = directorListeners.get(type);
        if (!list) return;
        directorListeners.set(type, list.filter((l) => (callback && l.callback !== callback) || (target !== undefined && l.target !== target)));
    },
    emit(type: string, ...args: any[]): void {
        for (const l of [...(directorListeners.get(type) ?? [])]) l.callback.apply(l.target, args);
    },
    /** Kept for scripts that mark a node to survive a scene change: the engine's scene streaming decides that. */
    addPersistRootNode(_node: Node): void {},
    removePersistRootNode(_node: Node): void {},
    isPersistRootNode(_node: Node): boolean { return false; },
};

let lastDelta = 0;
let totalFrames = 0;
/** @internal The host reports each frame, so `director.getDeltaTime()` and the frame events mean something. */
export function reportFrame(delta: number): void {
    lastDelta = delta;
    totalFrames++;
}

/**
 * `Director`: its event names, and the class the singleton `director` is an instance of. Scripts patch `Director.prototype.tick` to hook the
 * frame; here the frame is the engine's, so a patched `tick` is never called, but the patch itself has somewhere to land.
 */
export class Director {
    static readonly EVENT_BEFORE_UPDATE = 'director_before_update';
    static readonly EVENT_AFTER_UPDATE = 'director_after_update';
    static readonly EVENT_BEFORE_SCENE_LOADING = 'director_before_scene_loading';
    static readonly EVENT_AFTER_SCENE_LAUNCH = 'director_after_scene_launch';
    static readonly EVENT_BEFORE_DRAW = 'director_before_draw';
    static readonly EVENT_AFTER_DRAW = 'director_after_draw';
    static readonly EVENT_END_FRAME = 'director_end_frame';
    static get instance(): typeof director { return director; }
    static getInstance(): typeof director { return director; }
    tick(_now?: number): void { /* the engine runs the frame */ }
}

/** A node by absolute path from the scene roots: `find('Canvas/Panel')`. A name with no slash searches the roots, then everything. */
export function find(path: string, referenceNode?: Node): Node | null {
    if (referenceNode) return referenceNode.getChildByPath(path);
    const world = requireWorld('find');
    const scene = new Scene(world);
    const direct = scene.getChildByPath(path);
    if (direct || path.includes('/')) return direct;
    // A bare name: the first node anywhere with it.
    for (const e of world.getEntitiesWithComponents([Name])) {
        if (world.tryGet(e, Name)?.value === path) return Node.for(world, e);
    }
    return null;
}

/** Whether a node or component (or anything that says) is still usable. */
export function isValid(value: unknown, _strict = false): boolean {
    if (value === null || value === undefined) return false;
    const v = value as { isValid?: boolean };
    return typeof v.isValid === 'boolean' ? v.isValid : true;
}
