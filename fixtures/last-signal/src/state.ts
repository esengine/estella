export const GRID_WIDTH = 64;
export const GRID_HEIGHT = 64;
export const CELL_SIZE = 2;
export interface Cell { x: number; y: number }

export const SAVE_VERSION = 3;
export const REPAIR_COST = 150;
export const START_ORE = 15;
export const TOWER_CELL: Cell = { x: 32, y: 24 };
export const DRONE_CAPACITY = 5;
export const DAY_HOURS = 24;

export const SOLAR_PEAK = 4;
export const MINE_DRAW = 1.5;
export const BASE_CAPACITY = 6;
export const BATTERY_CAPACITY = 12;
export const MINE_RATE = 2;
export const MINE_STOCK_CAP = 10;
export const RECOVER_AT = 2;
export const POWER_STEP = 0.02;

export type PlaceableKind = 'mine' | 'store' | 'solar' | 'battery';
export type BuildingKind = PlaceableKind | 'tower';
export type Signal = 'offline' | 'online';
export type Leg = 'toMine' | 'toStore';
export type PowerStatus = 'blackout' | 'charging' | 'draining' | 'steady';

export const COSTS: Record<PlaceableKind, number> = { mine: 15, store: 5, solar: 10, battery: 10 };

export interface Building extends Cell { id: number; kind: BuildingKind; served: number; on: boolean; stock: number }
export interface DroneState { x: number; z: number; cargo: number; leg: Leg; target: number | null }

export interface GameState {
    buildings: Building[];
    nextId: number;
    ore: number;
    trips: number;
    hour: number;
    drone: DroneState;
    signal: Signal;
    energy: number;
    blackout: boolean;
}

export interface PowerReport {
    generation: number;
    demand: number;
    capacity: number;
    energy: number;
    running: number;
    wanted: number;
    status: PowerStatus;
}

export type PlaceResult = { ok: true; building: Building } | { ok: false; reason: string };

export function worldOfCell(cell: Cell): { x: number; z: number } {
    return {
        x: (cell.x - GRID_WIDTH / 2 + 0.5) * CELL_SIZE,
        z: (cell.y - GRID_HEIGHT / 2 + 0.5) * CELL_SIZE,
    };
}

export function cellOfWorld(x: number, z: number): Cell {
    return {
        x: Math.floor(x / CELL_SIZE + GRID_WIDTH / 2),
        y: Math.floor(z / CELL_SIZE + GRID_HEIGHT / 2),
    };
}

export function inBounds(cell: Cell): boolean {
    return Number.isInteger(cell.x) && Number.isInteger(cell.y)
        && cell.x >= 0 && cell.y >= 0 && cell.x < GRID_WIDTH && cell.y < GRID_HEIGHT;
}

const raise = (id: number, kind: BuildingKind, x: number, y: number, stock = 0): Building =>
    ({ id, kind, x, y, served: 0, on: true, stock });

export function createState(): GameState {
    const start = worldOfCell({ x: 21, y: 32 });
    return {
        buildings: [
            raise(1, 'mine', 20, 32, DRONE_CAPACITY),
            raise(2, 'store', 44, 32),
            raise(3, 'tower', TOWER_CELL.x, TOWER_CELL.y),
            raise(4, 'solar', 18, 29),
        ],
        nextId: 5,
        ore: START_ORE,
        trips: 0,
        hour: 8,
        drone: { x: start.x, z: start.z, cargo: 0, leg: 'toMine', target: null },
        signal: 'offline',
        energy: BASE_CAPACITY,
        blackout: false,
    };
}

export function buildingAt(state: GameState, cell: Cell): Building | null {
    return state.buildings.find((b) => b.x === cell.x && b.y === cell.y) ?? null;
}

export function isWalkable(state: GameState, cell: Cell): boolean {
    return inBounds(cell) && buildingAt(state, cell) === null;
}

export function droneCell(state: GameState): Cell {
    return cellOfWorld(state.drone.x, state.drone.z);
}

export function whyNotPlace(state: GameState, cell: Cell): string | null {
    if (!inBounds(cell)) return 'outside the map';
    if (buildingAt(state, cell) !== null) return 'the cell already holds a building';
    const drone = droneCell(state);
    if (drone.x === cell.x && drone.y === cell.y) return 'the drone is on that cell';
    return null;
}

export function whyNotBuild(state: GameState, kind: PlaceableKind, cell: Cell): string | null {
    const blocked = whyNotPlace(state, cell);
    if (blocked !== null) return blocked;
    if (state.ore < COSTS[kind]) return `it costs ${COSTS[kind]} ore and the storehouse holds ${state.ore}`;
    return null;
}

export function capacityOf(state: GameState): number {
    return BASE_CAPACITY + BATTERY_CAPACITY * state.buildings.filter((b) => b.kind === 'battery').length;
}

export function place(state: GameState, kind: PlaceableKind, cell: Cell): PlaceResult {
    const reason = whyNotBuild(state, kind, cell);
    if (reason !== null) return { ok: false, reason };
    const building = raise(state.nextId, kind, cell.x, cell.y);
    state.nextId += 1;
    state.ore -= COSTS[kind];
    state.buildings.push(building);
    return { ok: true, building };
}

export function demolish(state: GameState, cell: Cell): Building | null {
    const at = state.buildings.findIndex((b) => b.x === cell.x && b.y === cell.y);
    if (at < 0) return null;
    const kind = state.buildings[at]!.kind;
    if (kind === 'tower') return null;
    const gone = state.buildings.splice(at, 1)[0]!;
    state.ore += Math.floor(COSTS[kind] / 2);
    state.energy = Math.min(state.energy, capacityOf(state));
    if (state.drone.target === gone.id) state.drone.target = null;
    return gone;
}

export function sunlight(hour: number): number {
    const h = ((hour % DAY_HOURS) + DAY_HOURS) % DAY_HOURS;
    return h <= 6 || h >= 18 ? 0 : Math.sin(Math.PI * (h - 6) / 12);
}

export function isRunning(state: GameState, building: Building): boolean {
    return building.kind === 'mine' && building.on && !state.blackout;
}

export function powerReport(state: GameState, hour = state.hour): PowerReport {
    const generation = SOLAR_PEAK * state.buildings.filter((b) => b.kind === 'solar').length * sunlight(hour);
    const wanted = state.buildings.filter((b) => b.kind === 'mine' && b.on).length;
    const running = state.blackout ? 0 : wanted;
    const demand = running * MINE_DRAW;
    const capacity = capacityOf(state);
    const net = generation - demand;
    const status: PowerStatus = state.blackout ? 'blackout'
        : net > 0.01 && state.energy < capacity - 0.001 ? 'charging' : net < -0.01 ? 'draining' : 'steady';
    return { generation, demand, capacity, energy: state.energy, running, wanted, status };
}

export function stepPower(state: GameState, fromHour: number, hours: number): void {
    let at = fromHour;
    let left = hours;
    while (left > 1e-9) {
        const edge = (Math.floor(at / POWER_STEP + 1e-9) + 1) * POWER_STEP;
        const dt = Math.min(left, Math.max(edge - at, 1e-6));
        const capacity = capacityOf(state);
        const generation = SOLAR_PEAK * state.buildings.filter((b) => b.kind === 'solar').length * sunlight(at + dt / 2);
        const mines = state.buildings.filter((b) => b.kind === 'mine' && b.on);
        const wanted = mines.length * MINE_DRAW;
        if (state.blackout) {
            state.energy = Math.min(capacity, state.energy + generation * dt);
            if (wanted === 0 || state.energy >= Math.min(RECOVER_AT, capacity)) state.blackout = false;
        } else {
            state.energy += (generation - wanted) * dt;
            if (state.energy <= 0) {
                state.energy = 0;
                if (generation < wanted) state.blackout = true;
            }
            state.energy = Math.min(capacity, state.energy);
            if (!state.blackout) for (const mine of mines) mine.stock = Math.min(MINE_STOCK_CAP, mine.stock + MINE_RATE * dt);
        }
        at += dt;
        left -= dt;
    }
}

export function setMineOn(state: GameState, id: number, on: boolean): boolean {
    const mine = state.buildings.find((b) => b.id === id && b.kind === 'mine');
    if (mine === undefined) return false;
    mine.on = on;
    if (!on && state.drone.target === id && state.drone.leg === 'toMine') state.drone.target = null;
    return true;
}

export function targetOf(state: GameState): Building | null {
    const wanted: PlaceableKind = state.drone.leg === 'toMine' ? 'mine' : 'store';
    const current = state.buildings.find((b) => b.id === state.drone.target);
    if (current !== undefined && current.kind === wanted && (wanted === 'store' || current.on)) return current;
    let best: Building | null = null;
    for (const b of state.buildings) {
        if (b.kind !== wanted) continue;
        if (wanted === 'mine' && !b.on) continue;
        if (best === null || b.stock > best.stock + 1e-9 || (Math.abs(b.stock - best.stock) <= 1e-9 && b.id < best.id)) best = b;
    }
    state.drone.target = best === null ? null : best.id;
    return best;
}

const NEIGHBOURS: readonly Cell[] = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];

export function dockCells(state: GameState, building: Building): Cell[] {
    return NEIGHBOURS
        .map((n) => ({ x: building.x + n.x, y: building.y + n.y }))
        .filter((cell) => isWalkable(state, cell));
}

export function nearestDock(state: GameState, building: Building): Cell | null {
    let best: Cell | null = null;
    let bestDistance = Infinity;
    for (const cell of dockCells(state, building)) {
        const at = worldOfCell(cell);
        const distance = Math.hypot(at.x - state.drone.x, at.z - state.drone.z);
        if (distance < bestDistance) {
            best = cell;
            bestDistance = distance;
        }
    }
    return best;
}

export function isDocked(state: GameState, building: Building): boolean {
    const drone = droneCell(state);
    return Math.abs(drone.x - building.x) + Math.abs(drone.y - building.y) === 1;
}

export function settleArrival(state: GameState): boolean {
    const target = targetOf(state);
    if (target === null || !isDocked(state, target)) return false;
    if (state.drone.leg === 'toMine') {
        const load = Math.min(DRONE_CAPACITY, Math.floor(target.stock + 1e-9));
        if (load < 1 || (load < DRONE_CAPACITY && isRunning(state, target))) return false;
        target.stock -= load;
        state.drone.cargo = load;
        state.drone.leg = 'toStore';
    } else {
        state.ore += state.drone.cargo;
        state.drone.cargo = 0;
        state.trips += 1;
        state.drone.leg = 'toMine';
    }
    target.served += 1;
    state.drone.target = null;
    return true;
}

export function towerOf(state: GameState): Building | null {
    return state.buildings.find((b) => b.kind === 'tower') ?? null;
}

export function whyNotRepair(state: GameState): string | null {
    if (state.signal === 'online') return 'the signal is already transmitting';
    if (towerOf(state) === null) return 'there is no tower to repair';
    if (state.ore < REPAIR_COST) return `the repair takes ${REPAIR_COST} ore and the storehouse holds ${state.ore}`;
    return null;
}

export function repairTower(state: GameState): boolean {
    if (whyNotRepair(state) !== null) return false;
    state.ore -= REPAIR_COST;
    state.signal = 'online';
    return true;
}

export function advanceClock(state: GameState, hours: number): void {
    state.hour = ((state.hour + hours) % DAY_HOURS + DAY_HOURS) % DAY_HOURS;
}

export interface Snapshot {
    buildings: Building[];
    nextId: number;
    ore: number;
    trips: number;
    hour: number;
    drone: DroneState;
    signal: Signal;
    energy: number;
    blackout: boolean;
}

export function snapshot(state: GameState): Snapshot {
    return {
        buildings: state.buildings.map((b) => ({ id: b.id, kind: b.kind, x: b.x, y: b.y, served: b.served, on: b.on, stock: b.stock })),
        nextId: state.nextId,
        ore: state.ore,
        trips: state.trips,
        hour: state.hour,
        drone: { x: state.drone.x, z: state.drone.z, cargo: state.drone.cargo, leg: state.drone.leg, target: state.drone.target },
        signal: state.signal,
        energy: state.energy,
        blackout: state.blackout,
    };
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const count = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;
const KINDS: readonly string[] = ['mine', 'store', 'solar', 'battery', 'tower'];

export function restore(raw: unknown): GameState {
    const data = raw as Partial<Snapshot> | null;
    if (data === null || typeof data !== 'object') throw new Error('the save is not an object');
    if (!Array.isArray(data.buildings)) throw new Error('the save lists no buildings');
    const buildings: Building[] = [];
    const taken = new Set<number>();
    const ids = new Set<number>();
    for (const b of data.buildings) {
        if (b === null || typeof b !== 'object') throw new Error('a saved building is not an object');
        if (!KINDS.includes(b.kind)) throw new Error(`a saved building is of unknown kind "${String(b.kind)}"`);
        if (!count(b.id) || ids.has(b.id)) throw new Error('a saved building has no id of its own');
        if (!inBounds(b)) throw new Error(`saved building ${b.id} is outside the map`);
        const key = b.y * GRID_WIDTH + b.x;
        if (taken.has(key)) throw new Error(`saved building ${b.id} shares its cell with another`);
        taken.add(key);
        ids.add(b.id);
        if (!count(b.served)) throw new Error(`saved building ${b.id} has served a count that is not one`);
        if (typeof b.on !== 'boolean' || !finite(b.stock) || b.stock < 0 || b.stock > MINE_STOCK_CAP) {
            throw new Error(`saved building ${b.id} has no switch or a stock out of range`);
        }
        buildings.push({ id: b.id, kind: b.kind, x: b.x, y: b.y, served: b.served, on: b.on, stock: b.stock });
    }
    const drone = data.drone;
    if (drone === undefined || drone === null || !finite(drone.x) || !finite(drone.z) || !count(drone.cargo)
        || (drone.leg !== 'toMine' && drone.leg !== 'toStore') || (drone.target !== null && !count(drone.target))) {
        throw new Error('the saved drone is incomplete');
    }
    if (!count(data.ore) || !count(data.trips) || !finite(data.hour) || !count(data.nextId)) {
        throw new Error('the saved totals are incomplete');
    }
    if (buildings.some((b) => b.id >= data.nextId!)) throw new Error('the next building id is already taken');
    if (buildings.filter((b) => b.kind === 'tower').length !== 1) throw new Error('the save does not hold exactly one tower');
    if (data.signal !== 'offline' && data.signal !== 'online') throw new Error('the saved signal is neither offline nor online');
    if (typeof data.blackout !== 'boolean' || !finite(data.energy) || data.energy < 0) throw new Error('the saved power is incomplete');
    const state: GameState = {
        buildings,
        nextId: data.nextId,
        ore: data.ore,
        trips: data.trips,
        hour: ((data.hour % DAY_HOURS) + DAY_HOURS) % DAY_HOURS,
        drone: { x: drone.x, z: drone.z, cargo: drone.cargo, leg: drone.leg, target: drone.target !== null && ids.has(drone.target) ? drone.target : null },
        signal: data.signal,
        energy: data.energy,
        blackout: data.blackout,
    };
    state.energy = Math.min(state.energy, capacityOf(state));
    if (!isWalkable(state, droneCell(state))) throw new Error('the saved drone stands inside a building or off the map');
    return state;
}

type Loose = Record<string, unknown> & { buildings?: Record<string, unknown>[]; nextId?: number; drone?: { x: number; z: number } & Record<string, unknown> };

export function migrateFromV1(raw: unknown): unknown {
    const data = raw as Loose | null;
    if (data === null || typeof data !== 'object' || !Array.isArray(data.buildings) || !count(data.nextId)) return raw;
    const drone = data.drone ? cellOfWorld(data.drone.x, data.drone.z) : null;
    const taken = (cell: Cell): boolean => data.buildings!.some((b) => b.x === cell.x && b.y === cell.y) || (drone !== null && drone.x === cell.x && drone.y === cell.y);
    let site: Cell | null = null;
    for (let ring = 0; ring < GRID_WIDTH && site === null; ring++) {
        for (let dy = -ring; dy <= ring && site === null; dy++) {
            for (let dx = -ring; dx <= ring && site === null; dx++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
                const cell = { x: TOWER_CELL.x + dx, y: TOWER_CELL.y + dy };
                if (inBounds(cell) && !taken(cell)) site = cell;
            }
        }
    }
    if (site === null) return raw;
    return {
        ...data,
        buildings: [...data.buildings.map((b) => ({ ...b, served: b.served ?? 0 })), { id: data.nextId, kind: 'tower', x: site.x, y: site.y, served: 0 }],
        nextId: data.nextId + 1,
        signal: 'offline',
    };
}

export function migrateFromV2(raw: unknown): unknown {
    const data = raw as Loose | null;
    if (data === null || typeof data !== 'object' || !Array.isArray(data.buildings)) return raw;
    return {
        ...data,
        buildings: data.buildings.map((b) => ({ ...b, on: true, stock: b.kind === 'mine' ? DRONE_CAPACITY : 0 })),
        drone: data.drone ? { ...data.drone, target: null } : data.drone,
        energy: BASE_CAPACITY,
        blackout: false,
    };
}
