// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import {
    DRONE_CAPACITY, REPAIR_COST, START_ORE, TOWER_CELL, COSTS, BASE_CAPACITY, BATTERY_CAPACITY, MINE_STOCK_CAP,
    createState, place, demolish, isWalkable, whyNotPlace, whyNotBuild, targetOf, nearestDock, dockCells,
    isDocked, settleArrival, snapshot, restore, worldOfCell, cellOfWorld, droneCell, advanceClock,
    towerOf, whyNotRepair, repairTower, migrateFromV1, migrateFromV2,
    sunlight, capacityOf, powerReport, stepPower, setMineOn, isRunning,
    type GameState,
} from '../../fixtures/last-signal/src/state';

const standAt = (state: GameState, x: number, y: number): void => {
    const at = worldOfCell({ x, y });
    state.drone.x = at.x;
    state.drone.z = at.z;
};
const mineOf = (state: GameState) => state.buildings.find((b) => b.kind === 'mine')!;
const storeOf = (state: GameState) => state.buildings.find((b) => b.kind === 'store')!;
const haul = (state: GameState): void => {
    const mine = targetOf(state)!;
    standAt(state, mine.x + 1, mine.y);
    expect(settleArrival(state)).toBe(true);
    const store = targetOf(state)!;
    standAt(state, store.x - 1, store.y);
    expect(settleArrival(state)).toBe(true);
};

describe('last signal: the map and its buildings', () => {
    it('maps a cell to the world and back', () => {
        expect(cellOfWorld(worldOfCell({ x: 0, y: 63 }).x, worldOfCell({ x: 0, y: 63 }).z)).toEqual({ x: 0, y: 63 });
        expect(worldOfCell({ x: 32, y: 32 })).toEqual({ x: 1, z: 1 });
    });

    it('starts with a mine, a storehouse, the tower, one solar array and ore to spend', () => {
        const state = createState();
        expect(state.buildings.map((b) => b.kind)).toEqual(['mine', 'store', 'tower', 'solar']);
        expect(state).toMatchObject({ ore: START_ORE, signal: 'offline', blackout: false, energy: BASE_CAPACITY });
        expect(mineOf(state).stock).toBe(DRONE_CAPACITY);
    });

    it('blocks a cell the moment a building stands on it, and frees it when the building goes', () => {
        const state = createState();
        expect(isWalkable(state, { x: 30, y: 32 })).toBe(true);
        expect(place(state, 'store', { x: 30, y: 32 }).ok).toBe(true);
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
        expect(state.buildings).toHaveLength(4);
    });

    it('charges ore for a building, refuses one it cannot pay for, and gives half back when it is removed', () => {
        const state = createState();
        expect(place(state, 'solar', { x: 10, y: 10 }).ok).toBe(true);
        expect(state.ore).toBe(START_ORE - COSTS.solar);
        expect(whyNotBuild(state, 'mine', { x: 11, y: 10 })).toMatch(/costs 15 ore and the storehouse holds 5/);
        expect(place(state, 'mine', { x: 11, y: 10 }).ok).toBe(false);
        expect(state.ore).toBe(START_ORE - COSTS.solar);
        demolish(state, { x: 10, y: 10 });
        expect(state.ore).toBe(START_ORE - COSTS.solar + Math.floor(COSTS.solar / 2));
    });

    it('stands one tower that no tool removes and the drone never flies to', () => {
        const state = createState();
        const tower = towerOf(state)!;
        expect(tower).toMatchObject({ kind: 'tower', x: TOWER_CELL.x, y: TOWER_CELL.y });
        expect(demolish(state, TOWER_CELL)).toBeNull();
        expect(towerOf(state)).toBe(tower);
        expect(targetOf(state)?.kind).toBe('mine');
    });
});

describe('last signal: hauling', () => {
    it('hauls a full load from the mine to the storehouse and counts what each building served', () => {
        const state = createState();
        const mine = mineOf(state);
        expect(isDocked(state, mine)).toBe(true);
        expect(settleArrival(state)).toBe(true);
        expect(state.drone).toMatchObject({ cargo: DRONE_CAPACITY, leg: 'toStore' });
        expect(mine.stock).toBe(0);
        expect(settleArrival(state)).toBe(false);
        expect(nearestDock(state, storeOf(state))).toEqual({ x: 35, y: 32 });
        standAt(state, 35, 32);
        expect(settleArrival(state)).toBe(true);
        expect(state).toMatchObject({ ore: START_ORE + DRONE_CAPACITY, trips: 1 });
        expect([mine.served, storeOf(state).served]).toEqual([1, 1]);
    });

    it('waits at a running mine for a full load, and takes what there is from one that has stopped', () => {
        const state = createState();
        const mine = mineOf(state);
        mine.stock = 2.4;
        expect(settleArrival(state)).toBe(false);
        state.blackout = true;
        expect(isRunning(state, mine)).toBe(false);
        expect(settleArrival(state)).toBe(true);
        expect(state.drone.cargo).toBe(2);
        expect(mine.stock).toBeCloseTo(0.4, 6);
    });

    it('flies to the mine that holds the most, and keeps to it until it has loaded', () => {
        const state = createState();
        state.ore = 100;
        const second = (place(state, 'mine', { x: 24, y: 40 }) as { ok: true; building: { id: number; stock: number } }).building;
        mineOf(state).stock = 3;
        second.stock = 7;
        expect(targetOf(state)?.id).toBe(second.id);
        mineOf(state).stock = 9;
        expect(targetOf(state)?.id).toBe(second.id);
        setMineOn(state, second.id, false);
        expect(targetOf(state)?.id).toBe(mineOf(state).id);
    });

    it('has nowhere to dock at a building walled in on every side', () => {
        const state = createState();
        state.ore = 100;
        for (const cell of [{ x: 37, y: 32 }, { x: 35, y: 32 }, { x: 36, y: 31 }, { x: 36, y: 33 }]) place(state, 'store', cell);
        expect(dockCells(state, storeOf(state))).toEqual([]);
        expect(nearestDock(state, storeOf(state))).toBeNull();
    });
});

describe('last signal: power', () => {
    it('has sun between six and eighteen, most at noon', () => {
        expect(sunlight(3)).toBe(0);
        expect(sunlight(6)).toBe(0);
        expect(sunlight(12)).toBeCloseTo(1, 9);
        expect(sunlight(18)).toBe(0);
        expect(sunlight(9)).toBeCloseTo(sunlight(15), 9);
        expect(sunlight(36)).toBeCloseTo(1, 9);
    });

    it('reports what is made, what is drawn and what can be stored', () => {
        const state = createState();
        const noon = powerReport(state, 12);
        expect(noon).toMatchObject({ generation: 4, demand: 1.5, capacity: BASE_CAPACITY, running: 1, wanted: 1 });
        state.energy = 3;
        expect(powerReport(state, 12).status).toBe('charging');
        expect(powerReport(state, 22).status).toBe('draining');
        state.ore = 100;
        place(state, 'battery', { x: 10, y: 10 });
        expect(capacityOf(state)).toBe(BASE_CAPACITY + BATTERY_CAPACITY);
    });

    it('fills its store by day and mines while it has power', () => {
        const state = createState();
        state.energy = 0.5;
        mineOf(state).stock = 0;
        stepPower(state, 10, 2);
        expect(state.blackout).toBe(false);
        expect(state.energy).toBeGreaterThan(3);
        expect(mineOf(state).stock).toBeCloseTo(4, 2);
    });

    it('goes dark when the night outlasts what is stored, stops the mine, and comes back after dawn', () => {
        const state = createState();
        mineOf(state).stock = 0;
        stepPower(state, 18, 3);
        expect(state.energy).toBeCloseTo(BASE_CAPACITY - 4.5, 2);
        expect(state.blackout).toBe(false);
        stepPower(state, 21, 2);
        expect(state).toMatchObject({ energy: 0, blackout: true });
        const stopped = mineOf(state).stock;
        expect(stopped).toBeCloseTo(8, 1);
        stepPower(state, 23, 6);
        expect(mineOf(state).stock).toBe(stopped);
        expect(powerReport(state, 5)).toMatchObject({ status: 'blackout', running: 0, demand: 0 });
        stepPower(state, 5, 4);
        expect(state.blackout).toBe(false);
        expect(mineOf(state).stock).toBeGreaterThan(stopped);
    });

    it('lasts the night on a battery, or with the mine switched off', () => {
        const withBattery = createState();
        withBattery.ore = 100;
        place(withBattery, 'battery', { x: 10, y: 10 });
        place(withBattery, 'battery', { x: 11, y: 10 });
        withBattery.energy = capacityOf(withBattery);
        stepPower(withBattery, 18, 12);
        expect(withBattery.blackout).toBe(false);
        expect(withBattery.energy).toBeCloseTo(capacityOf(withBattery) - 18, 1);

        const switchedOff = createState();
        setMineOn(switchedOff, mineOf(switchedOff).id, false);
        stepPower(switchedOff, 18, 12);
        expect(switchedOff).toMatchObject({ blackout: false, energy: BASE_CAPACITY });
        expect(mineOf(switchedOff).stock).toBe(DRONE_CAPACITY);
    });

    it('never stocks a mine past what it holds or stores more than there is room for', () => {
        const state = createState();
        stepPower(state, 8, 9);
        expect(mineOf(state).stock).toBe(MINE_STOCK_CAP);
        expect(state.energy).toBeLessThanOrEqual(BASE_CAPACITY);
    });

    it('comes to the same state whether two days pass in large steps or small ones', () => {
        const run = (chunk: number): GameState => {
            const state = createState();
            state.ore = 100;
            place(state, 'mine', { x: 24, y: 40 });
            place(state, 'battery', { x: 10, y: 10 });
            let hour = 8;
            for (let done = 0; done < 48 - 1e-9; done += chunk) {
                stepPower(state, hour, chunk);
                hour = (hour + chunk) % 24;
            }
            return state;
        };
        const coarse = run(0.5), fine = run(0.013), frames = run(1 / 600);
        for (const other of [fine, frames]) {
            expect(other.blackout).toBe(coarse.blackout);
            expect(other.energy).toBeCloseTo(coarse.energy, 1);
            expect(other.buildings.map((b) => b.stock.toFixed(1))).toEqual(coarse.buildings.map((b) => b.stock.toFixed(1)));
        }
    });

    it('carries on from a save exactly as if it had never stopped', () => {
        const through = createState();
        stepPower(through, 16, 10);
        const paused = createState();
        stepPower(paused, 16, 4);
        const resumed = restore(JSON.parse(JSON.stringify(snapshot(paused))));
        stepPower(resumed, 20, 6);
        expect(resumed.blackout).toBe(through.blackout);
        expect(resumed.energy).toBeCloseTo(through.energy, 6);
        expect(mineOf(resumed).stock).toBeCloseTo(mineOf(through).stock, 6);
    });
});

describe('last signal: the tower and the save', () => {
    it('repairs the tower for ore the storehouse really holds, once', () => {
        const state = createState();
        expect(whyNotRepair(state)).toMatch(/holds 15/);
        state.ore = REPAIR_COST - 5;
        expect(repairTower(state)).toBe(false);
        expect(state).toMatchObject({ ore: REPAIR_COST - 5, signal: 'offline' });
        state.ore = REPAIR_COST + 10;
        expect(repairTower(state)).toBe(true);
        expect(state).toMatchObject({ ore: 10, signal: 'online' });
        state.ore = 500;
        expect(whyNotRepair(state)).toMatch(/already/);
        expect(repairTower(state)).toBe(false);
        expect(state.ore).toBe(500);
    });

    it('reaches the repair only by ore that was mined under power and delivered', () => {
        const state = createState();
        let hour = 9;
        let trips = 0;
        while (state.ore < REPAIR_COST) {
            expect(repairTower(state)).toBe(false);
            haul(state);
            trips += 1;
            stepPower(state, hour, 2.5);
            expect(trips).toBeLessThan(40);
        }
        expect(state.ore).toBe(START_ORE + trips * DRONE_CAPACITY);
        expect(trips).toBe((REPAIR_COST - START_ORE) / DRONE_CAPACITY);
        expect(repairTower(state)).toBe(true);
        expect(state.ore).toBe(0);
    });

    it('restores from its own snapshot, through JSON, to an equal state', () => {
        const state = createState();
        state.ore = 100;
        place(state, 'battery', { x: 10, y: 12 });
        haul(state);
        stepPower(state, 20, 3.3);
        setMineOn(state, mineOf(state).id, false);
        standAt(state, 30, 30);
        state.hour = 21.25;
        targetOf(state);
        const copy = restore(JSON.parse(JSON.stringify(snapshot(state))));
        expect(copy).toEqual(state);
        expect(copy.buildings).not.toBe(state.buildings);
    });

    it('refuses a save that would put the world in a state the game cannot reach', () => {
        const good = snapshot(createState());
        const [mine, ...rest] = good.buildings;
        expect(() => restore(null)).toThrow(/not an object/);
        expect(() => restore({ ...good, nextId: 9, buildings: [...good.buildings, { ...mine!, id: 8 }] })).toThrow(/shares its cell/);
        expect(() => restore({ ...good, buildings: [{ ...mine!, kind: 'turret' }, ...rest] })).toThrow(/unknown kind/);
        expect(() => restore({ ...good, drone: { ...good.drone, x: worldOfCell({ x: 20, y: 32 }).x } })).toThrow(/inside a building/);
        expect(() => restore({ ...good, nextId: 3 })).toThrow(/already taken/);
        expect(() => restore({ ...good, ore: -1 })).toThrow(/totals/);
        expect(() => restore({ ...good, buildings: [{ ...mine!, stock: 99 }, ...rest] })).toThrow(/stock out of range/);
        expect(() => restore({ ...good, energy: -3 })).toThrow(/power/);
        expect(() => restore({ ...good, signal: 'maybe' })).toThrow(/neither/);
        expect(() => restore({ ...good, buildings: good.buildings.filter((b) => b.kind !== 'tower') })).toThrow(/exactly one tower/);
        expect(restore({ ...good, energy: 999 }).energy).toBe(BASE_CAPACITY);
    });

    it('carries the transmitted signal through a save', () => {
        const state = createState();
        state.ore = REPAIR_COST;
        repairTower(state);
        const back = restore(JSON.parse(JSON.stringify(snapshot(state))));
        expect(back.signal).toBe('online');
        back.ore = 500;
        expect(repairTower(back)).toBe(false);
    });

    it('brings a save from before the tower and before power up to today', () => {
        const old = {
            buildings: [{ id: 1, kind: 'mine', x: 20, y: 32 }, { id: 2, kind: 'store', x: 44, y: 32 }, { id: 3, kind: 'store', x: TOWER_CELL.x, y: TOWER_CELL.y }],
            nextId: 4, ore: 40, trips: 8, hour: 13, drone: { x: worldOfCell({ x: 30, y: 30 }).x, z: worldOfCell({ x: 30, y: 30 }).z, cargo: 0, leg: 'toMine' },
        };
        const state = restore(migrateFromV2(migrateFromV1(old)));
        const tower = towerOf(state)!;
        expect(tower.id).toBe(4);
        expect(Math.max(Math.abs(tower.x - TOWER_CELL.x), Math.abs(tower.y - TOWER_CELL.y))).toBe(1);
        expect(state).toMatchObject({ signal: 'offline', ore: 40, trips: 8, nextId: 5, energy: BASE_CAPACITY, blackout: false });
        expect(state.buildings.every((b) => b.on)).toBe(true);
        expect(mineOf(state).stock).toBe(DRONE_CAPACITY);
        expect(state.drone.target).toBeNull();
        expect(powerReport(state, 12).generation).toBe(0);
    });

    it('keeps the hour inside a day', () => {
        const state = createState();
        advanceClock(state, 20);
        expect(state.hour).toBe(4);
    });
});
