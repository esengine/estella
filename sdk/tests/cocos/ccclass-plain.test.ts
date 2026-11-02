// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  `@ccclass` on a class that is not a component: Cocos allows it for serializable data, and the layer must not drive it as a script.
 */
import { describe, expect, it } from 'vitest';
import { ccclass, classInfoOf, Component } from '../../src/cocos';

describe('ccclass on a plain class', () => {
    it('declares nothing for a class that does not derive from Component', () => {
        @ccclass('PlainData')
        class PlainData { value = 1; }
        @ccclass('RealScript')
        class RealScript extends Component {}
        expect(classInfoOf(PlainData)).toBeUndefined();
        expect(classInfoOf(RealScript)).toBeDefined();
        expect(new PlainData().value).toBe(1);
    });
});
