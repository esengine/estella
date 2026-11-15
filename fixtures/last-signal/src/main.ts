import {
    addPlugin, defineSystem, Schedule, Res, GetWorld, Input, CameraView, Playthrough, SaveManager,
    Transform, MeshRenderer, TimeOfDay, Text, Name, UINode, spawnUIEntity, UIPositionType, px, rayPlaneHit,
    type World, type Entity,
} from 'esengine';
import { Nav, NavAgent, NavGrid, setNavDestination, stopNavAgent } from 'esengine/ai';
import {
    GRID_WIDTH, GRID_HEIGHT, CELL_SIZE, SAVE_VERSION, DAY_HOURS,
    createState, restore, snapshot, place, demolish, isWalkable, inBounds, buildingAt, droneCell,
    targetOf, nearestDock, settleArrival, worldOfCell, cellOfWorld,
    type GameState, type Building, type BuildingKind, type Cell, type Snapshot,
} from './state';

const UNITS = 100;
const SLOT = 'gate0';
const MAP = { left: 16, top: 16, cell: 4 };
const DAY_SECONDS = { normal: 240, fast: 24 };
const COLOURS = {
    mine: { r: 0.92, g: 0.5, b: 0.16, a: 1 },
    store: { r: 0.2, g: 0.55, b: 0.95, a: 1 },
    drone: { r: 1, g: 0.9, b: 0.2, a: 1 },
    cursor: { r: 1, g: 1, b: 1, a: 1 },
    panel: { r: 0.05, g: 0.07, b: 0.09, a: 0.85 },
    line: { r: 0.2, g: 0.25, b: 0.3, a: 1 },
    text: { r: 0.9, g: 0.92, b: 0.95, a: 1 },
};

const saves = new SaveManager({ version: SAVE_VERSION, keyPrefix: 'last-signal:' });

addPlugin({ name: 'last-signal-gate0', build(app) {
    const facts: Record<string, string | number | boolean> = {
        ready: false, restored: false, buildings: 0, blockedCells: 0, ore: 0, trips: 0, cargo: 0, leg: 'toMine',
        droneX: 0, droneY: 0, hour: 0, hoursElapsed: 0, fast: false, plans: 0, route: 'none', everInsideBuilding: false,
        cursorX: 0, cursorY: 0, cursorWalkable: true, tool: 'mine', saves: 0, loads: 0, notice: '', layout: '',
    };
    app.insertResource(Playthrough, { facts });

    let state: GameState = createState();
    let grid: NavGrid | null = null;
    let logic: Entity | null = null;
    let droneView: Entity | null = null;
    let droneMark: Entity | null = null;
    let cursorView: Entity | null = null;
    let hud: Entity | null = null;
    let canvas: Entity | null = null;
    let clock: Entity | null = null;
    let camera: Entity | null = null;
    let lowView = false;
    const buildingViews = new Map<number, Entity>();
    const buildingMarks = new Map<number, Entity>();
    let cursor: Cell = { x: 32, y: 30 };
    let tool: BuildingKind = 'mine';
    let dock: Cell | null = null;
    let dockFor = -1;
    let lastMouse = { x: -1, y: -1 };
    let lastHour = state.hour;
    let notice = 'Arrows or mouse move the cursor. Enter builds, Backspace removes.';

    const say = (text: string): void => { notice = text; };

    const cube = (world: World, name: string, colour: { r: number; g: number; b: number; a: number }, lit: boolean): Entity => {
        const entity = world.spawn(name);
        world.insert(entity, Transform, {});
        world.insert(entity, MeshRenderer, {
            mesh: 'builtin:cube' as unknown as number, lit, opaque: true, cullBackfaces: true, castShadows: lit, enabled: true, color: colour,
        });
        return entity;
    };

    const poseCube = (world: World, entity: Entity, x: number, z: number, size: { x: number; y: number; z: number }, lift: number): void => {
        const transform = world.get(entity, Transform);
        transform.position = { x: x * UNITS, y: lift * UNITS, z: z * UNITS };
        transform.scale = size;
        world.insert(entity, Transform, transform);
    };

    const mark = (world: World, name: string, colour: { r: number; g: number; b: number; a: number }, size: number): Entity => {
        const entity = spawnUIEntity({
            world, parent: canvas!,
            node: { position: UIPositionType.Absolute, insetLeft: px(0), insetTop: px(0), width: px(size), height: px(size) },
            visual: { color: colour },
        });
        world.insert(entity, Name, { value: name });
        return entity;
    };

    const moveMark = (world: World, entity: Entity, cellX: number, cellY: number, size: number): void => {
        const node = world.get(entity, UINode);
        const left = MAP.left + cellX * MAP.cell + (MAP.cell - size) / 2;
        const top = MAP.top + cellY * MAP.cell + (MAP.cell - size) / 2;
        if (node.insetLeft.value === left && node.insetTop.value === top) return;
        node.insetLeft = px(left);
        node.insetTop = px(top);
        world.insert(entity, UINode, node);
    };

    const showBuilding = (world: World, building: Building): void => {
        const at = worldOfCell(building);
        const view = cube(world, `Building ${building.id}`, COLOURS[building.kind], true);
        poseCube(world, view, at.x, at.z, { x: 1.6, y: building.kind === 'mine' ? 2.4 : 1.6, z: 1.6 }, building.kind === 'mine' ? 1.2 : 0.8);
        buildingViews.set(building.id, view);
        const marker = mark(world, `MapBuilding ${building.id}`, COLOURS[building.kind], MAP.cell);
        moveMark(world, marker, building.x, building.y, MAP.cell);
        buildingMarks.set(building.id, marker);
    };

    const hideBuilding = (world: World, id: number): void => {
        const view = buildingViews.get(id);
        const marker = buildingMarks.get(id);
        if (view !== undefined) world.despawn(view);
        if (marker !== undefined) world.despawn(marker);
        buildingViews.delete(id);
        buildingMarks.delete(id);
    };

    const countBlocked = (): number => {
        let blocked = 0;
        for (let y = 0; y < GRID_HEIGHT; y++) for (let x = 0; x < GRID_WIDTH; x++) if (!grid!.isWalkable(x, y)) blocked += 1;
        return blocked;
    };

    const groundPoint = (x: number, z: number): { x: number; y: number; z: number } => ({ x: x * UNITS, y: 0, z: z * UNITS });

    const adopt = (world: World, next: GameState): void => {
        for (const id of [...buildingViews.keys()]) hideBuilding(world, id);
        for (let y = 0; y < GRID_HEIGHT; y++) for (let x = 0; x < GRID_WIDTH; x++) grid!.setWalkable(x, y, true);
        state = next;
        for (const building of state.buildings) {
            grid!.setWalkable(building.x, building.y, false);
            showBuilding(world, building);
        }
        const transform = world.get(logic!, Transform);
        transform.position = groundPoint(state.drone.x, state.drone.z);
        world.insert(logic!, Transform, transform);
        stopNavAgent(world, logic!);
        dock = null;
        dockFor = -1;
        if (clock !== null) world.insert(clock, TimeOfDay, { ...world.get(clock, TimeOfDay), hour: state.hour });
        lastHour = state.hour;
        facts.blockedCells = countBlocked();
    };

    const build = (world: World): void => {
        const result = place(state, tool, cursor);
        if (!result.ok) { say(`Cannot build: ${result.reason}.`); return; }
        grid!.setWalkable(cursor.x, cursor.y, false);
        showBuilding(world, result.building);
        facts.blockedCells = countBlocked();
        say(`${tool === 'mine' ? 'Mine' : 'Storehouse'} built at ${cursor.x}, ${cursor.y}.`);
    };

    const remove = (world: World): void => {
        const gone = demolish(state, cursor);
        if (gone === null) { say('Nothing to remove here.'); return; }
        grid!.setWalkable(cursor.x, cursor.y, true);
        hideBuilding(world, gone.id);
        facts.blockedCells = countBlocked();
        say(`Building at ${cursor.x}, ${cursor.y} removed.`);
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

    app.addSystemToSchedule(Schedule.Startup, defineSystem([Res(Nav), GetWorld()], (nav, world) => {
        const origin = worldOfCell({ x: 0, y: 0 });
        grid = new NavGrid({ width: GRID_WIDTH, height: GRID_HEIGHT, cellSize: CELL_SIZE * UNITS, origin: { x: origin.x * UNITS, y: 0, z: origin.z * UNITS }, plane: 'xz' });
        nav.setSurface(grid);
        canvas = world.findEntityByName('Canvas');
        clock = world.findEntityByName('Clock');
        camera = world.findEntityByName('Camera');
        if (canvas === null || clock === null) throw new Error('the scene is missing its Canvas or its Clock');

        logic = world.spawn('DroneBody');
        world.insert(logic, Transform, { position: groundPoint(state.drone.x, state.drone.z) });
        world.insert(logic, NavAgent, NavAgent.create({ speed: 6 * UNITS, radius: 0.3 * UNITS, arriveRadius: 0.1 * UNITS, repathInterval: 0.5 }));

        droneView = cube(world, 'Drone', COLOURS.drone, true);
        cursorView = cube(world, 'Cursor', COLOURS.cursor, false);

        const panel = spawnUIEntity({
            world, parent: canvas,
            node: { position: UIPositionType.Absolute, insetLeft: px(MAP.left), insetTop: px(MAP.top), width: px(GRID_WIDTH * MAP.cell), height: px(GRID_HEIGHT * MAP.cell) },
            visual: { color: COLOURS.panel },
        });
        world.insert(panel, Name, { value: 'MapPanel' });
        for (let i = 8; i < GRID_WIDTH; i += 8) {
            spawnUIEntity({ world, parent: canvas, node: { position: UIPositionType.Absolute, insetLeft: px(MAP.left + i * MAP.cell), insetTop: px(MAP.top), width: px(1), height: px(GRID_HEIGHT * MAP.cell) }, visual: { color: COLOURS.line } });
            spawnUIEntity({ world, parent: canvas, node: { position: UIPositionType.Absolute, insetLeft: px(MAP.left), insetTop: px(MAP.top + i * MAP.cell), width: px(GRID_WIDTH * MAP.cell), height: px(1) }, visual: { color: COLOURS.line } });
        }
        droneMark = mark(world, 'MapDrone', COLOURS.drone, 6);
        hud = spawnUIEntity({
            world, parent: canvas,
            node: { position: UIPositionType.Absolute, insetLeft: px(MAP.left), insetTop: px(604), width: px(720), height: px(100) },
            text: { content: '', fontSize: 16, color: COLOURS.text, align: 0 },
        });
        world.insert(hud, Name, { value: 'Hud' });

        adopt(world, state);
        facts.restored = saves.has(SLOT) && load(world);
        world.insert(clock, TimeOfDay, { ...world.get(clock, TimeOfDay), daySeconds: DAY_SECONDS.normal });
        facts.ready = true;
    }, { name: 'LastSignalSetup' }));

    app.addSystem(defineSystem([Res(Nav), Res(Input), Res(CameraView), GetWorld()], (nav, input, view, world) => {
        if (grid === null || logic === null) return;

        const step = input.isKeyDown('ShiftLeft') || input.isKeyDown('ShiftRight') ? 8 : 1;
        const moved = { x: cursor.x, y: cursor.y };
        if (input.isKeyPressed('ArrowLeft')) moved.x -= step;
        if (input.isKeyPressed('ArrowRight')) moved.x += step;
        if (input.isKeyPressed('ArrowUp')) moved.y -= step;
        if (input.isKeyPressed('ArrowDown')) moved.y += step;
        if (input.mouseX !== lastMouse.x || input.mouseY !== lastMouse.y) {
            lastMouse = { x: input.mouseX, y: input.mouseY };
            const ray = input.isPointerOverUI() ? null : view.pointerRay(input.mouseX, input.mouseY);
            const hit = ray === null ? null : rayPlaneHit(ray, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
            if (hit !== null) {
                const cell = cellOfWorld(hit.x / UNITS, hit.z / UNITS);
                if (inBounds(cell)) { moved.x = cell.x; moved.y = cell.y; }
            }
        }
        cursor = { x: Math.min(GRID_WIDTH - 1, Math.max(0, moved.x)), y: Math.min(GRID_HEIGHT - 1, Math.max(0, moved.y)) };

        if (input.isKeyPressed('Digit1')) tool = 'mine';
        if (input.isKeyPressed('Digit2')) tool = 'store';
        const overUi = input.isPointerOverUI();
        if (input.isKeyPressed('Enter') || (!overUi && input.isMouseButtonPressed(0))) build(world);
        if (input.isKeyPressed('Backspace') || (!overUi && input.isMouseButtonPressed(2))) remove(world);
        if (input.isKeyPressed('KeyK')) save();
        if (input.isKeyPressed('KeyL')) load(world);
        if (input.isKeyPressed('KeyN')) { saves.remove(SLOT); adopt(world, createState()); say('New game.'); }
        if (input.isKeyPressed('KeyC') && camera !== null) {
            lowView = !lowView;
            const pose = world.get(camera, Transform);
            pose.position = lowView ? { x: 0, y: 400, z: 5200 } : { x: 0, y: 2800, z: 3400 };
            pose.rotation = lowView ? { x: -0.0262, y: 0, z: 0, w: 0.9997 } : { x: -0.3375, y: 0, z: 0, w: 0.9413 };
            world.insert(camera, Transform, pose);
        }
        if (input.isKeyPressed('KeyP')) throw new Error('last-signal probe: a script error raised on purpose');

        const clockData = world.get(clock!, TimeOfDay);
        if (input.isKeyPressed('KeyT')) {
            const fast = clockData.daySeconds !== DAY_SECONDS.fast;
            world.insert(clock!, TimeOfDay, { ...clockData, daySeconds: fast ? DAY_SECONDS.fast : DAY_SECONDS.normal });
            facts.fast = fast;
        }
        state.hour = clockData.hour;
        facts.hoursElapsed = (facts.hoursElapsed as number) + ((state.hour - lastHour) % DAY_HOURS + DAY_HOURS) % DAY_HOURS;
        lastHour = state.hour;

        const pose = world.get(logic, Transform).position;
        state.drone.x = pose.x / UNITS;
        state.drone.z = pose.z / UNITS;
        const agent = world.get(logic, NavAgent);
        if (agent.arrived && settleArrival(state)) { dock = null; dockFor = -1; }

        const target = targetOf(state);
        if (target === null) {
            if (agent.hasTarget) stopNavAgent(world, logic);
            dock = null;
            dockFor = -1;
            facts.route = 'none';
        } else {
            if (dockFor !== target.id || dock === null || !isWalkable(state, dock)) {
                dock = nearestDock(state, target);
                dockFor = target.id;
                if (dock === null) {
                    stopNavAgent(world, logic);
                } else {
                    const at = worldOfCell(dock);
                    setNavDestination(world, logic, groundPoint(at.x, at.z));
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

        poseCube(world, droneView!, state.drone.x, state.drone.z, { x: 0.8, y: 0.4, z: 0.8 }, 3);
        const cursorAt = worldOfCell(cursor);
        poseCube(world, cursorView!, cursorAt.x, cursorAt.z, { x: 1.9, y: 0.04, z: 1.9 }, 0.03);
        moveMark(world, droneMark!, standing.x, standing.y, 6);

        facts.buildings = state.buildings.length;
        facts.layout = state.buildings.map((b) => `${b.id}:${b.kind}:${b.x}:${b.y}`).join(';');
        facts.ore = state.ore;
        facts.trips = state.trips;
        facts.cargo = state.drone.cargo;
        facts.leg = state.drone.leg;
        facts.droneX = standing.x;
        facts.droneY = standing.y;
        facts.hour = state.hour;
        facts.plans = nav.planningStats.completed;
        facts.cursorX = cursor.x;
        facts.cursorY = cursor.y;
        facts.cursorWalkable = grid.isWalkable(cursor.x, cursor.y);
        facts.tool = tool;
        facts.notice = notice;

        const hours = Math.floor(state.hour);
        const minutes = Math.floor((state.hour - hours) * 60);
        const content = `ORE ${state.ore}   TRIPS ${state.trips}   CARGO ${state.drone.cargo}   ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}${facts.fast ? '  (fast)' : ''}\n`
            + `TOOL ${tool === 'mine' ? '1 MINE' : '2 STOREHOUSE'}   CURSOR ${cursor.x}, ${cursor.y}   ROUTE ${String(facts.route)}\n`
            + `${notice}\n1/2 tool   Enter build   Backspace remove   T time   C view   K save   L load   N new`;
        const text = world.get(hud!, Text);
        if (text.content !== content) world.insert(hud!, Text, { ...text, content });
    }, { name: 'LastSignalPlay', runAfter: ['NavAgentSystem'] }));
} });
