// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serveHost } from './lib/staticServer.mjs';
import zlib from 'node:zlib';

function encodePng(width, height, rgba) {
    const stride = width * 4;
    const raw = Buffer.alloc((stride + 1) * height);
    for (let y = 0; y < height; y++) rgba.copy(raw, y * (stride + 1) + 1, (height - 1 - y) * stride, (height - y) * stride);
    const table = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
    const chunk = (type, data) => {
        const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
        let crc = -1;
        for (const byte of body) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
        const out = Buffer.alloc(body.length + 8);
        out.writeUInt32BE(data.length, 0);
        body.copy(out, 4);
        out.writeUInt32BE((crc ^ -1) >>> 0, body.length + 4);
        return out;
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header.set([8, 6, 0, 0, 0], 8);
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const flag = (name) => { const at = process.argv.indexOf(name); return at < 0 ? undefined : process.argv[at + 1]; };
const dir = path.resolve(flag('--dir') ?? 'output/last-signal-web');
const out = path.resolve(flag('--out') ?? 'output/last-signal-check');
const GRID = 64, CELL = 2, UNITS = 100, MAP = { left: 16, top: 16, cell: 4 }, VIEW = { width: 1280, height: 720 };

fs.mkdirSync(out, { recursive: true });
const server = await serveHost(dir);
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--mute-audio'] });
const passed = [], errors = [], records = [];
const pass = (item, what) => { passed.push(item); console.log(`✓ ${item}  ${what}`); };

try {
    const context = await browser.newContext({ viewport: VIEW });
    const open = async () => {
        const page = await context.newPage();
        page.on('pageerror', (error) => errors.push(String(error)));
        page.on('console', (message) => fs.appendFileSync(path.join(out, 'console.log'), `${message.type()}: ${message.text()}\n`));
        await page.goto(`${origin}/?headless`);
        await page.waitForFunction(() => window.__estellaCooked?.facts()?.ready === true, {}, { timeout: 60000 });
        await page.waitForFunction(() => { const e = document.getElementById('es-splash'); return !e || Number(getComputedStyle(e).opacity) === 0; });
        await page.evaluate(() => window.__estellaCooked.setPaused(true));
        return page;
    };
    let page = await open();
    const facts = () => page.evaluate(() => window.__estellaCooked.facts());
    const probe = (names) => page.evaluate((n) => window.__estellaCooked.probe(n).at, names);
    const step = async (frames) => {
        for (let done = 0; done < frames; done += 30) {
            await page.evaluate((n) => window.__estellaCooked.step(n, 1 / 60), Math.min(30, frames - done));
            await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
        }
    };
    const press = async (code) => {
        await page.evaluate((code) => {
            window.__lastSignalKey = new Promise((resolve, reject) => {
                const sample = (event) => {
                    if (event.code !== code) return;
                    window.removeEventListener('keydown', sample);
                    window.__estellaCooked.step(1, 1 / 60).then(resolve, reject);
                };
                window.addEventListener('keydown', sample);
            });
        }, code);
        await page.keyboard.down(code);
        await page.evaluate(() => window.__lastSignalKey);
        await page.keyboard.up(code);
        await page.evaluate(() => window.__estellaCooked.step(1, 1 / 60));
    };
    const cursorTo = async (x, y) => {
        for (let guard = 0; guard < 200; guard++) {
            const f = await facts();
            if (f.cursorX === x && f.cursorY === y) return;
            await press(f.cursorX < x ? 'ArrowRight' : f.cursorX > x ? 'ArrowLeft' : f.cursorY < y ? 'ArrowDown' : 'ArrowUp');
        }
        assert.fail(`the cursor never reached ${x}, ${y}`);
    };
    const shot = async (name) => {
        const frame = await page.evaluate(() => {
            const { width, height, rgba } = window.__estellaCooked.capture();
            let text = '';
            for (let i = 0; i < rgba.length; i += 32768) text += String.fromCharCode(...rgba.subarray(i, i + 32768));
            return { width, height, data: btoa(text) };
        });
        fs.writeFileSync(path.join(out, `${name}.png`), encodePng(frame.width, frame.height, Buffer.from(frame.data, 'base64')));
    };
    const luminance = () => page.evaluate(() => {
        const { width, height, rgba } = window.__estellaCooked.capture();
        let sum = 0, count = 0;
        for (let i = 0; i < width * height * 4; i += 4 * 97) { sum += 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2]; count += 1; }
        return sum / count;
    });
    const record = async (name, extra = {}) => { const f = await facts(); records.push({ name, facts: f, ...extra }); fs.writeFileSync(path.join(out, 'observations.json'), JSON.stringify({ passed, errors, records }, null, 2)); return f; };
    const cellOfWorld = (p) => ({ x: Math.floor(p.x / UNITS / CELL + GRID / 2), y: Math.floor(p.z / UNITS / CELL + GRID / 2) });
    const cellOfMark = (p, size) => ({ x: Math.round((p.x + VIEW.width / 2 - size / 2 - MAP.left - (MAP.cell - size) / 2) / MAP.cell), y: Math.round((VIEW.height / 2 - p.y - size / 2 - MAP.top - (MAP.cell - size) / 2) / MAP.cell) });
    const viewsAgree = async (label) => {
        const f = await facts();
        const layout = f.layout === '' ? [] : f.layout.split(';').map((entry) => { const [id, kind, x, y] = entry.split(':'); return { id: Number(id), kind, x: Number(x), y: Number(y) }; });
        assert.equal(layout.length, f.buildings, `${label}: the layout lists a different number of buildings`);
        const names = ['Drone', 'MapDrone', ...layout.flatMap((b) => [`Building ${b.id}`, `MapBuilding ${b.id}`])];
        const at = await probe(names);
        for (const name of names) assert(at[name], `${label}: ${name} is not in the world`);
        assert.deepEqual(cellOfWorld(at.Drone), { x: f.droneX, y: f.droneY }, `${label}: the 3D drone is not on the cell the state names`);
        assert.deepEqual(cellOfMark(at.MapDrone, 6), { x: f.droneX, y: f.droneY }, `${label}: the map's drone is not on the cell the state names`);
        for (const b of layout) {
            assert.deepEqual(cellOfWorld(at[`Building ${b.id}`]), { x: b.x, y: b.y }, `${label}: 3D building ${b.id} is off its cell`);
            assert.deepEqual(cellOfMark(at[`MapBuilding ${b.id}`], MAP.cell), { x: b.x, y: b.y }, `${label}: map building ${b.id} is off its cell`);
        }
        return layout.length;
    };

    const start = await record('start');
    assert.equal(start.restored, false, 'a fresh profile started from a save');
    assert.equal(start.buildings, 2);
    assert.equal(start.blockedCells, 2);
    await shot('01-start');
    await viewsAgree('start');

    let f = start;
    for (let i = 0; i < 80 && f.trips < 1; i++) { await step(30); f = await facts(); }
    assert(f.trips >= 1, `the drone finished no trip in 40 s (leg ${f.leg}, at ${f.droneX}, ${f.droneY}, route ${f.route})`);
    assert.equal(f.ore, f.trips * 5, 'ore does not match the trips made');
    await record('first-trip');
    pass('4 运输循环', `${f.trips} 趟，矿石 ${f.ore}`);

    for (let i = 0; i < 200 && !(f.leg === 'toStore' && f.droneX >= 22 && f.droneX <= 26); i++) { await step(5); f = await facts(); }
    assert(f.leg === 'toStore' && f.droneX <= 26, 'the drone was never caught early on its way to the storehouse');
    const before = await record('before-wall');
    await cursorTo(34, 32);
    assert.equal((await facts()).cursorWalkable, true);
    await press('Enter');
    f = await facts();
    assert.equal(f.cursorWalkable, false, 'the cell under a new building is still walkable in the engine grid');
    assert.equal(f.buildings, before.buildings + 1);
    assert.equal(f.blockedCells, f.buildings, 'the engine grid and the state disagree on how many cells are blocked');
    pass('1 放置即阻挡', `(34,32) 放下后引擎格子不可走，阻挡格 ${f.blockedCells}`);
    for (const y of [31, 33, 30, 34, 29, 35]) { await cursorTo(34, y); await press('Enter'); }
    f = await record('wall-built');
    assert.equal(f.buildings, before.buildings + 7);
    assert.equal(f.blockedCells, f.buildings);
    assert(f.leg === 'toStore' && f.droneX < 34, `the wall went up after the drone had passed (drone at ${f.droneX})`);
    await viewsAgree('wall-built');
    await shot('02-wall');

    const tripsBefore = f.trips, trail = [];
    for (let i = 0; i < 400 && f.trips === tripsBefore; i++) { await step(5); f = await facts(); trail.push([f.droneX, f.droneY]); }
    await record('detour', { trail });
    assert.equal(f.trips, tripsBefore + 1, `the drone never delivered past the wall (at ${f.droneX}, ${f.droneY}, route ${f.route})`);
    assert.equal(f.everInsideBuilding, false, 'the drone stood inside a building');
    const crossing = trail.filter(([x]) => x === 34).map(([, y]) => y);
    assert(crossing.length > 0, 'the drone was never seen on column 34');
    assert(crossing.every((y) => y < 29 || y > 35), `the drone crossed the wall's column inside the wall: rows ${crossing}`);
    assert(f.plans > before.plans, 'no route was planned after the wall went up');
    pass('2 途中重新寻路', `绕过 x=34 的墙，穿越行 ${[...new Set(crossing)]}，规划次数 ${before.plans}→${f.plans}`);

    await cursorTo(34, 32);
    await press('Backspace');
    f = await facts();
    assert.equal(f.cursorWalkable, true, 'the cell is still blocked after its building was removed');
    assert.equal(f.blockedCells, f.buildings);
    assert.equal(f.buildings, before.buildings + 6);
    await viewsAgree('gap-opened');
    const tripsOpen = f.trips, straight = [];
    for (let i = 0; i < 800 && f.trips < tripsOpen + 2; i++) { await step(5); f = await facts(); straight.push([f.droneX, f.droneY]); }
    const through = straight.filter(([x]) => x === 34).map(([, y]) => y);
    assert(through.length > 0 && through.every((y) => y === 32), `after the gap opened the drone did not use it: rows ${[...new Set(through)]}`);
    await record('gap-used', { trail: straight });
    await shot('03-gap');
    pass('3 拆除即恢复', `(34,32) 拆除后可走，无人机改走缺口`);
    pass('5 2D 与 3D 一致', '起始、筑墙后、开缺口后三次逐个比对建筑与无人机所在格');

    await press('KeyT');
    assert.equal((await facts()).fast, true);
    const hourStart = (await facts()).hoursElapsed, light = [];
    for (let i = 0; i < 16; i++) {
        await step(100);
        f = await facts();
        const mean = await luminance();
        light.push({ hour: Number(f.hour.toFixed(2)), mean: Number(mean.toFixed(1)) });
        await shot(`04-day-${String(i).padStart(2, '0')}-h${String(Math.floor(f.hour)).padStart(2, '0')}`);
    }
    await press('KeyT');
    f = await record('day', { light });
    assert(f.hoursElapsed - hourStart >= 24, `only ${(f.hoursElapsed - hourStart).toFixed(1)} hours passed`);
    const day = light.filter((s) => s.hour >= 10 && s.hour <= 14), night = light.filter((s) => s.hour <= 3 || s.hour >= 22);
    assert(day.length > 0 && night.length > 0, 'the samples missed noon or midnight');
    const noon = Math.max(...day.map((s) => s.mean)), dark = Math.min(...night.map((s) => s.mean));
    assert(noon > dark * 1.5 && noon > 40, `noon (${noon}) is not clearly brighter than night (${dark})`);
    assert(light.every((s) => s.mean > 1 && s.mean < 250), `a frame was black or blown out: ${JSON.stringify(light)}`);
    pass('6 昼夜一轮', `经过 ${(f.hoursElapsed - hourStart).toFixed(1)} 小时，正午亮度 ${noon}，夜间 ${dark}`);

    await press('KeyK');
    f = await record('saved');
    assert.equal(f.saves, 1);
    const stored = await page.evaluate(() => { const key = Object.keys(localStorage).find((k) => k.includes('last-signal:gate0')); return key ? { key, value: localStorage.getItem(key) } : null; });
    assert(stored, 'no save was written to storage');
    const envelope = JSON.parse(stored.value);
    const data = envelope.data;
    assert.equal(envelope.version, 1);
    assert.equal(data.buildings.length, f.buildings);
    assert.equal(data.buildings.map((b) => `${b.id}:${b.kind}:${b.x}:${b.y}`).join(';'), f.layout);
    assert.equal(data.ore, f.ore);
    assert.equal(data.trips, f.trips);
    assert(Math.abs(data.hour - f.hour) < 0.05, `the saved hour ${data.hour} is not the hour shown ${f.hour}`);
    assert.equal(data.drone.cargo, f.cargo);
    assert.equal(data.drone.leg, f.leg);
    pass('7 快照内容', `${data.buildings.length} 座建筑、矿石 ${data.ore}、${data.trips} 趟、时刻 ${data.hour.toFixed(2)}`);

    const saved = f;
    await step(300);
    await page.close();
    page = await open();
    f = await record('reopened');
    assert.equal(f.restored, true, 'a new page did not start from the save');
    assert.equal(f.layout, saved.layout);
    assert.equal(f.ore, saved.ore);
    assert.equal(f.trips, saved.trips);
    assert.equal(f.cargo, saved.cargo);
    assert.equal(f.leg, saved.leg);
    assert.deepEqual([f.droneX, f.droneY], [saved.droneX, saved.droneY]);
    assert(Math.abs(f.hour - saved.hour) < 0.1, `the hour came back as ${f.hour}, saved ${saved.hour}`);
    assert.equal(f.blockedCells, f.buildings);
    await viewsAgree('reopened');
    const tripsBack = f.trips;
    for (let i = 0; i < 200 && f.trips === tripsBack; i++) { await step(30); f = await facts(); }
    assert(f.trips > tripsBack, 'the drone did not carry on after the restore');
    await shot('05-restored');
    pass('8 重开后恢复（网页同一存储，非 Windows 进程）', `建筑、矿石、趟数、无人机格、时刻与存档一致，恢复后继续运输`);

    assert.deepEqual(errors, [], `script errors before the probe: ${errors.join(' | ')}`);
    await press('KeyP').catch(() => {});
    await page.waitForTimeout(200);
    assert(errors.some((e) => e.includes('last-signal probe')), `the deliberate script error was not reported: ${JSON.stringify(errors)}`);
    pass('9 脚本错误可见（网页控制台，非持久化日志）', errors.find((e) => e.includes('last-signal probe')));
    fs.writeFileSync(path.join(out, 'observations.json'), JSON.stringify({ passed, errors, records }, null, 2));
    console.log(`verify-last-signal: ${passed.length} checks passed.`);
} finally {
    await browser.close();
    server.close();
}
