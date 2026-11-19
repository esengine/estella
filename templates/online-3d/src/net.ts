import {
    defineSystem, Res, GetWorld, Time, Input, Transform, MeshRenderer, Camera, Assets,
    type World, type Entity, type InputState,
} from 'esengine';
// Replication is a subpath: a package that imports it carries the protocol, and one that does not carries none of it.
import { Net, Replicated, registerReplicationArchetype } from 'esengine/replication';
import { Pawn } from './components';
import { PAWN_HEIGHT, moveFromKeys, stepPosition, type Move } from './shared/rules';

/** The player id of whoever sits at THIS machine's keyboard when it also hosts. Connection ids a server hands out start at 1. */
const HOST_PLAYER = 0;

/**
 * The one thing a listen server and a dedicated server disagree about. The editor preview (and offline Play) hosts player 0 on the local
 * keyboard; a dedicated server has none, sets `hostPlays = false` at startup, and owns no pawn.
 */
export const online = { hostPlays: true };

/** The stock capsule every pawn is drawn as. A mesh is a handle, which has to be loaded; a pawn built before it is there is given it by `paintPawnsSystem`. */
let capsuleMesh = 0;
export const loadPawnMeshSystem = defineSystem(
    [Res(Assets)],
    (assets) => {
        // A headless process (the dedicated server) draws nothing and has no renderer to load a mesh into: nothing there needs the handle.
        assets.load<{ handle: number }>('mesh', 'builtin:capsule').then((m) => { capsuleMesh = m.handle; }, () => undefined);
    },
    { name: 'LoadPawnMeshSystem' },
);

const PLAYER_COLORS = [
    { r: 0.35, g: 0.85, b: 1.0, a: 1 },
    { r: 1.0, g: 0.55, b: 0.35, a: 1 },
    { r: 0.55, g: 1.0, b: 0.45, a: 1 },
    { r: 0.95, g: 0.5, b: 1.0, a: 1 },
];

function readMove(input: InputState): Move {
    return moveFromKeys(
        input.isKeyDown('KeyA') || input.isKeyDown('ArrowLeft'), input.isKeyDown('KeyD') || input.isKeyDown('ArrowRight'),
        input.isKeyDown('KeyW') || input.isKeyDown('ArrowUp'), input.isKeyDown('KeyS') || input.isKeyDown('ArrowDown'),
    );
}

/** THE movement rule, applied by the server per connection per tick and by the client as its prediction. */
function applyMove(world: World, entity: Entity, actions: Record<string, unknown>, dt: number): void {
    const move = actions.move as Move | undefined;
    if (!move || (move.x === 0 && move.z === 0)) return;
    const pawn = world.tryGet(entity, Pawn);
    const transform = world.tryGet(entity, Transform);
    if (!pawn || !transform) return;
    const next = stepPosition(transform.position.x, transform.position.z, move, pawn.speed, dt);
    transform.position.x = next.x;
    transform.position.z = next.z;
    world.set(entity, Transform, transform);
}

/**
 * What a pawn IS, in one place: the authority builds one with it and so does every client, because it is registered as the ghost's construction
 * contract. A spawn carries identity and declared state, never a dump of the server's components, so what a proxy needs to exist is said here.
 */
function buildPawn(world: World, entity: Entity): void {
    world.insert(entity, MeshRenderer, { mesh: capsuleMesh, lit: true, opaque: true, cullBackfaces: true });
    world.insert(entity, Pawn, {});
    if (world.tryGet(entity, Transform)) world.update(entity, Transform, (d) => { (d as { scale: unknown }).scale = { x: 1.6, y: 1.6, z: 1.6 }; });
}
registerReplicationArchetype('pawn', buildPawn);

function spawnPawn(world: World, player: number): void {
    const e = world.spawn(`Pawn P${player + 1}`);
    world.insert(e, Transform, { position: { x: -300 + player * 200, y: PAWN_HEIGHT, z: 300 } });
    buildPawn(world, e);
    world.update(e, Pawn, (d) => { (d as { player: number }).player = player; });
    // Marking it Replicated is all it takes: it spawns on every client through the archetype, its pose streams as deltas, and `owner` routes that
    // connection's input to it.
    world.insert(e, Replicated, { owner: player, archetype: 'pawn' });
}

/** Colour from ownership, on whichever end is looking: the client is given `owner`, and the colour is derived from it by the same rule everywhere. */
export const paintPawnsSystem = defineSystem(
    [GetWorld()],
    (world) => {
        for (const e of world.getEntitiesWithComponents([Pawn, MeshRenderer, Replicated])) {
            const owner = (world.tryGet(e, Replicated) as { owner: number }).owner;
            const want = PLAYER_COLORS[owner % PLAYER_COLORS.length]!;
            const mesh = world.tryGet(e, MeshRenderer) as { mesh: number; color: { r: number; g: number; b: number } };
            const painted = mesh.color.r === want.r && mesh.color.g === want.g && mesh.color.b === want.b;
            if (painted && (mesh.mesh === capsuleMesh || capsuleMesh === 0)) continue;
            world.update(e as Entity, MeshRenderer, (d) => { (d as { color: unknown; mesh: number }).color = { ...want }; (d as { mesh: number }).mesh = capsuleMesh; });
        }
    },
    { name: 'PaintPawnsSystem' },
);

/** Authority-side provisioning, both directions: a player owed a pawn gets one, and a pawn whose player left is retired. */
export const provisionPawnsSystem = defineSystem(
    [GetWorld(), Res(Net)],
    (world, net) => {
        if (net.role === 'client') return;
        const live = new Set<number>();
        if (online.hostPlays) live.add(HOST_PLAYER);
        // `presentIds`: connected players, plus any who dropped and are still waited for, so a reconnect finds its pawn.
        for (const id of net.server?.presentIds ?? []) live.add(id);

        const have = new Set<number>();
        for (const e of world.getEntitiesWithComponents([Pawn])) {
            const player = (world.tryGet(e, Pawn) as { player: number }).player;
            if (!live.has(player)) {
                // Despawning the authority's entity is the whole retirement: replication makes it a despawn on every client that sees it.
                world.despawn(e as Entity);
                continue;
            }
            have.add(player);
        }
        for (const player of live) if (!have.has(player)) spawnPawn(world, player);
    },
    { name: 'ProvisionPawnsSystem' },
);

/** Authority-side movement: the host pawn reads the local keyboard, the others consume their connection's input queue, one command per tick. */
export const movePawnsSystem = defineSystem(
    [GetWorld(), Res(Net), Res(Input), Res(Time)],
    (world, net, input, time) => {
        if (net.role === 'client') return;
        for (const e of world.getEntitiesWithComponents([Pawn, Replicated])) {
            const repl = world.tryGet(e, Replicated)!;
            const actions = repl.owner === HOST_PLAYER ? { move: readMove(input) } : (net.server?.tickInputOf(repl.owner)?.actions ?? {});
            applyMove(world as World, e as Entity, actions, time.fixedDelta);
        }
    },
    { name: 'MovePawnsSystem' },
);

/** Client-side input uplink and prediction: one command per fixed tick, an idle move included, with the same rule the server runs. */
export const sendInputSystem = defineSystem(
    [Res(Net), Res(Input)],
    (net, input) => {
        if (net.role !== 'client' || !net.client) return;
        if (!net.client.predictionEnabled) net.client.enablePrediction({ apply: applyMove, smoothing: { halfLife: 0.08 } });
        net.client.sendInput({ move: readMove(input) });
    },
    { name: 'SendInputSystem' },
);

/** The camera follows your own pawn: the one whose owner is this connection (or the host's, where this machine hosts). */
export const followOwnPawnSystem = defineSystem(
    [GetWorld(), Res(Net), Res(Time)],
    (world, net, time) => {
        const mine = net.role === 'client' ? net.client?.connectionId ?? 0 : (online.hostPlays ? HOST_PLAYER : -1);
        if (mine < 0 || (net.role === 'client' && mine === 0)) return;
        let target: { x: number; z: number } | null = null;
        for (const e of world.getEntitiesWithComponents([Pawn, Replicated])) {
            if ((world.tryGet(e, Replicated) as { owner: number }).owner !== mine) continue;
            target = (world.tryGet(e, Transform) as { position: { x: number; z: number } }).position;
            break;
        }
        if (!target) return;
        const t = Math.min(1, 5 * time.delta);
        for (const e of world.getEntitiesWithComponents([Camera, Transform])) {
            const p = (world.tryGet(e, Transform) as { position: { x: number; y: number; z: number } }).position;
            world.update(e as Entity, Transform, (d) => {
                const pos = (d as { position: { x: number; z: number } }).position;
                pos.x = p.x + (target!.x - p.x) * t;
                pos.z = p.z + (target!.z + 900 - p.z) * t;
            });
        }
    },
    { name: 'FollowOwnPawnSystem' },
);
