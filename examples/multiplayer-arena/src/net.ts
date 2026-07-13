import {
    defineSystem, Res, GetWorld,
    Time, Input, Net, Replicated, Transform, Sprite,
    type World, type Entity, type InputState,
} from 'esengine';
import { Pawn } from './components';

// Arena bounds the movement rule clamps pawns to (matches the scene's walls).
const BOUND_X = 420;
const BOUND_Y = 278;

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

function spawnPawn(world: World, player: number): void {
    const slot = PLAYER_COLORS[player % PLAYER_COLORS.length];
    const e = world.spawn(`Pawn P${player + 1}`);
    world.insert(e, Transform, { position: { x: -150 + player * 100, y: -180, z: 0 } });
    world.insert(e, Sprite, { size: { x: 36, y: 36 }, color: slot, layer: 2 });
    world.insert(e, Pawn, { player });
    // Marking it Replicated is ALL it takes: the entity spawns on every client
    // (full component payload — sprite color included), its annotated Transform
    // pose streams as deltas, and `owner` routes that connection's input to it.
    // Owner is assigned AT spawn — ownership rides the spawn payload.
    world.insert(e, Replicated, { owner: player });
}

/**
 * Authority-side player provisioning: the host pawn always exists (so plain
 * single-player Play works too), and each handshaken client connection gets a
 * pawn. Stateless — derives what exists from the World each tick.
 */
export const provisionPawnsSystem = defineSystem(
    [GetWorld(), Res(Net)],
    (world, net) => {
        if (net.role === 'client') return;
        const have = new Set<number>();
        for (const e of world.getEntitiesWithComponents([Pawn])) {
            have.add((world.tryGet(e, Pawn) as { player: number }).player);
        }
        if (!have.has(0)) spawnPawn(world, 0);
        if (net.server) {
            for (const id of net.server.clientIds) {
                if (!have.has(id)) spawnPawn(world, id);
            }
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
            const actions = repl.owner === 0
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
