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
 * back is `__estellaCooked.gameplay` — an observation seam, not a second way to
 * play. Lanes run in -Z, so a run strafes to one and then walks it.
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

/** Drive the package with one gesture and read what the character became. */
function run(dir, input) {
    const r = runElectron([
        LAUNCHER, '--dir', dir, '--w', String(W), '--h', String(H),
        '--settle', '30', '--timeout', '60000',
        '--input', JSON.stringify(input), '--gameplay', 'Player,Camera',
        '--out', path.join(WORK, 'frame.png'),
    ], { encoding: 'utf8', cwd: ROOT });
    const line = (r.stdout || '').split('\n').find((l) => l.includes('gameplay:'));
    if (!line) {
        return { error: `no reading — ${(r.stdout || r.stderr || '').trim().slice(-200)}` };
    }
    try {
        return JSON.parse(line.slice(line.indexOf('{')));
    } catch (e) {
        return { error: `unreadable reading: ${e.message}` };
    }
}

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

// 6. Camera-relative movement, turned by a real mouse drag.
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

// 7. Camera obstruction, against the same wall the character cannot pass.
{
    const open = run(dir, { frames: 40 });
    const against = run(dir, standIn(TO_LANE.wall, 'KeyD'));
    check('the eye sits back when nothing is in the way',
          (open.cameraDistance ?? 0) > 400, `distance ${open.cameraDistance?.toFixed(0)}`);
    check('and pulls in when the wall is behind the character',
          (against.cameraDistance ?? 999) < (open.cameraDistance ?? 0) - 40,
          `distance ${against.cameraDistance?.toFixed(0)} vs ${open.cameraDistance?.toFixed(0)}`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\nverify-third-person: ${results.length - failed.length}/${results.length}`
    + ' behaviour(s) hold up in the packaged game.');
process.exit(failed.length ? 1 : 0);
