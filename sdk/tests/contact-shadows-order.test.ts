// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { withContactShadowsFirst, type ResolvedEffects } from '../src/postprocess/volumeSystem';

const chain = (...types: string[]): ResolvedEffects =>
    new Map(types.map((t) => [t, { enabled: true, uniforms: new Map(), colors: new Map(), textures: new Map() } as never]));

describe('contact shadows in the chain', () => {
    it('run ahead of ambient occlusion listed before them, the rest in the order given', () => {
        const out = withContactShadowsFirst(chain('skyAtmosphere', 'ssr', 'gtao', 'contactShadows', 'bloom'));
        expect([...out.keys()]).toEqual(['skyAtmosphere', 'contactShadows', 'ssr', 'gtao', 'bloom']);
    });

    it('leave a chain alone where they already come first, or where nothing scales the picture before them', () => {
        const first = chain('contactShadows', 'gtao', 'bloom');
        expect(withContactShadowsFirst(first)).toBe(first);
        const alone = chain('heightFog', 'contactShadows', 'taa');
        expect(withContactShadowsFirst(alone)).toBe(alone);
    });
});
