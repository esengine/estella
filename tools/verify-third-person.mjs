// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  verify-third-person.mjs — what the character DOES, in a packaged game.
 *
 * The gameplay unit criteria hold the ownership: input becomes a request, the
 * character controller answers it, the answer reaches the animator. What they
 * cannot say is whether the answer is right — whether a ramp is climbed, a step
 * is crossed, a wall stops it — because that is Jolt's answer and not the
 * controller's. So this drives the real package: real Physics3D, real
 * CharacterController3D, real Animator over TimelineMotion, real skin.
 *
 * Input goes in as key and mouse events on the page, and the only thing read
 * back is `__estellaCooked` — an observation seam, not a second way to play.
 * Lanes run in -Z, so a run strafes to one and then walks it.
 *
 * The scene is `gym`, and it is a FIXTURE: its coordinates, sizes and materials
 * answer to these claims and to nothing else. The project's entry scene is a
 * level, and a level moves when it is being designed — a bridge widened there
 * must not read here as a physics regression.
 */
import { spawnSync } from 'node:child_process';
import { rmSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runElectron } from './lib/electronRun.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORK = path.join(ROOT, '.golden', 'third-person');
const PROJECT = path.join(ROOT, 'examples', 'third-person-3d');
const LAUNCHER = path.join(ROOT, 'tools', 'launchers', 'launch-export.mjs');

const W = 960, H = 640;
/** Frames of strafe per lane: the character covers moveSpeed/60 a frame. */
const TO_LANE = { wall: 75, step: 75, highStep: 150 };

function packageGame() {
    rmSync(WORK, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    mkdirSync(WORK, { recursive: true });
    const out = path.join(WORK, 'web');
    const r = spawnSync(process.execPath, [
        path.join(ROOT, 'pipeline', 'bin', 'estella.mjs'), 'export', PROJECT,
        '--platform', 'web', '--out', out,
    ], { encoding: 'utf8', cwd: ROOT });
    if (r.status !== 0) {
        console.error('✗ third-person: the package did not build');
        for (const l of `${r.stderr ?? ''}${r.stdout ?? ''}`.split('\n').slice(-8)) {
            if (l.trim()) console.error(`    ${l}`);
        }
        process.exit(1);
    }
    return out;
}

/** The JSON a launcher printed after `label:`, or null when it printed none. */
function reading(stdout, label) {
    const line = (stdout || '').split('\n').find((l) => l.includes(`${label}:`));
    if (!line) return null;
    try {
        return JSON.parse(line.slice(line.indexOf('{')));
    } catch {
        return null;
    }
}

/**
 * Drive the package with one gesture and read what the character became.
 *
 * `scene` picks the fixture: `gym` answers to what a character DOES, `arena` to
 * what an autonomous one decides. Two, because a target one criterion needs
 * standing somewhere answers another's question — a solid one already did.
 */
function run(dir, input, scene = 'gym') {
    const r = runElectron([
        LAUNCHER, '--dir', dir, '--w', String(W), '--h', String(H),
        '--settle', '30', '--timeout', '60000', '--scene', scene,
        '--input', JSON.stringify(input), '--gameplay', 'Player,Camera',
        '--particles', 'FootDust,HitSpark',
        '--combat', 'Player:DummyA,DummyB,Player,Enemy',
        '--ai', 'Enemy',
        '--out', path.join(WORK, 'frame.png'),
    ], { encoding: 'utf8', cwd: ROOT });
    const seen = reading(r.stdout, 'gameplay');
    if (!seen) {
        return { error: `no reading — ${(r.stdout || r.stderr || '').trim().slice(-200)}` };
    }
    // The far end of the effect chain, beside what the character became: the
    // reading is one launch, so asking twice would be two different games.
    seen.particles = reading(r.stdout, 'particles') ?? {};
    seen.combat = reading(r.stdout, 'combat') ?? { attack: null, targets: {} };
    seen.ai = reading(r.stdout, 'ai') ?? { found: false };
    return seen;
}

/** Press the attack key at `at`, for the three frames a press needs to be seen. */
const ATTACK = (at) => ({ key: 'KeyJ', from: at, to: at + 3 });
/** What each named target has left, and what the swing has done. */
const health = (r, name) => r.combat?.targets?.[name]?.health;
const swing = (r) => r.combat?.attack ?? {};

/**
 * Walk a lane: strafe to it over `strafe` frames, then hold forward to the end.
 * Forward is never RELEASED - a wall claim is about the stick still being full,
 * and a reading taken after the key came up says nothing about it.
 */
const walkLane = (strafe, key, forward = 150) => ({
    holds: [
        ...(strafe ? [{ key, from: 0, to: strafe }] : []),
        { key: 'KeyW', from: strafe, to: strafe + forward + 1 },
    ],
    frames: strafe + forward,
});

/** Strafe to a lane and stand there, so the eye is read where the lane put it. */
const standIn = (strafe, key) => ({
    holds: [{ key, from: 0, to: strafe }],
    frames: strafe + 40,
});

const results = [];
function check(what, ok, detail) {
    results.push({ what, ok, detail });
    console.log(`${ok ? '✓' : '✗'} ${what}${detail ? ` — ${detail}` : ''}`);
}

const dir = packageGame();
const START = { y: 60, z: 120 };

// 1. Flat locomotion: still, moving, and still again.
{
    const idle = run(dir, { frames: 40 });
    check('starts idle on the floor',
          idle.animator?.state === 'Idle' && idle.grounded === true
          && (idle.animator?.speed ?? -1) === 0,
          `state ${idle.animator?.state}, speed ${idle.animator?.speed}, grounded ${idle.grounded}`);

    const moving = run(dir, { keys: ['KeyW'], frames: 90 });
    const travelled = START.z - (moving.position?.z ?? START.z);
    check('walking moves the character and the animator follows',
          travelled > 200 && (moving.animator?.speed ?? 0) > 100
          && moving.animator?.state === 'Locomotion',
          `travelled ${travelled.toFixed(0)}, speed ${moving.animator?.speed?.toFixed(0)}, state ${moving.animator?.state}`);

    const released = run(dir, { holds: [{ key: 'KeyW', from: 0, to: 60 }], frames: 160 });
    check('releasing returns it to idle',
          Math.abs(released.realVelocity?.z ?? 99) < 5 && (released.animator?.speed ?? 99) === 0
          && released.animator?.state === 'Idle',
          `realVz ${released.realVelocity?.z?.toFixed(1)}, speed ${released.animator?.speed}, state ${released.animator?.state}`);
}

// 2. A wall: the stick is full and the world gives nothing.
{
    const at = run(dir, walkLane(TO_LANE.wall, 'KeyD'));
    const asked = Math.hypot(at.askedVelocity?.x ?? 0, at.askedVelocity?.z ?? 0);
    const real = Math.hypot(at.realVelocity?.x ?? 0, at.realVelocity?.z ?? 0);
    check('a wall stops it while the stick is still full',
          asked > 100 && real < 20 && (at.position?.z ?? -999) > -520,
          `asked ${asked.toFixed(0)}, real ${real.toFixed(0)}, z ${at.position?.z?.toFixed(0)}`);
    check('and the animator says standing still',
          (at.animator?.speed ?? 99) === 0,
          `speed ${at.animator?.speed}`);
}

// 3. A walkable ramp: it goes UP.
{
    const at = run(dir, { keys: ['KeyW'], frames: 150 });
    const climbed = (at.position?.y ?? 0) - START.y;
    check('a walkable ramp is climbed',
          climbed > 40 && at.grounded === true,
          `climbed ${climbed.toFixed(0)}, grounded ${at.grounded}`);
}

// 4/5. A step it can climb, and one it cannot. The pair is the claim: reaching
// the far side of a low step is also what walking on flat ground looks like.
{
    const low = run(dir, walkLane(TO_LANE.step, 'KeyA'));
    const raised = (low.position?.y ?? 0) - START.y;
    check('a step inside stepHeight is crossed',
          raised > 20 && low.grounded === true,
          `raised ${raised.toFixed(0)}, z ${low.position?.z?.toFixed(0)}`);

    const high = run(dir, walkLane(TO_LANE.highStep, 'KeyA'));
    const lifted = (high.position?.y ?? 0) - START.y;
    check('a step above it is not',
          lifted < 20,
          `lifted ${lifted.toFixed(0)}, z ${high.position?.z?.toFixed(0)}`);
}

// 6. The jump as an arc rather than an outcome: landing on the far side of
// something is also what walking there looks like. Leaves the ground, gets high
// enough to be worth having, comes back, and travels while it is up there.
{
    const APEX_MIN = 80;
    const rising = run(dir, { holds: [{ key: 'Space', from: 0, to: 3 }], frames: 20 });
    const airborne = (rising.position?.y ?? 0) - START.y;
    check('a jump leaves the ground',
          airborne > 30 && rising.grounded === false,
          `rose ${airborne.toFixed(0)}, grounded ${rising.grounded}`);

    const apex = run(dir, { holds: [{ key: 'Space', from: 0, to: 3 }], frames: 40 });
    const height = (apex.position?.y ?? 0) - START.y;
    check('and reaches an apex worth having',
          height > APEX_MIN, `apex ${height.toFixed(0)} (needs > ${APEX_MIN})`);

    const landed = run(dir, { holds: [{ key: 'Space', from: 0, to: 3 }], frames: 140 });
    const settled = (landed.position?.y ?? 0) - START.y;
    check('and comes back down to the floor it left',
          Math.abs(settled) < 4 && landed.grounded === true,
          `settled ${settled.toFixed(1)}, grounded ${landed.grounded}`);

    // Authority in the air is partial by design (airControl), so the claim is
    // that the run CONTINUES through the arc, not that it is unchanged.
    const jumped = run(dir, {
        holds: [{ key: 'KeyW', from: 0, to: 90 }, { key: 'Space', from: 20, to: 23 }],
        frames: 90,
    });
    const walked = run(dir, { holds: [{ key: 'KeyW', from: 0, to: 90 }], frames: 90 });
    const jumpedDz = START.z - (jumped.position?.z ?? START.z);
    const walkedDz = START.z - (walked.position?.z ?? START.z);
    check('and keeps travelling while it is off the ground',
          jumpedDz > walkedDz * 0.5, `jumped ${jumpedDz.toFixed(0)} vs walked ${walkedDz.toFixed(0)}`);

    // The step it cannot walk over, it can jump onto: the pair above says the
    // 90-unit step stops a walk, so arriving on top of it is the jump's doing.
    const onto = run(dir, {
        holds: [
            { key: 'KeyA', from: 0, to: TO_LANE.highStep },
            { key: 'KeyW', from: TO_LANE.highStep, to: TO_LANE.highStep + 150 },
            { key: 'Space', from: TO_LANE.highStep + 88, to: TO_LANE.highStep + 91 },
        ],
        frames: TO_LANE.highStep + 150,
    });
    const stood = (onto.position?.y ?? 0) - START.y;
    check('a step too tall to walk over can be jumped onto',
          stood > 40 && onto.grounded === true,
          `stood ${stood.toFixed(0)}, grounded ${onto.grounded}`);
}

// 7. Camera-relative movement, turned by a real mouse drag.
{
    const straight = run(dir, { keys: ['KeyW'], frames: 90 });
    // sensitivity 0.2 deg/px over a 960-wide surface: 450 px is a quarter turn.
    const turned = run(dir, {
        drags: [{ from: 0, to: 20, x: 0.7, y: 0.5, toX: 0.7 - 450 / W, toY: 0.5 }],
        holds: [{ key: 'KeyW', from: 25, to: 115 }],
        frames: 125,
    });
    const straightDz = Math.abs(START.z - (straight.position?.z ?? START.z));
    const straightDx = Math.abs(straight.position?.x ?? 0);
    const turnedDx = Math.abs(turned.position?.x ?? 0);
    const turnedDz = Math.abs(START.z - (turned.position?.z ?? START.z));
    check('forward is along -Z with the camera behind',
          straightDz > 200 && straightDx < 40, `dz ${straightDz.toFixed(0)}, dx ${straightDx.toFixed(0)}`);
    check('turning the camera turns what forward means',
          turnedDx > 150 && turnedDx > turnedDz,
          `dx ${turnedDx.toFixed(0)}, dz ${turnedDz.toFixed(0)}`);
}

// 8. Camera obstruction, against the same wall the character cannot pass.
{
    const open = run(dir, { frames: 40 });
    const against = run(dir, standIn(TO_LANE.wall, 'KeyD'));
    check('the eye sits back when nothing is in the way',
          (open.cameraDistance ?? 0) > 400, `distance ${open.cameraDistance?.toFixed(0)}`);
    check('and pulls in when the wall is behind the character',
          (against.cameraDistance ?? 999) < (open.cameraDistance ?? 0) - 40,
          `distance ${against.cameraDistance?.toFixed(0)} vs ${open.cameraDistance?.toFixed(0)}`);
}

// 9. The footstep the WALK CLIP declares, reaching the effect that answers it.
// The emitter starts nothing itself, so a live particle means clip → animator →
// event → the project's system. Standing still is the other half of the pair.
{
    const still = run(dir, { frames: 60 });
    check('standing still throws up no dust',
          (still.particles?.FootDust ?? -1) === 0,
          `alive ${still.particles?.FootDust}`);

    const running = run(dir, { keys: ['KeyW'], frames: 90 });
    check('a footstep the clip declares reaches the effect that answers it',
          (running.particles?.FootDust ?? 0) > 0,
          `alive ${running.particles?.FootDust}, state ${running.animator?.state}`);
}

// 10. A dodge: an action whose MOVEMENT is the animation's. The stick is never
// touched, so anything that happens is the clip's doing — and the wall says the
// difference between what it asked for and what it got.
{
    const dodgeFrom = (holds, frames) => run(dir, { holds, frames });
    const DODGE = (at) => ({ key: 'ShiftLeft', from: at, to: at + 3 });

    const still = run(dir, { frames: 45 });
    const dodged = dodgeFrom([DODGE(5)], 45);
    const stillZ = still.position?.z ?? 0;
    const travelled = stillZ - (dodged.position?.z ?? stillZ);
    check('a dodge moves the character with no stick at all',
          travelled > 200,
          `travelled ${travelled.toFixed(0)} against a standing ${stillZ.toFixed(0)}`);

    const during = dodgeFrom([DODGE(5)], 20);
    const asked = Math.hypot(during.askedVelocity?.x ?? 0, during.askedVelocity?.z ?? 0);
    const real = Math.hypot(during.realVelocity?.x ?? 0, during.realVelocity?.z ?? 0);
    check('and while it runs, the animation is what the controller was asked for',
          during.animator?.state === 'Dodge' && asked > 400 && real > 200,
          `state ${during.animator?.state}, asked ${asked.toFixed(0)}, real ${real.toFixed(0)}`);

    // The same gesture against the wall the walk cannot pass. The request is the
    // clip's either way; only the world's answer differs.
    const held = dodgeFrom([
        { key: 'KeyD', from: 0, to: TO_LANE.wall },
        { key: 'KeyW', from: TO_LANE.wall, to: TO_LANE.wall + 160 },
        DODGE(TO_LANE.wall + 145),
    ], TO_LANE.wall + 160);
    const wallAsked = Math.hypot(held.askedVelocity?.x ?? 0, held.askedVelocity?.z ?? 0);
    const wallReal = Math.hypot(held.realVelocity?.x ?? 0, held.realVelocity?.z ?? 0);
    check('a dodge into a wall asks for the whole distance and is given none',
          held.animator?.state === 'Dodge' && wallAsked > 400
          && wallReal < 60 && (held.position?.z ?? -999) > -520,
          `state ${held.animator?.state}, asked ${wallAsked.toFixed(0)},`
          + ` real ${wallReal.toFixed(0)}, z ${held.position?.z?.toFixed(0)}`);
}

// 11. A swing: the animation decides WHEN, physics decides WHO, gameplay decides
// what that does. Every reading is taken while the swing is still live, so the
// attack instance itself is visible rather than inferred from the aftermath.
{
    // The clip's `hit` beats sit at 0.45s and 0.60s of a 1s attack; a press at
    // frame 5 puts them around frames 32 and 41 at the rate this harness runs.
    const attacking = (extra = [], frames = 50) =>
        run(dir, { holds: [ATTACK(5), ...extra], frames });

    // C — before the animation says it connects, nothing has happened yet.
    const early = attacking([], 17);
    check('a swing that has not connected yet has taken nothing off',
          swing(early).state === 'Attack1' && swing(early).hitCount === 0
          && health(early, 'DummyA') === 100,
          `state ${swing(early).state}, hits ${swing(early).hitCount},`
          + ` A ${health(early, 'DummyA')}`);

    // B + E — past the beat: the one beside the swing loses health, the one on
    // the other side of the character does not.
    const landed = attacking();
    check('and past it, the target the swing reached loses exactly one blow',
          swing(landed).hitCount === 1 && health(landed, 'DummyA') === 75,
          `hits ${swing(landed).hitCount}, A ${health(landed, 'DummyA')}`);
    // The mirror of A through the character's forward axis, and a hit volume
    // rather than an obstacle — a target that stood in the lanes would answer
    // the locomotion criteria instead of this one.
    check('while its mirror on the other side stays untouched',
          health(landed, 'DummyB') === 100 && health(landed, 'Player') === 100,
          `B ${health(landed, 'DummyB')}, self ${health(landed, 'Player')}`);
    check('and the sparks are the blow’s, not an effect left running',
          (early.particles?.HitSpark ?? -1) === 0
          && (landed.particles?.HitSpark ?? 0) > 0,
          `sparks ${early.particles?.HitSpark}→${landed.particles?.HitSpark}`);

    // D — the clip says `hit` twice, and the swing still lands once.
    const twice = run(dir, { holds: [ATTACK(5), ATTACK(80)], frames: 125 });
    check('a second swing may land on what the first one already hit',
          swing(twice).hitCount === 1 && health(twice, 'DummyA') === 50,
          `hits ${swing(twice).hitCount}, A ${health(twice, 'DummyA')}`);

    // A — the same swing where there is nothing to reach.
    const missed = run(dir, {
        holds: [{ key: 'KeyS', from: 0, to: 45 }, ATTACK(50)],
        frames: 95,
    });
    check('a swing with nothing in reach runs and takes nothing off',
          swing(missed).state === 'Attack1' && (swing(missed).id ?? 0) > 0
          && swing(missed).hitCount === 0 && health(missed, 'DummyA') === 100
          && (missed.particles?.HitSpark ?? -1) === 0,
          `attack ${swing(missed).id}, hits ${swing(missed).hitCount},`
          + ` A ${health(missed, 'DummyA')}, sparks ${missed.particles?.HitSpark}`);
}

// 12. The attack lunges, which makes it the same question the dodge answered:
// what the animation asks for is not what the world allows.
{
    const lunged = run(dir, { holds: [ATTACK(5)], frames: 70 });
    const travelled = START.z - (lunged.position?.z ?? START.z);
    check('an attack carries the character forward',
          travelled > 40, `travelled ${travelled.toFixed(0)}`);

    const atWall = run(dir, {
        holds: [
            { key: 'KeyD', from: 0, to: TO_LANE.wall },
            { key: 'KeyW', from: TO_LANE.wall, to: TO_LANE.wall + 151 },
            ATTACK(TO_LANE.wall + 135),
        ],
        frames: TO_LANE.wall + 180,
    });
    check('and the same attack against a wall plays without going through it',
          swing(atWall).state === 'Attack1' && (atWall.position?.z ?? -999) > -520,
          `state ${swing(atWall).state}, z ${atWall.position?.z?.toFixed(0)}`);
}

// 13. An autonomous character, in the arena fixture. Everything below is caused
// by the keyboard: the player walks into what the enemy can see, and every state
// the enemy reaches after that is its own.
{
    const arena = (input, frames) => run(dir, { ...input, frames }, 'arena');
    /** The player closes far enough to be seen; the enemy does the rest. */
    const seen = (frames, extra = []) =>
        arena({ holds: [{ key: 'KeyW', from: 0, to: 25 }, ...extra] }, frames);
    const ai = (r) => r.ai ?? {};
    const speed = (r) => Math.hypot(ai(r).realVelocity?.x ?? 0, ai(r).realVelocity?.z ?? 0);

    // 1. Detection. The pair is the claim: a chase that started on its own says
    // nothing about perception.
    const alone = arena({}, 40);
    check('an enemy that has seen nobody stands still',
          ai(alone).state === 'idle' && ai(alone).visible === false,
          `state ${ai(alone).state}, visible ${ai(alone).visible}`);

    const spotted = seen(40);
    check('and takes up the chase once the player walks into what it can see',
          ai(spotted).state === 'chase' && ai(spotted).visible === true
          && ai(spotted).hasTarget === true,
          `state ${ai(spotted).state}, visible ${ai(spotted).visible}`);

    // 2. The route. A wall it can see over stands between the two, so walking at
    // the player is not walking to the player.
    const rounding = seen(70);
    check('and goes around the barrier rather than into it',
          Math.abs(ai(rounding).position?.x ?? 0) > 150,
          `x ${ai(rounding).position?.x?.toFixed(0)} (straight would hold 0)`);

    // 3. Arrival, and the swing that follows — through the SAME pipeline: an
    // animator trigger, a beat the clip declares, MeleeAttack, Damage, Health.
    const swinging = seen(142);
    check('a swing of its own opens with the player still whole',
          ai(swinging).animator === 'Attack1' && ai(swinging).attackId > 0
          && health(swinging, 'Player') === 100,
          `anim ${ai(swinging).animator}, attack ${ai(swinging).attackId},`
          + ` player ${health(swinging, 'Player')}`);

    const struck = seen(175);
    check('and past the beat the player has lost exactly one blow',
          health(struck, 'Player') === 80 && (struck.particles?.HitSpark ?? 0) >= 0,
          `player ${health(struck, 'Player')}`);

    // 4. Out of reach again: a state that only left on its own would swing at air.
    const fleeing = seen(230, [{ key: 'KeyD', from: 170, to: 260 }]);
    check('a player who backs off is chased again rather than swung at',
          ai(fleeing).state === 'chase' && ai(fleeing).distance > 100,
          `state ${ai(fleeing).state}, distance ${ai(fleeing).distance?.toFixed(0)}`);

    // 5. Somewhere it cannot get to. The route ends where the mesh does, and the
    // enemy stops there — it does not pass through, and it does not give up.
    const stuck = arena({ holds: [{ key: 'KeyW', from: 0, to: 400 }] }, 340);
    const at = ai(stuck).position ?? { x: 0, z: 0 };
    const insideBarrier = Math.abs(at.x) < 230 && at.z > -160 && at.z < -40;
    check('a target it cannot reach leaves it stopped short, still trying',
          ai(stuck).state === 'chase' && speed(stuck) < 5 && !insideBarrier
          && health(stuck, 'Player') === 100,
          `state ${ai(stuck).state}, speed ${speed(stuck).toFixed(0)},`
          + ` at (${at.x.toFixed(0)}, ${at.z.toFixed(0)}), player ${health(stuck, 'Player')}`);

    // 6. And it can be killed, by the player's swing through the same pipeline.
    // One press: the player's own attack lunges, so a second would carry it back
    // out of reach before the first answer is in.
    const swings = [{ key: 'KeyA', from: 120, to: 150 }, ATTACK(170)];
    const dead = seen(260, swings);
    check('the player’s swing takes it down the same way its own works',
          ai(dead).state === 'dead' && health(dead, 'Enemy') === 0,
          `state ${ai(dead).state}, enemy ${health(dead, 'Enemy')}`);

    const after = seen(360, swings);
    check('and once it is down it stops moving and stops swinging',
          speed(after) < 5 && health(after, 'Player') === health(dead, 'Player'),
          `speed ${speed(after).toFixed(0)},`
          + ` player ${health(dead, 'Player')}→${health(after, 'Player')}`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\nverify-third-person: ${results.length - failed.length}/${results.length}`
    + ' behaviour(s) hold up in the packaged game.');
process.exit(failed.length ? 1 : 0);
