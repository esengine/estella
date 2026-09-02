// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  play-through.mjs — can the shipped game be played from start to finish?
 *
 * launch-export proves a package boots and answers input. It cannot prove a
 * playthrough: its input is a list of "hold this key from frame A to frame B",
 * which is open-loop. Any enemy standing in the way silently turns the rest of
 * the script into someone walking into a wall, and the run still reports green
 * because the frame is still lively. A route written that way is a route that
 * has to be re-timed by hand every time the level changes.
 *
 * So this one plays: it asks the running game where things are (`?headless` →
 * `__estellaCooked.probe`), steers toward the next waypoint, swings on the way,
 * and moves on when it arrives. What it asserts is the game's own progression —
 * the areas reached, in order — not a pixel.
 *
 *   electron desktop/scripts/play-through.mjs --dir <exportDir> --route <file.json>
 *     --out <file.png>   write the final frame
 *     --w / --h          surface size (default 960x540)
 *     --budget <n>       give up after this many frames (default 6000)
 *     --log <regex>      also print console lines matching this
 *     --trace            print what the driver decided, periodically
 *
 * A route is a list of legs: `{ area, goal, arriveWithin?, swing?, timeout? }`.
 * A leg ends when its goal is GONE — taken, or dead — or when the area changed.
 * `arriveWithin` ends it on distance instead, which is a weaker claim and so is
 * never assumed: a leg that wants it says so, and says why.
 * `goal` is an entity name the probe can find, so a leg survives the level being
 * re-authored — the door moves, the route does not.
 *
 * Runs of one package agree to the frame, which took three rules: read on a
 * frame boundary, never read a world mid-transition, and credit an arrival
 * only from arm's reach with Lyra present.
 *
 * Answers `flagship-plays-through` via tools/verify-playthrough.mjs.
 */
import { app, BrowserWindow } from 'electron';
import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { onRendererConsole } from '../lib/rendererConsole.mjs';

// Every other launcher has this and this one did not, so on a runner with no GPU
// Chromium blocklisted WebGL2, the game drew nothing, and the flagship criterion
// reported that its route could not be played.
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.commandLine.appendSwitch('force-color-profile', 'srgb');

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};

const DIR = path.resolve(flag('dir', ''));
const ROUTE = flag('route', '');
const OUT = flag('out', '');
const W = Number(flag('w', '960'));
const H = Number(flag('h', '540'));
const BUDGET = Number(flag('budget', '6000'));
const LOG = flag('log', '');
const logRe = LOG ? new RegExp(LOG, 'i') : null;
const TRACE = argv.includes('--trace');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ktx2': 'image/ktx2',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4', '.esv': 'video/mp4', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.atlas': 'text/plain', '.skel': 'application/octet-stream', '.txt': 'text/plain',
};

function serve(root) {
  const server = http.createServer(async (req, res) => {
    try {
      let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
      if (rel === '') rel = 'index.html';
      const abs = path.join(root, rel);
      if (!abs.startsWith(root)) { res.writeHead(403).end(); return; }
      const bytes = await readFile(abs);
      res.writeHead(200, { 'content-type': MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream' })
        .end(bytes);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/**
 * The page-side half: hold a set of keys for `frames` frames, then release.
 * Keys go in as real DOM events, which is what the engine's input actually
 * listens to — a driver that pokes state instead would be testing itself.
 *
 * The frames are the ENGINE's, one fixed dt at a time. Counted with
 * requestAnimationFrame a "frame" was whatever wall time the runner had spare —
 * one leg took 156 of them on a laptop and 36 on CI, with jump arcs to match.
 */
const stepScript = (keys, frames, tapKey) => `
(() => {
  const target = document.querySelector('canvas') ?? window;
  const send = (type, code) => {
    const e = new KeyboardEvent(type, { code, key: code, bubbles: true, cancelable: true });
    target.dispatchEvent(e);
    if (target !== window) window.dispatchEvent(new KeyboardEvent(type, { code, key: code, bubbles: true }));
  };
  const held = ${JSON.stringify(keys)};
  const step = (n) => window.__estellaCooked.step(n, 1 / 60);
  for (const k of held) send('keydown', k);
  ${tapKey ? `send('keydown', ${JSON.stringify(tapKey)});` : ''}
  return (async () => {
    ${tapKey
      ? `await step(Math.min(2, ${frames}));
    send('keyup', ${JSON.stringify(tapKey)});
    if (${frames} > 2) await step(${frames} - 2);`
      : `await step(${frames});`}
    for (const k of held) send('keyup', k);
    return true;
  })();
})()
`;

/**
 * Which keys walk from `from` toward `to`. The dead band stops a stutter
 * between opposite keys; shrinking it is how a driver gets off a wall. Feet
 * collide where navigation planned from the origin, so a plan can be walkable
 * for the middle and a wall for the feet.
 */
function keysToward(from, to, deadband = 40) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const keys = [];
  if (Math.abs(dx) > deadband) keys.push(dx > 0 ? 'KeyD' : 'KeyA');
  if (Math.abs(dy) > deadband) keys.push(dy > 0 ? 'KeyW' : 'KeyS');
  return keys;
}

async function main() {
  if (!DIR || !existsSync(path.join(DIR, 'index.html'))) {
    console.error(`✗ no index.html under ${DIR || '(--dir not given)'}`);
    app.exit(2);
    return;
  }
  if (!ROUTE || !existsSync(ROUTE)) {
    console.error(`✗ no route file at ${ROUTE || '(--route not given)'}`);
    app.exit(2);
    return;
  }
  const route = JSON.parse(await readFile(ROUTE, 'utf8'));
  const server = await serve(DIR);
  const base = `http://127.0.0.1:${server.address().port}/?headless`;

  const win = new BrowserWindow({
    width: W, height: H, useContentSize: true, show: false,
    webPreferences: { offscreen: false, backgroundThrottling: false },
  });
  await win.webContents.session.clearCache();

  const errors = [];
  const stop = onRendererConsole(win.webContents, (msg) => {
    if (/error|uncaught|failed/i.test(msg)) errors.push(msg.slice(0, 300));
    if (msg.startsWith('[engine]') || logRe?.test(msg)) console.log(`  ${msg}`);
  });

  await win.loadURL(base);
  // Where the wall time goes, by what was asked of the page: a route that
  // takes 40 minutes on a runner is a driver question before it is an engine one.
  const spentOn = { probe: [0, 0], step: [0, 0], path: [0, 0], other: [0, 0] };
  const exec = (js, kind = 'other') => {
    const t = performance.now();
    return win.webContents.executeJavaScript(js).finally(() => {
      spentOn[kind][0] += performance.now() - t;
      spentOn[kind][1]++;
    });
  };

  // The handle appears as soon as the host builds it, which is before the first
  // scene has spawned anything — asking then is asking an empty world.
  let ready = false;
  for (let i = 0; i < 300 && !ready; i++) {
    ready = await exec(`(() => {
      const c = window.__estellaCooked;
      if (!c || !c.probe) return false;
      const s = c.probe(['Lyra_Player']);
      return !!(s.scene && s.at.Lyra_Player);
    })()`).catch(() => false);
    if (!ready) await new Promise((r) => setTimeout(r, 100));
  }
  if (!ready) {
    console.log('✗ the package never exposed a probe — is this a cooked build served with ?headless');
    stop(); server.close(); app.exit(1);
    return;
  }

  // From here the only frames are the ones this driver asks for. Without it the
  // world still advances between two steps by however long the round trip took,
  // which is the runner's load — the thing this route must not be a function of.
  const owned = await exec(`(() => {
    if (typeof window.__estellaCooked.setPaused !== 'function') return false;
    window.__estellaCooked.setPaused(true);
    return true;
  })()`).catch(() => false);
  if (!owned) {
    console.log('✗ this package cannot hand over its clock (no __estellaCooked.setPaused)');
    stop(); server.close(); app.exit(2);
    return;
  }

  // Read where `step` left the world: it resolves on a frame boundary, and the
  // driver holds the clock. Waiting for requestAnimationFrame first cost a
  // second per read in a hidden window — 407 s of a 412 s walk whose steps took 3.
  const probe = (names) => exec(`window.__estellaCooked.probe(${JSON.stringify(names)})`, 'probe');
  const pathTo = (goal) => exec(`window.__estellaCooked.pathBetween("Lyra_Player", ${JSON.stringify(goal)})`, 'path');
  // Every goal the route names, before a step is taken: a leg whose goal never
  // existed would otherwise report as "already done" and the run would fail
  // later, somewhere else, for a reason that is not the reason.
  const goals = [...new Set(route.legs.map((l) => l.goal))];
  const opening = await probe(goals);
  const missing = goals.filter((g) => !(g in opening.at));
  console.log(`  route names ${goals.length} goal(s); ${goals.length - missing.length} are in ${opening.scene}`
    + (missing.length ? `, not yet: ${missing.join(', ')}` : ''));

  const STEP = 8;
  // Nothing vanishes into a pack from across the room: a goal that goes while
  // Lyra is nowhere near it went for some other reason, and crediting that is
  // how a run reports legs it never walked.
  const REACH = 220;
  let frames = 0;
  const done = [];
  let failure = null;

  for (const leg of route.legs) {
    const label = `${leg.area}:${leg.goal}`;
    const timeout = Number(leg.timeout ?? 1800);
    // Only when the route asks for it: "gone" is the game's own answer, a distance
    // is this driver guessing at one. A default of 90 outran a PICKUP_RADIUS of
    // 70, leaving a ring that reports arrival while the game hands over nothing.
    const arriveWithin = leg.arriveWithin === undefined ? 0 : Number(leg.arriveWithin);
    let spent = 0;
    let arrived = false;
    let sawArea = false;
    let sawGoal = false;
    let lastGap = Infinity;
    let stuckFor = 0;
    let was = null;
    let deaths = 0;
    let plan = [];
    let replan = 0;
    let last = null;
    // Frames spent waiting for a scene to hand out its entities — disk and decode,
    // not walking, and charging the walk for it made one door cost 104 frames on
    // one run and 704 on the next. Capped: a door that never opens still fails.
    let waited = 0;
    const WAIT_CAP = 1800;

    // Something picked up on the way to somewhere else is still picked up. A
    // leg whose goal is already gone before it starts is a leg already walked —
    // and a goal that is merely misspelled fails the legs that depend on it.
    const opening = await probe([leg.goal, 'Lyra_Player']);
    if (opening.at.Lyra_Player && !opening.at[leg.goal] && !leg.throughDoor) {
      console.log(`  ${label} was already done (probe saw ${JSON.stringify(Object.keys(opening.at))} in ${opening.scene})`);
      done.push(label);
      continue;
    }

    while (spent < timeout && frames < BUDGET && waited < WAIT_CAP) {
      const state = await probe([leg.goal, 'Lyra_Player']);
      // Nothing is true about a world that is halfway through being replaced.
      if (state.transitioning) { await exec(stepScript([], STEP, null), 'step'); waited += STEP; frames += STEP; continue; }
      if (state.scene === leg.area) sawArea = true;
      // The leg is over when the area it was aiming for has been left behind:
      // walking into a door IS the arrival, and the door is gone by the time
      // anyone could measure standing next to it.
      if (sawArea && state.scene !== leg.area) { arrived = true; break; }

      const goal = state.at[leg.goal];
      const me = state.at.Lyra_Player;
      // A goal that was there and now is not was reached — taken, or killed —
      // but only while Lyra is beside it: an area rebuilding after a death
      // empties the world for a moment, and that is not an arrival.
      if (sawGoal && !goal && me && lastGap < REACH && !leg.throughDoor) {
        // One read is not evidence. Something that is really gone stays gone;
        // something that blinked was a world caught mid-change, and crediting
        // it costs the run a pickup it never took.
        let gone = true;
        for (let i = 0; i < 3 && gone; i++) {
          await exec(stepScript([], 4, null), 'step');
          spent += 4;
          frames += 4;
          gone = !(await probe([leg.goal])).at[leg.goal];
        }
        if (gone) { arrived = true; break; }
        console.log(`  ${label}: goal blinked out and came back — not counting it`);
      }
      if (goal) sawGoal = true;
      if (me && goal) {
        const gap = Math.hypot(goal.x - me.x, goal.y - me.y);
        last = { me, goal, gap };
        lastGap = gap;
        if (gap <= arriveWithin && !leg.throughDoor) { arrived = true; break; }
        // Re-planned every few steps rather than followed to the end: the route
        // is walked with enemies pushing back, so a plan is a heading, not a rail.
        if (!plan.length || replan <= 0) {
          plan = (await pathTo(leg.goal)) ?? [];
          replan = 40;
        }
        replan -= STEP;
        while (plan.length && Math.hypot(plan[0].x - me.x, plan[0].y - me.y) < 70) plan.shift();
        const aim = plan[0] ?? goal;
        // Pressed and did not move: back off the dead band so the other axis
        // comes into play, and re-plan sooner.
        const moved = was ? Math.hypot(me.x - was.x, me.y - was.y) : Infinity;
        // Nobody walks 600 units in eight frames: that is a death putting her
        // back at the area's entrance, and the leg deserves its time again.
        if (moved > 600 && was) { deaths++; spent = 0; plan = []; }
        stuckFor = moved < 6 ? stuckFor + STEP : 0;
        was = me;
        if (stuckFor > 64) { replan = 0; }
        const keys = keysToward(me, aim, stuckFor > 32 ? 4 : 40);
        if (stuckFor > 32) {
          // Slide along whatever is in the way: press the axis the heading does
          // not need, flipping which way every so often until something gives.
          const alongX = Math.abs(aim.x - me.x) >= Math.abs(aim.y - me.y);
          const up = Math.floor(stuckFor / 96) % 2 === 0;
          const side = alongX ? (up ? 'KeyW' : 'KeyS') : (up ? 'KeyD' : 'KeyA');
          if (!keys.includes(side)) keys.push(side);
        }
        if (TRACE && spent % 160 === 0) {
          console.log(`  ${label} @${spent}: at ${Math.round(me.x)},${Math.round(me.y)} `
            + `aim ${Math.round(aim.x)},${Math.round(aim.y)} (${plan.length} waypoints) keys ${keys.join('+') || 'none'} gap ${Math.round(gap)}`);
        }
        await exec(stepScript(keys, STEP, leg.swing ? 'Space' : null), 'step');
      } else {
        // Between areas: the next scene has not handed out its entities yet.
        await exec(stepScript([], STEP, null), 'step');
        waited += STEP;
        frames += STEP;
        continue;
      }
      spent += STEP;
      frames += STEP;
    }

    if (!arrived) {
      failure = `${label} — ${waited >= WAIT_CAP ? 'the scene never handed out its entities'
        : spent >= timeout ? 'ran out of leg budget' : 'ran out of run budget'} after ${spent} frames`
        + (last ? `; last seen ${Math.round(last.me.x)},${Math.round(last.me.y)} with the goal at `
          + `${Math.round(last.goal.x)},${Math.round(last.goal.y)} (${Math.round(last.gap)} away)` : '; never saw both')
        + (deaths ? `; died ${deaths}x on this leg` : '');
      break;
    }
    done.push(label);
    console.log(`  reached ${label} (${frames} frames in)`);
  }

  if (OUT) await writeFile(OUT, (await win.webContents.capturePage()).toPNG());
  const final = await probe([]).catch(() => ({ scene: null }));
  stop();
  server.close();

  const ok = !failure && errors.length === 0;
  console.log(`${ok ? '✓' : '✗'} ${path.basename(DIR)} — ${done.length}/${route.legs.length} legs, `
    + `${frames} frames, ended in ${final.scene ?? '(nothing)'}, errors=${errors.length}`);
  if (failure) console.log(`    ${failure}`);
  const secs = (k) => `${(spentOn[k][0] / 1000).toFixed(0)}s/${spentOn[k][1]}`;
  console.log(`    wall: step ${secs('step')}, probe ${secs('probe')}, path ${secs('path')}, other ${secs('other')}`);
  for (const e of errors.slice(0, 5)) console.log(`    ${e}`);
  app.exit(ok ? 0 : 1);
}

app.whenReady().then(main).catch((e) => {
  console.error('✗ play-through failed:', e);
  app.exit(2);
});
