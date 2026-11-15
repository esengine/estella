export const GRID_WIDTH = 64;
export const GRID_HEIGHT = 64;
export const CELL_SIZE = 2;
export const SAVE_VERSION = 1;
export const DRONE_CAPACITY = 5;
export const DAY_HOURS = 24;

export type BuildingKind = 'mine' | 'store';
export type Leg = 'toMine' | 'toStore';

export interface Cell { x: number; y: number }
export interface Building extends Cell { id: number; kind: BuildingKind }
export interface DroneState { x: number; z: number; cargo: number; leg: Leg }

export interface GameState {
    buildings: Building[];
    nextId: number;
    ore: number;
    trips: number;
    hour: number;
    drone: DroneState;
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

export function createState(): GameState {
    const start = worldOfCell({ x: 21, y: 32 });
    return {
        buildings: [
            { id: 1, kind: 'mine', x: 20, y: 32 },
            { id: 2, kind: 'store', x: 44, y: 32 },
        ],
        nextId: 3,
        ore: 0,
        trips: 0,
        hour: 8,
        drone: { x: start.x, z: start.z, cargo: 0, leg: 'toMine' },
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

export function place(state: GameState, kind: BuildingKind, cell: Cell): PlaceResult {
    const reason = whyNotPlace(state, cell);
    if (reason !== null) return { ok: false, reason };
    const building: Building = { id: state.nextId, kind, x: cell.x, y: cell.y };
    state.nextId += 1;
    state.buildings.push(building);
    return { ok: true, building };
}

export function demolish(state: GameState, cell: Cell): Building | null {
    const at = state.buildings.findIndex((b) => b.x === cell.x && b.y === cell.y);
    if (at < 0) return null;
    return state.buildings.splice(at, 1)[0]!;
}

export function targetOf(state: GameState): Building | null {
    const wanted: BuildingKind = state.drone.leg === 'toMine' ? 'mine' : 'store';
    let best: Building | null = null;
    for (const b of state.buildings) {
        if (b.kind === wanted && (best === null || b.id < best.id)) best = b;
    }
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
        state.drone.cargo = DRONE_CAPACITY;
        state.drone.leg = 'toStore';
    } else {
        state.ore += state.drone.cargo;
        state.drone.cargo = 0;
        state.trips += 1;
        state.drone.leg = 'toMine';
    }
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
}

export function snapshot(state: GameState): Snapshot {
    return {
        buildings: state.buildings.map((b) => ({ id: b.id, kind: b.kind, x: b.x, y: b.y })),
        nextId: state.nextId,
        ore: state.ore,
        trips: state.trips,
        hour: state.hour,
        drone: { x: state.drone.x, z: state.drone.z, cargo: state.drone.cargo, leg: state.drone.leg },
    };
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const count = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;

export function restore(raw: unknown): GameState {
    const data = raw as Partial<Snapshot> | null;
    if (data === null || typeof data !== 'object') throw new Error('the save is not an object');
    if (!Array.isArray(data.buildings)) throw new Error('the save lists no buildings');
    const buildings: Building[] = [];
    const taken = new Set<number>();
    const ids = new Set<number>();
    for (const b of data.buildings) {
        if (b === null || typeof b !== 'object') throw new Error('a saved building is not an object');
        if (b.kind !== 'mine' && b.kind !== 'store') throw new Error(`a saved building is of unknown kind "${String(b.kind)}"`);
        if (!count(b.id) || ids.has(b.id)) throw new Error('a saved building has no id of its own');
        if (!inBounds(b)) throw new Error(`saved building ${b.id} is outside the map`);
        const key = b.y * GRID_WIDTH + b.x;
        if (taken.has(key)) throw new Error(`saved building ${b.id} shares its cell with another`);
        taken.add(key);
        ids.add(b.id);
        buildings.push({ id: b.id, kind: b.kind, x: b.x, y: b.y });
    }
    const drone = data.drone;
    if (drone === undefined || drone === null || !finite(drone.x) || !finite(drone.z) || !count(drone.cargo)
        || (drone.leg !== 'toMine' && drone.leg !== 'toStore')) {
        throw new Error('the saved drone is incomplete');
    }
    if (!count(data.ore) || !count(data.trips) || !finite(data.hour) || !count(data.nextId)) {
        throw new Error('the saved totals are incomplete');
    }
    if (buildings.some((b) => b.id >= data.nextId!)) throw new Error('the next building id is already taken');
    const state: GameState = {
        buildings,
        nextId: data.nextId,
        ore: data.ore,
        trips: data.trips,
        hour: ((data.hour % DAY_HOURS) + DAY_HOURS) % DAY_HOURS,
        drone: { x: drone.x, z: drone.z, cargo: drone.cargo, leg: drone.leg },
    };
    if (!isWalkable(state, droneCell(state))) throw new Error('the saved drone stands inside a building or off the map');
    return state;
}
