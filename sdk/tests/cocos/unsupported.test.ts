// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, expect, it } from 'vitest';
import { unsupported } from '../../src/cocos/unsupported';

describe('a part of Cocos the layer does not provide', () => {
    it('survives what a script does with it while its module loads', () => {
        const gfx = unsupported('gfx') as any;
        const format = [new gfx.Attribute('a_position', gfx.Format.RGB32F), gfx.Format.RG32F];
        expect(format).toHaveLength(2);
        expect(`${gfx.Format.RGB32F}`).toBe('');
        expect(gfx.Attribute).toBe(gfx.Attribute);
        expect(() => { gfx.useless(1).deeper.still(); gfx.flag = 3; })
            .not.toThrow();
        class Derived extends (unsupported('Base') as any) { }
        expect(() => new Derived()).not.toThrow();
    });

    it('is not a promise, so awaiting it does not hang', async () => {
        await expect(Promise.resolve(unsupported('x'))).resolves.toBeDefined();
    });
});
