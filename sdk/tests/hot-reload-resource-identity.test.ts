// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    hot-reload-resource-identity.test.ts
 * @brief   A re-imported bundle's resources must address the live World's, the
 *          way its components already do.
 *
 * @details Issue #60. A hot-swap reload keeps the live World and its
 *          ResourceStorage but installs system bodies from a re-EVALUATED
 *          module. Every module-level identity that re-evaluation mints again
 *          must therefore be stable by name, or the new bodies address slots
 *          nothing ever filled — and a resource read that misses does not
 *          throw, it materialises the DEFAULT, which for the
 *          `defineResource<T>(null!, 'Name')` idiom is null.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { App } from '../src/app/app';
import { defineSystem, Schedule, addSystemToSchedule } from '../src/ecs/system';
import { defineResource, declaredResource, Res, type ResourceDef } from '../src/ecs/resource';
import { defineEvent, eventNamed, EventRegistry } from '../src/ecs/event';
import { setDefaultContext, AppContext, getDefaultContext } from '../src/ecs/context';
import { probeRegistrations } from '../src/hotReload';

interface MatchState { phase: string }

describe('a project resource across a bundle re-import', () => {
    beforeEach(() => setDefaultContext(new AppContext()));

    it('survives the whole reload chain: probe, hot-swap, next frame', async () => {
        // The chain playHost.ts runs on a script edit while the game is live —
        // and issue #60 in one test: every system began reading null from every
        // resource, one frame after the edit, and the game just stopped being it.
        const app = App.new();
        let seen: MatchState | null | undefined;
        const body = (state: MatchState): void => { seen = state; };
        // Read through a typed accessor: the assignment happens inside a system
        // the type checker cannot see run, so a direct read narrows to `undefined`.
        const read = (): MatchState | null | undefined => seen;

        // Evaluation #1 — the bundle as the running session imported it.
        const declare = (): ResourceDef<MatchState> => {
            const MatchState = defineResource<MatchState>(null!, 'MatchState');
            addSystemToSchedule(Schedule.Update, defineSystem([Res(MatchState)], body, { name: 'match-flow' }));
            return MatchState;
        };
        const evaluation1 = declare();
        const live = getDefaultContext().drainPendingSystems();
        app.addBundleSystems(live as Parameters<App['addBundleSystems']>[0]);
        app.insertResource(evaluation1, { phase: 'playing' });
        await app.tick(1 / 60);
        expect(read()?.phase).toBe('playing');

        // Evaluation #2 — the same source, re-imported under a cache-busted URL,
        // in the throwaway context the probe installs.
        seen = undefined;
        const { pending } = await probeRegistrations(async () => { declare(); });
        expect(app.hotSwapSystems(pending as Parameters<App['hotSwapSystems']>[0])).toBe(true);
        await app.tick(1 / 60);

        expect(read()).not.toBeNull();
        expect(read()?.phase).toBe('playing');
    });

    it('a write through the re-imported def lands on the live slot', () => {
        const app = App.new();
        const V1 = defineResource<MatchState>(null!, 'MatchState2');
        app.insertResource(V1, { phase: 'playing' });
        const V2 = defineResource<MatchState>(null!, 'MatchState2');

        app.insertResource(V2, { phase: 'won' });

        expect(app.getResource(V1).phase).toBe('won');
    });

    it('stays addressable by name — a re-import is not an ambiguous declaration', () => {
        defineResource<MatchState>(null!, 'MatchState3');
        defineResource<MatchState>(null!, 'MatchState3');

        expect(declaredResource('MatchState3')).toBeDefined();
    });
});

describe('a project event across a bundle re-import', () => {
    it('keeps one identity, so the name door and the running systems agree', () => {
        const registry = new EventRegistry();
        registry.register(defineEvent<{ amount: number }>('Damage'));

        // Evaluation #2 — the same declaration, re-imported.
        const DamageV2 = defineEvent<{ amount: number }>('Damage');
        registry.getBus(DamageV2).send({ amount: 7 });
        registry.swapAll();

        // Whoever resolves the event by NAME — the AOT manifest handshake — must
        // land on the bus the live systems actually write.
        expect(eventNamed('Damage')?._id).toBe(DamageV2._id);
        expect(registry.busNamed('Damage')?.getReadBuffer()).toEqual([{ amount: 7 }]);
    });

    it('does not mint a fresh bus per reload', () => {
        const registry = new EventRegistry();
        const buses = (registry as unknown as { buses_: Map<symbol, unknown> }).buses_;
        registry.register(defineEvent('Healed'));
        const after1 = buses.size;
        registry.register(defineEvent('Healed'));

        expect(buses.size).toBe(after1);
    });
});
