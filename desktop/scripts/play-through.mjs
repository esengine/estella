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
 * `goal` is an entity name the probe can find, so a leg survives the level being
 * re-authored — the door moves, the route does not.
 *
 * NOT a gate yet, and deliberately not wired into verify. Runs of the same
 * package still disagree with each other: a leg occasionally reports arrival
 * from a pickup that was not taken, and the run then fails later at a door that
 * had every right to stay shut. Reading on a frame boundary and refusing a
 * world mid-transition fixed most of it; what remains is timing-sensitive
 * enough that adding console output changes the outcome, which is the shape of
 * a race that has not been found yet.
 */
import { app, BrowserWindow } from 'electron';
import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { onRendererConsole } from './rendererConsole.mjs';

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
  for (const k of held) send('keydown', k);
  ${tapKey ? `send('keydown', ${JSON.stringify(tapKey)});` : ''}
  return new Promise((resolve) => {
    let n = 0;
    const tick = () => {
      n++;
      ${tapKey ? `if (n === 2) send('keyup', ${JSON.stringify(tapKey)});` : ''}
      if (n >= ${frames}) {
        for (const k of held) send('keyup', k);
        return resolve(true);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
})()
`;

/** Which keys walk from `from` toward `to` on the ground plane. */
function keysToward(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const keys = [];
  // The dead band keeps a driver from stuttering between two opposite keys when
  // it is already lined up on one axis.
  if (Math.abs(dx) > 40) keys.push(dx > 0 ? 'KeyD' : 'KeyA');
  if (Math.abs(dy) > 40) keys.push(dy > 0 ? 'KeyW' : 'KeyS');
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
  const exec = (js) => win.webContents.executeJavaScript(js);

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

  // Read on a frame boundary. Poked from outside the loop, a read can land
  // between the systems that despawn something and the ones that replace it,
  // and every such read is a world nobody was ever in.
  const probe = (names) => exec(
    `new Promise((r) => requestAnimationFrame(() => r(window.__estellaCooked.probe(${JSON.stringify(names)}))))`,
  );
  const pathTo = (goal) => exec(`window.__estellaCooked.pathBetween("Lyra_Player", ${JSON.stringify(goal)})`);
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
    const arriveWithin = Number(leg.arriveWithin ?? 90);
    let spent = 0;
    let arrived = false;
    let sawArea = false;
    let sawGoal = false;
    let lastGap = Infinity;
    let plan = [];
    let replan = 0;
    let last = null;

    // Something picked up on the way to somewhere else is still picked up. A
    // leg whose goal is already gone before it starts is a leg already walked —
    // and a goal that is merely misspelled fails the legs that depend on it.
    const opening = await probe([leg.goal, 'Lyra_Player']);
    if (opening.at.Lyra_Player && !opening.at[leg.goal] && !leg.throughDoor) {
      console.log(`  ${label} was already done (probe saw ${JSON.stringify(Object.keys(opening.at))} in ${opening.scene})`);
      done.push(label);
      continue;
    }

    while (spent < timeout && frames < BUDGET) {
      const state = await probe([leg.goal, 'Lyra_Player']);
      // Nothing is true about a world that is halfway through being replaced.
      if (state.transitioning) { await exec(stepScript([], STEP, null)); spent += STEP; frames += STEP; continue; }
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
      if (sawGoal && !goal && me && lastGap < REACH && !leg.throughDoor) { arrived = true; break; }
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
        const keys = keysToward(me, aim);
        if (TRACE && spent % 160 === 0) {
          console.log(`  ${label} @${spent}: at ${Math.round(me.x)},${Math.round(me.y)} `
            + `aim ${Math.round(aim.x)},${Math.round(aim.y)} (${plan.length} waypoints) keys ${keys.join('+') || 'none'} gap ${Math.round(gap)}`);
        }
        await exec(stepScript(keys, STEP, leg.swing ? 'Space' : null));
      } else {
        // Between areas: the next scene has not handed out its entities yet.
        await exec(stepScript([], STEP, null));
      }
      spent += STEP;
      frames += STEP;
    }

    if (!arrived) {
      failure = `${label} — ${spent >= timeout ? 'ran out of leg budget' : 'ran out of run budget'} after ${spent} frames`
        + (last ? `; last seen ${Math.round(last.me.x)},${Math.round(last.me.y)} with the goal at `
          + `${Math.round(last.goal.x)},${Math.round(last.goal.y)} (${Math.round(last.gap)} away)` : '; never saw both');
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
  for (const e of errors.slice(0, 5)) console.log(`    ${e}`);
  app.exit(ok ? 0 : 1);
}

app.whenReady().then(main).catch((e) => {
  console.error('✗ play-through failed:', e);
  app.exit(2);
});
