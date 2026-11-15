// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import {
    DRONE_CAPACITY, createState, place, demolish, isWalkable, whyNotPlace, targetOf, nearestDock, dockCells,
    isDocked, settleArrival, snapshot, restore, worldOfCell, cellOfWorld, droneCell, advanceClock,
    REPAIR_COST, TOWER_CELL, towerOf, whyNotRepair, repairTower, migrateFromV1,
} from '../../fixtures/last-signal/src/state';

const standAt = (state: ReturnType<typeof createState>, x: number, y: number): void => {
    const at = worldOfCell({ x, y });
    state.drone.x = at.x;
    state.drone.z = at.z;
};

describe('last signal gate 0: world state', () => {
    it('maps a cell to the world and back', () => {
        expect(cellOfWorld(worldOfCell({ x: 0, y: 63 }).x, worldOfCell({ x: 0, y: 63 }).z)).toEqual({ x: 0, y: 63 });
        expect(worldOfCell({ x: 32, y: 32 })).toEqual({ x: 1, z: 1 });
    });

    it('blocks a cell the moment a building stands on it, and frees it when the building goes', () => {
        const state = createState();
        expect(isWalkable(state, { x: 30, y: 32 })).toBe(true);
        const built = place(state, 'store', { x: 30, y: 32 });
        expect(built.ok).toBe(true);
        expect(isWalkable(state, { x: 30, y: 32 })).toBe(false);
        expect(demolish(state, { x: 30, y: 32 })?.kind).toBe('store');
        expect(isWalkable(state, { x: 30, y: 32 })).toBe(true);
        expect(demolish(state, { x: 30, y: 32 })).toBeNull();
    });

    it('refuses a building on another, on the drone, or off the map', () => {
        const state = createState();
        expect(whyNotPlace(state, { x: 20, y: 32 })).toMatch(/already/);
        expect(whyNotPlace(state, droneCell(state))).toMatch(/drone/);
        expect(whyNotPlace(state, { x: 64, y: 0 })).toMatch(/outside/);
        expect(place(state, 'mine', { x: -1, y: 0 }).ok).toBe(false);
        expect(state.buildings).toHaveLength(3);
    });

    it('hauls ore from the mine to the storehouse and back', () => {
        const state = createState();
        expect(targetOf(state)?.kind).toBe('mine');
        expect(isDocked(state, targetOf(state)!)).toBe(true);
        expect(settleArrival(state)).toBe(true);
        expect(state.drone).toMatchObject({ cargo: DRONE_CAPACITY, leg: 'toStore' });
        expect(settleArrival(state)).toBe(false);
        const store = targetOf(state)!;
        const dock = nearestDock(state, store)!;
        expect(dock).toEqual({ x: 43, y: 32 });
        standAt(state, dock.x, dock.y);
        expect(settleArrival(state)).toBe(true);
        expect(state).toMatchObject({ ore: DRONE_CAPACITY, trips: 1 });
        expect(state.buildings.map((b) => b.served)).toEqual([1, 1, 0]);
        expect(state.drone).toMatchObject({ cargo: 0, leg: 'toMine' });
    });

    it('has nowhere to dock at a building walled in on every side, and no target once its kind is gone', () => {
        const state = createState();
        for (const cell of [{ x: 45, y: 32 }, { x: 43, y: 32 }, { x: 44, y: 31 }, { x: 44, y: 33 }]) place(state, 'mine', cell);
        const store = state.buildings.find((b) => b.kind === 'store')!;
        expect(dockCells(state, store)).toEqual([]);
        expect(nearestDock(state, store)).toBeNull();
        state.drone.leg = 'toStore';
        demolish(state, store);
        expect(targetOf(state)).toBeNull();
    });

    it('keeps the hour inside a day', () => {
        const state = createState();
        advanceClock(state, 20);
        expect(state.hour).toBe(4);
    });

    it('restores from its own snapshot, through JSON, to an equal state', () => {
        const state = createState();
        place(state, 'store', { x: 10, y: 12 });
        settleArrival(state);
        standAt(state, 30, 30);
        state.ore = 15;
        state.trips = 3;
        state.hour = 21.25;
        const copy = restore(JSON.parse(JSON.stringify(snapshot(state))));
        expect(copy).toEqual(state);
        expect(copy.buildings).not.toBe(state.buildings);
        expect(place(copy, 'mine', { x: 11, y: 12 })).toMatchObject({ ok: true, building: { id: state.nextId } });
    });

    it('refuses a save that would put the world in a state the game cannot reach', () => {
        const good = snapshot(createState());
        expect(() => restore(null)).toThrow(/not an object/);
        expect(() => restore({ ...good, buildings: [...good.buildings, { id: 9, kind: 'mine', x: 20, y: 32, served: 0 }] })).toThrow(/shares its cell/);
        expect(() => restore({ ...good, buildings: [{ id: 1, kind: 'turret', x: 1, y: 1 }] })).toThrow(/unknown kind/);
        expect(() => restore({ ...good, drone: { ...good.drone, x: worldOfCell({ x: 20, y: 32 }).x } })).toThrow(/inside a building/);
        expect(() => restore({ ...good, nextId: 3 })).toThrow(/already taken/);
        expect(() => restore({ ...good, ore: -1 })).toThrow(/totals/);
        expect(() => restore({ ...good, buildings: [{ ...good.buildings[0]!, served: -2 }, good.buildings[1]!, good.buildings[2]!] })).toThrow(/served/);
        const old = { ...good, buildings: good.buildings.map(({ served: _served, ...rest }) => rest) };
        expect(restore(old).buildings.every((b) => b.served === 0)).toBe(true);
    });

    it('stands one tower that no tool removes and the drone never flies to', () => {
        const state = createState();
        const tower = towerOf(state)!;
        expect(tower).toMatchObject({ kind: 'tower', x: TOWER_CELL.x, y: TOWER_CELL.y });
        expect(isWalkable(state, TOWER_CELL)).toBe(false);
        expect(demolish(state, TOWER_CELL)).toBeNull();
        expect(towerOf(state)).toBe(tower);
        expect(targetOf(state)?.kind).toBe('mine');
        state.drone.leg = 'toStore';
        expect(targetOf(state)?.kind).toBe('store');
    });

    it('repairs the tower for ore the storehouse really holds, once', () => {
        const state = createState();
        expect(whyNotRepair(state)).toMatch(/holds 0/);
        state.ore = REPAIR_COST - 5;
        expect(repairTower(state)).toBe(false);
        expect(state).toMatchObject({ ore: REPAIR_COST - 5, signal: 'offline' });
        state.ore = REPAIR_COST + 10;
        expect(repairTower(state)).toBe(true);
        expect(state).toMatchObject({ ore: 10, signal: 'online' });
        state.ore = 100;
        expect(whyNotRepair(state)).toMatch(/already/);
        expect(repairTower(state)).toBe(false);
        expect(state.ore).toBe(100);
    });

    it('reaches the repair by five real deliveries and not before', () => {
        const state = createState();
        const mine = state.buildings.find((b) => b.kind === 'mine')!, store = state.buildings.find((b) => b.kind === 'store')!;
        for (let trip = 1; trip <= 5; trip++) {
            expect(repairTower(state)).toBe(false);
            standAt(state, mine.x + 1, mine.y);
            expect(settleArrival(state)).toBe(true);
            expect(state.ore).toBe((trip - 1) * DRONE_CAPACITY);
            standAt(state, store.x - 1, store.y);
            expect(settleArrival(state)).toBe(true);
            expect(state.ore).toBe(trip * DRONE_CAPACITY);
        }
        expect(repairTower(state)).toBe(true);
        expect(state.ore).toBe(0);
    });

    it('carries the transmitted signal through a save, and refuses a save with no tower or two', () => {
        const state = createState();
        state.ore = REPAIR_COST;
        repairTower(state);
        const saved = JSON.parse(JSON.stringify(snapshot(state)));
        expect(saved.signal).toBe('online');
        const back = restore(saved);
        expect(back.signal).toBe('online');
        back.ore = 500;
        expect(repairTower(back)).toBe(false);
        expect(() => restore({ ...saved, signal: 'maybe' })).toThrow(/neither/);
        expect(() => restore({ ...saved, buildings: saved.buildings.filter((b: { kind: string }) => b.kind !== 'tower') })).toThrow(/exactly one tower/);
        expect(() => restore({ ...saved, nextId: 9, buildings: [...saved.buildings, { id: 8, kind: 'tower', x: 2, y: 2, served: 0 }] })).toThrow(/exactly one tower/);
    });

    it('gives a save from before the tower its tower, on a free cell, with the signal offline', () => {
        const old = {
            buildings: [{ id: 1, kind: 'mine', x: 20, y: 32 }, { id: 2, kind: 'store', x: 44, y: 32 }, { id: 3, kind: 'store', x: TOWER_CELL.x, y: TOWER_CELL.y }],
            nextId: 4, ore: 40, trips: 8, hour: 13, drone: { x: worldOfCell({ x: 30, y: 30 }).x, z: worldOfCell({ x: 30, y: 30 }).z, cargo: 0, leg: 'toMine' },
        };
        const state = restore(migrateFromV1(old));
        const tower = towerOf(state)!;
        expect(tower.id).toBe(4);
        expect([tower.x, tower.y]).not.toEqual([TOWER_CELL.x, TOWER_CELL.y]);
        expect(Math.max(Math.abs(tower.x - TOWER_CELL.x), Math.abs(tower.y - TOWER_CELL.y))).toBe(1);
        expect(state).toMatchObject({ signal: 'offline', ore: 40, trips: 8, nextId: 5 });
        expect(state.buildings).toHaveLength(4);
    });
});
