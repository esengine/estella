import {
    addPlugin, defineSystem, Schedule, Res, GetWorld, Input, CameraView, Playthrough, SaveManager, UIEvents, Time,
    Transform, MeshRenderer, TimeOfDay, PostProcessVolume, Light, Text, Name, UINode, UIVisual,
    spawnUIEntity, createButton, UIPositionType, px, rayPlaneHit,
    type World, type Entity,
} from 'esengine';
import { Nav, NavAgent, NavGrid, setNavDestination, stopNavAgent } from 'esengine/ai';
import {
    GRID_WIDTH, GRID_HEIGHT, CELL_SIZE, SAVE_VERSION, DAY_HOURS,
    REPAIR_COST, createState, restore, snapshot, place, demolish, isWalkable, inBounds, buildingAt, droneCell, whyNotPlace,
    targetOf, nearestDock, settleArrival, worldOfCell, cellOfWorld, towerOf, whyNotRepair, repairTower, migrateFromV1,
    type GameState, type Building, type BuildingKind, type PlaceableKind, type Cell, type Snapshot,
} from './state';
import { PALETTE, mineParts, storeParts, droneParts, ringParts, towerParts, type Part, type Role, type Colour } from './models';

type Tool = PlaceableKind | 'select' | 'remove';

const UNITS = 100;
const SLOT = 'gate0';
const MAP = { left: 16, top: 16, cell: 4 };
const DAY_SECONDS = { normal: 240, fast: 24 };
const VIEW = { width: 1280, height: 720 };
const DRONE_LIFT = 2.4;
const HIDDEN = -400;
const UI = {
    panel: { r: 0.05, g: 0.07, b: 0.09, a: 0.85 },
    line: { r: 0.2, g: 0.25, b: 0.3, a: 1 },
    text: { r: 0.9, g: 0.92, b: 0.95, a: 1 },
    dim: { r: 0.62, g: 0.68, b: 0.74, a: 1 },
    button: { r: 0.12, g: 0.16, b: 0.2, a: 0.95 },
    accent: { r: 0.6, g: 0.95, b: 1, a: 1 },
};
const TOOLS: { tool: Tool; label: string; name: string }[] = [
    { tool: 'mine', label: '1  MINE', name: 'ToolMine' },
    { tool: 'store', label: '2  STOREHOUSE', name: 'ToolStore' },
    { tool: 'select', label: '3  SELECT', name: 'ToolSelect' },
    { tool: 'remove', label: '4  REMOVE', name: 'ToolRemove' },
];
const TOOLBAR = { top: 664, width: 150, gap: 12, left: (VIEW.width - 4 * 150 - 3 * 12) / 2 };

const saves = new SaveManager({ version: SAVE_VERSION, migrations: { 1: migrateFromV1 }, keyPrefix: 'last-signal:' });
const mixed = (a: Colour, b: Colour, k: number): Colour => ({ r: a.r + (b.r - a.r) * k, g: a.g + (b.g - a.g) * k, b: a.b + (b.b - a.b) * k, a: a.a + (b.a - a.a) * k });
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const shade = (c: Colour, k: number, a = c.a): Colour => ({ r: c.r * k, g: c.g * k, b: c.b * k, a });

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
                mesh: `builtin:${part.shape}` as unknown as number, lit: tint === null && part.lit, opaque: colour.a >= 1,
                cullBackfaces: true, castShadows: tint === null && part.lit, enabled: true, color: colour,
            });
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
        for (const piece of this.pieces) world.despawn(piece.entity);
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

interface Site { building: Building; model: Model; mark: Entity; active: boolean; lit: boolean }

addPlugin({ name: 'last-signal-gate0', build(app) {
    const facts: Record<string, string | number | boolean> = {
        ready: false, restored: false, buildings: 0, blockedCells: 0, ore: 0, trips: 0, cargo: 0, leg: 'toMine',
        droneX: 0, droneY: 0, hour: 0, hoursElapsed: 0, fast: false, plans: 0, route: 'none', everInsideBuilding: false,
        cursorX: 0, cursorY: 0, cursorWalkable: true, tool: 'mine', saves: 0, loads: 0, notice: '', layout: '',
        autoExposure: true, held: false, lowView: false, ambient: 0, sun: 0, selected: 0, ghostLegal: true, active: 0, signal: 'offline', canRepair: false, victory: false, repairs: 0, uplink: 0,
    };
    app.insertResource(Playthrough, { facts });

    let state: GameState = createState();
    let grid: NavGrid | null = null;
    let body: Entity | null = null;
    let drone: Model | null = null;
    let ghost: Model | null = null;
    let ghostKind: PlaceableKind | null = null;
    let uplink = -1;
    let acknowledged = false;
    let towerLook = '';
    let objectiveTitle: Entity | null = null;
    let objective: Entity | null = null;
    let objectiveHint: Entity | null = null;
    let objectiveCount: Entity | null = null;
    let objectiveFill: Entity | null = null;
    let victory: Entity[] = [];
    let victoryShown = false;
    let repairEntity: Entity | null = null;
    let repairTop = 0;
    let ghostLegal = true;
    let cursorRing: Model | null = null;
    let cursorRed = false;
    let selectRing: Model | null = null;
    let droneMark: Entity | null = null;
    let ghostMark: Entity | null = null;
    let selectMarks: Entity[] = [];
    let toolMark: Entity | null = null;
    let hud: Entity | null = null;
    let info: Entity | null = null;
    let noticeText: Entity | null = null;
    let canvas: Entity | null = null;
    let clock: Entity | null = null;
    let camera: Entity | null = null;
    let lowView = false;
    const rig = { x: -4, z: -1, distance: 44, pitch: 0.9 };
    let rigKey = '';
    const sites = new Map<number, Site>();
    let cursor: Cell = { x: 32, y: 30 };
    let tool: Tool = 'mine';
    let selected = 0;
    let dock: Cell | null = null;
    let dockFor = -1;
    let lastMouse = { x: -1, y: -1 };
    let lastHour = state.hour;
    let lastDrone = { x: state.drone.x, z: state.drone.z };
    let heading = 0;
    let elapsed = 0;
    let notice = 'Pick a building below and click the ground to place it.';

    const say = (text: string): void => { notice = text; };
    const kindName = (kind: BuildingKind): string => kind === 'mine' ? 'Mine' : kind === 'store' ? 'Storehouse' : 'Signal tower';
    const groundPoint = (x: number, z: number): { x: number; y: number; z: number } => ({ x: x * UNITS, y: 0, z: z * UNITS });

    const rect = (world: World, name: string, left: number, top: number, width: number, height: number, colour: Colour): Entity => {
        const entity = spawnUIEntity({
            world, parent: canvas!,
            node: { position: UIPositionType.Absolute, insetLeft: px(left), insetTop: px(top), width: px(width), height: px(height) },
            visual: { color: colour },
        });
        world.insert(entity, Name, { value: name });
        return entity;
    };

    const label = (world: World, name: string, left: number, top: number, width: number, height: number, size: number, colour: Colour): Entity => {
        const entity = spawnUIEntity({
            world, parent: canvas!,
            node: { position: UIPositionType.Absolute, insetLeft: px(left), insetTop: px(top), width: px(width), height: px(height), pointerEvents: 1 },
            text: { content: '', fontSize: size, color: colour, align: 0 },
        });
        world.insert(entity, Name, { value: name });
        return entity;
    };

    const write = (world: World, entity: Entity, content: string): void => {
        const text = world.get(entity, Text);
        if (text.content !== content) world.insert(entity, Text, { ...text, content });
    };

    const moveTo = (world: World, entity: Entity, left: number, top: number): void => {
        const node = world.get(entity, UINode);
        if (node.insetLeft.value === left && node.insetTop.value === top) return;
        node.insetLeft = px(left);
        node.insetTop = px(top);
        world.insert(entity, UINode, node);
    };

    const moveMark = (world: World, entity: Entity, cellX: number, cellY: number, size: number): void => {
        moveTo(world, entity, MAP.left + cellX * MAP.cell + (MAP.cell - size) / 2, MAP.top + cellY * MAP.cell + (MAP.cell - size) / 2);
    };

    const paint = (world: World, entity: Entity, colour: Colour): void => {
        const visual = world.get(entity, UIVisual);
        world.insert(entity, UIVisual, { ...visual, color: colour });
    };

    const glowColour = (kind: BuildingKind): Colour => kind === 'mine' ? PALETTE.mineGlow : kind === 'store' ? PALETTE.storeGlow : state.signal === 'online' ? PALETTE.online : PALETTE.offline;
    const sizeTo = (world: World, entity: Entity, width: number): void => {
        const node = world.get(entity, UINode);
        if (node.width.value === width) return;
        node.width = px(width);
        world.insert(entity, UINode, node);
    };

    const showSite = (world: World, building: Building): void => {
        const at = worldOfCell(building);
        const model = new Model(world, `Building ${building.id}`, building.kind === 'mine' ? mineParts() : building.kind === 'store' ? storeParts() : towerParts());
        model.pose(world, at.x, at.z, 0);
        if (building.kind === 'tower') { model.show(world, 'beam', false); towerLook = ''; } else model.colour(world, 'beacon', shade(glowColour(building.kind), 0.35));
        const mark = rect(world, `MapBuilding ${building.id}`, 0, 0, MAP.cell, MAP.cell, shade(glowColour(building.kind), 0.6));
        moveMark(world, mark, building.x, building.y, MAP.cell);
        sites.set(building.id, { building, model, mark, active: false, lit: false });
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
        facts.blockedCells = countBlocked();
    };

    const build = (world: World, kind: PlaceableKind): void => {
        const result = place(state, kind, cursor);
        if (!result.ok) { say(`Cannot build here: ${result.reason}.`); return; }
        grid!.setWalkable(cursor.x, cursor.y, false);
        showSite(world, result.building);
        facts.blockedCells = countBlocked();
        say(`${kindName(kind)} built at ${cursor.x}, ${cursor.y}.`);
    };

    const remove = (world: World): void => {
        if (buildingAt(state, cursor)?.kind === 'tower') { say('The signal tower cannot be removed.'); return; }
        const gone = demolish(state, cursor);
        if (gone === null) { say('Nothing to remove here.'); return; }
        grid!.setWalkable(cursor.x, cursor.y, true);
        hideSite(world, gone.id);
        facts.blockedCells = countBlocked();
        say(`${kindName(gone.kind)} at ${cursor.x}, ${cursor.y} removed.`);
    };

    const pick = (): void => {
        const at = buildingAt(state, cursor);
        selected = at === null ? 0 : at.id;
        say(at === null ? 'Nothing selected.' : `${kindName(at.kind)} #${at.id} selected.`);
    };

    const primary = (world: World): void => {
        if (tool === 'remove') { remove(world); return; }
        if (tool === 'select') { pick(); return; }
        build(world, tool);
    };

    const choose = (next: Tool): void => {
        tool = next;
        say(next === 'select' ? 'Click a building to inspect it.' : next === 'remove' ? 'Click a building to remove it.' : `Click the ground to place a ${kindName(next).toLowerCase()}.`);
    };

    const repair = (): void => {
        const reason = whyNotRepair(state);
        if (reason !== null) { say(`Cannot repair the tower: ${reason}.`); return; }
        repairTower(state);
        uplink = 0;
        acknowledged = false;
        facts.repairs = (facts.repairs as number) + 1;
        say(`Tower repaired for ${REPAIR_COST} ore. The uplink is powering up.`);
    };

    const save = (): void => {
        saves.save<Snapshot>(SLOT, snapshot(state));
        facts.saves = (facts.saves as number) + 1;
        say('Game saved.');
    };

    const load = (world: World): boolean => {
        if (!saves.has(SLOT)) { say('No save to load.'); return false; }
        try {
            adopt(world, restore(saves.load<Snapshot>(SLOT)));
        } catch (error) {
            console.error('[last-signal] the save could not be restored:', error);
            say('The save could not be restored.');
            return false;
        }
        facts.loads = (facts.loads as number) + 1;
        say('Game loaded.');
        return true;
    };

    const speed = (world: World): void => {
        const data = world.get(clock!, TimeOfDay);
        const fast = data.daySeconds !== DAY_SECONDS.fast;
        world.insert(clock!, TimeOfDay, { ...data, daySeconds: fast ? DAY_SECONDS.fast : DAY_SECONDS.normal });
        facts.fast = fast;
        facts.held = false;
    };

    app.addSystemToSchedule(Schedule.Startup, defineSystem([Res(Nav), Res(UIEvents), GetWorld()], (nav, events, world) => {
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
        selectRing.pose(world, 0, 0, HIDDEN);

        rect(world, 'MapPanel', MAP.left, MAP.top, GRID_WIDTH * MAP.cell, GRID_HEIGHT * MAP.cell, UI.panel);
        for (let i = 8; i < GRID_WIDTH; i += 8) {
            rect(world, `MapLineV${i}`, MAP.left + i * MAP.cell, MAP.top, 1, GRID_HEIGHT * MAP.cell, UI.line);
            rect(world, `MapLineH${i}`, MAP.left, MAP.top + i * MAP.cell, GRID_WIDTH * MAP.cell, 1, UI.line);
        }
        ghostMark = rect(world, 'MapGhost', -20, -20, MAP.cell, MAP.cell, PALETTE.ok);
        selectMarks = [
            rect(world, 'MapSelectTop', -20, -20, 10, 1, UI.accent), rect(world, 'MapSelectBottom', -20, -20, 10, 1, UI.accent),
            rect(world, 'MapSelectLeft', -20, -20, 1, 10, UI.accent), rect(world, 'MapSelectRight', -20, -20, 1, 10, UI.accent),
        ];

        const left = MAP.left, column = GRID_WIDTH * MAP.cell, below = MAP.top + GRID_HEIGHT * MAP.cell + 10;
        rect(world, 'ObjectivePanel', left, below, column, 148, UI.panel);
        objectiveTitle = label(world, 'ObjectiveTitle', left + 10, below + 8, column - 20, 18, 12, UI.accent);
        objective = label(world, 'Objective', left + 10, below + 28, column - 20, 22, 15, UI.text);
        rect(world, 'ObjectiveBar', left + 10, below + 58, 150, 8, UI.line);
        objectiveFill = rect(world, 'ObjectiveFill', left + 10, below + 58, 1, 8, PALETTE.offline);
        objectiveCount = label(world, 'ObjectiveCount', left + 168, below + 51, 90, 20, 13, UI.text);
        objectiveHint = label(world, 'ObjectiveHint', left + 10, below + 74, column - 20, 30, 11, UI.dim);
        const repairButton = createButton({
            world, events, parent: canvas!,
            node: { position: UIPositionType.Absolute, insetLeft: px(left + 10), insetTop: px(below + 106), width: px(column - 20), height: px(34) },
            text: { content: 'R  REPAIR TOWER', fontSize: 13, color: UI.text }, background: { color: UI.button }, onClick: repair,
        });
        repairEntity = repairButton.entity;
        repairTop = below + 106;
        rect(world, 'HudPanel', left, below + 158, column, 56, UI.panel);
        hud = label(world, 'Hud', left + 10, below + 164, column - 20, 46, 13, UI.text);
        world.insert(repairButton.entity, Name, { value: 'RepairButton' });
        rect(world, 'InfoPanel', VIEW.width - 316, 96, 300, 170, UI.panel);
        info = label(world, 'Info', VIEW.width - 304, 106, 280, 150, 15, UI.text);
        rect(world, 'NoticePanel', TOOLBAR.left, TOOLBAR.top - 40, 4 * TOOLBAR.width + 3 * TOOLBAR.gap, 30, UI.panel);
        noticeText = label(world, 'Notice', TOOLBAR.left + 12, TOOLBAR.top - 35, 4 * TOOLBAR.width + 3 * TOOLBAR.gap - 24, 24, 15, UI.text);

        TOOLS.forEach((entry, i) => {
            const button = createButton({
                world, events, parent: canvas!,
                node: { position: UIPositionType.Absolute, insetLeft: px(TOOLBAR.left + i * (TOOLBAR.width + TOOLBAR.gap)), insetTop: px(TOOLBAR.top), width: px(TOOLBAR.width), height: px(38) },
                text: { content: entry.label, fontSize: 14, color: UI.text }, background: { color: UI.button },
                onClick: () => choose(entry.tool),
            });
            world.insert(button.entity, Name, { value: entry.name });
        });
        toolMark = rect(world, 'ToolActive', TOOLBAR.left, TOOLBAR.top + 40, TOOLBAR.width, 4, UI.accent);
        const side: [string, string, () => void][] = [['SpeedButton', 'T  SPEED', () => speed(world)], ['SaveButton', 'K  SAVE', save], ['LoadButton', 'L  LOAD', () => { load(world); }]];
        side.forEach(([name, text, onClick], i) => {
            const button = createButton({
                world, events, parent: canvas!,
                node: { position: UIPositionType.Absolute, insetLeft: px(VIEW.width - 316 + i * 102), insetTop: px(MAP.top), width: px(96), height: px(34) },
                text: { content: text, fontSize: 13, color: UI.text }, background: { color: UI.button }, onClick,
            });
            world.insert(button.entity, Name, { value: name });
        });
        droneMark = rect(world, 'MapDrone', 0, 0, 6, 6, PALETTE.drone);
        const curtain = rect(world, 'VictoryCurtain', 0, -2000, VIEW.width, VIEW.height, { r: 0.01, g: 0.03, b: 0.06, a: 0.72 });
        const headline = label(world, 'VictoryTitle', 0, -2000, VIEW.width, 60, 48, PALETTE.online);
        const tagline = label(world, 'VictoryText', 0, -2000, VIEW.width, 30, 18, UI.text);
        for (const entity of [headline, tagline]) world.insert(entity, Text, { ...world.get(entity, Text), align: 1 });
        write(world, headline, 'SIGNAL TRANSMITTED');
        const again = createButton({
            world, events, parent: canvas!,
            node: { position: UIPositionType.Absolute, insetLeft: px(VIEW.width / 2 - 170), insetTop: px(-2000), width: px(160), height: px(44) },
            text: { content: 'CONTINUE', fontSize: 15, color: UI.text }, background: { color: UI.button },
            onClick: () => { acknowledged = true; say('The signal is out. The base is still yours to run.'); },
        });
        world.insert(again.entity, Name, { value: 'ContinueButton' });
        const fresh = createButton({
            world, events, parent: canvas!,
            node: { position: UIPositionType.Absolute, insetLeft: px(VIEW.width / 2 + 10), insetTop: px(-2000), width: px(160), height: px(44) },
            text: { content: 'NEW GAME', fontSize: 15, color: UI.text }, background: { color: UI.button },
            onClick: () => { saves.remove(SLOT); adopt(world, createState()); say('New game. The tower is silent again.'); },
        });
        world.insert(fresh.entity, Name, { value: 'NewGameButton' });
        victory = [curtain, headline, tagline, again.entity, fresh.entity];

        adopt(world, state);
        facts.restored = saves.has(SLOT) && load(world);
        if (facts.restored) say('Welcome back. Your base was restored from the last save.');
        world.insert(clock, TimeOfDay, { ...world.get(clock, TimeOfDay), daySeconds: DAY_SECONDS.normal });
        facts.ready = true;
    }, { name: 'LastSignalSetup' }));

    app.addSystem(defineSystem([Res(Nav), Res(Input), Res(CameraView), Res(Time), GetWorld()], (nav, input, view, time, world) => {
        if (grid === null || body === null) return;
        elapsed += time.delta;

        const step = input.isKeyDown('ShiftLeft') || input.isKeyDown('ShiftRight') ? 8 : 1;
        const moved = { x: cursor.x, y: cursor.y };
        if (input.isKeyPressed('ArrowLeft')) moved.x -= step;
        if (input.isKeyPressed('ArrowRight')) moved.x += step;
        if (input.isKeyPressed('ArrowUp')) moved.y -= step;
        if (input.isKeyPressed('ArrowDown')) moved.y += step;
        const overUi = input.isPointerOverUI();
        if (input.mouseX !== lastMouse.x || input.mouseY !== lastMouse.y) {
            lastMouse = { x: input.mouseX, y: input.mouseY };
            const ray = overUi ? null : view.pointerRay(input.mouseX, input.mouseY);
            const hit = ray === null ? null : rayPlaneHit(ray, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
            if (hit !== null) {
                const cell = cellOfWorld(hit.x / UNITS, hit.z / UNITS);
                if (inBounds(cell)) { moved.x = cell.x; moved.y = cell.y; }
            }
        }
        cursor = { x: Math.min(GRID_WIDTH - 1, Math.max(0, moved.x)), y: Math.min(GRID_HEIGHT - 1, Math.max(0, moved.y)) };

        if (input.isKeyPressed('Digit1')) choose('mine');
        if (input.isKeyPressed('Digit2')) choose('store');
        if (input.isKeyPressed('Digit3') || input.isKeyPressed('Escape')) choose('select');
        if (input.isKeyPressed('Digit4')) choose('remove');
        if (input.isKeyPressed('Enter') || (!overUi && input.isMouseButtonPressed(0))) primary(world);
        if (input.isKeyPressed('Backspace') || (!overUi && input.isMouseButtonPressed(2))) remove(world);
        if (input.isKeyPressed('KeyR')) repair();
        if (input.isKeyPressed('KeyK')) save();
        if (input.isKeyPressed('KeyL')) load(world);
        if (input.isKeyPressed('KeyN')) { saves.remove(SLOT); adopt(world, createState()); say('New game.'); }
        if (input.isKeyPressed('KeyC')) {
            lowView = !lowView;
            facts.lowView = lowView;
        }
        const pan = 0.9 * rig.distance * time.delta;
        if (input.isKeyDown('KeyW')) rig.z -= pan;
        if (input.isKeyDown('KeyS')) rig.z += pan;
        if (input.isKeyDown('KeyA')) rig.x -= pan;
        if (input.isKeyDown('KeyD')) rig.x += pan;
        const zoom = (input.isKeyDown('KeyX') ? 1 : 0) - (input.isKeyDown('KeyZ') ? 1 : 0) + input.getScrollDelta().y * 0.02;
        rig.distance = Math.min(70, Math.max(8, rig.distance * (1 + zoom * 1.2 * time.delta)));
        const span = GRID_WIDTH * CELL_SIZE / 2;
        rig.x = Math.min(span, Math.max(-span, rig.x));
        rig.z = Math.min(span, Math.max(-span, rig.z));
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
        if (input.isKeyPressed('KeyP')) throw new Error('last-signal probe: a script error raised on purpose');

        if (input.isKeyPressed('KeyT')) speed(world);
        if (input.isKeyPressed('KeyH')) {
            const data = world.get(clock!, TimeOfDay);
            const held = data.daySeconds !== 0;
            world.insert(clock!, TimeOfDay, { ...data, daySeconds: held ? 0 : DAY_SECONDS.normal });
            facts.held = held;
            facts.fast = false;
        }
        const nudge = (input.isKeyPressed('BracketRight') ? 0.5 : 0) - (input.isKeyPressed('BracketLeft') ? 0.5 : 0);
        if (nudge !== 0) {
            const now = world.get(clock!, TimeOfDay);
            world.insert(clock!, TimeOfDay, { ...now, hour: ((now.hour + nudge) % DAY_HOURS + DAY_HOURS) % DAY_HOURS });
        }
        state.hour = world.get(clock!, TimeOfDay).hour;
        facts.hoursElapsed = (facts.hoursElapsed as number) + ((state.hour - lastHour) % DAY_HOURS + DAY_HOURS) % DAY_HOURS;
        lastHour = state.hour;

        const pose = world.get(body, Transform).position;
        state.drone.x = pose.x / UNITS;
        state.drone.z = pose.z / UNITS;
        const agent = world.get(body, NavAgent);
        if (agent.arrived && settleArrival(state)) {
            say(state.drone.leg === 'toStore' ? 'The drone loaded ore at the mine.' : `Ore delivered. The storehouse holds ${state.ore}.`);
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
        moveMark(world, droneMark!, standing.x, standing.y, 6);

        const activeId = target === null ? 0 : target.id;
        const blink = Math.floor(elapsed * 2.5) % 2 === 0;
        if (uplink >= 0 && uplink < 900) uplink += time.delta;
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
            const active = site.building.id === activeId;
            if (active !== site.active) {
                site.active = active;
                paint(world, site.mark, shade(glowColour(site.building.kind), active ? 1 : 0.6));
            }
            const lit = active && blink;
            if (lit !== site.lit) {
                site.lit = lit;
                site.model.colour(world, 'beacon', shade(glowColour(site.building.kind), lit ? 1 : 0.35));
            }
            if (active && site.building.kind === 'mine') site.model.turn(world, 'spinner', elapsed * 3);
        }

        const building = tool === 'mine' || tool === 'store' ? tool : null;
        const occupied = buildingAt(state, cursor);
        const showGhost = building !== null;
        const legal = whyNotPlace(state, cursor) === null;
        if (building !== ghostKind) {
            ghost?.despawn(world);
            ghost = building === null ? null : new Model(world, 'Ghost', building === 'mine' ? mineParts() : storeParts(), legal ? PALETTE.ok : PALETTE.blocked);
            ghostKind = building;
            ghostLegal = legal;
        }
        if (ghost !== null && legal !== ghostLegal) {
            ghost.colour(world, null, legal ? PALETTE.ok : PALETTE.blocked);
            ghostLegal = legal;
        }
        const cursorAt = worldOfCell(cursor);
        if (ghost !== null) ghost.pose(world, cursorAt.x, cursorAt.z, showGhost ? 0 : HIDDEN);
        cursorRing!.pose(world, cursorAt.x, cursorAt.z, 0);
        const red = tool === 'remove' ? occupied !== null : building !== null && !legal;
        if (red !== cursorRed) {
            cursorRing!.colour(world, null, red ? PALETTE.blocked : PALETTE.cursor);
            cursorRed = red;
        }
        if (showGhost) {
            moveMark(world, ghostMark!, cursor.x, cursor.y, MAP.cell);
            paint(world, ghostMark!, legal ? PALETTE.ok : PALETTE.blocked);
        } else {
            moveTo(world, ghostMark!, -20, -20);
        }

        const chosen = selected === 0 ? undefined : sites.get(selected);
        if (chosen === undefined) {
            selectRing!.pose(world, 0, 0, HIDDEN);
            for (const mark of selectMarks) moveTo(world, mark, -20, -20);
        } else {
            const at = worldOfCell(chosen.building);
            selectRing!.pose(world, at.x, at.z, 0.02 + (Math.sin(elapsed * 4) + 1) * 0.03);
            const left = MAP.left + chosen.building.x * MAP.cell - 3, top = MAP.top + chosen.building.y * MAP.cell - 3;
            moveTo(world, selectMarks[0]!, left, top);
            moveTo(world, selectMarks[1]!, left, top + 9);
            moveTo(world, selectMarks[2]!, left, top);
            moveTo(world, selectMarks[3]!, left + 9, top);
        }
        moveTo(world, toolMark!, TOOLBAR.left + TOOLS.findIndex((entry) => entry.tool === tool) * (TOOLBAR.width + TOOLBAR.gap), TOOLBAR.top + 40);

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
        facts.cursorX = cursor.x;
        facts.cursorY = cursor.y;
        facts.cursorWalkable = grid.isWalkable(cursor.x, cursor.y);
        facts.tool = tool;
        facts.notice = notice;
        facts.selected = selected;
        facts.ghostLegal = legal;
        facts.active = activeId;
        facts.signal = state.signal;
        facts.canRepair = whyNotRepair(state) === null;
        facts.uplink = uplink;

        const online = state.signal === 'online';
        const showVictory = online && uplink >= 5 && !acknowledged;
        if (showVictory !== victoryShown) {
            victoryShown = showVictory;
            const tops = showVictory ? [0, 250, 322, 384, 384] : [-2000, -2000, -2000, -2000, -2000];
            victory.forEach((entity, i) => {
                const node = world.get(entity, UINode);
                node.insetTop = px(tops[i]!);
                world.insert(entity, UINode, node);
            });
            if (showVictory) write(world, victory[2]!, `The tower is repaired and the signal is out. ${state.trips} trips, ${state.ore} ore left in store.`);
        }
        facts.victory = showVictory;
        const held = Math.min(state.ore, REPAIR_COST);
        const button = world.get(repairEntity!, UINode);
        const buttonTop = online ? -2000 : repairTop;
        if (button.insetTop.value !== buttonTop) { button.insetTop = px(buttonTop); world.insert(repairEntity!, UINode, button); }
        write(world, objectiveTitle!, online ? 'LAST SIGNAL   /   SIGNAL ONLINE' : 'LAST SIGNAL   /   SIGNAL OFFLINE');
        write(world, objective!, online ? 'THE SIGNAL IS OUT' : 'REPAIR THE COMMUNICATION TOWER');
        write(world, objectiveCount!, online ? 'TRANSMITTING' : `${held} / ${REPAIR_COST} ORE`);
        write(world, objectiveHint!, online ? 'The base is yours to keep running.'
            : state.ore >= REPAIR_COST ? 'Enough ore in store. Press REPAIR TOWER.' : 'Deliver ore to the storehouse\nto restore the signal.');
        sizeTo(world, objectiveFill!, online ? 150 : Math.max(1, 150 * held / REPAIR_COST));
        const fill = online || state.ore >= REPAIR_COST ? PALETTE.online : PALETTE.offline;
        if (facts.fillColour !== fill.r) { paint(world, objectiveFill!, fill); facts.fillColour = fill.r; }

        const hours = Math.floor(state.hour);
        const minutes = Math.floor((state.hour - hours) * 60);
        write(world, hud!, `ORE ${state.ore}    TRIPS ${state.trips}    ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}${facts.fast ? '  >>' : facts.held ? '  ||' : ''}\n`
            + `DRONE ${state.drone.cargo > 0 ? `hauling ${state.drone.cargo} ore to store` : 'flying to the mine'}${facts.route === 'complete' ? '' : `  (route ${String(facts.route)})`}`);
        write(world, noticeText!, notice);
        if (chosen !== undefined) {
            const b = chosen.building;
            const status = b.kind === 'tower' ? (online ? 'Transmitting.' : 'Silent. Its uplink is damaged.')
                : b.id === activeId ? (b.kind === 'mine' ? 'The drone is on its way to load.' : 'The drone is on its way to unload.') : 'Idle.';
            const detail = b.kind === 'tower' ? (online ? 'The signal is out.' : `Repair: ${REPAIR_COST} ore. In store: ${state.ore}.\n\nPress R or REPAIR TOWER.`)
                : (b.kind === 'mine' ? `Loads handed to the drone: ${b.served}` : `Deliveries received: ${b.served}`) + '\n\nBackspace removes it.';
            write(world, info!, `${kindName(b.kind).toUpperCase()}  #${b.id}\nCell ${b.x}, ${b.y}\n${status}\n${detail}`);
        } else {
            write(world, info!, tool === 'select' ? 'SELECT\nClick a building to see what it is doing.'
                : tool === 'remove' ? 'REMOVE\nClick a building to take it down.\nThe drone re-plans around what is left.'
                    : `${kindName(tool).toUpperCase()}\nGreen outline: the cell is free.\nRed: a building or the drone is there.\nClick to build. The drone flies around it.\n\nWASD move the view, wheel or Z/X zoom.`);
        }
    }, { name: 'LastSignalPlay', runAfter: ['NavAgentSystem'] }));
} });
