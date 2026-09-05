import {
    defineSystem, Res, GetWorld,
    Time, Input, Net, Replicated, Transform, Sprite,
    registerReplicationArchetype,
    type World, type Entity, type InputState,
} from 'esengine';
import { Pawn } from './components';

// Arena bounds the movement rule clamps pawns to (matches the scene's walls).
const BOUND_X = 420;
const BOUND_Y = 278;

/** The player id of whoever sits at THIS machine's keyboard. Connection ids the
 *  server hands out start at 1, so 0 is never a remote player. */
const HOST_PLAYER = 0;

/**
 * The one thing a listen server and a dedicated server disagree about. The
 * editor preview (and offline Play) hosts player 0 on the local keyboard; a
 * dedicated server has none, sets `hostPlays = false` at startup, and owns no
 * pawn. Nothing else in this file can tell the deployments apart.
 */
export const arena = {
    hostPlays: true,
};

const PLAYER_COLORS = [
    { r: 0.35, g: 0.85, b: 1.0, a: 1 },  // host — cyan
    { r: 1.0, g: 0.55, b: 0.35, a: 1 },  // player 2 — orange
    { r: 0.55, g: 1.0, b: 0.45, a: 1 },  // player 3 — green
    { r: 0.95, g: 0.5, b: 1.0, a: 1 },   // player 4 — violet
];

function readMove(input: InputState): { x: number; y: number } {
    let x = 0;
    let y = 0;
    if (input.isKeyDown('KeyW') || input.isKeyDown('ArrowUp')) y += 1;
    if (input.isKeyDown('KeyS') || input.isKeyDown('ArrowDown')) y -= 1;
    if (input.isKeyDown('KeyA') || input.isKeyDown('ArrowLeft')) x -= 1;
    if (input.isKeyDown('KeyD') || input.isKeyDown('ArrowRight')) x += 1;
    const len = Math.hypot(x, y);
    return len > 0 ? { x: x / len, y: y / len } : { x: 0, y: 0 };
}

/**
 * THE movement rule — one function, both ends. The server applies it with each
 * connection's per-tick input (`tickInputOf`); the client applies it as its
 * prediction function, so your own pawn responds the moment a key goes down
 * (the bounds clamp included — even the walls are predicted). Because both
 * ends run the same rule, reconciliation corrections are invisible in normal
 * play.
 */
function applyMove(world: World, entity: Entity, actions: Record<string, unknown>, dt: number): void {
    const move = actions.move as { x: number; y: number } | undefined;
    if (!move || (move.x === 0 && move.y === 0)) return;
    const pawn = world.tryGet(entity, Pawn);
    const transform = world.tryGet(entity, Transform);
    if (!pawn || !transform) return;
    const p = transform.position;
    p.x = Math.min(BOUND_X, Math.max(-BOUND_X, p.x + move.x * pawn.speed * dt));
    p.y = Math.min(BOUND_Y, Math.max(-BOUND_Y, p.y + move.y * pawn.speed * dt));
    world.set(entity, Transform, transform);
}

/**
 * What a pawn IS, in one place. The authority builds one with it and so does
 * every client, because it is registered as the ghost's construction contract:
 * a spawn carries identity and declared state, never a dump of the server's
 * components, so anything a proxy needs to exist has to be said here.
 */
function buildPawn(world: World, entity: Entity): void {
    world.insert(entity, Sprite, { size: { x: 36, y: 36 }, layer: 2 });
    // `speed` is a property of the archetype; `player` is authority-side
    // bookkeeping that provisioning reads and no client needs — ownership
    // reaches them as `Replicated.owner`.
    world.insert(entity, Pawn, {});
}
registerReplicationArchetype('pawn', buildPawn);

function spawnPawn(world: World, player: number): void {
    const e = world.spawn(`Pawn P${player + 1}`);
    world.insert(e, Transform, { position: { x: -150 + player * 100, y: -180, z: 0 } });
    buildPawn(world, e);
    world.update(e, Pawn, (d) => { (d as { player: number }).player = player; });
    // Marking it Replicated is ALL it takes: the entity spawns on every client
    // through the `pawn` archetype, its annotated Transform pose streams as
    // deltas, and `owner` — protocol identity, carried by the spawn itself —
    // routes that connection's input to it and colours it at both ends.
    world.insert(e, Replicated, { owner: player, archetype: 'pawn' });
}

/**
 * Colour from ownership, on whichever end is looking. The fact a client is given
 * is `owner`; the colour is derived from it by the same rule on both ends, so
 * the Sprite an archetype builds does not have to carry it.
 */
export const paintPawnsSystem = defineSystem(
    [GetWorld()],
    (world) => {
        for (const e of world.getEntitiesWithComponents([Pawn, Sprite, Replicated])) {
            const owner = (world.tryGet(e, Replicated) as { owner: number }).owner;
            const want = PLAYER_COLORS[owner % PLAYER_COLORS.length];
            const sprite = world.tryGet(e, Sprite) as { color: { r: number; g: number; b: number } };
            if (sprite.color.r === want.r && sprite.color.g === want.g && sprite.color.b === want.b) continue;
            world.update(e as Entity, Sprite, (d) => { (d as { color: unknown }).color = { ...want }; });
        }
    },
    { name: 'PaintPawnsSystem' },
);

/**
 * Authority-side provisioning, both directions: a player owed a pawn gets one,
 * a pawn whose player left is retired. Stateless — the roster is derived from
 * the World and the connection list each tick. Retirement only ever fires on a
 * real server; the preview's MessagePorts never drop, so it never ran there.
 */
export const provisionPawnsSystem = defineSystem(
    [GetWorld(), Res(Net)],
    (world, net) => {
        if (net.role === 'client') return;
        // Who is entitled to a pawn this tick.
        const live = new Set<number>();
        if (arena.hostPlays) live.add(HOST_PLAYER);
        for (const id of net.server?.clientIds ?? []) live.add(id);

        const have = new Set<number>();
        for (const e of world.getEntitiesWithComponents([Pawn])) {
            const player = (world.tryGet(e, Pawn) as { player: number }).player;
            if (!live.has(player)) {
                // Despawning the authority's entity is the whole retirement:
                // replication turns it into a despawn on every client that can
                // see it, and the ghost goes with it.
                world.despawn(e as Entity);
                continue;
            }
            have.add(player);
        }
        for (const player of live) {
            if (!have.has(player)) spawnPawn(world, player);
        }
    },
    { name: 'ProvisionPawnsSystem' },
);

/**
 * Authority-side movement: `applyMove` for everyone. The host pawn reads the
 * local keyboard; remote pawns consume their connection's input queue via
 * `tickInputOf` — exactly one command per tick, the contract the clients'
 * prediction replays against.
 */
export const movePawnsSystem = defineSystem(
    [GetWorld(), Res(Net), Res(Input), Res(Time)],
    (world, net, input, time) => {
        if (net.role === 'client') return;
        for (const e of world.getEntitiesWithComponents([Pawn, Replicated])) {
            const repl = world.tryGet(e, Replicated)!;
            const actions = repl.owner === HOST_PLAYER
                ? { move: readMove(input) }
                : (net.server?.tickInputOf(repl.owner)?.actions ?? {});
            applyMove(world as World, e as Entity, actions, time.fixedDelta);
        }
    },
    { name: 'MovePawnsSystem' },
);

/**
 * Client-side input uplink + prediction: one command per fixed tick (an idle
 * move counts — with prediction on, silence would mean "keep doing that").
 * The editor's multiplayer preview connects the client realm itself, so
 * prediction is enabled here, lazily, with the same `applyMove` the server
 * runs — your own pawn stops waiting for the round trip.
 */
export const sendInputSystem = defineSystem(
    [Res(Net), Res(Input)],
    (net, input) => {
        if (net.role !== 'client' || !net.client) return;
        if (!net.client.predictionEnabled) {
            // smoothing eases rare corrections out over ~80ms instead of
            // snapping (both ends run the same rule, so they stay rare).
            net.client.enablePrediction({ apply: applyMove, smoothing: { halfLife: 0.08 } });
        }
        net.client.sendInput({ move: readMove(input) });
    },
    { name: 'SendInputSystem' },
);
