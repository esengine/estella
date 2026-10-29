// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  `instantiate` and `tween` on nodes, against the real engine.
 *
 * A prefab is given in its prepared form (what the engine's loader makes), so what is exercised is the layer's side: that a held
 * `Prefab` is a handle on a path, that instantiating spawns a whole subtree whose scripts then run, that the result is outside the
 * scene until it has a parent, and that a copied node is independent of its original but keeps references to nodes outside it.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ESEngineModule } from '../../src/wasm';
import { App, flushPendingRegistrations } from '../../src/app/app';
import { Transform, ensureBuiltinComponentsRegistered } from '../../src/ecs/component';
import { AppContext, setDefaultContext } from '../../src/ecs/context';
import { loadSceneData, SCENE_FORMAT_VERSION } from '../../src/scene/scene';
import type { SceneData } from '../../src/scene/scene';
import type { PreparedPrefab } from '../../src/prefab/preparedPrefab';
import { resetClassRegistry } from '../../src/cocos/registry';
import { declareBuiltinScripts } from '../../src/cocos/builtinScripts';
import { Component, Node, Prefab, Vec3, _decorator, instantiate, providePrefab, setCurrentWorld, tween } from '../../src/cocos';
import { HAS_WASM, loadWasmModule } from '../helpers/loadWasm';

const transform = (x = 0, y = 0) => ({ type: 'Transform', data: { position: { x, y, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } } });

describe.skipIf(!HAS_WASM)('instantiate and tween on the engine', () => {
    let module: ESEngineModule;
    let registry: InstanceType<ESEngineModule['Registry']> | undefined;
    let app: App | undefined;

    beforeAll(async () => { ensureBuiltinComponentsRegistered(); module = await loadWasmModule(); });
    afterEach(() => {
        setCurrentWorld(null);
        app?.world.disconnectCpp();
        registry?.delete();
        app = undefined;
        registry = undefined;
    });

    function connect(): void {
        setDefaultContext(new AppContext());
        ensureBuiltinComponentsRegistered();
        resetClassRegistry();
        declareBuiltinScripts();
    }
    function boot(): void {
        registry = new module.Registry();
        app = App.new();
        app.connectCpp(registry as never, module);
        flushPendingRegistrations(app);
        setCurrentWorld(app.world);
    }
    const frame = async (n = 2): Promise<void> => { for (let i = 0; i < n; i++) await app!.tick(1 / 60); };

    /** A prefab of a root with one child, the root carrying the script. */
    function bullet(): PreparedPrefab {
        const scene = {
            version: SCENE_FORMAT_VERSION, name: 'bullet',
            entities: [
                { id: 0, name: 'Bullet', parent: null, children: [1], visible: true, components: [transform(5, 6), { type: 'Cocos.Bullet', data: { enabled: true, damage: 7 } }] },
                { id: 1, name: 'Trail', parent: 0, children: [], visible: true, components: [transform(1, 0)] },
            ],
        } as unknown as SceneData;
        return { ref: 'bullet.esprefab', scene, rootId: 0, missing: [], release() {} };
    }

    it('holds a prefab property as a handle on its path, and spawns the prepared prefab whole', async () => {
        connect();
        const started: number[] = [];
        @_decorator.ccclass('Bullet')
        class Bullet extends Component {
            @_decorator.property damage = 1;
            start() { started.push(this.damage); }
        }
        @_decorator.ccclass('Gun')
        class Gun extends Component {
            @_decorator.property(Prefab) round: Prefab | null = null;
        }
        void Bullet;
        providePrefab('bullet.esprefab', bullet());
        boot();

        const map = loadSceneData(app!.world, {
            version: SCENE_FORMAT_VERSION, name: 'main',
            entities: [{ id: 0, name: 'Gun', parent: null, children: [], visible: true, components: [transform(), { type: 'Cocos.Gun', data: { enabled: true, round: 'bullet.esprefab' } }] }],
        } as unknown as SceneData);
        await frame();
        const gun = Node.for(app!.world, map.get(0)!);
        const script = gun.getComponent(Gun)!;
        expect(script.round).toBeInstanceOf(Prefab);
        expect(script.round!.path).toBe('bullet.esprefab');

        const made = instantiate(script.round!);
        expect(made.name).toBe('Bullet');
        expect(made.children.map((c) => c.name)).toEqual(['Trail']);
        expect([made.position.x, made.position.y]).toEqual([5, 6]);

        // out of the scene until it has a parent: nothing runs, but the node itself says it is active
        expect(made.active).toBe(true);
        expect(made.activeInHierarchy).toBe(false);
        await frame();
        expect(started).toEqual([]);

        gun.addChild(made);
        expect(made.activeInHierarchy).toBe(true);
        await frame();
        expect(started).toEqual([7]);
    });

    it('says what is wrong when the prefab has not loaded, rather than answering half a node', () => {
        connect();
        boot();
        expect(() => instantiate(new Prefab('never-loaded.esprefab'))).toThrow(/not loaded yet/);
    });

    it('keeps a switched-off instance switched off after it is parented', async () => {
        connect();
        providePrefab('p.esprefab', bullet());
        boot();
        const made = instantiate(new Prefab('p.esprefab'));
        made.active = false;
        expect(made.active).toBe(false);
        const parent = new Node('holder');
        app!.world.insert(parent._entity, Transform);
        parent.addChild(made);
        expect(made.active).toBe(false);
        expect(made.activeInHierarchy).toBe(false);
    });

    it('copies a node with its children and scripts, independent of the original', async () => {
        connect();
        const ticks: string[] = [];
        @_decorator.ccclass('Counter')
        class Counter extends Component {
            @_decorator.property n = 0;
            update() { this.n++; ticks.push(this.node.name); }
        }
        void Counter;
        boot();
        const map = loadSceneData(app!.world, {
            version: SCENE_FORMAT_VERSION, name: 'main',
            entities: [
                { id: 0, name: 'Root', parent: null, children: [1], visible: true, components: [transform(), { type: 'Cocos.Counter', data: { enabled: true, n: 10 } }] },
                { id: 1, name: 'Child', parent: 0, children: [], visible: true, components: [transform(3, 0)] },
            ],
        } as unknown as SceneData);
        const original = Node.for(app!.world, map.get(0)!);
        const copy = instantiate(original);
        expect(copy).not.toBe(original);
        expect(copy.children.map((c) => c.name)).toEqual(['Child']);
        expect(copy.children[0]).not.toBe(original.children[0]);
        original.setPosition(100, 0, 0);
        expect(copy.position.x).toBe(0);

        const holder = new Node('holder');
        app!.world.insert(holder._entity, Transform);
        holder.addChild(copy);
        await frame(1);
        expect(ticks.filter((n) => n === 'Root')).toHaveLength(2);   // the original's and the copy's
    });

    it('keeps a copy\'s reference to a node outside it pointed at that node', async () => {
        connect();
        @_decorator.ccclass('Follower')
        class Follower extends Component {
            @_decorator.property(Node) leader: Node | null = null;
        }
        boot();
        const map = loadSceneData(app!.world, {
            version: SCENE_FORMAT_VERSION, name: 'main',
            entities: [
                { id: 1, name: 'Leader', parent: null, children: [], visible: true, components: [transform()] },
                { id: 2, name: 'Fan', parent: null, children: [], visible: true, components: [transform(), { type: 'Cocos.Follower', data: { enabled: true, leader: 1 } }] },
            ],
        } as unknown as SceneData);
        await frame();
        const leader = Node.for(app!.world, map.get(1)!);
        const copy = instantiate(Node.for(app!.world, map.get(2)!));
        const holder = new Node('holder');
        app!.world.insert(holder._entity, Transform);
        holder.addChild(copy);
        await frame();
        // `===`, not toBe: a failing toBe walks both nodes' worlds to print a diff, and the wasm heap is in there
        expect(copy.getComponent(Follower)!.leader === leader).toBe(true);
    });

    it('tweens a node\'s position by its accessor, and stops when the node is destroyed', async () => {
        connect();
        boot();
        const n = new Node('mover');
        app!.world.insert(n._entity, Transform);
        tween(n).to(0.5, { position: new Vec3(60, 0, 0) }).start();
        await frame(15);   // 0.25s at 60 fps
        expect(n.position.x).toBeCloseTo(30, 0);
        await frame(30);
        expect(n.position.x).toBe(60);

        const doomed = new Node('doomed');
        app!.world.insert(doomed._entity, Transform);
        const t = tween(doomed).to(10, { position: new Vec3(1, 0, 0) }).start();
        doomed.destroy();
        await frame(2);
        expect(t.isRunning).toBe(false);
    });

    it('waits while the node is switched off', async () => {
        connect();
        boot();
        const n = new Node('sleeper');
        app!.world.insert(n._entity, Transform);
        tween(n).to(1, { position: new Vec3(10, 0, 0) }).start();
        n.active = false;
        await frame(30);
        expect(n.position.x).toBe(0);
        n.active = true;
        await frame(70);
        expect(n.position.x).toBe(10);
    });
});
