// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  A prefab is handed over with the prefabs its scripts hold: a List in a screen holds its row's prefab, and the screen's own code builds rows
 *        the moment it is up.
 */
import { describe, expect, it } from 'vitest';
import { Component, Prefab, _decorator } from '../../src/cocos';
import { prefabsHeldBy } from '../../src/cocos/prefabs';
import type { PreparedPrefab } from '../../src/prefab/preparedPrefab';

const { ccclass, property } = _decorator;

describe('prefabs a prefab holds', () => {
    it('names the paths in Prefab fields of its script components, lists too, and nothing else', () => {
        @ccclass('HeldList')
        class HeldList extends Component {
            @property(Prefab) row: Prefab | null = null;
            @property([Prefab]) more: Prefab[] = [];
            @property(String) label = '';
        }
        expect(HeldList).toBeDefined();
        const prepared = {
            scene: { entities: [
                { id: 1, name: 'a', parent: null, children: [], components: [
                    { type: 'Cocos.HeldList', data: { row: 'ui/row', more: ['ui/a', 'ui/b'], label: 'ui/not-a-prefab' } },
                    { type: 'Transform', data: {} },
                ] },
            ] },
        } as unknown as PreparedPrefab;
        expect(prefabsHeldBy(prepared).sort()).toEqual(['ui/a', 'ui/b', 'ui/row']);
    });
});
