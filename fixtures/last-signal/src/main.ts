import {
    addPlugin, defineSystem, Schedule, Res, GetWorld, Input, CameraView, Playthrough, SaveManager, Storage, UIEvents, Time,
    Transform, MeshRenderer, TimeOfDay, PostProcessVolume, Light, Text, Name, UINode, UIVisual, Assets, SafeArea,
    spawnUIEntity, createButton, UIPositionType, UIDisplay, px, percent, rayPlaneHit,
    type World, type Entity, type UIEventQueue, type TextAlign, type TextVerticalAlign,
} from 'esengine';
import { Nav, NavAgent, NavGrid, setNavDestination, stopNavAgent, type Navigation } from 'esengine/ai';
import {
    GRID_WIDTH, GRID_HEIGHT, CELL_SIZE, SAVE_VERSION, DAY_HOURS,
    REPAIR_COST, COSTS, createState, restore, snapshot, place, demolish, isWalkable, inBounds, buildingAt, droneCell, whyNotBuild,
    targetOf, nearestDock, settleArrival, worldOfCell, cellOfWorld, whyNotRepair, repairTower, migrateFromV1, migrateFromV2,
    stepPower, powerReport, setMineOn, isRunning,
    type GameState, type Building, type BuildingKind, type PlaceableKind, type Cell, type Snapshot,
} from './state';
import { Journal } from './journal';
import { Gestures, type Point } from './touch';
import { PALETTE, mineParts, storeParts, droneParts, ringParts, towerParts, solarParts, batteryParts, type Part, type Role, type Colour, type Shape } from './models';

interface Anchor { left?: number; right?: number; top?: number; bottom?: number; center?: number; middle?: number }

const UNITS = 100;
const SLOT = 'gate0';
const JOURNAL_KEY = 'last-signal:journals';
const JOURNAL_KEEP = 6;
const ACTIVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyZ', 'KeyX', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
const CHEAPEST = Math.min(...Object.values(COSTS));
const MAP = { size: 128, cell: 2 };
const DAY_SECONDS = 240;
const SPEEDS = [1, 2, 4];
const DRONE_LIFT = 2.4;
const HIDDEN = -400;
const EDGE = 16;
const UI = {
    panel: { r: 0.06, g: 0.09, b: 0.13, a: 0.78 },
    card: { r: 0.1, g: 0.15, b: 0.21, a: 0.92 },
    line: { r: 0.24, g: 0.31, b: 0.38, a: 1 },
    text: { r: 0.94, g: 0.96, b: 0.98, a: 1 },
    dim: { r: 0.55, g: 0.6, b: 0.66, a: 1 },
    accent: { r: 0.45, g: 0.9, b: 1, a: 1 },
    go: { r: 0.1, g: 0.5, b: 0.36, a: 0.96 },
    warn: { r: 0.55, g: 0.14, b: 0.12, a: 0.96 },
};
const KINDS: readonly PlaceableKind[] = ['mine', 'store', 'solar', 'battery'];
const reasonText = (reason: string): string => {
    const cost = /^it costs (\d+) ore and the storehouse holds (\d+)$/.exec(reason);
    if (cost) return `需要 ${cost[1]} 矿石，仓库只有 ${cost[2]}`;
    const fix = /^the repair takes (\d+) ore and the storehouse holds (\d+)$/.exec(reason);
    if (fix) return `修复需要 ${fix[1]} 矿石，仓库只有 ${fix[2]}`;
    return ({
        'outside the map': '超出了地图',
        'the cell already holds a building': '这一格已经有建筑',
        'the drone is on that cell': '无人机正停在这一格',
        'the signal is already transmitting': '信号已经在发射',
        'there is no tower to repair': '没有可修复的通信塔',
    } as Record<string, string>)[reason] ?? reason;
};
const NAMES: Record<BuildingKind, string> = { mine: '采矿站', store: '仓库', solar: '太阳能站', battery: '电池', tower: '通信塔' };
const partsOf = (kind: BuildingKind): Part[] => kind === 'mine' ? mineParts() : kind === 'store' ? storeParts() : kind === 'solar' ? solarParts() : kind === 'battery' ? batteryParts() : towerParts();

const saves = new SaveManager({ version: SAVE_VERSION, migrations: { 1: migrateFromV1, 2: migrateFromV2 }, keyPrefix: 'last-signal:' });
const mixed = (a: Colour, b: Colour, k: number): Colour => ({ r: a.r + (b.r - a.r) * k, g: a.g + (b.g - a.g) * k, b: a.b + (b.b - a.b) * k, a: a.a + (b.a - a.a) * k });
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const shade = (c: Colour, k: number, a = c.a): Colour => ({ r: c.r * k, g: c.g * k, b: c.b * k, a });
const boxAt = (a: Anchor, width: number, height: number) => ({
    position: UIPositionType.Absolute, width: px(width), height: px(height),
    ...(a.left !== undefined ? { insetLeft: px(a.left) } : {}),
    ...(a.right !== undefined ? { insetRight: px(a.right) } : {}),
    ...(a.top !== undefined ? { insetTop: px(a.top) } : {}),
    ...(a.bottom !== undefined ? { insetBottom: px(a.bottom) } : {}),
    ...(a.center !== undefined ? { insetLeft: percent(50), marginLeft: px(a.center - width / 2) } : {}),
    ...(a.middle !== undefined ? { insetTop: percent(50), marginTop: px(a.middle - height / 2) } : {}),
});

const livePieces = new Set<Entity>();
const SHAPES: readonly Shape[] = ['cube', 'cylinder', 'sphere', 'cone'];
const meshes = new Map<Shape, number>();

class Model {
    readonly root: Entity;
    private readonly pieces: { entity: Entity; part: Part }[];
    private x = 0;
    private z = 0;
    private lift = 0;
    private yaw = 0;
    private readonly shifts = new Map<Role, { rise: number; stretch: number }>();

    constructor(world: World, name: string, parts: readonly Part[], tint: Colour | null = null) {
        this.root = world.spawn(name);
        world.insert(this.root, Transform, {});
        this.pieces = parts.map((part) => {
            const colour = tint ?? part.colour;
            const entity = world.spawn();
            world.insert(entity, Transform, {});
            world.insert(entity, MeshRenderer, {
                mesh: meshes.get(part.shape)!, lit: tint === null && part.lit, opaque: colour.a >= 1,
                cullBackfaces: true, castShadows: tint === null && part.lit, enabled: true, color: colour,
            });
            livePieces.add(entity);
            return { entity, part };
        });
    }

    pose(world: World, x: number, z: number, lift: number, yaw = 0): void {
        this.x = x; this.z = z; this.lift = lift; this.yaw = yaw;
        const root = world.get(this.root, Transform);
        root.position = { x: x * UNITS, y: lift * UNITS, z: z * UNITS };
        world.insert(this.root, Transform, root);
        for (const piece of this.pieces) this.put(world, piece, 0);
    }

    adjust(role: Role, rise: number, stretch: number): void {
        this.shifts.set(role, { rise, stretch });
    }

    turn(world: World, role: Role, angle: number): void {
        for (const piece of this.pieces) if (piece.part.role === role) this.put(world, piece, angle);
    }

    colour(world: World, role: Role | null, colour: Colour): void {
        for (const piece of this.pieces) {
            if (role !== null && piece.part.role !== role) continue;
            const mesh = world.get(piece.entity, MeshRenderer);
            world.insert(piece.entity, MeshRenderer, { ...mesh, color: colour });
        }
    }

    show(world: World, role: Role, visible: boolean): void {
        for (const piece of this.pieces) {
            if (piece.part.role !== role) continue;
            const mesh = world.get(piece.entity, MeshRenderer);
            if (mesh.enabled !== visible) world.insert(piece.entity, MeshRenderer, { ...mesh, enabled: visible });
        }
    }

    despawn(world: World): void {
        for (const piece of this.pieces) { livePieces.delete(piece.entity); world.despawn(piece.entity); }
        world.despawn(this.root);
    }

    private put(world: World, piece: { entity: Entity; part: Part }, extra: number): void {
        const [ax, ay, az] = piece.part.at;
        const cos = Math.cos(this.yaw), sin = Math.sin(this.yaw);
        const half = (this.yaw + extra) / 2;
        const shift = this.shifts.get(piece.part.role);
        const rise = shift ? shift.rise : 0, stretch = shift ? shift.stretch : 1;
        const transform = world.get(piece.entity, Transform);
        transform.position = {
            x: (this.x + ax * cos + az * sin) * UNITS, y: (this.lift + ay + rise) * UNITS, z: (this.z - ax * sin + az * cos) * UNITS,
        };
        transform.rotation = { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) };
        transform.scale = { x: piece.part.size[0], y: piece.part.size[1] * stretch, z: piece.part.size[2] };
        world.insert(piece.entity, Transform, transform);
    }
}

interface Site { building: Building; model: Model; mark: Entity; look: string }
interface Tile { entity: Entity; text: Entity }

addPlugin({ name: 'last-signal', build(app) {
    const facts: Record<string, string | number | boolean> = {
        ready: false, restored: false, buildings: 0, blockedCells: 0, ore: 0, trips: 0, cargo: 0, leg: 'toMine',
        droneX: 0, droneY: 0, hour: 0, hoursElapsed: 0, speed: 1, held: false, plans: 0, route: 'none', everInsideBuilding: false,
        cursorX: -1, cursorY: -1, tool: 'none', saves: 0, loads: 0, notice: '', layout: '',
        autoExposure: true, lowView: false, selected: 0, ghostLegal: true, active: 0,
        signal: 'offline', canRepair: false, victory: false, repairs: 0, uplink: 0,
        energy: 0, capacity: 0, generation: 0, demand: 0, blackout: false, power: 'steady', mines: 0, minesRunning: 0, blackouts: 0,
        touches: 0, taps: 0, drags: 0, pinches: 0,
    };
    app.insertResource(Playthrough, { facts });
    const bootAt = performance.now();

    let state: GameState = createState();
    let journal = new Journal(Date.now().toString(36));
    let journalWritten = 0;
    let journalAge = 0;
    const keepJournal = (force = false): void => {
        if (!force && journal.entries.length === journalWritten) return;
        journalAge = 0;
        journalWritten = journal.entries.length;
        const kept = (Storage.getJSON<{ session: string }[]>(JOURNAL_KEY, []) ?? []).filter((j) => j.session !== journal.session);
        Storage.setJSON(JOURNAL_KEY, [...kept, journal.export()].slice(-JOURNAL_KEEP));
    };
    const exportJournals = (): void => {
        keepJournal(true);
        const text = JSON.stringify(Storage.getJSON(JOURNAL_KEY, []), null, 1);
        console.log(`[last-signal] play journals\n${text}`);
        const page = (globalThis as { document?: { createElement(tag: string): { href: string; download: string; click(): void } } }).document;
        const blobs = globalThis as { Blob?: new (parts: string[], init: { type: string }) => object; URL?: { createObjectURL(blob: object): string } };
        if (page && blobs.Blob && blobs.URL) {
            const link = page.createElement('a');
            link.href = blobs.URL.createObjectURL(new blobs.Blob([text], { type: 'application/json' }));
            link.download = `last-signal-journal-${journal.session}.json`;
            link.click();
        }
    };

    let grid: NavGrid | null = null;
    let body: Entity | null = null;
    let drone: Model | null = null;
    let ghost: Model | null = null;
    let ghostKind: PlaceableKind | null = null;
    let ghostLegal = true;
    let cursorRing: Model | null = null;
    let cursorRed = false;
    let selectRing: Model | null = null;
    let canvas: Entity | null = null;
    let hud: Entity | null = null;
    let clock: Entity | null = null;
    let camera: Entity | null = null;
    const sites = new Map<number, Site>();
    const gestures = new Gestures();
    const rig = { x: -7, z: -4, distance: 26, pitch: 0.9 };
    let rigKey = '';
    let lowView = false;
    let touchSeen = false;
    let tool: PlaceableKind | null = null;
    let pending: Cell | null = null;
    let selected = 0;
    let dock: Cell | null = null;
    let dockFor = -1;
    let lastMouse = { x: -1, y: -1 };
    let lastHour = state.hour;
    let lastDrone = { x: state.drone.x, z: state.drone.z };
    let heading = 0;
    let elapsed = 0;
    let speedIndex = 0;
    let uplink = -1;
    let acknowledged = false;
    let towerLook = '';
    let wasBlackout = false;
    let toast = '点下面的建筑，再点地面放置。拖动可移动视角。';
    let toastLeft = 8;
    let started = false;

    let oreText: Entity | null = null;
    let powerText: Entity | null = null;
    let powerFill: Entity | null = null;
    let clockText: Entity | null = null;
    let goal: Tile | null = null;
    let goalFill: Entity | null = null;
    let speedTile: Tile | null = null;
    let mapPanel: Entity | null = null;
    let droneMark: Entity | null = null;
    let ghostMark: Entity | null = null;
    let selectMark: Entity | null = null;
    let toastPanel: Entity | null = null;
    let toastText: Entity | null = null;
    const cards = new Map<PlaceableKind, { tile: Tile; pick: Entity; dim: boolean }>();
    let confirmTile: Tile | null = null;
    let cancelTile: Tile | null = null;
    let detail: Entity | null = null;
    let detailTitle: Entity | null = null;
    let detailText: Entity | null = null;
    let removeTile: Tile | null = null;
    let switchTile: Tile | null = null;
    let fixTile: Tile | null = null;
    let victory: Entity[] = [];
    let victoryText: Entity | null = null;
    let victoryShown = false;

    const say = (text: string): void => { toast = text; toastLeft = 3.5; };
    const kindName = (kind: BuildingKind): string => NAMES[kind];
    const groundPoint = (x: number, z: number): { x: number; y: number; z: number } => ({ x: x * UNITS, y: 0, z: z * UNITS });
    const glowColour = (kind: BuildingKind): Colour => kind === 'mine' ? PALETTE.mineGlow : kind === 'store' ? PALETTE.storeGlow : kind === 'solar' ? PALETTE.solarGlow
        : kind === 'battery' ? PALETTE.batteryGlow : state.signal === 'online' ? PALETTE.online : PALETTE.offline;

    const rect = (world: World, name: string, parent: Entity, anchor: Anchor, width: number, height: number, colour: Colour): Entity => {
        const entity = spawnUIEntity({ world, parent, node: { ...boxAt(anchor, width, height), pointerEvents: 1 }, visual: { color: colour } });
        world.insert(entity, Name, { value: name });
        return entity;
    };

    const label = (world: World, name: string, parent: Entity, anchor: Anchor, width: number, height: number, size: number, colour: Colour, align = 0): Entity => {
        const entity = spawnUIEntity({
            world, parent, node: { ...boxAt(anchor, width, height), pointerEvents: 1 },
            text: { content: '', fontSize: size, color: colour, align: align as unknown as TextAlign, verticalAlign: 1 as unknown as TextVerticalAlign },
        });
        world.insert(entity, Name, { value: name });
        return entity;
    };

    const tile = (world: World, events: UIEventQueue, name: string, parent: Entity, anchor: Anchor, width: number, height: number, colour: Colour, size: number, onClick: () => void): Tile => {
        const button = createButton({ world, events, parent, node: boxAt(anchor, width, height), background: { color: colour }, onClick });
        world.insert(button.entity, Name, { value: name });
        return { entity: button.entity, text: label(world, `${name}Text`, button.entity, { left: 0, top: 0 }, width, height, size, UI.text, 1) };
    };

    const write = (world: World, entity: Entity, content: string): void => {
        const text = world.get(entity, Text);
        if (text.content !== content) world.insert(entity, Text, { ...text, content });
    };

    const ink = (world: World, entity: Entity, colour: Colour): void => {
        const text = world.get(entity, Text);
        if (text.color.r !== colour.r || text.color.g !== colour.g || text.color.b !== colour.b) world.insert(entity, Text, { ...text, color: colour });
    };

    const paint = (world: World, entity: Entity, colour: Colour): void => {
        const visual = world.get(entity, UIVisual);
        if (visual.color.r === colour.r && visual.color.g === colour.g && visual.color.b === colour.b && visual.color.a === colour.a) return;
        world.insert(entity, UIVisual, { ...visual, color: colour });
    };

    const show = (world: World, entity: Entity, visible: boolean): void => {
        const node = world.get(entity, UINode);
        const display = visible ? UIDisplay.Flex : UIDisplay.None;
        if (node.display !== display) world.insert(entity, UINode, { ...node, display });
    };

    const moveTo = (world: World, entity: Entity, left: number, top: number): void => {
        const node = world.get(entity, UINode);
        if (node.insetLeft.value === left && node.insetTop.value === top) return;
        node.insetLeft = px(left);
        node.insetTop = px(top);
        world.insert(entity, UINode, node);
    };

    const sizeTo = (world: World, entity: Entity, width: number): void => {
        const node = world.get(entity, UINode);
        if (node.width.value === width) return;
        node.width = px(width);
        world.insert(entity, UINode, node);
    };

    const markAt = (world: World, entity: Entity, cell: Cell, size: number): void => {
        moveTo(world, entity, cell.x * MAP.cell + (MAP.cell - size) / 2, cell.y * MAP.cell + (MAP.cell - size) / 2);
    };

    const showSite = (world: World, building: Building): void => {
        const at = worldOfCell(building);
        const model = new Model(world, `Building ${building.id}`, partsOf(building.kind));
        model.pose(world, at.x, at.z, 0);
        if (building.kind === 'tower') { model.show(world, 'beam', false); towerLook = ''; }
        const mark = rect(world, `MapBuilding ${building.id}`, mapPanel!, { left: 0, top: 0 }, 4, 4, shade(glowColour(building.kind), 0.6));
        markAt(world, mark, building, 4);
        sites.set(building.id, { building, model, mark, look: '' });
    };

    const hideSite = (world: World, id: number): void => {
        const site = sites.get(id);
        if (site === undefined) return;
        site.model.despawn(world);
        world.despawn(site.mark);
        sites.delete(id);
        if (selected === id) selected = 0;
    };

    const countBlocked = (): number => {
        let blocked = 0;
        for (let y = 0; y < GRID_HEIGHT; y++) for (let x = 0; x < GRID_WIDTH; x++) if (!grid!.isWalkable(x, y)) blocked += 1;
        return blocked;
    };

    const adopt = (world: World, next: GameState): void => {
        for (const id of [...sites.keys()]) hideSite(world, id);
        for (let y = 0; y < GRID_HEIGHT; y++) for (let x = 0; x < GRID_WIDTH; x++) grid!.setWalkable(x, y, true);
        state = next;
        selected = 0;
        pending = null;
        for (const building of state.buildings) {
            grid!.setWalkable(building.x, building.y, false);
            showSite(world, building);
        }
        const transform = world.get(body!, Transform);
        transform.position = groundPoint(state.drone.x, state.drone.z);
        world.insert(body!, Transform, transform);
        stopNavAgent(world, body!);
        dock = null;
        dockFor = -1;
        lastDrone = { x: state.drone.x, z: state.drone.z };
        if (clock !== null) world.insert(clock, TimeOfDay, { ...world.get(clock, TimeOfDay), hour: state.hour });
        lastHour = state.hour;
        uplink = state.signal === 'online' ? 999 : -1;
        acknowledged = state.signal === 'online';
        wasBlackout = state.blackout;
        facts.blockedCells = countBlocked();
    };

    const save = (quiet = true): void => {
        saves.save<Snapshot>(SLOT, snapshot(state));
        facts.saves = (facts.saves as number) + 1;
        if (!quiet) say('已存档。');
    };

    const load = (world: World): boolean => {
        if (!saves.has(SLOT)) return false;
        try {
            adopt(world, restore(saves.load<Snapshot>(SLOT)));
        } catch (error) {
            console.error('[last-signal] the save could not be restored:', error);
            say('存档无法恢复，已开始新的一局。');
            return false;
        }
        facts.loads = (facts.loads as number) + 1;
        return true;
    };

    const fresh = (world: World): void => {
        saves.remove(SLOT);
        keepJournal(true);
        journal = new Journal(Date.now().toString(36));
        journalWritten = 0;
        adopt(world, createState());
        tool = null;
        say('新的一局。通信塔沉默着，等你把它修好。');
    };

    const build = (world: World): void => {
        if (tool === null || pending === null) return;
        const kind = tool, cell = pending;
        const result = place(state, kind, cell);
        if (!result.ok) {
            journal.note('build', { kind, ok: false, reason: result.reason, ore: state.ore });
            say(`这里不能建：${reasonText(result.reason)}。`);
            return;
        }
        grid!.setWalkable(cell.x, cell.y, false);
        showSite(world, result.building);
        facts.blockedCells = countBlocked();
        journal.act('build', { kind, cost: COSTS[kind], oreLeft: state.ore, x: cell.x, y: cell.y });
        pending = null;
        save();
        say(`${kindName(kind)}已建成，花费 ${COSTS[kind]} 矿石。`);
    };

    const removeSelected = (world: World): void => {
        const site = sites.get(selected);
        if (site === undefined) return;
        if (site.building.kind === 'tower') { say('通信塔不能拆除。'); return; }
        const cell = { x: site.building.x, y: site.building.y };
        const gone = demolish(state, cell);
        if (gone === null) return;
        grid!.setWalkable(cell.x, cell.y, true);
        hideSite(world, gone.id);
        facts.blockedCells = countBlocked();
        journal.act('remove', { kind: gone.kind, refund: Math.floor(COSTS[gone.kind as PlaceableKind] / 2), oreLeft: state.ore });
        save();
        say(`${kindName(gone.kind)}已拆除，退回 ${Math.floor(COSTS[gone.kind as PlaceableKind] / 2)} 矿石。`);
    };

    const toggle = (): void => {
        const mine = state.buildings.find((b) => b.id === selected && b.kind === 'mine');
        if (mine === undefined) return;
        setMineOn(state, mine.id, !mine.on);
        journal.act('mine_toggle', { id: mine.id, on: mine.on, blackout: state.blackout });
        save();
        say(mine.on ? '采矿站已开启，重新开始耗电。' : '采矿站已关闭，不耗电也不产矿。');
    };

    const repair = (): void => {
        const reason = whyNotRepair(state);
        if (reason !== null) { journal.act('repair', { ok: false, ore: state.ore }); say(`还不能修复通信塔：${reasonText(reason)}。`); return; }
        repairTower(state);
        journal.act('repair', { ok: true, ore: state.ore });
        uplink = 0;
        acknowledged = false;
        facts.repairs = (facts.repairs as number) + 1;
        save();
        say(`通信塔已修复，花费 ${REPAIR_COST} 矿石。发射器正在启动。`);
    };

    const choose = (next: PlaceableKind | null): void => {
        tool = tool === next ? null : next;
        pending = null;
        if (tool !== null) selected = 0;
        journal.look();
        if (tool !== null) say(`点地面选位置，再点“建造”。需要 ${COSTS[tool]} 矿石。`);
    };

    const tapCell = (world: World, cell: Cell): void => {
        facts.taps = (facts.taps as number) + 1;
        if (tool !== null) {
            if (pending !== null && pending.x === cell.x && pending.y === cell.y) build(world);
            else pending = cell;
            return;
        }
        const at = buildingAt(state, cell);
        selected = at === null ? 0 : at.id;
        journal.look();
    };

    const cycleSpeed = (): void => {
        speedIndex = (speedIndex + 1) % SPEEDS.length;
        app.getResource(Time).scale = SPEEDS[speedIndex]!;
        facts.speed = SPEEDS[speedIndex]!;
    };

    app.addSystemToSchedule(Schedule.Startup, defineSystem([Res(Assets)], (assets) => {
        void Promise.all(SHAPES.map((shape) => assets.acquireTyped<{ handle: number }>('mesh', `builtin:${shape}`).then((lease) => { meshes.set(shape, lease.value.handle); })))
            .catch((error: unknown) => { console.error('[last-signal] a built-in mesh could not be loaded:', error); });
    }, { name: 'LastSignalMeshes' }));

    const setup = (nav: Navigation, events: UIEventQueue, world: World): void => {
        const origin = worldOfCell({ x: 0, y: 0 });
        grid = new NavGrid({ width: GRID_WIDTH, height: GRID_HEIGHT, cellSize: CELL_SIZE * UNITS, origin: { x: origin.x * UNITS, y: 0, z: origin.z * UNITS }, plane: 'xz' });
        nav.setSurface(grid);
        canvas = world.findEntityByName('Canvas');
        clock = world.findEntityByName('Clock');
        camera = world.findEntityByName('Camera');
        if (canvas === null || clock === null) throw new Error('the scene is missing its Canvas or its Clock');

        const span = GRID_WIDTH * CELL_SIZE;
        const lines: Part[] = [];
        for (let i = 0; i <= GRID_WIDTH; i += 1) {
            const offset = (i - GRID_WIDTH / 2) * CELL_SIZE;
            const strong = i % 8 === 0;
            const colour = strong ? { r: 0.56, g: 0.52, b: 0.46, a: 1 } : { r: 0.47, g: 0.43, b: 0.38, a: 1 };
            const width = strong ? 0.08 : 0.04;
            lines.push({ shape: 'cube', at: [offset, 0.005, 0], size: [width, 0.01, span], colour, lit: true, role: 'body' });
            lines.push({ shape: 'cube', at: [0, 0.005, offset], size: [span, 0.01, width], colour, lit: true, role: 'body' });
        }
        new Model(world, 'GroundGrid', lines).pose(world, 0, 0, 0);

        body = world.spawn('DroneBody');
        world.insert(body, Transform, { position: groundPoint(state.drone.x, state.drone.z) });
        world.insert(body, NavAgent, NavAgent.create({ speed: 6 * UNITS, radius: 0.3 * UNITS, arriveRadius: 0.1 * UNITS, repathInterval: 0.5 }));
        drone = new Model(world, 'Drone', droneParts());
        cursorRing = new Model(world, 'Cursor', ringParts(PALETTE.cursor, 0.96, 0.04));
        selectRing = new Model(world, 'Selection', ringParts(PALETTE.select, 1.08, 0.1));
        cursorRing.pose(world, 0, 0, HIDDEN);
        selectRing.pose(world, 0, 0, HIDDEN);

        hud = spawnUIEntity({ world, parent: canvas, node: { fill: true } });
        world.insert(hud, Name, { value: 'Hud' });
        world.insert(hud, SafeArea, { applyTop: true, applyBottom: true, applyLeft: true, applyRight: true, avoidHostMenu: false });

        const oreChip = rect(world, 'OreChip', hud, { left: EDGE, top: EDGE }, 170, 64, UI.panel);
        rect(world, 'OreSwatch', oreChip, { left: 14, top: 20 }, 24, 24, PALETTE.ore);
        oreText = label(world, 'OreText', oreChip, { left: 50, top: 0 }, 116, 64, 32, UI.text);
        const clockChip = rect(world, 'ClockChip', hud, { left: EDGE + 178, top: EDGE }, 122, 64, UI.panel);
        clockText = label(world, 'ClockText', clockChip, { left: 0, top: 0 }, 122, 64, 28, UI.text, 1);
        const powerChip = rect(world, 'PowerChip', hud, { left: EDGE, top: EDGE + 72 }, 300, 64, UI.panel);
        powerText = label(world, 'PowerText', powerChip, { left: 14, top: 2 }, 280, 42, 24, UI.text);
        rect(world, 'PowerBar', powerChip, { left: 14, top: 48 }, 272, 8, UI.line);
        powerFill = rect(world, 'PowerFill', powerChip, { left: 14, top: 48 }, 1, 8, PALETTE.batteryGlow);

        goal = tile(world, events, 'Goal', hud, { center: 0, top: EDGE }, 500, 84, UI.card, 28, repair);
        rect(world, 'GoalBar', goal.entity, { left: 20, top: 68 }, 460, 8, UI.line);
        goalFill = rect(world, 'GoalFill', goal.entity, { left: 20, top: 68 }, 1, 8, PALETTE.offline);

        speedTile = tile(world, events, 'Speed', hud, { right: EDGE, top: EDGE }, 150, 64, UI.card, 26, cycleSpeed);
        mapPanel = rect(world, 'MapPanel', hud, { right: EDGE, top: EDGE + 72 }, MAP.size, MAP.size, UI.panel);
        ghostMark = rect(world, 'MapGhost', mapPanel, { left: 0, top: 0 }, 4, 4, PALETTE.ok);
        selectMark = rect(world, 'MapSelect', mapPanel, { left: 0, top: 0 }, 8, 8, UI.accent);
        droneMark = rect(world, 'MapDrone', mapPanel, { left: 0, top: 0 }, 5, 5, PALETTE.drone);

        toastPanel = rect(world, 'Toast', hud, { center: 0, top: EDGE + 96 }, 640, 52, UI.panel);
        toastText = label(world, 'ToastText', toastPanel, { left: 0, top: 0 }, 640, 52, 22, UI.text, 1);

        const cardWidth = 170, cardHeight = 110, cardGap = 8;
        const barWidth = KINDS.length * cardWidth + (KINDS.length - 1) * cardGap;
        KINDS.forEach((kind, i) => {
            const offset = -barWidth / 2 + cardWidth / 2 + i * (cardWidth + cardGap);
            const card = tile(world, events, `Card${kind}`, hud!, { center: offset, bottom: EDGE }, cardWidth, cardHeight, UI.card, 26, () => choose(kind));
            rect(world, `CardSwatch${kind}`, card.entity, { left: 0, top: 0 }, cardWidth, 8, glowColour(kind));
            const pick = rect(world, `CardPick${kind}`, card.entity, { left: 0, top: cardHeight - 8 }, cardWidth, 8, UI.accent);
            write(world, card.text, `${kindName(kind)}\n${COSTS[kind]} 矿石`);
            cards.set(kind, { tile: card, pick, dim: false });
        });
        confirmTile = tile(world, events, 'Confirm', hud, { right: EDGE, bottom: EDGE }, 190, cardHeight, UI.go, 34, () => build(world));
        write(world, confirmTile.text, '建造');
        cancelTile = tile(world, events, 'Cancel', hud, { right: EDGE, bottom: EDGE + cardHeight + 8 }, 190, 64, UI.card, 26, () => choose(null));
        write(world, cancelTile.text, '取消');

        const detailTile = createButton({ world, events, parent: hud, node: boxAt({ left: EDGE, bottom: EDGE + cardHeight + 8 }, 400, 196), background: { color: UI.card } });
        detail = detailTile.entity;
        world.insert(detail, Name, { value: 'Detail' });
        detailTitle = label(world, 'DetailTitle', detail, { left: 18, top: 8 }, 364, 42, 32, UI.text);
        detailText = label(world, 'DetailText', detail, { left: 18, top: 52 }, 364, 66, 22, UI.dim);
        removeTile = tile(world, events, 'Remove', detail, { left: 18, top: 126 }, 176, 58, UI.warn, 26, () => removeSelected(world));
        switchTile = tile(world, events, 'Switch', detail, { left: 206, top: 126 }, 176, 58, UI.panel, 26, toggle);
        fixTile = tile(world, events, 'Fix', detail, { left: 18, top: 126 }, 364, 58, UI.go, 26, repair);

        const curtain = createButton({ world, events, parent: canvas, node: { fill: true }, background: { color: { r: 0.01, g: 0.03, b: 0.06, a: 0.74 } } });
        world.insert(curtain.entity, Name, { value: 'VictoryCurtain' });
        const headline = label(world, 'VictoryTitle', curtain.entity, { center: 0, middle: -70 }, 900, 70, 54, PALETTE.online, 1);
        write(world, headline, '信号已发出');
        victoryText = label(world, 'VictoryText', curtain.entity, { center: 0, middle: -6 }, 1000, 34, 20, UI.text, 1);
        const again = tile(world, events, 'Continue', curtain.entity, { center: -106, middle: 70 }, 200, 64, UI.card, 22, () => { acknowledged = true; });
        write(world, again.text, '继续经营');
        const anew = tile(world, events, 'NewGame', curtain.entity, { center: 106, middle: 70 }, 200, 64, UI.go, 22, () => fresh(world));
        write(world, anew.text, '重新开始');
        victory = [curtain.entity];
        show(world, curtain.entity, false);

        adopt(world, state);
        facts.restored = load(world);
        if (facts.restored) say('欢迎回来，基地已恢复到上次离开时的样子。');
        world.insert(clock, TimeOfDay, { ...world.get(clock, TimeOfDay), daySeconds: DAY_SECONDS });
        facts.readyMs = Math.round(performance.now() - bootAt);
        facts.pieces = livePieces.size;
        facts.ready = true;
    };

    app.addSystem(defineSystem([Res(Nav), Res(Input), Res(CameraView), Res(Time), Res(UIEvents), GetWorld()], (nav, input, view, time, events, world) => {
        if (!started) {
            if (meshes.size < SHAPES.length) return;
            started = true;
            setup(nav, events, world);
        }
        if (grid === null || body === null) return;
        const real = time.unscaledDelta;
        elapsed += real;

        const overUi = input.isPointerOverUI();
        const touches = input.getTouches();
        if (touches.length > 0) touchSeen = true;
        const points: Point[] = touches.length > 0 ? touches.map((t) => ({ id: t.id, x: t.x, y: t.y }))
            : !touchSeen && input.isMouseButtonDown(0) ? [{ id: -1, x: input.mouseX, y: input.mouseY }] : [];
        facts.touches = touches.length;
        const cellAt = (x: number, y: number): Cell | null => {
            const ray = view.pointerRay(x, y);
            const hit = ray === null ? null : rayPlaneHit(ray, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
            if (hit === null) return null;
            const cell = cellOfWorld(hit.x / UNITS, hit.z / UNITS);
            return inBounds(cell) ? cell : null;
        };
        const groundAt = (x: number, y: number): { x: number; z: number } | null => {
            const ray = view.pointerRay(x, y);
            const hit = ray === null ? null : rayPlaneHit(ray, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
            return hit === null ? null : { x: hit.x / UNITS, z: hit.z / UNITS };
        };
        const gesture = gestures.feed(points, real, overUi);
        let moving = points.length > 0;
        if (gesture.drag !== null && !lowView) {
            const from = groundAt(gesture.drag.fromX, gesture.drag.fromY), to = groundAt(gesture.drag.toX, gesture.drag.toY);
            if (from !== null && to !== null) { rig.x += from.x - to.x; rig.z += from.z - to.z; }
            facts.drags = (facts.drags as number) + 1;
        }
        if (gesture.pinch !== null) {
            rig.distance *= gesture.pinch.factor;
            facts.pinches = (facts.pinches as number) + 1;
        }
        if (gesture.tap !== null) {
            const cell = cellAt(gesture.tap.x, gesture.tap.y);
            if (cell !== null) tapCell(world, cell);
        }
        const mouseMoved = input.mouseX !== lastMouse.x || input.mouseY !== lastMouse.y;
        if (mouseMoved) {
            lastMouse = { x: input.mouseX, y: input.mouseY };
            moving = true;
            if (!touchSeen && tool !== null && !overUi && points.length === 0) pending = cellAt(input.mouseX, input.mouseY) ?? pending;
        }

        const step = input.isKeyDown('ShiftLeft') || input.isKeyDown('ShiftRight') ? 8 : 1;
        const nudged = (input.isKeyPressed('ArrowRight') ? step : 0) - (input.isKeyPressed('ArrowLeft') ? step : 0);
        const nudgedY = (input.isKeyPressed('ArrowDown') ? step : 0) - (input.isKeyPressed('ArrowUp') ? step : 0);
        if (nudged !== 0 || nudgedY !== 0) {
            const from = pending ?? { x: 32, y: 30 };
            pending = { x: Math.min(GRID_WIDTH - 1, Math.max(0, from.x + nudged)), y: Math.min(GRID_HEIGHT - 1, Math.max(0, from.y + nudgedY)) };
        }
        KINDS.forEach((kind, i) => { if (input.isKeyPressed(`Digit${i + 1}`)) { tool = null; choose(kind); } });
        if (input.isKeyPressed('Escape')) choose(null);
        if (input.isKeyPressed('Enter')) {
            if (tool !== null) build(world);
            else if (pending !== null) { const at = buildingAt(state, pending); selected = at === null ? 0 : at.id; }
        }
        if (input.isKeyPressed('Backspace')) removeSelected(world);
        if (input.isKeyPressed('KeyO')) toggle();
        if (input.isKeyPressed('KeyR')) repair();
        if (input.isKeyPressed('KeyK')) save(false);
        if (input.isKeyPressed('KeyL')) { if (load(world)) say('已读档。'); }
        if (input.isKeyPressed('KeyN')) fresh(world);
        if (input.isKeyPressed('KeyJ')) { exportJournals(); say('试玩记录已导出。'); }
        if (input.isKeyPressed('KeyT')) cycleSpeed();
        if (input.isKeyPressed('KeyP')) throw new Error('last-signal probe: a script error raised on purpose');
        if (input.isKeyPressed('KeyC')) { lowView = !lowView; facts.lowView = lowView; }

        const pan = 0.9 * rig.distance * real;
        if (input.isKeyDown('KeyW')) rig.z -= pan;
        if (input.isKeyDown('KeyS')) rig.z += pan;
        if (input.isKeyDown('KeyA')) rig.x -= pan;
        if (input.isKeyDown('KeyD')) rig.x += pan;
        const zoom = (input.isKeyDown('KeyX') ? 1 : 0) - (input.isKeyDown('KeyZ') ? 1 : 0) + input.getScrollDelta().y * 0.02;
        rig.distance = Math.min(60, Math.max(10, rig.distance * (1 + zoom * 1.2 * real)));
        const half = GRID_WIDTH * CELL_SIZE / 2;
        rig.x = Math.min(half, Math.max(-half, rig.x));
        rig.z = Math.min(half, Math.max(-half, rig.z));
        if (ACTIVE_KEYS.some((code) => input.isKeyDown(code)) || input.getScrollDelta().y !== 0) moving = true;
        const key = lowView ? 'low' : `${rig.x.toFixed(3)},${rig.z.toFixed(3)},${rig.distance.toFixed(3)}`;
        if (camera !== null && key !== rigKey) {
            rigKey = key;
            const pose = world.get(camera, Transform);
            if (lowView) {
                pose.position = { x: 0, y: 400, z: 5200 };
                pose.rotation = { x: -0.0262, y: 0, z: 0, w: 0.9997 };
            } else {
                pose.position = { x: rig.x * UNITS, y: rig.distance * Math.sin(rig.pitch) * UNITS, z: (rig.z + rig.distance * Math.cos(rig.pitch)) * UNITS };
                pose.rotation = { x: -Math.sin(rig.pitch / 2), y: 0, z: 0, w: Math.cos(rig.pitch / 2) };
            }
            world.insert(camera, Transform, pose);
        }
        if (input.isKeyPressed('KeyE') && camera !== null) {
            const volume = world.get(camera, PostProcessVolume);
            const effects = volume.effects.map((effect) => effect.type === 'autoExposure' ? { ...effect, enabled: !effect.enabled } : effect);
            world.insert(camera, PostProcessVolume, { ...volume, effects });
            facts.autoExposure = effects.some((effect) => effect.type === 'autoExposure' && effect.enabled);
        }
        const skyLight = world.findEntityByName('Sky');
        const sunLight = world.findEntityByName('Sun');
        if (skyLight !== null) facts.ambient = world.get(skyLight, Light).intensity;
        if (sunLight !== null) facts.sun = world.get(sunLight, Light).intensity;

        if (input.isKeyPressed('KeyH')) {
            const data = world.get(clock!, TimeOfDay);
            const held = data.daySeconds !== 0;
            world.insert(clock!, TimeOfDay, { ...data, daySeconds: held ? 0 : DAY_SECONDS });
            facts.held = held;
        }
        const nudge = (input.isKeyPressed('BracketRight') ? 0.5 : 0) - (input.isKeyPressed('BracketLeft') ? 0.5 : 0);
        if (nudge !== 0) {
            const now = world.get(clock!, TimeOfDay);
            world.insert(clock!, TimeOfDay, { ...now, hour: ((now.hour + nudge) % DAY_HOURS + DAY_HOURS) % DAY_HOURS });
        }
        state.hour = world.get(clock!, TimeOfDay).hour;
        const passed = ((state.hour - lastHour) % DAY_HOURS + DAY_HOURS) % DAY_HOURS;
        facts.hoursElapsed = (facts.hoursElapsed as number) + passed;
        if (passed > 0) stepPower(state, lastHour, passed);
        journal.tick(real, passed, { canAct: state.signal === 'offline' && state.ore >= CHEAPEST, input: moving });
        journal.outage(state.blackout);
        lastHour = state.hour;
        if (state.blackout !== wasBlackout) {
            wasBlackout = state.blackout;
            if (state.blackout) { facts.blackouts = (facts.blackouts as number) + 1; say('停电了。储电耗尽，所有采矿站都已停工。'); }
            else say(state.buildings.some((b) => b.kind === 'mine' && b.on) ? '电力恢复，采矿站重新开工。' : '现在没有设备耗电，储电可以回充。');
        }

        const pose = world.get(body, Transform).position;
        state.drone.x = pose.x / UNITS;
        state.drone.z = pose.z / UNITS;
        const agent = world.get(body, NavAgent);
        const carried = state.drone.cargo;
        if ((agent.arrived || !agent.hasTarget) && settleArrival(state)) {
            if (state.drone.leg === 'toMine') { journal.note('delivery', { ore: carried, stored: state.ore }); save(); }
            dock = null;
            dockFor = -1;
        }
        const target = targetOf(state);
        if (target === null) {
            if (agent.hasTarget) stopNavAgent(world, body);
            dock = null;
            dockFor = -1;
            facts.route = 'none';
        } else {
            if (dockFor !== target.id || dock === null || !isWalkable(state, dock)) {
                dock = nearestDock(state, target);
                dockFor = target.id;
                if (dock === null) {
                    stopNavAgent(world, body);
                } else {
                    const at = worldOfCell(dock);
                    setNavDestination(world, body, groundPoint(at.x, at.z));
                }
            }
            if (dock === null) {
                facts.route = 'none';
            } else {
                const at = worldOfCell(dock);
                facts.route = nav.queryWorldPath(pose, groundPoint(at.x, at.z), { radius: 0.3 * UNITS }).status;
            }
        }

        const standing = droneCell(state);
        if (buildingAt(state, standing) !== null) facts.everInsideBuilding = true;
        const dx = state.drone.x - lastDrone.x, dz = state.drone.z - lastDrone.z;
        if (Math.hypot(dx, dz) > 0.001) heading = Math.atan2(dx, dz);
        lastDrone = { x: state.drone.x, z: state.drone.z };
        drone!.pose(world, state.drone.x, state.drone.z, DRONE_LIFT + Math.sin(elapsed * 2.2) * 0.06, heading);
        drone!.turn(world, 'rotor', elapsed * 40);
        drone!.show(world, 'cargo', state.drone.cargo > 0);
        markAt(world, droneMark!, standing, 5);

        const activeId = target === null ? 0 : target.id;
        const blink = Math.floor(elapsed * 2.5) % 2 === 0;
        if (uplink >= 0 && uplink < 900) uplink += time.delta;
        const report = powerReport(state);
        for (const site of sites.values()) {
            if (site.building.kind === 'tower') {
                const online = state.signal === 'online';
                const warm = online ? clamp01(uplink) : 0;
                const raised = online ? clamp01((uplink - 1) / 2) : 0;
                const beam = online ? clamp01((uplink - 3) / 1.5) : 0;
                const pulse = online ? 1 : Math.floor(elapsed * 1.2) % 2 === 0 ? 1 : 0.3;
                const look = `${warm.toFixed(2)},${pulse}`;
                if (look !== towerLook) {
                    towerLook = look;
                    const colour = shade(mixed(PALETTE.offline, PALETTE.online, warm), pulse);
                    site.model.colour(world, 'beacon', colour);
                    site.model.colour(world, 'emitter', colour);
                    paint(world, site.mark, colour);
                }
                const lift = raised * raised * (3 - 2 * raised) * 1.1;
                site.model.adjust('antenna', lift, 1);
                site.model.adjust('emitter', lift, 1);
                site.model.turn(world, 'antenna', online ? uplink * 1.4 : 0);
                site.model.turn(world, 'emitter', 0);
                site.model.show(world, 'beam', beam > 0);
                if (beam > 0) {
                    const height = 2 + beam * 320;
                    site.model.adjust('beam', lift + height / 2, height);
                    site.model.turn(world, 'beam', 0);
                }
                continue;
            }
            const b = site.building;
            const active = b.id === activeId;
            const running = isRunning(state, b);
            const mode = b.kind === 'mine' ? (!b.on ? 'off' : state.blackout ? 'dark' : active && blink ? 'call' : 'run')
                : b.kind === 'solar' ? `sun${report.generation > 0 ? 2 : 0}`
                    : b.kind === 'battery' ? `charge${Math.round(4 * report.energy / report.capacity)}`
                        : active ? (blink ? 'call' : 'wait') : 'idle';
            if (mode !== site.look) {
                site.look = mode;
                const glow = glowColour(b.kind);
                const beacon = mode === 'off' ? PALETTE.idle : mode === 'dark' ? shade(PALETTE.offline, 0.8) : mode === 'call' ? glow
                    : mode === 'sun0' ? shade(glow, 0.2) : mode.startsWith('charge') ? shade(glow, 0.15 + 0.85 * report.energy / report.capacity)
                        : mode === 'idle' ? shade(glow, 0.35) : shade(glow, 0.7);
                site.model.colour(world, 'beacon', beacon);
                paint(world, site.mark, mode === 'off' ? PALETTE.idle : mode === 'dark' ? PALETTE.offline : mode === 'sun0' ? shade(glow, 0.35)
                    : mode === 'idle' || mode === 'wait' ? shade(glow, 0.6) : glow);
            }
            if (running) site.model.turn(world, 'spinner', elapsed * 3);
        }

        const legal = tool === null || pending === null || whyNotBuild(state, tool, pending) === null;
        if (tool !== ghostKind) {
            ghost?.despawn(world);
            ghost = tool === null ? null : new Model(world, 'Ghost', partsOf(tool), legal ? PALETTE.ok : PALETTE.blocked);
            ghostKind = tool;
            ghostLegal = legal;
        }
        if (ghost !== null && legal !== ghostLegal) {
            ghost.colour(world, null, legal ? PALETTE.ok : PALETTE.blocked);
            ghostLegal = legal;
        }
        if (tool !== null && pending !== null) {
            const at = worldOfCell(pending);
            ghost!.pose(world, at.x, at.z, 0);
            cursorRing!.pose(world, at.x, at.z, 0);
            if (!legal !== cursorRed) { cursorRing!.colour(world, null, legal ? PALETTE.cursor : PALETTE.blocked); cursorRed = !legal; }
            markAt(world, ghostMark!, pending, 4);
            paint(world, ghostMark!, legal ? PALETTE.ok : PALETTE.blocked);
        } else {
            ghost?.pose(world, 0, 0, HIDDEN);
            cursorRing!.pose(world, 0, 0, HIDDEN);
        }
        show(world, ghostMark!, tool !== null && pending !== null);

        const chosen = selected === 0 ? undefined : sites.get(selected);
        if (chosen === undefined) {
            selectRing!.pose(world, 0, 0, HIDDEN);
        } else {
            const at = worldOfCell(chosen.building);
            selectRing!.pose(world, at.x, at.z, 0.02 + (Math.sin(elapsed * 4) + 1) * 0.03);
            markAt(world, selectMark!, chosen.building, 8);
        }
        show(world, selectMark!, chosen !== undefined);

        const online = state.signal === 'online';
        const hours = Math.floor(state.hour);
        const minutes = Math.floor((state.hour - hours) * 60);
        write(world, oreText!, `${state.ore}`);
        write(world, clockText!, `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`);
        write(world, powerText!, state.blackout ? '停电！储电耗尽' : `储电 ${report.energy.toFixed(1)} / ${report.capacity}   ${report.generation >= report.demand ? '+' : '−'}${Math.abs(report.generation - report.demand).toFixed(1)}`);
        ink(world, powerText!, state.blackout ? PALETTE.offline : report.status === 'draining' ? PALETTE.mineGlow : UI.text);
        sizeTo(world, powerFill!, Math.max(1, 272 * report.energy / report.capacity));
        paint(world, powerFill!, state.blackout ? PALETTE.offline : report.status === 'draining' ? PALETTE.mineGlow : PALETTE.batteryGlow);

        const ready = !online && state.ore >= REPAIR_COST;
        write(world, goal!.text, online ? '信号已发出' : ready ? '点这里修复通信塔' : `修复通信塔   ${Math.min(state.ore, REPAIR_COST)} / ${REPAIR_COST} 矿石`);
        sizeTo(world, goalFill!, online ? 460 : Math.max(1, 460 * Math.min(state.ore, REPAIR_COST) / REPAIR_COST));
        paint(world, goalFill!, online || ready ? PALETTE.online : PALETTE.offline);
        paint(world, goal!.entity, ready && blink ? UI.go : UI.card);
        write(world, speedTile!.text, `速度 ×${SPEEDS[speedIndex]}`);

        for (const [kind, card] of cards) {
            const dim = state.ore < COSTS[kind];
            if (dim !== card.dim) { card.dim = dim; ink(world, card.tile.text, dim ? UI.dim : UI.text); }
            show(world, card.pick, tool === kind);
        }
        show(world, cancelTile!.entity, tool !== null);
        show(world, confirmTile!.entity, tool !== null && pending !== null);
        paint(world, confirmTile!.entity, legal ? UI.go : UI.warn);
        write(world, confirmTile!.text, legal ? '建造' : '不能建');

        show(world, detail!, chosen !== undefined && tool === null);
        if (chosen !== undefined) {
            const b = chosen.building;
            const status = b.kind === 'tower' ? (online ? '正在发射信号' : '沉默着，发射器已损坏')
                : b.kind === 'mine' ? (!b.on ? '已关闭' : state.blackout ? '停工：没有电' : `运转中，待运 ${Math.floor(b.stock)} / 10`)
                    : b.kind === 'store' ? `已收货 ${b.served} 次`
                        : b.kind === 'solar' ? (report.generation > 0 ? '正在发电' : '没有阳光，不发电') : '多存 12 度电';
            const about = b.kind === 'tower' ? (online ? '' : `修复需要 ${REPAIR_COST} 矿石`)
                : b.kind === 'mine' ? '通电时每小时产 2 矿石，耗电 1.5' : b.kind === 'store' ? '无人机在这里卸货' : b.kind === 'solar' ? '正午最多发 4，夜里不发电' : '让采矿站撑过夜晚';
            write(world, detailTitle!, kindName(b.kind));
            write(world, detailText!, `${status}\n${about}`);
            show(world, removeTile!.entity, b.kind !== 'tower');
            show(world, switchTile!.entity, b.kind === 'mine');
            show(world, fixTile!.entity, b.kind === 'tower' && !online);
            write(world, removeTile!.text, b.kind === 'tower' ? '' : `拆除 +${Math.floor(COSTS[b.kind as PlaceableKind] / 2)}`);
            write(world, switchTile!.text, b.on ? '关闭' : '开启');
            write(world, fixTile!.text, ready ? '修复通信塔' : `还差 ${REPAIR_COST - state.ore} 矿石`);
        }

        toastLeft -= real;
        show(world, toastPanel!, toastLeft > 0);
        write(world, toastText!, toast);

        const showVictory = online && uplink >= 5 && !acknowledged;
        if (showVictory !== victoryShown) {
            victoryShown = showVictory;
            show(world, victory[0]!, showVictory);
            if (showVictory) {
                const sum = journal.summary();
                journal.note('victory', { seconds: sum.seconds, gameHours: sum.gameHours, buildings: state.buildings.length, builds: sum.builds, outages: sum.outages, outageHours: sum.outageHours, trips: state.trips });
                const mins = Math.floor(sum.seconds / 60);
                write(world, victoryText!, `用时 ${mins} 分 ${Math.round(sum.seconds - mins * 60)} 秒，运输 ${state.trips} 趟，建造 ${sum.builds} 座，停电 ${sum.outageHours} 小时`);
            }
        }

        facts.buildings = state.buildings.length;
        facts.layout = state.buildings.map((b) => `${b.id}:${b.kind}:${b.x}:${b.y}`).join(';');
        facts.ore = state.ore;
        facts.trips = state.trips;
        facts.cargo = state.drone.cargo;
        facts.leg = state.drone.leg;
        facts.droneX = standing.x;
        facts.droneY = standing.y;
        facts.hour = state.hour;
        facts.plans = (facts.plans as number) + nav.planningStats.completed;
        facts.cursorX = pending === null ? -1 : pending.x;
        facts.cursorY = pending === null ? -1 : pending.y;
        facts.tool = tool ?? 'none';
        facts.notice = toast;
        facts.selected = selected;
        facts.ghostLegal = legal;
        facts.active = activeId;
        facts.signal = state.signal;
        facts.canRepair = whyNotRepair(state) === null;
        facts.uplink = uplink;
        facts.victory = showVictory;
        facts.energy = report.energy;
        facts.capacity = report.capacity;
        facts.generation = report.generation;
        facts.demand = report.demand;
        facts.blackout = state.blackout;
        facts.power = report.status;
        facts.mines = report.wanted;
        facts.minesRunning = report.running;
        facts.camera = `${rig.x.toFixed(1)},${rig.z.toFixed(1)},${rig.distance.toFixed(1)}`;
        facts.journalEntries = journal.entries.length;
        journalAge += real;
        keepJournal(journalAge > 10);
    }, { name: 'LastSignalPlay', runAfter: ['NavAgentSystem'] }));
} });
