// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { Journal } from '../../fixtures/last-signal/src/journal';

describe('last signal: the play journal', () => {
    it('stamps an event with the seconds played and the game hours gone by', () => {
        const journal = new Journal('s1');
        journal.tick(12.34, 1.234, { canAct: false, input: false });
        const entry = journal.note('delivery', { ore: 5 });
        expect(entry).toEqual({ type: 'delivery', seconds: 12.3, gameHours: 1.23, ore: 5 });
        expect(journal.entries[0]).toMatchObject({ type: 'session', session: 's1' });
    });

    it('says how long the player went between two things they did, and what that time was like', () => {
        const journal = new Journal('s1');
        journal.tick(10, 1, { canAct: false, input: false });
        journal.tick(6, 0.6, { canAct: true, input: true });
        journal.look();
        journal.look();
        journal.tick(4, 0.4, { canAct: true, input: false });
        const first = journal.act('build', { kind: 'mine', cost: 15 });
        expect(first).toMatchObject({ gapSeconds: 20, gapCouldActSeconds: 10, gapInputSeconds: 6, gapLooks: 2 });
        journal.tick(3, 0.3, { canAct: false, input: false });
        expect(journal.act('mine_toggle', { on: false })).toMatchObject({ gapSeconds: 3, gapCouldActSeconds: 0, gapLooks: 0 });
    });

    it('does not count a delivery, which the game does by itself, as something the player did', () => {
        const journal = new Journal('s1');
        journal.tick(30, 3, { canAct: false, input: false });
        journal.note('delivery', { ore: 5 });
        journal.tick(30, 3, { canAct: false, input: false });
        expect(journal.act('build', { kind: 'solar', cost: 10 }).gapSeconds).toBe(60);
    });

    it('records a blackout once, when it ends, with how long it lasted', () => {
        const journal = new Journal('s1');
        journal.tick(50, 5, { canAct: false, input: false });
        journal.outage(true);
        journal.outage(true);
        journal.tick(80, 8, { canAct: false, input: false });
        expect(journal.entries.filter((e) => e.type === 'power_outage')).toHaveLength(0);
        journal.outage(false);
        journal.outage(false);
        expect(journal.entries.filter((e) => e.type === 'power_outage')).toEqual([
            { type: 'power_outage', seconds: 50, gameHours: 5, lastedSeconds: 80, lastedHours: 8 },
        ]);
    });

    it('sums a session up, splitting the waiting into time with something to do and time with nothing', () => {
        const journal = new Journal('s1');
        journal.tick(20, 2, { canAct: true, input: false });
        journal.act('build', { kind: 'mine', cost: 15 });
        journal.note('build', { kind: 'battery', ok: false, reason: 'too dear' });
        journal.tick(100, 10, { canAct: false, input: false });
        journal.note('delivery', { ore: 5 });
        journal.note('delivery', { ore: 3 });
        journal.act('repair', { ok: false });
        journal.outage(true);
        journal.tick(40, 4, { canAct: true, input: true });
        journal.act('remove', { kind: 'store', refund: 2 });
        journal.tick(15, 1.5, { canAct: false, input: false });
        expect(journal.summary()).toEqual({
            seconds: 175, gameHours: 17.5, builds: 1, refusedBuilds: 1, removes: 1, toggles: 0, deliveries: 2, oreDelivered: 8,
            outages: 1, outageHours: 5.5, failedRepairs: 1, actions: 3, longestGapSeconds: 100,
            idleSeconds: 175, couldActIdleSeconds: 60, nothingToDoSeconds: 115, won: false,
        });
        journal.outage(false);
        journal.act('repair', { ok: true });
        journal.note('victory', { buildings: 6 });
        expect(journal.summary()).toMatchObject({ won: true, outages: 1, outageHours: 5.5, actions: 4 });
        expect(journal.export().entries).toBe(journal.entries);
    });
});
