// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// Dynamic dropdown options used to be a project-wide fact (sorting layers) read
// through a source that was handed nothing. Most option sets are not: which
// armatures exist depends on which file THIS entity points at, and which
// animations are playable depends on what THIS entity has loaded — so two entities
// of one component type legitimately answer differently. This is the whole
// contract of the one registry every dynamic dropdown goes through: the provider
// sees the component and the entity, an option may BE a name rather than an index
// into one, and it may carry a label that reads differently from what it stores.
import { describe, it, expect, afterEach } from 'vitest';
import { setEnumSource, isEnumSourceExhaustive, inspectorFields } from '@/engine/schema';

const FIELD = 'layer';

// Most cases here are about WHAT a provider sees and stores, not about whether its
// options are the only legal values, so they take the strict reading. Openness has
// its own describe block below.
const EXHAUSTIVE = { exhaustive: true } as const;

afterEach(() => {
    setEnumSource('sortingLayers', null);
});

const fieldsOf = (comp: string, data: Record<string, unknown>, entity?: number) =>
    inspectorFields(comp, data, undefined, entity);

describe('enum sources', () => {
    it('hands the provider the component`s own values', () => {
        let seen: Record<string, unknown> | null = null;
        setEnumSource('sortingLayers', (data) => {
            seen = data as Record<string, unknown>;
            return [{ label: 'Default', value: 0 }];
        }, EXHAUSTIVE);

        fieldsOf('Sprite', { layer: 0, texture: 0 });
        expect(seen).not.toBeNull();
        expect(seen!.texture).toBe(0);
    });

    it('lets two entities of one component type see different options', () => {
        // The whole reason the provider needed context: a global source cannot
        // express "depends on what this one references".
        setEnumSource('sortingLayers', (data) =>
            data.texture === 1
                ? [{ label: 'A', value: 0 }, { label: 'B', value: 1 }]
                : [{ label: 'Only', value: 0 }], EXHAUSTIVE);

        const one = fieldsOf('Sprite', { layer: 0, texture: 1 }).find((f) => f.key === FIELD);
        const two = fieldsOf('Sprite', { layer: 0, texture: 2 }).find((f) => f.key === FIELD);
        expect(one?.options?.length).toBe(2);
        expect(two?.options?.length).toBe(1);
    });

    it('keeps a name as the value instead of an index into a list', () => {
        // An ordinal would silently point at a different animation the next time
        // the asset is exported with its list in another order.
        setEnumSource('sortingLayers', () => [
            { label: 'walk', value: 'walk' },
            { label: 'idle', value: 'idle' },
        ], EXHAUSTIVE);

        const f = fieldsOf('Sprite', { layer: 'idle' }).find((x) => x.key === FIELD);
        expect(f?.type).toBe('enum');
        expect(f?.value).toBe('idle');
    });

    it('leaves a numeric source resolving exactly as before', () => {
        setEnumSource('sortingLayers', () => [
            { label: 'Default', value: 0 },
            { label: 'Foreground', value: 3 },
        ], EXHAUSTIVE);

        const f = fieldsOf('Sprite', { layer: 3 }).find((x) => x.key === FIELD);
        expect(f?.type).toBe('enum');
        expect(f?.value).toBe(3);
    });

    it('hands the provider the entity being inspected', () => {
        // Options that come from what an entity has LOADED (a spine skeleton's
        // animation list) live in the runtime instance bound to that entity, and
        // are reachable from nothing but its id.
        let seen: number | undefined = -1;
        setEnumSource('sortingLayers', (_data, entity) => {
            seen = entity;
            return [{ label: 'Default', value: 0 }];
        }, EXHAUSTIVE);

        fieldsOf('Sprite', { layer: 0 }, 42);
        expect(seen).toBe(42);
    });

    it('keeps a label that reads differently from the value it stores', () => {
        // An i18n key previews its translation; the key is still what gets written.
        setEnumSource('sortingLayers', () => [{ label: 'menu.play · 开始', value: 'menu.play' }], EXHAUSTIVE);

        const f = fieldsOf('Sprite', { layer: 'menu.play' }).find((x) => x.key === FIELD);
        expect(f?.options).toEqual([{ label: 'menu.play · 开始', value: 'menu.play' }]);
        expect(f?.value).toBe('menu.play');
    });

    it('stays a plain field while its source knows nothing', () => {
        // A source that yields nothing must not strand the value in an empty
        // dropdown — free editing has to survive an unwarmed cache.
        const f = fieldsOf('Sprite', { layer: 2 }).find((x) => x.key === FIELD);
        expect(f?.type).not.toBe('enum');
    });
});

// Whether a source's options are the ONLY legal values is a property of the thing
// being named, not of how it is spelled — and both writers (the inspector control
// and the MCP/agent path) have to get the same answer, which is why the source
// declares it once instead of each side guessing from the value's type.
describe('enum sources — exhaustive vs open', () => {
    it('marks a field open exactly when its source says its options are suggestions', () => {
        setEnumSource('sortingLayers', () => [{ label: 'back', value: 0 }], { exhaustive: false });
        expect(fieldsOf('Sprite', { layer: 0 }).find((f) => f.key === FIELD)?.open).toBe(true);

        setEnumSource('sortingLayers', () => [{ label: 'back', value: 0 }], EXHAUSTIVE);
        expect(fieldsOf('Sprite', { layer: 0 }).find((f) => f.key === FIELD)?.open).toBeFalsy();
    });

    it('keeps a value the options never offered — the layer nobody named', () => {
        // The renderer sorts on any i32; the names are aliases over it. A project
        // that named three layers must still be able to hold layer 7.
        setEnumSource('sortingLayers', () => [{ label: 'back', value: 0 }], { exhaustive: false });
        const f = fieldsOf('Sprite', { layer: 7 }).find((x) => x.key === FIELD);
        expect(f?.type).toBe('enum');
        expect(f?.value).toBe(7);
    });

    it('reports unknown sources as exhaustive, which offer nothing anyway', () => {
        expect(isEnumSourceExhaustive('nothing-registered-here')).toBe(true);
    });
});
