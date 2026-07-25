// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The editor's action vocabulary: the live registry (engine builtins the
 *        edit realm registered) merged with the open project's artifact, so the
 *        FSM/BT palettes and the Events section all offer one list.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { aiRegistry } from 'esengine';
import {
    actionNames,
    conditionNames,
    actionParams,
    actionSeparator,
    isKnownAction,
    setProjectActions,
    subscribeActionCatalog,
    getActionCatalogRevision,
} from '@/ai/actionCatalog';

beforeEach(() => {
    aiRegistry.clear();
    setProjectActions([], []);
});

describe('actionCatalog', () => {
    it('offers the live registry and the project artifact as one list', () => {
        aiRegistry.registerAction('timeline.play', () => {});
        setProjectActions([{ name: 'game.startRun' }], ['game.isBoss']);

        expect(actionNames()).toEqual(['timeline.play', 'game.startRun']);
        expect(conditionNames()).toEqual(['game.isBoss']);
    });

    it('does not list a name twice when both halves have it', () => {
        aiRegistry.registerAction('game.startRun', () => {});
        setProjectActions([{ name: 'game.startRun' }], []);

        expect(actionNames()).toEqual(['game.startRun']);
    });

    it('serves a project action\'s declared parameters', () => {
        setProjectActions(
            [{ name: 'game.award', params: [{ name: 'kind', type: 'string' }], separator: '=' }],
            [],
        );

        expect(actionParams('game.award')).toEqual([{ name: 'kind', type: 'string' }]);
        expect(actionSeparator('game.award')).toBe('=');
        expect(isKnownAction('game.award')).toBe(true);
    });

    it('prefers the live registry over the artifact — the artifact can be one extract behind', () => {
        aiRegistry.registerAction('game.award', {
            params: [{ name: 'fresh', type: 'string' }],
            run: () => {},
        });
        setProjectActions([{ name: 'game.award', params: [{ name: 'stale', type: 'string' }] }], []);

        expect(actionParams('game.award').map((p) => p.name)).toEqual(['fresh']);
    });

    it('an unknown name has no parameters and the default separator (still authorable)', () => {
        expect(actionParams('nope')).toEqual([]);
        expect(actionSeparator('nope')).toBe(':');
        expect(isKnownAction('nope')).toBe(false);
    });

    it('notifies subscribers when the project half changes', () => {
        let hits = 0;
        const off = subscribeActionCatalog(() => { hits++; });
        const before = getActionCatalogRevision();

        setProjectActions([{ name: 'game.x' }], []);

        expect(hits).toBe(1);
        expect(getActionCatalogRevision()).toBeGreaterThan(before);
        off();
    });
});
