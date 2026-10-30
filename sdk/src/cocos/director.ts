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
import { Children, Name, Parent, SceneOwner } from '../ecs/component';
import { log } from '../util/logger';
import type { World } from '../ecs/world';
import { INVALID_ENTITY, type Entity } from '../types';
import { Schedule, defineSystem, addSystemToSchedule, GetWorld } from '../ecs/system';
import { Res, Time } from '../ecs/resource';
import { Node, getCurrentWorld } from './node';
import { Scheduler, scheduler } from './scheduler';
import { SceneManager, type SceneManagerState } from '../scene/sceneManager';
import { listScenes } from './assetManager';
import { SceneAsset } from './assets';

/** The root of the running scene: a stand-in for the parent the world's top-level entities do not have. */
export class Scene {
    constructor(private readonly world: World) {}

    private name_ = 'Scene';
    get name(): string { return this.name_; }
    set name(value: string) { this.name_ = value; }
    get active(): boolean { return true; }
    /** A scene is a root, not a node: it holds no components. */
    getComponent(_type?: unknown): null { return null; }
    get isValid(): boolean { return true; }

    get children(): Node[] {
        const roots: Entity[] = [];
        for (const e of this.world.getEntitiesWithComponents([Name])) {
            const parent = this.world.tryGet(e, Parent)?.entity;
            if (!parent || parent === INVALID_ENTITY) roots.push(e);
        }
        // A node kept across scenes is moved under the new scene after the scene's own, so the new scene's come first
        const kept = (e: Entity): boolean => this.world.tryGet(e, SceneOwner)?.persistent === true;
        roots.sort((a, b) => Number(kept(a)) - Number(kept(b)));
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

/** The engine's scene manager of each world, learned from the frame loop (see {@link declareDirector}). */
const sceneManagers = new WeakMap<World, SceneManagerState>();
const registeredScenes = new WeakMap<World, Set<string>>();
let loadingScene = '';

/** What a scene's nodes keep across a scene change: the engine's `SceneOwner.persistent`, set on the node and what is under it. */
function setPersistent(node: Node, persistent: boolean): void {
    const world = node._world;
    const visit = (e: Entity): void => {
        const owner = world.tryGet(e, SceneOwner);
        if (owner && owner.persistent !== persistent) world.set(e, SceneOwner, { ...owner, persistent });
        for (const child of world.tryGet(e, Children)?.entities ?? []) visit(child);
    };
    visit(node._entity);
}

/** Give the scene manager every scene of the project by name, once. */
async function registerScenes(world: World, manager: SceneManagerState): Promise<void> {
    let done = registeredScenes.get(world);
    if (!done) registeredScenes.set(world, (done = new Set()));
    for (const scene of await listScenes()) {
        if (done.has(scene.name)) continue;
        done.add(scene.name);
        manager.register({ name: scene.name, path: scene.path });
    }
}

function sceneManagerOf(world: World): SceneManagerState {
    const manager = sceneManagers.get(world);
    if (!manager) throw new Error('cocos compat: the engine\'s scene manager is not running');
    return manager;
}

/** Run @p name as the scene: the one before it goes, what the game marked persistent stays, and @p done hears how it went. */
function runScene(name: string, done?: (error: Error | null, scene?: Scene) => void): void {
    const world = requireWorld('director.loadScene');
    loadingScene = name;
    director.emit(Director.EVENT_BEFORE_SCENE_LOADING, name);
    (async () => {
        const manager = sceneManagerOf(world);
        await registerScenes(world, manager);
        await manager.load(name);
        return new Scene(world);
    })().then(
        (scene) => { loadingScene = ''; director.emit(Director.EVENT_AFTER_SCENE_LAUNCH, scene); done?.(null, scene); },
        (error: Error) => { loadingScene = ''; log.warn('cocos', `scene "${name}" did not load: ${String(error.message ?? error)}`); done?.(error); },
    );
}

/** The parts of `director` scripts actually call. */
export const director = {
    /** The name of the scene being loaded, or empty: a game reads it to refuse a second load while one is under way. */
    get _loadingScene(): string { return loadingScene; },
    /** Run a scene by its name. `onLaunched(error, scene)` hears the result. */
    loadScene(name: string, onLaunched?: (error: Error | null, scene?: Scene) => void): boolean {
        runScene(name, onLaunched);
        return true;
    },
    /** Run a scene a bundle's `loadScene` gave. */
    runScene(scene: SceneAsset | string, _onBeforeLoad?: () => void, onLaunched?: (error: Error | null, scene?: Scene) => void): void {
        runScene(typeof scene === 'string' ? scene : scene.name, onLaunched);
    },
    /** Ready a scene so running it is quick. */
    preloadScene(name: string, onProgress?: unknown, onLoaded?: (error: Error | null, scene?: SceneAsset) => void): void {
        const done = (typeof onProgress === 'function' && onLoaded === undefined ? onProgress : onLoaded) as ((error: Error | null, scene?: SceneAsset) => void) | undefined;
        const world = requireWorld('director.preloadScene');
        (async () => {
            const manager = sceneManagerOf(world);
            await registerScenes(world, manager);
            await manager.prepare(name);
            const asset = new SceneAsset(name);
            asset.name = name;
            return asset;
        })().then((asset) => done?.(null, asset), (error: Error) => done?.(error));
    },
    getScene(): Scene | null {
        const world = getCurrentWorld();
        return world ? new Scene(world) : null;
    },
    /** The time of the last frame, in seconds. */
    getDeltaTime(): number { return lastDelta; },
    getTotalFrames(): number { return totalFrames; },
    /** The timers kept by target: the ones a game's own timer service runs on. */
    getScheduler(): Scheduler { return scheduler; },
    getAnimationManager(): undefined { return undefined; },
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
    /** Keep a node (and what is under it) through scene changes. */
    addPersistRootNode(node: Node): void { setPersistent(node, true); },
    removePersistRootNode(node: Node): void { setPersistent(node, false); },
    isPersistRootNode(node: Node): boolean { return node._world.tryGet(node._entity, SceneOwner)?.persistent === true; },
};

let lastDelta = 0;
let totalFrames = 0;
/** @internal The host reports each frame, so `director.getDeltaTime()` and the frame events mean something. */
export function reportFrame(delta: number): void {
    lastDelta = delta;
    totalFrames++;
    scheduler.update(delta);
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

/**
 * The director's frame, which scripts hook: the delta it reports and the events around the update and the draw. The frame is the
 * engine's; these systems mark its start (before the scripts run), the end of the update and the end of the frame, in the order Cocos
 * emits them.
 */
export function declareDirector(): void {
    addSystemToSchedule(Schedule.First, defineSystem(
        [Res(SceneManager), GetWorld()],
        (manager, world) => { if (manager) sceneManagers.set(world, manager as SceneManagerState); },
        { name: 'Cocos:SceneManager', touches: { opaque: true } },
    ));
    addSystemToSchedule(Schedule.First, defineSystem(
        [Res(Time)],
        (time) => { reportFrame(time.delta); director.emit(Director.EVENT_BEFORE_UPDATE); },
        { name: 'Cocos:DirectorBegin', touches: { opaque: true } },
    ));
    addSystemToSchedule(Schedule.Last, defineSystem(
        [],
        () => {
            director.emit(Director.EVENT_AFTER_UPDATE);
            director.emit(Director.EVENT_BEFORE_DRAW);
            director.emit(Director.EVENT_AFTER_DRAW);
            director.emit(Director.EVENT_END_FRAME);
        },
        { name: 'Cocos:DirectorEnd', touches: { opaque: true } },
    ));
}
