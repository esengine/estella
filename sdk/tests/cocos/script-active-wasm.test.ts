// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A script may switch nodes on and off from `start`, which the host runs for every script in one pass: the pass must not be a query
 *        being walked, because switching a node off adds and removes components, which a walked query refuses.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ESEngineModule } from '../../src/wasm';
import { App, flushPendingRegistrations } from '../../src/app/app';
import { ensureBuiltinComponentsRegistered } from '../../src/ecs/component';
import { AppContext, setDefaultContext } from '../../src/ecs/context';
import { loadSceneData, SCENE_FORMAT_VERSION } from '../../src/scene/scene';
import type { SceneData } from '../../src/scene/scene';
import { resetClassRegistry, syncActivity } from '../../src/cocos/registry';
import { declareBuiltinScripts } from '../../src/cocos/builtinScripts';
import { Component, Node, _decorator, setCurrentWorld } from '../../src/cocos';
import { HAS_WASM, loadWasmModule } from '../helpers/loadWasm';

const transform = { type: 'Transform', data: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } } };

describe.skipIf(!HAS_WASM)('a script that switches nodes on and off', () => {
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

    it('can switch another node on in start, and the scripts that node carries still start', async () => {
        setDefaultContext(new AppContext());
        ensureBuiltinComponentsRegistered();
        resetClassRegistry();
        declareBuiltinScripts();
        const started: string[] = [];

        @_decorator.ccclass('Switcher')
        class Switcher extends Component {
            @_decorator.property(Node) other: Node | null = null;
            start() {
                started.push('switcher');
                this.other!.active = true;   // takes the Disabled tag off, which a walked query refuses
                this.node.active = false;
            }
        }
        @_decorator.ccclass('Bystander')
        class Bystander extends Component {
            start() { started.push('bystander'); }
        }
        void Switcher; void Bystander;

        registry = new module.Registry();
        app = App.new();
        app.connectCpp(registry as never, module);
        flushPendingRegistrations(app);
        setCurrentWorld(app.world);
        const map = loadSceneData(app.world, {
            version: SCENE_FORMAT_VERSION, name: 'main',
            entities: [
                { id: 0, name: 'A', parent: null, children: [], visible: true, components: [transform, { type: 'Cocos.Switcher', data: { enabled: true, other: 1 } }] },
                { id: 1, name: 'B', parent: null, children: [], visible: true, components: [transform, { type: 'Disabled', data: {} }, { type: 'Cocos.Bystander', data: { enabled: true } }] },
            ],
        } as unknown as SceneData);
        for (let i = 0; i < 3; i++) await app.tick(1 / 60);

        expect(started).toContain('switcher');
        expect(Node.for(app.world, map.get(0)!).active).toBe(false);
        expect(Node.for(app.world, map.get(1)!).active).toBe(true);
        expect(started).toContain('bystander');
    });

    it('enables a script as soon as its node joins an active parent, so a value set right after addChild is not undone', async () => {
        setDefaultContext(new AppContext());
        ensureBuiltinComponentsRegistered();
        resetClassRegistry();
        declareBuiltinScripts();
        const calls: string[] = [];

        @_decorator.ccclass('Resetter')
        class Resetter extends Component {
            opacity = 0;
            onEnable() { calls.push('enable'); this.opacity = 255; }
            onDisable() { calls.push('disable'); }
        }
        void Resetter;

        registry = new module.Registry();
        app = App.new();
        app.connectCpp(registry as never, module);
        flushPendingRegistrations(app);
        setCurrentWorld(app.world);
        const map = loadSceneData(app.world, {
            version: SCENE_FORMAT_VERSION, name: 'main',
            entities: [
                { id: 0, name: 'Parent', parent: null, children: [1], visible: true, components: [transform] },
                { id: 1, name: 'Child', parent: 0, children: [], visible: true, components: [transform, { type: 'Cocos.Resetter', data: { enabled: true } }] },
            ],
        } as unknown as SceneData);
        const child = Node.for(app.world, map.get(1)!);
        child.setParent(null);
        child.active = false;
        calls.length = 0;
        // an orphan that is switched on and given a parent: onEnable runs inside the call
        child.active = true;
        child.setParent(Node.for(app.world, map.get(0)!));
        const resetter = child.getComponent(Resetter)!;
        resetter.opacity = 120;
        expect(calls).toContain('enable');
        await app.tick(1 / 60);
        expect(resetter.opacity).toBe(120);

        child.active = false;
        expect(calls).toContain('disable');
    });

    it('loads every script of a tree before it enables any, in node order, when the tree is activated at once', async () => {
        setDefaultContext(new AppContext());
        ensureBuiltinComponentsRegistered();
        resetClassRegistry();
        declareBuiltinScripts();
        const calls: string[] = [];

        @_decorator.ccclass('First')
        class First extends Component {
            onLoad() { calls.push('first.load'); }
            onEnable() { calls.push('first.enable'); }
        }
        @_decorator.ccclass('Second')
        class Second extends Component {
            onLoad() { calls.push('second.load'); }
            onEnable() { calls.push('second.enable'); }
        }
        void First; void Second;

        registry = new module.Registry();
        app = App.new();
        app.connectCpp(registry as never, module);
        flushPendingRegistrations(app);
        setCurrentWorld(app.world);
        const map = loadSceneData(app.world, {
            version: SCENE_FORMAT_VERSION, name: 'main',
            entities: [
                { id: 0, name: 'Root', parent: null, children: [1], visible: true, components: [transform, { type: 'Cocos.First', data: { enabled: true } }] },
                { id: 1, name: 'Child', parent: 0, children: [], visible: true, components: [transform, { type: 'Cocos.Second', data: { enabled: true } }] },
            ],
        } as unknown as SceneData);
        syncActivity(app.world, map.get(0)!);
        expect(calls).toEqual(['first.load', 'second.load', 'first.enable', 'second.enable']);
    });
});
