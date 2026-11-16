import { chromium } from 'playwright';
import path from 'node:path';
import { serveHost } from '../../../tools/lib/staticServer.mjs';

const root = path.resolve('output/space-frigate');
const angle = process.platform === 'win32' ? 'd3d11' : process.platform === 'darwin' ? 'metal' : 'swiftshader';
const server = await serveHost(path.join(root, 'web'));
const browser = await chromium.launch({ headless: true, args: [`--use-angle=${angle}`, '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const problems = [];
const findings = [];
const expect = (what, ok, detail) => { findings.push({ what, ok, detail }); if (!ok) problems.push(`${what}: ${JSON.stringify(detail)}`); };
try {
    const page = await browser.newPage({ viewport: { width: 800, height: 450 }, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => problems.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text().slice(0, 400)); });
    await page.goto(`http://127.0.0.1:${server.address().port}/?headless`, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => window.__estellaCooked?.facts().ready, null, { timeout: 120000 });
    await page.evaluate(() => window.__estellaCooked.setPaused(true));
    const step = (n) => page.evaluate((frames) => window.__estellaCooked.step(frames), n);
    const facts = () => page.evaluate(() => window.__estellaCooked.facts());
    const tap = async (key) => { await page.keyboard.down(key); await step(1); await page.keyboard.up(key); await step(1); };
    const camera = () => page.evaluate(() => { const f = window.__estellaCooked.facts(); return [f.eyeX, f.eyeY, f.eyeZ]; });
    await page.mouse.move(400, 225);

    await step(30);
    const idle = await facts();
    expect('the tour runs untouched', idle.tour === true && idle.throttle > 0.6 && idle.throttle < 0.8, [idle.tour, idle.throttle]);

    await page.keyboard.down('KeyS');
    await step(150);
    await page.keyboard.up('KeyS');
    const slow = await facts();
    expect('S eases the throttle down', slow.throttle < 0.1, slow.throttle);
    expect('the throttle alone leaves the tour running', slow.tour === true, slow.tour);

    await page.keyboard.down('KeyW');
    await step(240);
    await page.keyboard.up('KeyW');
    const fast = await facts();
    expect('W pushes it to full', fast.throttle > 0.9, fast.throttle);

    const helm = () => page.evaluate(() => { const h = window.__spaceHud.helm; return { rudder: h.rudder, elevation: h.elevation, forward: h.forward, lean: h.lean, mode: h.mode }; });
    const apart = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    await tap('KeyD');
    await tap('KeyD');
    await tap('KeyD');
    const over = await helm();
    expect('D puts the rudder over a place at a time, and it stays there', Math.abs(over.rudder - 1) < 1e-6, over);
    const jets = (await facts()).jets;
    expect('and her thrusters fire to start the turn', jets.startsWith('-1.00'), jets);
    expect('steering leaves the tour running', (await facts()).tour === true, over);
    let astern = 1;
    for (let second = 0; second < 22; second++) { await step(60); astern = Math.min(astern, (await helm()).forward.z); }
    expect('left over, the rudder takes her all the way round', astern < -0.95 && (await helm()).forward.z > 0.3, astern);
    await tap('KeyX');
    await tap('KeyE');
    await tap('KeyE');
    let top = 0;
    for (let second = 0; second < 9; second++) { await step(60); top = Math.max(top, (await helm()).forward.y); }
    expect('E pitches her up, past the vertical', top > 0.95, top);
    await tap('KeyX');
    await step(240);
    const held = await helm();
    await step(600);
    const later = await helm();
    expect('with the helm amidships she keeps the attitude she has and does not come level', apart(held.forward, later.forward) < 0.01 && apart(later.forward, { x: 0, y: 0, z: 1 }) > 0.3 && later.rudder === 0 && later.elevation === 0, { held, later });

    await tap('KeyD');
    await step(240);
    await tap('KeyX');
    await step(120);
    await tap('KeyZ');
    const levelling = await helm();
    await step(60 * 45);
    const level = await helm();
    expect('Z brings her level from wherever she is, and then gives the helm back', levelling.mode === 'level' && level.mode === 'manual' && Math.abs(level.forward.y) < 0.02 && Math.abs(level.lean) < 0.02, { levelling, level });

    await tap('Digit5');
    const near = await camera();
    expect('5 jumps to the close shot', Math.abs(Math.hypot(near[0], near[1] - 7, near[2] + 15) - 36) < 0.5, near);

    await page.mouse.down();
    for (let x = 420; x <= 520; x += 20) {
        await page.mouse.move(x, 225);
        await step(1);
    }
    await page.mouse.up();
    const dragged = await camera();
    expect('a drag orbits', Math.hypot(dragged[0] - near[0], dragged[2] - near[2]) > 3, { near, dragged });

    await tap('Space');
    const back = await facts();
    expect('Space hands the camera back to the tour', back.tour === true, back);

    const guns = (f) => ({ view: f.gunView, source: f.gunSource, bearing: f.gunBearing, ready: f.gunReady, shots: f.gunShots, train: f.gunTrain, tour: f.tour });
    expect('with no target and no sight the guns are stowed fore and aft', back.gunSource === 'stowed' && back.gunBearing === 0, guns(back));
    await tap('KeyG');
    await step(320);
    const sighted = await facts();
    expect('G takes the gunnery view', sighted.gunView === true && sighted.tour === false && sighted.gunSource === 'view', guns(sighted));
    expect('and the guns that can see past the ship lay on it', sighted.gunBearing >= 3 && sighted.gunReady === sighted.gunBearing, guns(sighted));
    await page.mouse.move(360, 150);
    await page.mouse.down();
    for (let x = 380; x <= 620; x += 20) { await page.mouse.move(x, 150); await step(1); }
    await page.mouse.up();
    await step(2);
    const turning = await facts();
    expect('turning the view leaves the guns training behind it', turning.gunReady === 0 && turning.gunTrain !== sighted.gunTrain, guns(turning));
    await step(480);
    const laid = await facts();
    expect('until they come to bear again', laid.gunReady >= 3, guns(laid));
    await tap('Space');
    const one = await facts();
    expect('Space fires one turret and leaves the view alone', one.gunShots === laid.gunShots + 1 && one.gunView === true && one.tour === false, guns(one));
    await step(20);
    await tap('Space');
    await tap('Space');
    const salvo = await facts();
    expect('pressed twice at once it fires every gun that is ready', salvo.gunShots === one.gunShots + laid.gunReady - 1 && salvo.gunReady === 0, guns(salvo));
    await step(200);
    const loaded = await facts();
    expect('and they load again', loaded.gunReady >= 3, guns(loaded));
    const spots = await page.evaluate(() => window.__spaceHud.guns.spots);
    const scale = 450 / 900;
    await page.mouse.move(spots.fire.left * scale, spots.fire.top * scale);
    await page.mouse.down();
    await step(3);
    const pressed = await facts();
    await page.mouse.up();
    await step(2);
    expect('the FIRE button on the glass fires a turret, for a hand with no keyboard', pressed.gunShots === loaded.gunShots + 1, guns(pressed));
    expect('and pressing it does not swing the view', Math.hypot(pressed.eyeX - loaded.eyeX, pressed.eyeZ - loaded.eyeZ) < 0.5, [pressed.eyeX, loaded.eyeX]);
    await tap('KeyG');
    await step(30);
    const stowed = await facts();
    expect('G gives the view back and the guns stow', stowed.gunView === false && stowed.gunSource === 'stowed', guns(stowed));

    await tap('KeyT');
    await step(120);
    const tracking = await facts();
    expect('a locked target is followed by the guns, which hold their fire', tracking.gunSource === 'target' && tracking.gunShots === pressed.gunShots, guns(tracking));
    await tap('KeyC');
    await step(30);
    const cruising = await facts();
    expect('out of combat C does nothing: the guns are a combat tool', cruising.gunAuto === false && cruising.gunSource === 'target', guns(cruising));
    await tap('KeyG');
    await step(20);
    await tap('KeyC');
    await step(80);
    const auto = await facts();
    expect('C lets them fire on it themselves', auto.gunAuto === true && auto.gunSource === 'auto' && (auto.gunShots > tracking.gunShots || auto.gunBearing === 0), guns(auto));
    expect('laying ahead of it by a flight time, with a spread that narrows as the solution is held', auto.gunLead > 0 && auto.gunSpread > 0.25 && auto.gunHeld > 1, { lead: auto.gunLead, spread: auto.gunSpread, held: auto.gunHeld });
    await tap('KeyC');
    await step(30);
    const quiet = await facts();
    await step(240);
    const still = await facts();
    expect('and C again stops them', still.gunAuto === false && still.gunShots === quiet.gunShots, guns(still));
    await tap('KeyC');
    await step(10);
    await tap('KeyG');
    await step(30);
    const left = await facts();
    expect('leaving combat takes auto fire off with it', left.gunView === false && left.gunAuto === false, guns(left));
} finally {
    await browser.close();
    server.close();
}
console.log(JSON.stringify({ findings, problems: [...new Set(problems)] }, null, 1));
if (problems.length > 0) process.exitCode = 1;
