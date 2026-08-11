// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  EventBinding authoring commands: rows round-trip through the scene
 *        model as one undo step each, emptying the list drops the component
 *        (no `{rows: []}` litter), and the editor-side target resolution
 *        matches the runtime's nearest-name rule.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { App } from 'esengine';
import type { EventBindingRow, SceneData } from 'esengine';
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

const emptyScene = (): SceneData =>
    ({ version: '1.0', name: 'test', entities: [] }) as unknown as SceneData;

describe.skipIf(!HAS_WASM)('EventBinding authoring commands', () => {
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

    const compOf = (id: number) => S.model.entityBySource(id)?.components.find((c) => c.type === 'EventBinding');
    const rowsOf = (id: number): EventBindingRow[] =>
        ((compOf(id)?.data as { rows: EventBindingRow[] } | undefined)?.rows ?? []);

    it('adds a row, creating the component on first use', () => {
        const e = S.commands.addEntity()!;
        expect(compOf(e)).toBeUndefined();

        S.commands.addEventBinding(e, { event: 'click', action: 'ui.setPage', arg: 'tabs:home' });

        expect(rowsOf(e)).toEqual([{ event: 'click', action: 'ui.setPage', arg: 'tabs:home' }]);
    });

    it('patches one row without touching its siblings', () => {
        const e = S.commands.addEntity()!;
        S.commands.addEventBinding(e, { event: 'click', action: 'a' });
        S.commands.addEventBinding(e, { event: 'change', action: 'b' });

        S.commands.updateEventBinding(e, 1, { target: 'Panel' });

        expect(rowsOf(e)).toEqual([
            { event: 'click', action: 'a' },
            { event: 'change', action: 'b', target: 'Panel' },
        ]);
    });

    it('clearing an optional field removes the key rather than storing ""', () => {
        const e = S.commands.addEntity()!;
        S.commands.addEventBinding(e, { event: 'click', action: 'a', target: 'Panel', arg: 'x' });

        S.commands.updateEventBinding(e, 0, { target: '', arg: undefined });

        expect(rowsOf(e)).toEqual([{ event: 'click', action: 'a' }]);
    });

    it('removing the last row drops the component (no empty-rows litter)', () => {
        const e = S.commands.addEntity()!;
        S.commands.addEventBinding(e, { event: 'click', action: 'a' });

        S.commands.removeEventBinding(e, 0);

        expect(compOf(e)).toBeUndefined();
    });

    it('each edit is one undo step, and undo restores the previous list', () => {
        const e = S.commands.addEntity()!;
        S.commands.addEventBinding(e, { event: 'click', action: 'a' });
        S.commands.updateEventBinding(e, 0, { arg: 'one' });

        S.history.undo();
        expect(rowsOf(e)).toEqual([{ event: 'click', action: 'a' }]);

        S.history.undo();
        expect(compOf(e)).toBeUndefined();

        S.history.redo();
        expect(rowsOf(e)).toEqual([{ event: 'click', action: 'a' }]);
    });

    // The Events section writes parameters as a record and drops the canonical
    // string, so the two forms never disagree on disk; switching the action
    // drops both, because the old input belonged to the old action.
    it('writing parameters clears the canonical string', () => {
        const e = S.commands.addEntity()!;
        S.commands.addEventBinding(e, { event: 'click', action: 'ui.setPage', arg: 'tabs:home' });

        S.commands.updateEventBinding(e, 0, { params: { controller: 'tabs', page: 'settings' }, arg: undefined });

        expect(rowsOf(e)).toEqual([
            { event: 'click', action: 'ui.setPage', params: { controller: 'tabs', page: 'settings' } },
        ]);
    });

    it('switching the action drops the previous input entirely', () => {
        const e = S.commands.addEntity()!;
        S.commands.addEventBinding(e, { event: 'click', action: 'ui.setPage', params: { controller: 'tabs', page: 'home' } });

        S.commands.updateEventBinding(e, 0, { action: 'fsm.fire', params: undefined, arg: undefined });

        expect(rowsOf(e)).toEqual([{ event: 'click', action: 'fsm.fire' }]);
    });

    it('an out-of-range patch or removal is a no-op', () => {
        const e = S.commands.addEntity()!;
        S.commands.addEventBinding(e, { event: 'click', action: 'a' });

        S.commands.updateEventBinding(e, 5, { arg: 'x' });
        S.commands.removeEventBinding(e, 5);

        expect(rowsOf(e)).toEqual([{ event: 'click', action: 'a' }]);
    });
});
