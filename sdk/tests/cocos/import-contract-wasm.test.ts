// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A scene as the importer writes it, loaded into the real engine with the compatibility layer.
 *
 * The importer (pipeline/src/import/cocos) and the layer agree on a contract by name only: `Cocos.UITransform`, `Cocos.Widget`,
 * `Cocos.Button`, `Cocos.<ScriptClass>`, with a node reference as the entity id the loader maps. This is the one place that agreement
 * is exercised end to end, so a rename on either side fails here and not on a user's project.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { ESEngineModule } from '../../src/wasm';
import { App, flushPendingRegistrations } from '../../src/app/app';
import { ensureBuiltinComponentsRegistered } from '../../src/ecs/component';
import { AppContext, setDefaultContext } from '../../src/ecs/context';
import { loadSceneData } from '../../src/scene/scene';
import type { SceneData } from '../../src/scene/scene';
import { resetClassRegistry } from '../../src/cocos/registry';
import { declareBuiltinScripts } from '../../src/cocos/builtinScripts';
import { Button, Component, Node, UITransform, Widget, _decorator, setCurrentWorld, setVisibleSize } from '../../src/cocos';
import { HAS_WASM, loadWasmModule } from '../helpers/loadWasm';

const transform = { type: 'Transform', data: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, scale: { x: 1, y: 1, z: 1 } } };

describe.skipIf(!HAS_WASM)('the importer\'s scene in the compatibility layer', () => {
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

    it('loads UI geometry, alignment, a button with a handler on a later node, and a script with node references', async () => {
        setDefaultContext(new AppContext());
        ensureBuiltinComponentsRegistered();
        resetClassRegistry();
        declareBuiltinScripts();

        // The project's own script, as the layer's decorators declare it.
        const seen: string[] = [];
        @_decorator.ccclass('Hud')
        class Hud extends Component {
            @_decorator.property(Node) label: Node | null = null;
            @_decorator.property([Node]) all: Node[] = [];
            @_decorator.property speed = 1;
            onBuy(_event: unknown, data: string): void { seen.push(data); }
        }
        // the decorator ran before the registry was reset above in some orders; declare is idempotent per name
        void Hud;

        registry = new module.Registry();
        app = App.new();
        app.connectCpp(registry as never, module);
        flushPendingRegistrations(app);
        setCurrentWorld(app.world);
        setVisibleSize(960, 640);

        const scene: SceneData = {
            version: 4,
            name: 'main',
            entities: [
                { id: 0, name: 'Canvas', parent: null, children: [1, 2], visible: true, components: [
                    transform,
                    { type: 'Cocos.UITransform', data: { width: 10, height: 10, anchorX: 0.5, anchorY: 0.5 } },
                    { type: 'Cocos.Widget', data: { enabled: true, alignFlags: 45, left: 0, right: 0, top: 0, bottom: 0, alignMode: 1 } },
                ] },
                { id: 1, name: 'Buy', parent: 0, children: [], visible: true, components: [
                    transform,
                    { type: 'Cocos.UITransform', data: { width: 120, height: 48, anchorX: 0.5, anchorY: 0.5 } },
                    { type: 'Cocos.Button', data: { enabled: true, interactable: true, transition: 3, zoomScale: 1.1, clickTargets: [2], clickHandlers: [{ component: 'Hud', handler: 'onBuy', customEventData: 'gold' }] } },
                ] },
                { id: 2, name: 'Hud', parent: 0, children: [], visible: true, components: [
                    transform,
                    { type: 'Cocos.Hud', data: { enabled: true, speed: 3, label: 1, all: [1, 2] } },
                ] },
            ],
        } as never;
        const map = loadSceneData(app.world, scene);
        await app.tick(1 / 60);
        await app.tick(1 / 60);

        const canvas = Node.for(app.world, map.get(0)!);
        const buy = Node.for(app.world, map.get(1)!);
        const hud = Node.for(app.world, map.get(2)!);

        // geometry and alignment: the canvas was authored 10x10 and stretches to the visible area
        const t = canvas.getComponent(UITransform)!;
        expect([t.width, t.height]).toEqual([960, 640]);
        expect(canvas.position.x).toBe(480);

        // a script with its fields, node references mapped to the entities the loader made
        const script = hud.getComponent('Hud') as unknown as Hud;
        expect(script.speed).toBe(3);
        expect(script.label).toBe(buy);
        expect(script.all).toEqual([buy, hud]);

        // the button's handler finds the script on a node that was later in the file, by its class name
        const button = buy.getComponent(Button)!;
        expect(button.clickEvents).toHaveLength(1);
        button.clickEvents[0]!.emit([{}]);
        expect(seen).toEqual(['gold']);
        void Widget;
    });
});
