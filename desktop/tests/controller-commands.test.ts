// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  UIController / UIGear commands: rename + page-removal cascades follow the
 *        nearest-ancestor resolution rule into descendant gear bindings, as one
 *        undo step; gear tween editing round-trips.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { App } from 'esengine';
import type { GearBinding } from 'esengine';
import type { ESEngineModule } from 'esengine/wasm';
import { loadWasmModule, HAS_WASM } from './helpers/loadWasm';

const host = vi.hoisted(() => ({ world: null as unknown as App['world'] }));
vi.mock('@/engine/EngineHost', () => ({
    EngineHost: {
        mutableWorld: () => host.world,
        get world() {
            return host.world;
        },
        getResource: () => undefined,
    },
}));

import { EditorSession } from '@/engine/EditorSession';
import type { SceneData } from 'esengine';

const emptyScene = (): SceneData =>
    ({ version: '1.0', name: 'test', entities: [] }) as unknown as SceneData;

describe.skipIf(!HAS_WASM)('controller + gear commands (cascades)', () => {
    let module: ESEngineModule;
    let S: EditorSession;

    beforeAll(async () => {
        module = await loadWasmModule();
    });
    beforeEach(() => {
        const app = App.new();
        const registry = new module.Registry();
        app.connectCpp(registry as never, module);
        host.world = app.world;
        S = EditorSession.create();
        S.model.adopt(emptyScene(), new Map());
    });
    afterEach(() => S.dispose());

    const controllersOf = (id: number) =>
        (S.model.entityBySource(id)?.components.find((c) => c.type === 'UIController')?.data as
            { controllers: Array<{ name: string; pages: string[]; current: string }> }).controllers;
    const gearsOf = (id: number): GearBinding[] =>
        (S.model.entityBySource(id)?.components.find((c) => c.type === 'UIGear')?.data as
            { bindings: GearBinding[] }).bindings;

    /** root('tab': a,b) → leaf with a colour gear on 'tab'. */
    function makeTree() {
        const root = S.commands.addEntity()!;
        const leaf = S.commands.addEntity()!;
        S.commands.setParent(leaf, root);
        S.commands.addController(root, 'tab', ['a', 'b']);
        S.commands.addGearBinding(leaf, {
            controller: 'tab', component: 'UIVisual', property: 'color',
            pages: { a: { r: 1, g: 0, b: 0, a: 1 }, b: { r: 0, g: 1, b: 0, a: 1 } },
        });
        return { root, leaf };
    }

    it('renameController cascades into descendant gears; one undo step reverts both', () => {
        const { root, leaf } = makeTree();
        S.commands.renameController(root, 'tab', 'nav');

        expect(controllersOf(root)[0]!.name).toBe('nav');
        expect(gearsOf(leaf)[0]!.controller).toBe('nav');

        S.history.undo();
        expect(controllersOf(root)[0]!.name).toBe('tab');
        expect(gearsOf(leaf)[0]!.controller).toBe('tab');
    });

    it('renameController leaves gears that resolve to a shadowing descendant alone', () => {
        const { root } = makeTree();
        const mid = S.commands.addEntity()!;
        const deep = S.commands.addEntity()!;
        S.commands.setParent(mid, root);
        S.commands.setParent(deep, mid);
        S.commands.addController(mid, 'tab', ['x', 'y']);
        S.commands.addGearBinding(deep, {
            controller: 'tab', component: 'UIVisual', property: 'color',
            pages: { x: { r: 0, g: 0, b: 1, a: 1 } },
        });

        S.commands.renameController(root, 'tab', 'nav');
        // deep's gear resolves to mid's 'tab' (nearest ancestor), so it keeps its name.
        expect(gearsOf(deep)[0]!.controller).toBe('tab');
    });

    it('renameControllerPage moves the pages entry, current, and gear page keys', () => {
        const { root, leaf } = makeTree();
        S.commands.setControllerPage(root, 'tab', 'b');
        S.commands.renameControllerPage(root, 'tab', 'b', 'beta');

        const ctrl = controllersOf(root)[0]!;
        expect(ctrl.pages).toEqual(['a', 'beta']);
        expect(ctrl.current).toBe('beta');
        const pages = gearsOf(leaf)[0]!.pages;
        expect(pages.beta).toEqual({ r: 0, g: 1, b: 0, a: 1 });
        expect(pages.b).toBeUndefined();

        S.history.undo();
        expect(controllersOf(root)[0]!.pages).toEqual(['a', 'b']);
        expect(gearsOf(leaf)[0]!.pages.b).toBeDefined();
    });

    it('removeControllerPage strips the page value from resolving gears', () => {
        const { root, leaf } = makeTree();
        S.commands.removeControllerPage(root, 'tab', 'b');

        expect(controllersOf(root)[0]!.pages).toEqual(['a']);
        expect(gearsOf(leaf)[0]!.pages.b).toBeUndefined();

        S.history.undo();
        expect(controllersOf(root)[0]!.pages).toEqual(['a', 'b']);
        expect(gearsOf(leaf)[0]!.pages.b).toEqual({ r: 0, g: 1, b: 0, a: 1 });
    });

    it('setControllerPage projects the page values into the MODEL fields (undo restores both)', () => {
        const { root, leaf } = makeTree();
        S.commands.addComponent(leaf, 'UIVisual');
        const colorOf = () =>
            (S.model.entityBySource(leaf)?.components.find((c) => c.type === 'UIVisual')?.data as
                { color: { r: number; g: number } }).color;
        const white = structuredClone(colorOf());

        S.commands.setControllerPage(root, 'tab', 'b');
        expect(controllersOf(root)[0]!.current).toBe('b');
        expect(colorOf()).toEqual({ r: 0, g: 1, b: 0, a: 1 }); // page b's authored green

        S.history.undo();
        expect(controllersOf(root)[0]!.current).toBe('a');
        expect(colorOf()).toEqual(white); // the field write undoes with the page switch
    });

    it('refuses to remove the last page', () => {
        const { root } = makeTree();
        S.commands.removeControllerPage(root, 'tab', 'b');
        S.commands.removeControllerPage(root, 'tab', 'a');
        expect(controllersOf(root)[0]!.pages).toEqual(['a']);
    });

    it('setGearTween sets and clears the transition', () => {
        const { leaf } = makeTree();
        S.commands.setGearTween(leaf, 'tab', 'UIVisual', 'color', { easing: 2, duration: 0.25 });
        expect(gearsOf(leaf)[0]!.tween).toEqual({ easing: 2, duration: 0.25 });

        S.commands.setGearTween(leaf, 'tab', 'UIVisual', 'color', undefined);
        expect(gearsOf(leaf)[0]!.tween).toBeUndefined();

        S.history.undo();
        expect(gearsOf(leaf)[0]!.tween).toEqual({ easing: 2, duration: 0.25 });
    });
});
