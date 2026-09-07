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
const DESKTOP = path.join(ROOT, 'desktop');

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
        const at = Math.max(...['reading ', 'watching ', 'lostDevice ', 'readiness ', 'counters ']
            .map((p) => line.indexOf(p)));
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
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const sortKeys = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

/**
 * Boot the editor into Play on the same project and read the same report.
 *
 * Through the play-frame eval hook, because the realm is an out-of-process
 * frame. POLLS rather than reading once: a reading taken before residency
 * settles says "loading", which is neither present nor absent.
 */
function playRealmResidency() {
    const settle = `(async () => {
        for (let i = 0; i < 900; i++) {
            const r = window.__estellaPlay?.streaming?.();
            if (r && r.streamed && r.loadingCells.length === 0
                && r.unloadingCells.length === 0 && r.residentCells.length > 0) break;
            await new Promise((done) => setTimeout(done, 16));
        }
        return JSON.stringify(window.__estellaPlay?.streaming?.() ?? null);
    })()`;
    const r = runElectron(['.'], {
        via: 'npx',
        encoding: 'utf8',
        cwd: DESKTOP,
        env: {
            ESTELLA_SHOT: path.join(WORK, 'editor-play.png'),
            ESTELLA_SHOT_PROJECT: PROJECT,
            ESTELLA_SHOT_SCENE: 'assets/scenes/main.esscene',
            ESTELLA_SHOT_PLAY: '1',
            ESTELLA_SHOT_PLAY_EVAL: settle,
            ESTELLA_WIN_W: '1500',
            ESTELLA_WIN_H: '1040',
        },
    });
    const line = (r.stdout || '').split('\n').find((l) => l.includes('[playEval]'));
    if (!line) {
        console.error(`    the editor printed no play-realm reading — ${(r.stdout || r.stderr || '').trim().slice(-300)}`);
        return null;
    }
    try {
        // The hook prints a string result as-is, and the eval already stringified
        // the report — so this is the report's own encoding and nothing else.
        return JSON.parse(line.slice(line.indexOf('[playEval]') + '[playEval]'.length).trim());
    } catch {
        console.error(`    the reading did not parse: ${line.slice(0, 300)}`);
        return null;
    }
}
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
    // Assets are half of what publication needs. A cell readied without its
    // shader programs pays for them in the first frame that shows it, which is
    // the frame this whole feature exists to make cheap.
    claim(initial.streaming.preparedWithRenderClaim.includes(B)
        && initial.streaming.preparedWithRenderClaim.includes(C),
        'and their render programs are ready too, not just their assets',
        `claims ${JSON.stringify(initial.streaming.preparedWithRenderClaim)}`
        + ` of prepared ${JSON.stringify(initial.streaming.preparedCells)}`);
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

    // ---- 5. A readiness claim across a device generation ----------------
    //
    // The epoch says readiness taken before a rebuild is worth nothing, and
    // publication is where that debt comes due. All four facts are read.
    const CELL_COMPILES = 'render.mesh.programCompiles';
    const revalidate = drive(dir, 'readiness-across-loss', [
        { do: 'step', frames: 30 },
        // Engage the profiler before the interesting frames, not during them.
        { do: 'counters', as: 'warmup' },
        { do: 'readiness', as: 'beforeLoss', cell: C },
        { do: 'loseDevice', as: 'lost' },
        { do: 'readiness', as: 'afterLoss', cell: C },
        // Demand C. Publication has to re-establish readiness before it can show
        // anything, and the peak across the window is where a cold compile lands.
        { do: 'tap', key: 'KeyL', frames: 1 },
        { do: 'counters', as: 'atReveal', frames: 60 },
        { do: 'readiness', as: 'afterPublish', cell: C },
        { do: 'read', as: 'revealed' },
    ]);

    const preLoss = revalidate.beforeLoss;
    const afterLoss = revalidate.afterLoss;
    const afterPublish = revalidate.afterPublish;
    claim(preLoss.claim !== null && preLoss.claim.restamps === 0,
        'a readied cell holds a claim before anything takes the device away',
        `claim ${JSON.stringify(preLoss.claim)}`);
    claim(afterLoss.device.generation > preLoss.device.generation,
        'losing the device and recovering advances the device generation',
        `generation ${preLoss.device.generation} → ${afterLoss.device.generation}`);
    claim(afterLoss.device.programEpoch > preLoss.device.programEpoch,
        'and the program epoch too, independently — the stock cache went cold',
        `epoch ${preLoss.device.programEpoch} → ${afterLoss.device.programEpoch}`);
    claim(afterLoss.claim !== null
        && afterLoss.claim.programEpoch === preLoss.claim?.programEpoch,
        'the claim the cell is holding is now from a dead epoch, and it still holds it',
        `still ${JSON.stringify(afterLoss.claim)}`);
    claim(afterPublish.claim !== null
        && afterPublish.claim.programEpoch === afterLoss.device.programEpoch
        && afterPublish.claim.restamps === 1,
        'publishing it replaced the stale claim with one from the live epoch',
        `claim ${JSON.stringify(afterPublish.claim)}`);
    claim(resident(revalidate.revealed, C),
        'the cell published', `resident ${JSON.stringify(revalidate.revealed.streaming.residentCells)}`);
    // Soundness, not attribution: this fixture's cells share variants with the one
    // the player stands in, whose draws rebuild them after a loss regardless. A
    // zero says no first frame met a cold program; who warmed it is readiness.mjs's.
    claim((revalidate.atReveal[CELL_COMPILES] ?? 0) === 0,
        'and nothing compiled on the frames that first showed it',
        `${CELL_COMPILES} peaked at ${revalidate.atReveal[CELL_COMPILES] ?? 0}`);

    // The control arm. Without it, a publication that re-readies unconditionally
    // passes everything above while paying the cost prefetching exists to avoid.
    const quiet = drive(dir, 'readiness-no-loss', [
        { do: 'step', frames: 30 },
        { do: 'counters', as: 'warmup' },
        { do: 'readiness', as: 'beforePublish', cell: C },
        { do: 'tap', key: 'KeyL', frames: 1 },
        { do: 'counters', as: 'atReveal', frames: 60 },
        { do: 'readiness', as: 'afterPublish', cell: C },
        { do: 'read', as: 'revealed' },
    ]);
    claim(quiet.afterPublish.claim !== null && quiet.afterPublish.claim.restamps === 0,
        'a dwell in which nothing moved publishes on the claim it was prepared with',
        `restamps ${quiet.afterPublish.claim?.restamps}`);
    claim(quiet.afterPublish.claim?.digestLo === quiet.beforePublish.claim?.digestLo
        && quiet.afterPublish.claim?.programEpoch === quiet.beforePublish.claim?.programEpoch,
        'and the claim it publishes on is the same claim, not a fresh one',
        `${JSON.stringify(quiet.beforePublish.claim)} → ${JSON.stringify(quiet.afterPublish.claim)}`);
    claim((quiet.atReveal[CELL_COMPILES] ?? 0) === 0,
        'with nothing compiled at first sight either',
        `${CELL_COMPILES} peaked at ${quiet.atReveal[CELL_COMPILES] ?? 0}`);

    // ---- The editor plays the same world, and cuts it the same way --------
    //
    // Frames cannot make this claim: the editor's moved 0.0073 → 0.0008 when
    // Play stopped loading the world whole — inside every parity tolerance.
    const played = playRealmResidency();
    if (played === null) {
        claim(false, 'the editor play realm reported its residency');
    } else {
        claim(played.streamed && played.cellCount === initial.streaming.cellCount,
            'the editor plays a cut world too, with the cells the package ships',
            `${played.cellCount} cells, streamed=${played.streamed}`);
        claim(same(played.residentCells, initial.streaming.residentCells),
            'and the same places are resident at boot, because the geometry is the same',
            `editor ${JSON.stringify([...played.residentCells].sort())} `
            + `vs package ${JSON.stringify([...initial.streaming.residentCells].sort())}`);
        claim(JSON.stringify(sortKeys(played.authoredCellEntityCounts))
            === JSON.stringify(sortKeys(initial.streaming.authoredCellEntityCounts)),
            'holding what the cook put in them — one partition, two hosts',
            JSON.stringify(sortKeys(played.authoredCellEntityCounts)));
        claim(JSON.stringify(sortKeys(played.cellEntityCounts))
            === JSON.stringify(sortKeys(initial.streaming.cellEntityCounts)),
            'and the live entity counts agree, so both published the same documents',
            `editor ${JSON.stringify(sortKeys(played.cellEntityCounts))}`);
    }

    const failed = results.filter((r) => !r.ok).length;
    console.log(`\nworld-residency: ${results.length - failed}/${results.length}`);
    process.exit(failed === 0 ? 0 : 1);
}

main();
