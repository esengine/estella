// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  `node._components`: a project prepares the scripts of a node it just made (reads their `_components`) before the node is given a parent, so
 *        a script on a node that is not active has what it needs when something calls it before it loads.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ESEngineModule } from '../../src/wasm';
import { App, flushPendingRegistrations } from '../../src/app/app';
import { Transform, ensureBuiltinComponentsRegistered } from '../../src/ecs/component';
import { AppContext, setDefaultContext } from '../../src/ecs/context';
import { loadSceneData, SCENE_FORMAT_VERSION } from '../../src/scene/scene';
import type { SceneData } from '../../src/scene/scene';
import { resetClassRegistry } from '../../src/cocos/registry';
import { declareBuiltinScripts } from '../../src/cocos/builtinScripts';
import { Component, Node, _decorator, setCurrentWorld } from '../../src/cocos';
import { HAS_WASM, loadWasmModule } from '../helpers/loadWasm';

void Transform;
const transform = { type: 'Transform', data: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } } };

describe.skipIf(!HAS_WASM)('the components a node holds', () => {
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

    it('lists the scripts of a node under an inactive parent, ready to be prepared before they load', () => {
        setDefaultContext(new AppContext());
        ensureBuiltinComponentsRegistered();
        resetClassRegistry();
        declareBuiltinScripts();
        const log: string[] = [];

        @_decorator.ccclass('Prepared')
        class Prepared extends Component {
            ready = false;
            parseNode() { this.ready = true; log.push('parse'); }
            onLoad() { log.push('load'); }
        }
        void Prepared;

        registry = new module.Registry();
        app = App.new();
        app.connectCpp(registry as never, module);
        flushPendingRegistrations(app);
        setCurrentWorld(app.world);
        const map = loadSceneData(app.world, {
            version: SCENE_FORMAT_VERSION, name: 'main',
            entities: [
                { id: 0, name: 'Parent', parent: null, children: [1], visible: true, components: [transform] },
                { id: 1, name: 'Child', parent: 0, children: [], visible: true, components: [transform, { type: 'Disabled', data: {} }, { type: 'Cocos.Prepared', data: { enabled: true } }] },
            ],
        } as unknown as SceneData);
        const child = Node.for(app.world, map.get(1)!);

        const held = child._components;
        expect(held).toHaveLength(1);
        expect(held[0]).toBeInstanceOf(Prepared);
        (held[0] as unknown as { parseNode(): void }).parseNode();
        expect((child.getComponent(Prepared) as Prepared).ready).toBe(true);
        // the instance the node answers with, not a second one
        expect(child.getComponent(Prepared)).toBe(held[0]);
        expect(log).toContain('parse');
    });
});
