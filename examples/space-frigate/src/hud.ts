import {
    Assets, Camera, FillMethod, FillOrigin, Input, ScreenOverlay, TextAlign, Transform, UIVisual, UIVisualType,
    defineSystem, GetWorld, Res, Time,
} from 'esengine';
import type { App, Entity, World } from 'esengine';
import { SHOTS, SHOT_SECONDS, clamp } from './flight';
import { helm, stepHelm } from './helm';
import {
    ALERT, AMBER, DESIGN, EDGE, FONTS, HAZE, ICE, TEXTURES, createKit, ease, pad, rgb, stamp,
    type Frame, type Log, type Rgba, type Rock, type Textures,
} from './hudKit';
import { MINING, installMining, mining } from './hudMining';
import { buildHelm } from './hudHelm';
import { buildScope } from './hudScope';
import { buildTargets } from './hudTargets';
import { ship } from './shipState';

const GAUGE = { box: 320, sweep: 0.75, fullScale: 440, redline: 400, labels: 114, command: 106 };
const BAR_CELLS = 24;
const ROCKS = 46;
const MAJOR_FROM = 40;
const LOG_LINES = 4;
const BOOT_SECONDS = 2.6;

type Loaded = { textures: Textures; fonts: { regular: number; strong: number } };

const state = { ready: false, loadMs: 0, error: '', waypointClamped: true, selected: -1, current: -1, locked: false, booted: false, mining: mining, helm: helm, picks: [] as { index: number; x: number; y: number }[], spots: {} as Record<string, { x: number; y: number }> };

export function installHud(app: App): void {
    let loading: Promise<Loaded> | null = null;
    let loaded: Loaded | null = null;
    let update: ((dt: number, input: InputState) => void) | null = null;

    const majors: Entity[] = [];
    app.addSystem(defineSystem([GetWorld(), Res(Time), Res(Input)], (world, time, input) => {
        if (world.findEntityByName('Camera') === null) return;
        const moved = stepHelm({
            ahead: input.isKeyDown('KeyW'), astern: input.isKeyDown('KeyS'), port: input.isKeyDown('ArrowLeft'), starboard: input.isKeyDown('ArrowRight'),
            climb: input.isKeyDown('ArrowUp'), dive: input.isKeyDown('ArrowDown'), steady: input.isKeyDown('KeyX'), approach: input.isKeyDown('KeyV'), align: input.isKeyDown('KeyB'),
        }, Math.min(time.delta, 0.05));
        if (majors.length === 0) {
            for (let i = MAJOR_FROM; i < ROCKS; i++) { const e = world.findEntityByName(`Rock${i}`); if (e !== null) majors.push(e); }
        }
        for (const e of majors) world.update(e, Transform, (t) => { t.position = { x: t.position.x + moved.x, y: t.position.y + moved.y, z: t.position.z + moved.z }; });
    }));
    app.addSystem(defineSystem([GetWorld(), Res(Time), Res(Input)], (world, time, input) => {
        if (update) { update(Math.min(time.delta, 0.05), input); return; }
        if (world.findEntityByName('Camera') === null) return;
        if (!loading) {
            const began = Date.now();
            (globalThis as { __spaceHud?: typeof state }).__spaceHud = state;
            loading = load(app);
            loading.then((got) => { loaded = got; state.loadMs = Date.now() - began; }, (err: unknown) => {
                state.error = err instanceof Error ? err.message : String(err);
                console.error(`space-frigate HUD did not load: ${state.error}`);
            });
        }
        if (loaded) {
            update = build(app, world, loaded);
            state.ready = true;
        }
    }));
}

type InputState = { isKeyDown(key: string): boolean; isMouseButtonDown(button: number): boolean };

async function load(app: App): Promise<Loaded> {
    const assets = app.getResource(Assets);
    const names = Object.keys(TEXTURES) as (keyof typeof TEXTURES)[];
    const textures = await Promise.all(names.map((name) => assets.loadTexture(TEXTURES[name])));
    const [regular, strong] = await Promise.all([assets.loadFont(FONTS.regular), assets.loadFont(FONTS.strong)]);
    return {
        textures: Object.fromEntries(names.map((name, i) => [name, textures[i]!.handle])) as Textures,
        fonts: { regular: regular.handle, strong: strong.handle },
    };
}

function build(app: App, world: World, { textures, fonts }: Loaded): (dt: number, input: InputState) => void {
    const kit = createKit(world, textures, fonts);
    const { root, node, image, sliced, solid, label, pivot, tilt, lift, glow, say, ink, fill, fade, place } = kit;
    app.getResource(ScreenOverlay).perspective = 1500;

    image(root, 'ScrimTop', { left: 0, right: 0, top: 0, height: 170 }, textures.scrimTop);
    image(root, 'ShadeIdentity', { left: -120, top: -70, width: 680, height: 320 }, textures.shade);
    image(root, 'ShadeView', { right: -120, top: -70, width: 560, height: 270 }, textures.shade);
    image(root, 'ScrimBottom', { left: 0, right: 0, bottom: 0, height: 300 }, textures.scrimBottom);

    const identityAt = pivot(root, 'IdentityPivot', { left: EDGE + 222, top: 34 + 84 });
    const identity = node(identityAt, 'Identity', { left: -210, top: -80, width: 420, height: 64 });
    solid(identity, 'IdentityBar', { left: 0, top: 3, width: 3, height: 40 }, rgb(ICE, 0.9));
    label(identity, 'ShipName', { left: 16, top: 0, width: 400, height: 24 }, { size: 19, color: rgb(ICE), spacing: 4.2, content: 'ESV HALCYON' });
    label(identity, 'ShipClass', { left: 16, top: 27, width: 400, height: 16 }, { size: 11, color: rgb(HAZE, 0.9), spacing: 1.8, content: 'MERIDIAN CLASS FRIGATE', strong: false });
    const clock = label(identity, 'MissionClock', { left: 16, top: 48, width: 400, height: 16 }, { size: 11, color: rgb(HAZE, 0.9), spacing: 1.8, strong: false });
    const helmLine = label(identity, 'HelmLine', { left: 16, top: 67, width: 400, height: 16 }, { size: 11, color: rgb(HAZE, 0.9), spacing: 1.8, strong: false });

    const viewAt = pivot(root, 'ViewPivot', { right: EDGE + 150, top: 34 + 32 });
    const view = node(viewAt, 'View', { left: -150, top: -32, width: 300, height: 64 });
    const viewTitle = label(view, 'ViewTitle', { right: 0, top: 0, width: 300, height: 24 }, { size: 19, color: rgb(ICE), spacing: 4.2, align: TextAlign.Right });
    const pips: Entity[] = [];
    for (let i = 0; i < SHOTS.length; i++) {
        pips.push(node(view, `ViewPip${i + 1}`, { right: (SHOTS.length - 1 - i) * 23 + 4, top: 33, width: 20, height: 6 }, { visualType: UIVisualType.Image, texture: textures.pip, color: rgb(ICE, 0.2) }));
    }
    label(view, 'HoldTitle', { right: 0, top: 84, width: 300, height: 14 }, { size: 10, color: rgb(HAZE), spacing: 2.6, align: TextAlign.Right, content: 'ORE HOLD' });
    const holdValue = label(view, 'HoldValue', { right: 0, top: 100, width: 300, height: 22 }, { size: 17, color: rgb(ICE), spacing: 0.8, align: TextAlign.Right });
    image(view, 'HoldTrack', { right: 0, top: 128, width: 168, height: 6 }, textures.barTrack, rgb(ICE));
    const holdBar = node(view, 'HoldBar', { right: 0, top: 128, width: 168, height: 6 }, { visualType: UIVisualType.Filled, texture: textures.barFill, color: rgb(ICE), fillMethod: FillMethod.Horizontal, fillOrigin: FillOrigin.Left, fillAmount: 0 });
    const holdNote = label(view, 'HoldNote', { right: 0, top: 140, width: 300, height: 14 }, { size: 10, color: rgb(HAZE), spacing: 1.8, align: TextAlign.Right, strong: false });
    const viewMode = label(view, 'ViewMode', { right: 0, top: 48, width: 300, height: 16 }, { size: 11, color: rgb(HAZE, 0.9), spacing: 1.8, align: TextAlign.Right, strong: false });

    const systemsAt = pivot(root, 'SystemsPivot', { left: EDGE + 184, bottom: EDGE + 102 });
    const systems = sliced(systemsAt, 'Systems', { left: -174, top: -95, width: 348, height: 190 }, textures.plate, 26);
    label(systems, 'SystemsTitle', { left: 20, top: 14, width: 200, height: 16 }, { size: 11, color: rgb(ICE, 0.95), spacing: 2.6, content: 'SHIP SYSTEMS' });
    const systemsState = label(systems, 'SystemsState', { right: 34, top: 14, width: 160, height: 16 }, { size: 11, color: rgb(HAZE), spacing: 1.8, align: TextAlign.Right });
    node(systems, 'SystemsScan', { left: 3, top: 3, width: 342, height: 184 }, { visualType: UIVisualType.Tiled, texture: textures.scan, tileSize: { x: 4, y: 3 }, color: rgb(ICE) });
    solid(systems, 'SystemsRule', { left: 20, right: 20, top: 38, height: 1 }, rgb(ICE, 0.16));
    const ROWS = ['DRIVE', 'REACTOR', 'CAPACITOR', 'EMITTER'] as const;
    const rows = ROWS.map((title, i) => {
        const top = 52 + i * 32;
        label(systems, `${title}Label`, { left: 20, top, width: 100, height: 18 }, { size: 11, color: rgb(HAZE), spacing: 1.8, content: title, strong: false });
        image(systems, `${title}Track`, { left: 122, top: top + 5, width: 160, height: 8 }, textures.barTrack, rgb(ICE));
        const bar = node(systems, `${title}Bar`, { left: 122, top: top + 5, width: 160, height: 8 }, {
            visualType: UIVisualType.Filled, texture: textures.barFill, color: rgb(ICE), fillMethod: FillMethod.Horizontal, fillOrigin: FillOrigin.Left, fillAmount: 0,
        });
        const value = lift(label(systems, `${title}Value`, { right: 18, top, width: 60, height: 18 }, { size: 13, color: rgb(ICE), align: TextAlign.Right, spacing: 0.4 }), 10);
        lift(bar, 6);
        return { bar, value };
    });

    const gaugeAt = pivot(root, 'GaugePivot', { right: EDGE + 10 + GAUGE.box / 2, bottom: EDGE - 4 + GAUGE.box / 2 });
    const gauge = node(gaugeAt, 'Gauge', { left: -GAUGE.box / 2, top: -GAUGE.box / 2, width: GAUGE.box, height: GAUGE.box });
    const whole = { left: 0, top: 0, width: GAUGE.box, height: GAUGE.box };
    image(gauge, 'GaugeDial', whole, textures.dial);
    const ring = (name: string, texture: number): Entity => node(gauge, name, whole, {
        visualType: UIVisualType.Filled, texture, fillMethod: FillMethod.Radial360, fillOrigin: FillOrigin.Bottom, fillAmount: 0,
    });
    const commandRing = lift(ring('GaugeCommand', textures.command), 8);
    const driveRing = lift(ring('GaugeDrive', textures.drive), 8);
    const hotRing = lift(ring('GaugeSpeedHot', textures.speedHot), 16);
    const speedRing = lift(ring('GaugeSpeed', textures.speed), 16);
    const speedGlow = lift(glow(ring('GaugeSpeedGlow', textures.speed)), 16);
    const half = GAUGE.box / 2;
    const around = (t: number, radius: number): { x: number; y: number } => {
        const phi = (0.25 + GAUGE.sweep * t) * Math.PI * 2;
        return { x: half + Math.cos(phi) * radius, y: half + Math.sin(phi) * radius };
    };
    for (let v = 0; v <= GAUGE.fullScale; v += 100) {
        const at = around(v / GAUGE.fullScale, GAUGE.labels);
        label(gauge, `GaugeMark${v}`, { left: at.x - 12, top: at.y - 8, width: 24, height: 16 }, {
            size: 10, color: rgb(v >= GAUGE.redline ? AMBER : HAZE, 0.95), align: TextAlign.Center, content: String(v / 100), spacing: 0.5,
        });
    }
    const commandPip = image(gauge, 'GaugeCommandPip', { left: 0, top: 0, width: 16, height: 16 }, textures.dot, rgb(AMBER));
    label(gauge, 'GaugeTitle', { left: half - 70, top: half - 52, width: 140, height: 14 }, { size: 10, color: rgb(HAZE), spacing: 3, align: TextAlign.Center, content: 'VELOCITY' });
    const fringes = [[-1.6, 0xff4a3a], [1.6, 0x39c8ff]].map(([shift, hue]) => [0, 1, 2].map((i) => lift(label(gauge, `GaugeFringe${i}${hue}`, { left: half - 57 + i * 38 + shift!, top: half - 34, width: 38, height: 60 }, { size: 56, color: rgb(hue!, 0.34), align: TextAlign.Center }), 26)));
    const digits = [0, 1, 2].map((i) => lift(label(gauge, `GaugeDigit${i}`, { left: half - 57 + i * 38, top: half - 34, width: 38, height: 60 }, { size: 56, color: rgb(ICE), align: TextAlign.Center }), 34));
    label(gauge, 'GaugeUnit', { left: half - 70, top: half + 28, width: 140, height: 14 }, { size: 10, color: rgb(HAZE), spacing: 3, align: TextAlign.Center, content: 'M / S' });
    const tag = lift(node(gauge, 'GaugeThrottle', { left: half + 22, top: half + 62, width: 140, height: 64 }), 22);
    solid(tag, 'ThrottleRule', { left: 0, top: 0, width: 132, height: 1 }, rgb(ICE, 0.28));
    solid(tag, 'ThrottleTick', { left: 0, top: 0, width: 1, height: 7 }, rgb(ICE, 0.5));
    label(tag, 'ThrottleLabel', { left: 10, top: 9, width: 60, height: 14 }, { size: 10, color: rgb(HAZE), spacing: 2.4, content: 'THRUST' });
    const throttleValue = label(tag, 'ThrottleValue', { left: 8, top: 24, width: 80, height: 30 }, { size: 26, color: rgb(ICE), spacing: 0.5 });
    const commandLabel = label(tag, 'CommandLabel', { left: 76, top: 9, width: 56, height: 14 }, { size: 10, color: rgb(AMBER), spacing: 2.4, content: 'SET', align: TextAlign.Right });
    const commandValue = label(tag, 'CommandValue', { left: 76, top: 30, width: 56, height: 20 }, { size: 15, color: rgb(AMBER), align: TextAlign.Right, spacing: 0.5 });

    const logLines = Array.from({ length: LOG_LINES }, (_, i) => label(identityAt, `Log${i}`, { left: -194, top: 28 + i * 17, width: 420, height: 14 }, { size: 10, color: rgb(HAZE), spacing: 1.6, strong: false }));
    const entries: { text: string; tone: number; at: number }[] = [];
    const log: Log = {
        say(text, tone = HAZE) {
            if (entries.length > 0 && entries[entries.length - 1]!.text === text) return;
            entries.push({ text, tone, at: ship.time });
            if (entries.length > LOG_LINES) entries.shift();
        },
    };

    const rocks: Rock[] = [];
    for (let i = 0; i < ROCKS; i++) {
        const entity = world.findEntityByName(`Rock${i}`);
        if (entity !== null) rocks.push({ entity, index: i, big: i >= MAJOR_FROM });
    }
    const camera = world.findEntityByName('Camera');
    const targets = buildTargets(kit, rocks, world.findEntityByName('Planet'), log);
    const mine = installMining(app, world, rocks, targets.probe, log);
    const scope = buildScope(kit, rocks, targets.probe);
    const desk = buildHelm(kit, targets.probe);
    const press = { down: false, at: 0, left: 0, top: 0, travel: 0 };
    const groups: readonly (readonly [Entity, number, number])[] = [[identity, 0, 1], [view, 0.15, 1], [systems, 0.35, 1], [gauge, 0.5, 1], [desk.root, 0.9, 1]];
    const leans: readonly (readonly [Entity, number, number])[] = [[identityAt, 0.1, 0.26], [viewAt, 0.1, -0.26], [systemsAt, -0.12, 0.3], [gaugeAt, -0.12, -0.3]];
    const sway = { x: 0, y: 0, yaw: 0, pitch: 0, primed: false };

    const model = { reactor: 0.18, primed: false };
    const began = ship.time;
    let full = false, hot = false;

    return (dt, input) => {
        const screen = app.getResource(ScreenOverlay);
        const across = screen.vpH > 0 ? (DESIGN.height * screen.vpW) / screen.vpH : DESIGN.width;
        const eye = camera === null ? null : world.get(camera, Transform), glass = camera === null ? null : world.get(camera, Camera);
        if (eye) {
            const q = eye.worldRotation;
            const fx = -2 * (q.x * q.z + q.w * q.y), fy = 2 * (q.y * q.z - q.w * q.x) * -1, fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
            const yaw = Math.atan2(fx, fz), pitch = Math.asin(clamp(fy, -1, 1));
            let turned = yaw - sway.yaw;
            turned -= Math.round(turned / (Math.PI * 2)) * Math.PI * 2;
            const rate = sway.primed && dt > 0 ? { x: (pitch - sway.pitch) / dt, y: turned / dt } : { x: 0, y: 0 };
            sway.x += (clamp(rate.x * 0.16, -0.09, 0.09) - sway.x) * Math.min(1, dt * 4);
            sway.y += (clamp(rate.y * 0.16, -0.12, 0.12) - sway.y) * Math.min(1, dt * 4);
            sway.yaw = yaw; sway.pitch = pitch; sway.primed = true;
        }
        const surge = clamp((ship.wanted - ship.throttle) * 0.12, -0.05, 0.05);
        for (const [group, x, y] of leans) tilt(group, x + sway.x + surge, y + sway.y);
        const pointer = { left: screen.pointerX + across / 2, top: DESIGN.height / 2 - screen.pointerY };
        const pressing = input.isMouseButtonDown(0);
        let click: Frame['click'] = null;
        if (pressing && !press.down) { press.at = ship.time; press.left = pointer.left; press.top = pointer.top; press.travel = 0; }
        if (pressing) press.travel = Math.max(press.travel, Math.hypot(pointer.left - press.left, pointer.top - press.top));
        if (!pressing && press.down && press.travel < 6 && ship.time - press.at < 0.4) click = { left: press.left, top: press.top };
        press.down = pressing;
        const frame: Frame = {
            dt, sway: { x: sway.x + surge, y: sway.y }, time: ship.time, across,
            lens: eye && glass ? { position: eye.worldPosition, rotation: eye.worldRotation, perspective: true, fov: glass.fov, orthoSize: glass.orthoSize, near: glass.nearPlane } : null,
            pointer, click,
            held: (key) => input.isKeyDown(key),
            pressing,
        };
        const age = ship.time - began;
        const boot = clamp(age / BOOT_SECONDS, 0, 1);
        for (const [group, from, most] of groups) {
            const up = (age - from) / 0.6;
            fade(group, most * ease(up) * (up > 0 && up < 1.4 && Math.sin(age * 71 + from * 9) > 0.55 ? 0.45 : 1));
        }
        if (boot >= 1 && !state.booted) { state.booted = true; log.say('HELM DISPLAY ONLINE'); }
        const test = clamp((age - 0.6) / 1.6, 0, 1), sweep = Math.sin(Math.PI * test), settle = test * test * (3 - 2 * test);
        const shown = (actual: number): number => sweep * (1 - settle) + actual * settle;

        const load = 0.18 + 0.62 * ship.throttle * ship.throttle + (mining.firing ? 0.2 : 0);
        if (!model.primed) { model.reactor = load; model.primed = true; }
        model.reactor += (load - model.reactor) * Math.min(1, dt * 1.6);

        say(clock, `OUTER PATROL   T+ ${stamp(ship.time)}`);
        const bearing = ((Math.round((-helm.yaw * 180) / Math.PI) % 360) + 360) % 360, climb = Math.round((helm.pitch * 180) / Math.PI);
        say(helmLine, `${helm.mode === 'manual' ? 'HELM MANUAL' : helm.mode === 'align' ? 'ALIGNING TO GATE' : 'CLOSING ON TARGET'}   HDG ${pad(bearing, 3)}   ELV ${climb < 0 ? '-' : '+'}${pad(Math.abs(climb), 2)}`);
        ink(helmLine, helm.mode === 'manual' ? rgb(HAZE, 0.9) : rgb(AMBER));
        if (helm.arrived) {
            log.say(mining.hold > 0 ? `DELIVERED ${mining.hold.toFixed(1)} T   NAV ${pad(helm.leg, 2)} ${helm.gateName}` : `GATE REACHED   NAV ${pad(helm.leg, 2)} ${helm.gateName}`, AMBER);
            mining.delivered = Math.round((mining.delivered + mining.hold) * 10) / 10;
            mining.hold = 0;
        }

        if (ship.tour) {
            say(viewTitle, `VIEW ${ship.shot + 1} / ${SHOTS.length}`);
            say(viewMode, 'AUTO TOUR');
            ink(viewMode, rgb(HAZE, 0.9));
        } else {
            say(viewTitle, 'FREE VIEW');
            say(viewMode, 'MANUAL ORBIT');
            ink(viewMode, rgb(AMBER));
        }
        const within = (ship.time % SHOT_SECONDS) / SHOT_SECONDS;
        pips.forEach((pip, i) => {
            const here = ship.tour && i === ship.shot;
            ink(pip, here ? rgb(ICE, 0.55 + 0.45 * (1 - within)) : rgb(ICE, ship.tour ? 0.2 : 0.1), UIVisual);
        });

        const strained = model.reactor > 0.82;
        say(systemsState, mining.firing ? 'MINING' : strained ? 'HIGH LOAD' : 'NOMINAL');
        ink(systemsState, mining.firing || strained ? rgb(AMBER) : rgb(HAZE));
        const readings: readonly (readonly [number, string, Rgba])[] = [
            [ship.throttle, `${Math.round(ship.throttle * 100)} %`, rgb(ICE)],
            [model.reactor, `${Math.round(model.reactor * 100)} %`, strained ? rgb(AMBER) : rgb(ICE)],
            [mining.capacitor, `${Math.round(mining.capacitor * 100)} %`, mining.capacitor < 0.2 ? rgb(ALERT) : mining.capacitor < 0.45 ? rgb(AMBER) : rgb(ICE)],
            [mining.heat, `${Math.round(mining.heat * 100)} %`, mining.overheated ? rgb(ALERT) : mining.heat > 0.6 ? rgb(AMBER) : rgb(ICE)],
        ];
        readings.forEach(([amount, text, color], i) => {
            fill(rows[i]!.bar, Math.round(amount * BAR_CELLS) / BAR_CELLS);
            ink(rows[i]!.bar, color, UIVisual);
            say(rows[i]!.value, text);
            ink(rows[i]!.value, color);
        });

        const speed = shown(ship.speed / GAUGE.fullScale) * GAUGE.fullScale;
        const pace = clamp(speed / GAUGE.fullScale, 0, 1);
        const fast = speed >= GAUGE.redline;
        fill(hotRing, pace * GAUGE.sweep);
        fill(speedRing, Math.min(pace, GAUGE.redline / GAUGE.fullScale) * GAUGE.sweep);
        fill(speedGlow, Math.min(pace, GAUGE.redline / GAUGE.fullScale) * GAUGE.sweep);
        ink(speedGlow, rgb(0x9fdcff, 0.3 + 0.08 * Math.sin(ship.time * 3.1)), UIVisual);
        fill(driveRing, shown(ship.throttle) * GAUGE.sweep);
        fill(commandRing, shown(ship.wanted) * GAUGE.sweep);
        const pipAt = around(shown(ship.wanted), GAUGE.command);
        place(commandPip, pipAt.x - 8, pipAt.y - 8);
        const figures = pad(speed, 3);
        const lead = figures.length - String(Math.round(speed)).length;
        digits.forEach((digit, i) => {
            say(digit, figures[i]!);
            ink(digit, i < lead ? rgb(ICE, 0.2) : fast ? rgb(AMBER) : rgb(ICE));
            for (const fringe of fringes) { say(fringe[i]!, i < lead ? '' : figures[i]!); }
        });
        say(throttleValue, `${pad(ship.throttle * 100, 3)}`);
        const changing = Math.abs(ship.wanted - ship.throttle) > 0.012;
        say(commandValue, `${pad(ship.wanted * 100, 3)}`);
        fade(commandLabel, changing ? 1 : 0.45);
        fade(commandValue, changing ? 1 : 0.45);
        fade(commandPip, changing ? 0.7 + 0.3 * Math.sin(ship.time * 9) : 1);


        if (ship.throttle > 0.985 && !full) log.say('DRIVE AT FULL BURN', AMBER);
        full = ship.throttle > 0.97;
        if (fast && !hot) log.say('VELOCITY PAST 400 M/S', AMBER);
        hot = fast;

        desk.update(frame);
        targets.update(frame);
        mine(frame);
        scope(frame);
        const laden = mining.hold >= MINING.capacity;
        say(holdValue, `${mining.hold.toFixed(1)} / ${MINING.capacity.toFixed(0)} T`);
        fill(holdBar, Math.round((mining.hold / MINING.capacity) * 24) / 24);
        ink(holdBar, laden ? rgb(AMBER) : rgb(ICE), UIVisual);
        say(holdNote, laden ? `HOLD FULL  RETURN TO ${helm.gateName}` : mining.reason ? mining.reason : `${mining.delivered.toFixed(1)} T DELIVERED`);
        ink(holdNote, laden || mining.reason ? rgb(AMBER) : rgb(HAZE));
        entries.forEach((entry, i) => {
            const line = logLines[i]!, old = ship.time - entry.at;
            say(line, `${stamp(entry.at)}   ${entry.text}`);
            ink(line, rgb(entry.tone, clamp((12 - old) / 4, 0, 1) * (i === entries.length - 1 ? 1 : 0.7)));
        });
        for (let i = entries.length; i < LOG_LINES; i++) say(logLines[i]!, '');

        const scale = screen.vpH > 0 ? screen.vpH / DESIGN.height : 1;
        state.waypointClamped = targets.probe.waypointClamped;
        state.selected = targets.probe.selected;
        state.current = targets.probe.current;
        state.locked = targets.probe.locked;
        state.picks = targets.probe.picks.map((pick) => ({ index: pick.index, x: pick.left * scale, y: pick.top * scale }));
        for (const name in desk.spots) state.spots[name] = { x: desk.spots[name]!.left * scale, y: desk.spots[name]!.top * scale };
    };
}
