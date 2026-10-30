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
import { resetClassRegistry } from '../../src/cocos/registry';
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
});
