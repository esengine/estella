// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
//
// The armature/animation dropdowns. The parsing is covered in the SDK; what is
// covered here is the choosing — a file's armatures do NOT share an animation
// list, so offering their union would let someone pick an animation the armature
// they selected cannot play, and it would look like a broken export rather than a
// bad menu.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const files = new Map<string, string>();

vi.mock('@/project/ProjectStore', () => ({
    ProjectStore: { refPath: (ref: string) => (files.has(ref) ? ref : null) },
}));

const sources = new Map<string, (data: Record<string, unknown>) => { label: string; value: string | number }[]>();
vi.mock('@/engine/schema', () => ({
    setEnumSource: (name: string, provider: never) => sources.set(name, provider),
}));

const TWO_ARMATURES = JSON.stringify({
    armature: [
        { name: 'Dragon', animation: [{ name: 'walk' }, { name: 'stand' }] },
        { name: 'Effects', animation: [{ name: 'burst' }] },
    ],
});

describe('DragonBones enum sources', () => {
    beforeEach(async () => {
        files.clear();
        sources.clear();
        (globalThis as { window?: unknown }).window = {
            estella: { fs: { read: (p: string) => Promise.resolve(files.get(p) ?? '') } },
        };
        const mod = await import('@/engine/dragonBonesNames');
        mod.clearDragonBonesNameCache();
        mod.installDragonBonesEnumSources();
    });

    /** The provider reads a cache; the first call only starts the read. */
    const settle = () => new Promise((r) => setTimeout(r, 0));

    it('offers nothing before the file has been read, so the field stays editable', () => {
        files.set('hero_ske.json', TWO_ARMATURES);
        const opts = sources.get('dragonbonesArmatures')!({ skeletonPath: 'hero_ske.json' });
        expect(opts).toEqual([]);
    });

    it('lists the file`s armatures once it has', async () => {
        files.set('hero_ske.json', TWO_ARMATURES);
        const data = { skeletonPath: 'hero_ske.json' };
        sources.get('dragonbonesArmatures')!(data);
        await settle();
        expect(sources.get('dragonbonesArmatures')!(data).map((o) => o.value)).toEqual(['Dragon', 'Effects']);
    });

    it('offers only the animations of the armature this entity chose', async () => {
        files.set('hero_ske.json', TWO_ARMATURES);
        const base = { skeletonPath: 'hero_ske.json' };
        sources.get('dragonbonesAnimations')!(base);
        await settle();

        const anims = (armature: string) =>
            sources.get('dragonbonesAnimations')!({ ...base, armature }).map((o) => o.value);
        expect(anims('Dragon')).toEqual(['walk', 'stand']);
        expect(anims('Effects')).toEqual(['burst']);
        // Unset means the first armature, which is what the component does too.
        expect(anims('')).toEqual(['walk', 'stand']);
    });

    it('answers empty for a reference that does not resolve, and stops asking', async () => {
        const data = { skeletonPath: 'missing_ske.json' };
        sources.get('dragonbonesArmatures')!(data);
        await settle();
        // Cached as empty rather than retried: a path that cannot be read now will
        // not read differently on the next repaint, and the inspector repaints a lot.
        expect(sources.get('dragonbonesArmatures')!(data)).toEqual([]);
    });
});
