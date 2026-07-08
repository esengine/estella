import {
    defineSystem, Query, Mut, Res, GetWorld,
    Time, Input, Net, Replicated, Transform, Sprite,
    type World, type InputState,
} from 'esengine';
import { Pawn } from './components';

// Arena bounds the authority clamps pawns to (matches the scene's walls).
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

function spawnPawn(world: World, player: number): void {
    const slot = PLAYER_COLORS[player % PLAYER_COLORS.length];
    const e = world.spawn(`Pawn P${player + 1}`);
    world.insert(e, Transform, { position: { x: -150 + player * 100, y: -180, z: 0 } });
    world.insert(e, Sprite, { size: { x: 36, y: 36 }, color: slot, layer: 2 });
    world.insert(e, Pawn, { player });
    // Marking it Replicated is ALL it takes: the entity spawns on every client
    // (full component payload — sprite color included), its annotated Transform
    // pose streams as deltas, and `owner` routes that connection's input to it.
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
 * Authority-side movement: one rule for everyone. The host pawn reads the local
 * keyboard; remote pawns read their connection's uplinked input. Clients never
 * run this — their view of every pawn (their own included) is the replicated,
 * interpolated authoritative state.
 */
export const movePawnsSystem = defineSystem(
    [Query(Mut(Transform), Pawn, Replicated), Res(Net), Res(Input), Res(Time)],
    (query, net, input, time) => {
        if (net.role === 'client') return;
        for (const [, transform, pawn, repl] of query) {
            const move = repl.owner === 0
                ? readMove(input)
                : ((net.server?.inputOf(repl.owner)?.actions.move as { x: number; y: number } | undefined) ?? { x: 0, y: 0 });
            if (move.x === 0 && move.y === 0) continue;
            const p = transform.position;
            p.x = Math.min(BOUND_X, Math.max(-BOUND_X, p.x + move.x * pawn.speed * time.fixedDelta));
            p.y = Math.min(BOUND_Y, Math.max(-BOUND_Y, p.y + move.y * pawn.speed * time.fixedDelta));
        }
    },
    { name: 'MovePawnsSystem' },
);

/** Client-side input uplink: one command per fixed tick, keyboard → server. */
export const sendInputSystem = defineSystem(
    [Res(Net), Res(Input)],
    (net, input) => {
        if (net.role !== 'client') return;
        net.client?.sendInput({ move: readMove(input) });
    },
    { name: 'SendInputSystem' },
);
