import { chromium } from 'playwright';
import path from 'node:path';
import { serveHost } from '../../../tools/lib/staticServer.mjs';

const root = path.resolve('output/space-frigate');
const angle = process.platform === 'win32' ? 'd3d11' : process.platform === 'darwin' ? 'metal' : 'swiftshader';
const server = await serveHost(path.join(root, 'web'));
const browser = await chromium.launch({
    headless: true,
    args: [`--use-angle=${angle}`, '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const problems = [];
const findings = [];
const expect = (what, ok, detail) => { findings.push({ what, ok, detail }); if (!ok) problems.push(`${what}: ${JSON.stringify(detail)}`); };
try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => problems.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text().slice(0, 400)); });
    await page.goto(`http://127.0.0.1:${server.address().port}/?headless`, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => window.__estellaCooked?.facts().ready, null, { timeout: 120000 });
    await page.waitForFunction(() => window.__spaceHud?.ready || window.__spaceHud?.error, null, { timeout: 120000 }).catch(() => {});
    await page.mouse.move(960, 540);
    await page.keyboard.press('ShiftLeft');

    const facts = () => page.evaluate(() => window.__estellaCooked.facts());
    const hud = () => page.evaluate(() => ({ ...window.__spaceHud }));
    const when = (test, arg, timeout = 60000) => page.waitForFunction(test, arg, { timeout }).then(() => true, () => false);
    const hear = async () => {
        let low = 0, high = 0;
        const reads = 10;
        for (let i = 0; i < reads; i++) {
            await page.waitForTimeout(150);
            const f = await facts();
            low += f.soundLow / reads;
            high += f.soundHigh / reads;
        }
        return { low, high };
    };
    const holdUntil = async (key, test, timeout = 30000) => {
        await page.keyboard.down(key);
        const ok = await when(test, null, timeout);
        await page.keyboard.up(key);
        return ok;
    };

    const raised = await when(() => window.__estellaCooked.facts().soundEngine === true, null, 20000);
    expect('the engine voice is raised when the scene is up', raised, await facts());
    expect('this browser lets the mixer be measured', (await facts()).soundMeasured === true, await facts());
    expect('the music starts with the scene', await when(() => window.__estellaCooked.facts().soundMusic === true && window.__estellaCooked.facts().soundLow > 0.02, null, 60000), await facts());
    const tap = async (key) => { await page.keyboard.down(key); await page.waitForTimeout(150); await page.keyboard.up(key); await page.waitForTimeout(150); };
    await tap('KeyM');
    expect('M stops the music', await when(() => window.__estellaCooked.facts().soundMusic === false, null, 5000), await facts());
    await page.waitForTimeout(1500);
    await tap('Digit1');
    expect('1 holds the camera at one distance', (await facts()).tour === false, await facts());
    const heard = await when(() => window.__estellaCooked.facts().soundLow > 0.02, null, 30000);
    expect('the engine is heard at the mixer output with the music off', heard, await facts());

    const cuesAtStart = (await facts()).soundCues;
    expect('S brings the engine order down to stop', await holdUntil('KeyS', () => window.__estellaCooked.facts().throttle < 0.08), (await facts()).throttle);
    const idleFacts = await facts(), idle = await hear();
    expect('W brings it up to full', await holdUntil('KeyW', () => window.__estellaCooked.facts().throttle > 0.92), (await facts()).throttle);
    const fullFacts = await facts(), full = await hear();
    expect('the engine is asked for more volume and a higher pitch at full than at stop',
        fullFacts.soundEngineVolume > idleFacts.soundEngineVolume && fullFacts.soundEnginePitch > idleFacts.soundEnginePitch,
        { idle: [idleFacts.soundEngineVolume, idleFacts.soundEnginePitch], full: [fullFacts.soundEngineVolume, fullFacts.soundEnginePitch] });
    expect('and the mixer output is louder at full than at stop', full.low > idle.low + 0.01, { idle, full });
    await tap('Digit5');
    await page.waitForTimeout(600);
    const nearFacts = await facts(), near = await hear();
    await tap('Digit3');
    await page.waitForTimeout(600);
    const farFacts = await facts(), far = await hear();
    expect('the far shot is further from the engines and is given less of them',
        farFacts.soundEngineDistance > nearFacts.soundEngineDistance + 40 && farFacts.soundEngineHeard < nearFacts.soundEngineHeard * 0.6,
        { near: [nearFacts.soundEngineDistance, nearFacts.soundEngineHeard], far: [farFacts.soundEngineDistance, farFacts.soundEngineHeard] });
    expect('and the mixer output is quieter from far than from near', near.low > far.low + 0.01, { near, far });
    expect('each engine order ticked', fullFacts.soundCues >= cuesAtStart + 2 && fullFacts.soundLastCue === 'helmOrder', { cuesAtStart, cues: fullFacts.soundCues, last: fullFacts.soundLastCue });

    expect('S brings it back to stop before mining', await holdUntil('KeyS', () => window.__estellaCooked.facts().throttle < 0.08), (await facts()).throttle);
    const press = tap;
    const quiet = await hear();
    const refused = [];
    let firing = false;
    for (let tries = 0; tries < 16 && !firing; tries++) {
        await press('KeyT');
        if (!(await when(() => window.__spaceHud.locked === true, null, 8000))) { refused.push('no lock'); continue; }
        await press('KeyF');
        firing = await when(() => window.__spaceHud.mining.firing === true, null, 3000);
        if (firing) break;
        const held = (await hud()).mining;
        refused.push(held.reason || 'not firing');
        if (held.armed) await press('KeyF');
    }
    expect('a rock can be locked and mined', firing, { refused, mining: { ...(await hud()).mining, integrity: undefined } });
    if (firing) {
        expect('the beam voice is raised while it fires', await when(() => window.__estellaCooked.facts().soundBeam === true, null, 5000), await facts());
        const cutting = await hear();
        expect('the beam is heard above the engine band', cutting.high > quiet.high + 0.01, { quiet, cutting });
        const brokenBefore = (await hud()).mining.broken;
        const cuesBefore = (await facts()).soundCues;
        const broke = await when((n) => window.__spaceHud.mining.broken > n, brokenBefore, 90000);
        expect('the rock breaks', broke, { ...(await hud()).mining, integrity: undefined });
        if (broke) {
            const after = await facts();
            expect('breaking it is cued', ['rockBreak', 'alarm'].includes(after.soundLastCue) && after.soundCues > cuesBefore, { cuesBefore, after });
            expect('the beam voice is lowered once nothing fires', await when(() => window.__estellaCooked.facts().soundBeam === false, null, 5000), await facts());
            await page.waitForTimeout(2500);
            const settled = await hear();
            expect('and the band above the engine falls back', settled.high < cutting.high - 0.005, { cutting, settled });
        }
    }
} finally {
    await browser.close();
    server.close();
}
console.log(JSON.stringify({ findings, problems: [...new Set(problems)] }, null, 1));
if (problems.length > 0) process.exitCode = 1;
