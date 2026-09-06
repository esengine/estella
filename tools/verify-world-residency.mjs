// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  verify-world-residency.mjs — a place exists because someone is near it.
 *
 * The unit criteria hold the decision: the union over sources, the hysteresis
 * band, what the cook cuts and what it refuses. What they cannot say is whether
 * a cell LEAVING the world takes everything it brought — the renderer's
 * instances, the physics body, the navigating agent, the asset receipts — and
 * that is the whole feature. So this drives the real package: real cooked cells,
 * real Jolt, real navigation, real input.
 *
 * Four launches, because a claim about what boot produced cannot be made after
 * something walked, and a wall that blocks cannot be un-walked into.
 *
 * The scene is `world-streaming-3d`, and it is a FIXTURE: its cell size, radii
 * and coordinates answer to these claims and nothing else.
 */
import { spawnSync } from 'node:child_process';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runElectron } from './lib/electronRun.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORK = path.join(ROOT, '.golden', 'world-residency');
const PROJECT = path.join(ROOT, 'examples', 'world-streaming-3d');
const LAUNCHER = path.join(ROOT, 'tools', 'launchers', 'residency-run.mjs');

const A = 'main.cell_0_0';
const B = 'main.cell_1_0';
const C = 'main.cell_2_0';
const D = 'main.cell_0_5';
/** The enemy's authored row in the fixture — what its handle is looked up by. */
const ENEMY_ROW = 31;

function packageGame() {
    rmSync(WORK, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    mkdirSync(WORK, { recursive: true });
    const out = path.join(WORK, 'web');
    const r = spawnSync(process.execPath, [
        path.join(ROOT, 'pipeline', 'bin', 'estella.mjs'), 'export', PROJECT,
        '--platform', 'web', '--out', out,
    ], { encoding: 'utf8', cwd: ROOT });
    if (r.status !== 0) {
        console.error('✗ world-residency: the package did not build');
        for (const l of `${r.stderr ?? ''}${r.stdout ?? ''}`.split('\n').slice(-8)) {
            if (l.trim()) console.error(`    ${l}`);
        }
        process.exit(1);
    }
    return out;
}

/** Run one script against the package and return every labelled reading. */
function drive(dir, name, steps) {
    const script = path.join(WORK, `${name}.json`);
    writeFileSync(script, JSON.stringify(steps, null, 2));
    const r = runElectron([
        LAUNCHER, '--dir', dir, '--script', script, '--w', '640', '--h', '360',
    ], { encoding: 'utf8', cwd: ROOT });
    const readings = {};
    for (const line of (r.stdout || '').split('\n')) {
        const at = Math.max(line.indexOf('reading '), line.indexOf('watching '));
        if (at < 0) continue;
        const label = line.slice(line.indexOf(' ', at) + 1, line.indexOf(':', at));
        try {
            readings[label] = JSON.parse(line.slice(line.indexOf('{', at)));
        } catch { /* a truncated line is a missing reading, reported below */ }
    }
    if (Object.keys(readings).length === 0) {
        console.error(`✗ ${name}: no readings — ${(r.stdout || r.stderr || '').trim().slice(-300)}`);
        process.exit(1);
    }
    return readings;
}

const results = [];
function claim(ok, text, detail) {
    results.push({ ok, text, detail });
    console.log(`${ok ? '✓' : '✗'} ${text}${detail ? ` — ${detail}` : ''}`);
}

const resident = (r, cell) => r.streaming.residentCells.includes(cell);
const entities = (r, cell) => r.streaming.cellEntityCounts[cell];
const authored = (r, cell) => r.streaming.authoredCellEntityCounts[cell];
/** An entity handle's slot, so a criterion can say whether one was REUSED. */
const slot = (handle) => handle & 0xFFFFF;

function main() {
    const dir = packageGame();

    // ---- 1. What boot produced, before anything walked -------------------
    const start = drive(dir, 'residency', [
        { do: 'step', frames: 30 },
        { do: 'read', as: 'initial' },
        { do: 'tap', key: 'KeyL', frames: 30 },
        { do: 'read', as: 'scoutOn' },
        { do: 'tap', key: 'KeyL', frames: 30 },
        { do: 'read', as: 'scoutOff' },
        { do: 'tap', key: 'KeyM', frames: 20 },
        { do: 'watch', as: 'bobbed', name: 'Bobber', axis: 'z', frames: 400, every: 20 },
        // One cell, alone: nothing else loads between its unload and its reload,
        // so the handle slot it gives up is the one it gets back — which is the
        // arrangement a stale handle is actually dangerous in.
        { do: 'read', as: 'beaconFirst' },
        { do: 'tap', key: 'KeyM', frames: 30 },
        { do: 'read', as: 'beaconGone' },
        { do: 'tap', key: 'KeyM', frames: 30 },
        { do: 'read', as: 'beaconBack' },
        { do: 'tap', key: 'KeyJ', frames: 30 },
        { do: 'read', as: 'beaconBlown' },
        // Nobody walked in this launch, so the places the player never reached
        // are still merely READY — which is the only state a discard can be
        // asked about.
        { do: 'tap', key: 'KeyK', frames: 30 },
        { do: 'read', as: 'nobodyAsking' },
    ]);

    const initial = start.initial;
    claim(initial.streaming.streamed && initial.streaming.cellCount === 4,
        'the package ships a cut world', `${initial.streaming.cellCount} cells`);
    claim(resident(initial, A) && !resident(initial, C) && !resident(initial, D),
        'only the place the player stands in is resident',
        `resident ${JSON.stringify(initial.streaming.residentCells)}`);
    // Not drawn and not there are different things, and only one of them is this.
    claim(entities(initial, C) === undefined && initial.at.Arch === undefined
        && (initial.streaming.cellRenderCounts[C] ?? 0) === 0,
        'a cell nobody needs has no entities, no renderers and nothing to probe');

    // ---- Prepared is not resident, and nothing can tell it is there ------
    claim(initial.streaming.preparedCells.includes(B)
        && initial.streaming.preparedCells.includes(C)
        && !initial.streaming.residentCells.includes(B),
        'places the player may soon want are readied without being brought in',
        `prepared ${JSON.stringify(initial.streaming.preparedCells)}`);
    claim(initial.at.Enemy === undefined && initial.at.Wall === undefined
        && initial.streaming.hunters === 0 && initial.streaming.navAgents === 0
        && entities(initial, B) === undefined,
        'and nothing they hold is in the world — no entity, no body, no hunter',
        `${initial.streaming.physicsBodies} bodies, ${initial.streaming.hunters} hunter(s)`);

    // ---- 6. Two sources are unioned --------------------------------------
    const scoutOn = start.scoutOn;
    claim(scoutOn.streaming.sourceCount === 2 && resident(scoutOn, A) && resident(scoutOn, C),
        'a second source brings its own place in without taking the first away',
        `${scoutOn.streaming.sourceCount} sources, resident ${JSON.stringify(scoutOn.streaming.residentCells)}`);
    claim(scoutOn.at.Arch !== undefined && scoutOn.at.ArchTop !== undefined,
        'and that place arrived whole');
    const scoutOff = start.scoutOff;
    claim(!resident(scoutOff, C) && resident(scoutOff, A),
        'switching it off gives up only what no source still needs',
        `resident ${JSON.stringify(scoutOff.streaming.residentCells)}`);

    // ---- 5. A boundary is a band, not a treadmill ------------------------
    const bobbed = start.bobbed;
    const loads = bobbed.streaming.loadCount - scoutOff.streaming.loadCount;
    const unloads = bobbed.streaming.unloadCount - scoutOff.streaming.unloadCount;
    // The threshold the bobber is meant to breathe across. Asserted, because a
    // source that never moved would satisfy every count below for no reason.
    const CROSSES_AT = 2750;
    claim(bobbed.swept.min < CROSSES_AT && bobbed.swept.max > CROSSES_AT,
        'the source really did cross the load threshold, both ways',
        `swept z ${bobbed.swept.min.toFixed(0)}..${bobbed.swept.max.toFixed(0)} across ${CROSSES_AT}`);
    claim(resident(bobbed, D) && loads === 1 && unloads === 0,
        'and a boundary it breathes across loads the place once and keeps it',
        `${loads} load(s), ${unloads} unload(s) over 400 frames`);

    // ---- 10a. A blow held across ONE cell's whole lifetime ---------------
    const wasBeacon = (start.beaconFirst.streaming.cellRows[D] ?? [])[0];
    const isBeacon = (start.beaconBack.streaming.cellRows[D] ?? [])[0];
    claim(start.beaconGone.at.Beacon === undefined && isBeacon !== undefined
        && wasBeacon !== undefined && wasBeacon.entity !== isBeacon.entity,
        'a place that leaves and comes back mints a new handle for the same row',
        `row ${wasBeacon?.id}: ${wasBeacon?.entity} then ${isBeacon?.entity}`);
    // Which slot comes back is the allocator's business, not a contract, so it is
    // reported rather than claimed. The generation's guarantee is held to where it
    // lives — sdk/tests/world-residency.test.ts fabricates a handle to test it.
    console.log(`  slot ${slot(wasBeacon?.entity ?? 0)} gave way to slot ${slot(isBeacon?.entity ?? 0)}`);
    claim(start.beaconBlown.combat.targets.Beacon.health
        === start.beaconBlown.combat.targets.Beacon.max
        && start.beaconBlown.combat.targets.Canary.health < 100,
        'and the blow held over that lifetime lands on nobody while the live one lands',
        `beacon at ${start.beaconBlown.combat.targets.Beacon.health}, `
        + `canary at ${start.beaconBlown.combat.targets.Canary.health}`);

    // ---- Readiness is not a claim on the world ---------------------------
    const asking = start.nobodyAsking;
    claim(!asking.streaming.preparedCells.includes(B) && !asking.streaming.preparedCells.includes(C)
        && asking.streaming.cancelCount >= 2,
        'what was merely readied is thrown away when nobody is near it, not published',
        `${asking.streaming.cancelCount} discarded of ${asking.streaming.prepareCount} prepared,`
        + ` still ready ${JSON.stringify(asking.streaming.preparedCells)}`);
    claim(asking.streaming.cancelledRefs > 0,
        'and the assets it had acquired come back with it',
        `${asking.streaming.cancelledRefs} acquisition(s) returned`);
    claim(asking.at.Enemy === undefined && asking.at.Wall === undefined
        && asking.at.Arch === undefined,
        'and none of it was published on the way out');

    // ---- 2/3/4/7/8. The journey ------------------------------------------
    const trip = drive(dir, 'journey', [
        { do: 'step', frames: 30 },
        { do: 'read', as: 'atA' },
        { do: 'walkTo', x: 900, z: 300, budget: 900 },
        { do: 'read', as: 'atB' },
        { do: 'walkTo', x: 1750, z: 300, budget: 1200 },
        { do: 'read', as: 'atC' },
        { do: 'walkTo', x: 900, z: 300, budget: 1200 },
        { do: 'read', as: 'backAtB' },
    ]);

    const atB = trip.atB;
    claim(resident(atB, B) && entities(atB, B) === authored(atB, B) && atB.at.Enemy !== undefined,
        'walking into a place instantiates everything the cook put in it',
        `${entities(atB, B)}/${authored(atB, B)} entities`);
    claim(atB.streaming.physicsCharacters >= 2 && atB.streaming.navAgents === 1
        && atB.streaming.hunters === 1,
        'and its enemy arrives as a physical, navigating, deciding thing',
        `${atB.streaming.physicsCharacters} characters, ${atB.streaming.navAgents} agent(s)`);
    claim(atB.ai.found && (atB.ai.visible || atB.ai.hasTarget),
        'which then notices the player it was not told about',
        `visible=${atB.ai.visible} hasTarget=${atB.ai.hasTarget}`);
    // The point of readying it early: what the player waited through is the
    // publication, not the fetching and decoding.
    claim(atB.streaming.prefetchHits > 0,
        'and it was published from something already readied, not fetched on arrival',
        `${atB.streaming.prefetchHits} hit(s), ${atB.streaming.prefetchMisses} miss(es),`
        + ` demand→resident ${atB.streaming.lastDemandToResidentMs.toFixed(1)}ms`);

    const atC = trip.atC;
    claim(!resident(atC, B) && entities(atC, B) === undefined && atC.at.Enemy === undefined
        && atC.at.Wall === undefined,
        'leaving takes the place with it — every entity, not the picture of them',
        `resident ${JSON.stringify(atC.streaming.residentCells)}`);
    claim(atC.streaming.navAgents === 0 && atC.streaming.hunters === 0
        && atC.streaming.stalePhysics === 0,
        'no agent, no hunter and no physics row outlives the cell that brought it',
        `${atC.streaming.stalePhysics} stale physics row(s)`);
    claim((atC.streaming.assetRefsByCell[B] ?? 0) === 0,
        'and the cell owes nothing for the assets it acquired');

    // ---- 8. A subtree is the residency atom ------------------------------
    claim(atC.at.Arch !== undefined && atC.at.ArchTop !== undefined
        && Math.abs(atC.at.ArchTop.x - 1900) < 1,
        'a child standing in another cell comes in with its root, not with its own place',
        `ArchTop at x=${atC.at.ArchTop?.x?.toFixed(0)}`);

    // ---- The one reference that crosses a document boundary ---------------
    claim(atC.at.RefProbe?.x === 1000,
        'a reference the cell holds into the persistent world names the live entity',
        `probe at x=${atC.at.RefProbe?.x}`);
    claim(trip.atA.at.RefProbe?.x === 0,
        'and there is nothing to resolve while the cell that holds it is absent');
    claim(trip.atA.at.ArchTop === undefined && atB.at.ArchTop === undefined,
        'and is gone whenever its root is');

    // ---- 4. Coming back produces ONE of everything -----------------------
    const back = trip.backAtB;
    claim(resident(back, B) && entities(back, B) === authored(back, B)
        && back.streaming.hunters === 1 && back.streaming.navAgents === 1,
        'coming back builds the place once, not twice',
        `${entities(back, B)}/${authored(back, B)} entities, ${back.streaming.hunters} hunter(s)`);
    const rowsOf = (r) => (r.streaming.cellRows[B] ?? []).map((row) => row.id);
    const handlesOf = (r) => (r.streaming.cellRows[B] ?? []).map((row) => row.entity);
    claim(JSON.stringify(rowsOf(back)) === JSON.stringify(rowsOf(atB))
        && JSON.stringify(handlesOf(back)) !== JSON.stringify(handlesOf(atB)),
        'with the same authored rows and different runtime handles',
        `rows ${JSON.stringify(rowsOf(back))}`);

    // ---- 7. The persistent world is not rebuilt --------------------------
    const persistent = JSON.stringify(trip.atA.streaming.persistentHandles);
    claim([atB, atC, back].every((r) => JSON.stringify(r.streaming.persistentHandles) === persistent),
        'nothing the world is made of was rebuilt along the way',
        `${trip.atA.streaming.persistentEntities} persistent entities`);

    // ---- 9. A wall that unloaded is not still there ----------------------
    const ghost = drive(dir, 'ghost', [
        { do: 'step', frames: 30 },
        { do: 'walkTo', x: 900, z: 300, budget: 900 },
        { do: 'read', as: 'approach' },
        { do: 'walkTo', x: 900, z: 760, budget: 400 },
        { do: 'read', as: 'blocked' },
        { do: 'tap', key: 'KeyK', frames: 60 },
        { do: 'read', as: 'sourceOff' },
        { do: 'walkTo', x: 900, z: 760, budget: 400 },
        { do: 'read', as: 'through' },
    ]);
    claim(ghost.approach.at.Wall !== undefined && ghost.blocked.at.Player.z < 440,
        'a wall the cell brought stops the player',
        `stopped at z=${ghost.blocked.at.Player.z.toFixed(0)}`);
    claim(ghost.sourceOff.streaming.sourceCount === 0
        && ghost.sourceOff.streaming.residentCells.length === 0
        && ghost.sourceOff.at.Wall === undefined
        && ghost.sourceOff.streaming.stalePhysics === 0,
        'with nobody asking, every place leaves and leaves no body behind');
    claim(ghost.through.at.Player.z > 520,
        'and the player walks through where the wall was',
        `reached z=${ghost.through.at.Player.z.toFixed(0)}`);

    // ---- 10. A blow aimed at what is gone -------------------------------
    const stale = drive(dir, 'stale', [
        { do: 'step', frames: 30 },
        { do: 'walkTo', x: 900, z: 300, budget: 900 },
        { do: 'read', as: 'met' },
        { do: 'walkTo', x: 1750, z: 300, budget: 1200 },
        { do: 'read', as: 'gone' },
        { do: 'walkTo', x: 900, z: 300, budget: 1200 },
        { do: 'read', as: 'back' },
        { do: 'tap', key: 'KeyJ', frames: 30 },
        { do: 'read', as: 'blown' },
    ]);
    const before = stale.met.streaming.cellRows[B] ?? [];
    const after = stale.back.streaming.cellRows[B] ?? [];
    const remembered = before.find((row) => row.id === ENEMY_ROW);
    // Whoever holds that slot NOW — anywhere, since a freed one goes to whichever
    // place loads next. Every cell entity carries Health on purpose, so a blow
    // that landed is visible whichever of them inherited it.
    const everywhere = Object.values(stale.blown.streaming.cellRows).flat();
    const current = after.find((row) => row.id === ENEMY_ROW);
    const inherited = everywhere.find((row) => slot(row.entity) === slot(remembered?.entity ?? -1));
    claim(stale.gone.at.Enemy === undefined && after.length === before.length,
        'the enemy a blow was aimed at really did stop existing');
    claim(remembered !== undefined && current !== undefined && remembered.entity !== current.entity,
        'and the handle it was aimed at no longer names it',
        `row ${remembered?.id}: ${remembered?.entity} then ${current?.entity}`
        + (inherited ? `; its slot is now row ${inherited.id}` : '; its slot is unheld'));
    claim(stale.blown.combat.targets.Canary.health < 100,
        'the gesture reached the damage bus',
        `canary at ${stale.blown.combat.targets.Canary.health}`);
    const hurt = Object.entries(stale.blown.combat.targets)
        .filter(([name, t]) => name !== 'Canary' && name !== 'Player' && t.health !== t.max)
        .map(([name, t]) => `${name} at ${t.health}`);
    claim(hurt.length === 0,
        'and the blow held for the entity that left landed on nobody',
        hurt.length === 0
            ? `${Object.keys(stale.blown.combat.targets).length} targets, all whole`
            : hurt.join(', '));

    const failed = results.filter((r) => !r.ok).length;
    console.log(`\nworld-residency: ${results.length - failed}/${results.length}`);
    process.exit(failed === 0 ? 0 : 1);
}

main();
