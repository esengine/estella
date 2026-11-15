import {
    Assets, Camera, Canvas, Name, ScaleMode, ScreenOverlay, Text, Transform, TextAlign, TextVerticalAlign, UINode, UIPointerEvents, UIPositionType, UIVisual, UIVisualType, UIWorldAnchor, FillMethod, FillOrigin,
    defineSystem, GetWorld, Res, Time, percent, placeOnScreen, px, spawnUIEntity,
} from 'esengine';
import type { App, Entity, World } from 'esengine';
import { SHOTS, SHOT_SECONDS, clamp } from './flight';
import { ship } from './shipState';

type Rgba = { r: number; g: number; b: number; a: number };

const rgb = (hex: number, a = 1): Rgba => ({ r: ((hex >> 16) & 255) / 255, g: ((hex >> 8) & 255) / 255, b: (hex & 255) / 255, a });
const ICE = 0xe6f2f7, HAZE = 0xa6bdc9, DRIVE = 0x7cd3ff, AMBER = 0xffa348, ALERT = 0xff5a3d;

const DESIGN = { width: 1600, height: 900 };
const EDGE = 40;
const GAUGE = { box: 320, sweep: 0.75, fullScale: 440, redline: 400, labels: 114, command: 106 };
const WAYPOINT = { x: 0, y: 14, z: 2600 };
const LEG_KM = 86;
const BAR_CELLS = 24;
const HULL_HALF = 52;

const TEXTURES = {
    dial: 'assets/ui/gauge-dial.esimage',
    speed: 'assets/ui/gauge-speed.esimage',
    speedHot: 'assets/ui/gauge-speed-hot.esimage',
    drive: 'assets/ui/gauge-drive.esimage',
    command: 'assets/ui/gauge-command.esimage',
    plate: 'assets/ui/plate.esimage',
    barTrack: 'assets/ui/bar-track.esimage',
    barFill: 'assets/ui/bar-fill.esimage',
    bracket: 'assets/ui/bracket.esimage',
    diamond: 'assets/ui/diamond.esimage',
    chevron: 'assets/ui/chevron.esimage',
    body: 'assets/ui/body.esimage',
    dot: 'assets/ui/dot.esimage',
    pip: 'assets/ui/pip.esimage',
    keycap: 'assets/ui/keycap.esimage',
    scrimBottom: 'assets/ui/scrim-bottom.esimage',
    scrimTop: 'assets/ui/scrim-top.esimage',
    shade: 'assets/ui/shade.esimage',
} as const;

const FONTS = { regular: 'assets/ui/fonts/inter-latin-400-normal.woff2', strong: 'assets/ui/fonts/inter-latin-600-normal.woff2' } as const;

type Loaded = { textures: Record<keyof typeof TEXTURES, number>; fonts: Record<keyof typeof FONTS, number> };

interface Box { left?: number; top?: number; right?: number; bottom?: number; width?: number; height?: number }

interface Label { size: number; color: Rgba; strong?: boolean; align?: TextAlign; spacing?: number; content?: string }

const state = { ready: false, loadMs: 0, error: '', waypointClamped: true };

export function installHud(app: App): void {
    let loading: Promise<Loaded> | null = null;
    let loaded: Loaded | null = null;
    let update: ((world: World, dt: number) => void) | null = null;

    app.addSystem(defineSystem([GetWorld(), Res(Time)], (world, time) => {
        if (update) { update(world, Math.min(time.delta, 0.05)); return; }
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

async function load(app: App): Promise<Loaded> {
    const assets = app.getResource(Assets);
    const names = Object.keys(TEXTURES) as (keyof typeof TEXTURES)[];
    const textures = await Promise.all(names.map((name) => assets.loadTexture(TEXTURES[name])));
    const [regular, strong] = await Promise.all([assets.loadFont(FONTS.regular), assets.loadFont(FONTS.strong)]);
    return {
        textures: Object.fromEntries(names.map((name, i) => [name, textures[i]!.handle])) as Loaded['textures'],
        fonts: { regular: regular.handle, strong: strong.handle },
    };
}

function build(app: App, world: World, { textures, fonts }: Loaded): (world: World, dt: number) => void {
    const node = (parent: Entity, name: string, box: Box, visual?: Parameters<typeof spawnUIEntity>[0]['visual']): Entity => {
        const absolute = { position: UIPositionType.Absolute, pointerEvents: UIPointerEvents.None };
        const e = spawnUIEntity({
            world, parent,
            node: {
                ...absolute,
                ...(box.left !== undefined ? { insetLeft: px(box.left) } : {}),
                ...(box.top !== undefined ? { insetTop: px(box.top) } : {}),
                ...(box.right !== undefined ? { insetRight: px(box.right) } : {}),
                ...(box.bottom !== undefined ? { insetBottom: px(box.bottom) } : {}),
                ...(box.width !== undefined ? { width: px(box.width) } : {}),
                ...(box.height !== undefined ? { height: px(box.height) } : {}),
            },
            ...(visual ? { visual } : {}),
        });
        world.insert(e, Name, { value: name });
        return e;
    };
    const image = (parent: Entity, name: string, box: Box, texture: number, color: Rgba = rgb(0xffffff)): Entity =>
        node(parent, name, box, { visualType: UIVisualType.Image, texture, color });
    const sliced = (parent: Entity, name: string, box: Box, texture: number, border: number, color: Rgba = rgb(0xffffff)): Entity =>
        node(parent, name, box, { visualType: UIVisualType.NineSlice, texture, color, sliceBorder: { x: border, y: border, z: border, w: border } });
    const solid = (parent: Entity, name: string, box: Box, color: Rgba): Entity => node(parent, name, box, { visualType: UIVisualType.SolidColor, color });
    const label = (parent: Entity, name: string, box: Box, l: Label): Entity => {
        const e = node(parent, name, box);
        world.insert(e, Text, Text.create({
            content: l.content ?? '', font: l.strong === false ? fonts.regular : fonts.strong, fontSize: l.size, color: l.color,
            align: l.align ?? TextAlign.Left, verticalAlign: TextVerticalAlign.Middle, wordWrap: false, letterSpacing: l.spacing ?? 0, lineHeight: 1,
            shadowColor: { r: 0, g: 0.02, b: 0.04, a: 0.9 }, shadowBlur: 6, shadowOffsetX: 0, shadowOffsetY: 1,
        }));
        return e;
    };

    const said = new Map<Entity, string>();
    const say = (e: Entity, content: string): void => {
        if (said.get(e) === content) return;
        said.set(e, content);
        world.update(e, Text, (t) => { t.content = content; });
    };
    const inked = new Map<Entity, string>();
    const ink = (e: Entity, color: Rgba, component: typeof Text | typeof UIVisual = Text): void => {
        const key = `${color.r.toFixed(3)},${color.g.toFixed(3)},${color.b.toFixed(3)},${color.a.toFixed(3)}`;
        if (inked.get(e) === key) return;
        inked.set(e, key);
        if (component === Text) world.update(e, Text, (t) => { t.color = color; });
        else world.update(e, UIVisual, (v) => { v.color = color; });
    };
    const filled = new Map<Entity, number>();
    const fill = (e: Entity, amount: number): void => {
        const to = Math.round(clamp(amount, 0, 1) * 2000) / 2000;
        if (filled.get(e) === to) return;
        filled.set(e, to);
        world.update(e, UIVisual, (v) => { v.fillAmount = to; });
    };
    const shown = new Map<Entity, number>();
    const fade = (e: Entity, opacity: number): void => {
        const to = Math.round(clamp(opacity, 0, 1) * 100) / 100;
        if (shown.get(e) === to) return;
        shown.set(e, to);
        world.update(e, UINode, (n) => { n.opacity = to; });
    };

    const placed = new Map<Entity, string>();
    const place = (e: Entity, left: number, top: number): void => {
        const x = Math.round(left * 10) / 10, y = Math.round(top * 10) / 10;
        if (placed.get(e) === `${x},${y}`) return;
        placed.set(e, `${x},${y}`);
        world.update(e, UINode, (n) => { n.insetLeft = px(x); n.insetTop = px(y); });
    };

    const canvas = spawnUIEntity({ world, node: { pointerEvents: UIPointerEvents.None } });
    world.insert(canvas, Name, { value: 'Hud' });
    world.insert(canvas, Canvas, { designResolution: { x: DESIGN.width, y: DESIGN.height }, scaleMode: ScaleMode.FixedHeight });
    const root = spawnUIEntity({ world, parent: canvas, node: { fill: true, pointerEvents: UIPointerEvents.None } });
    world.insert(root, Name, { value: 'HudRoot' });

    image(root, 'ScrimTop', { left: 0, right: 0, top: 0, height: 170 }, textures.scrimTop);
    image(root, 'ShadeIdentity', { left: -120, top: -70, width: 680, height: 270 }, textures.shade);
    image(root, 'ShadeView', { right: -120, top: -70, width: 560, height: 270 }, textures.shade);
    image(root, 'ShadeHints', { left: 380, right: 380, bottom: -60, height: 190 }, textures.shade);
    image(root, 'ScrimBottom', { left: 0, right: 0, bottom: 0, height: 300 }, textures.scrimBottom);

    const identity = node(root, 'Identity', { left: EDGE, top: 34, width: 420, height: 64 });
    solid(identity, 'IdentityBar', { left: 0, top: 3, width: 3, height: 40 }, rgb(ICE, 0.9));
    label(identity, 'ShipName', { left: 16, top: 0, width: 400, height: 24 }, { size: 19, color: rgb(ICE), spacing: 4.2, content: 'ESV HALCYON' });
    label(identity, 'ShipClass', { left: 16, top: 27, width: 400, height: 16 }, { size: 11, color: rgb(HAZE, 0.9), spacing: 1.8, content: 'MERIDIAN CLASS FRIGATE', strong: false });
    const clock = label(identity, 'MissionClock', { left: 16, top: 48, width: 400, height: 16 }, { size: 11, color: rgb(HAZE, 0.9), spacing: 1.8, strong: false });

    const view = node(root, 'View', { right: EDGE, top: 34, width: 300, height: 64 });
    const viewTitle = label(view, 'ViewTitle', { right: 0, top: 0, width: 300, height: 24 }, { size: 19, color: rgb(ICE), spacing: 4.2, align: TextAlign.Right });
    const pips: Entity[] = [];
    for (let i = 0; i < SHOTS.length; i++) {
        pips.push(node(view, `ViewPip${i + 1}`, { right: (SHOTS.length - 1 - i) * 23 + 4, top: 33, width: 20, height: 6 }, { visualType: UIVisualType.Image, texture: textures.pip, color: rgb(ICE, 0.2) }));
    }
    const viewMode = label(view, 'ViewMode', { right: 0, top: 48, width: 300, height: 16 }, { size: 11, color: rgb(HAZE, 0.9), spacing: 1.8, align: TextAlign.Right, strong: false });

    const systems = sliced(root, 'Systems', { left: EDGE, bottom: EDGE, width: 348, height: 190 }, textures.plate, 26);
    label(systems, 'SystemsTitle', { left: 20, top: 14, width: 200, height: 16 }, { size: 11, color: rgb(ICE, 0.95), spacing: 2.6, content: 'SHIP SYSTEMS' });
    const systemsState = label(systems, 'SystemsState', { right: 34, top: 14, width: 160, height: 16 }, { size: 11, color: rgb(HAZE), spacing: 1.8, align: TextAlign.Right });
    solid(systems, 'SystemsRule', { left: 20, right: 20, top: 38, height: 1 }, rgb(ICE, 0.16));
    const ROWS = ['DRIVE', 'REACTOR', 'CAPACITOR', 'NOZZLE'] as const;
    const rows = ROWS.map((title, i) => {
        const top = 52 + i * 32;
        label(systems, `${title}Label`, { left: 20, top, width: 100, height: 18 }, { size: 11, color: rgb(HAZE), spacing: 1.8, content: title, strong: false });
        image(systems, `${title}Track`, { left: 112, top: top + 5, width: 168, height: 8 }, textures.barTrack, rgb(ICE));
        const bar = node(systems, `${title}Bar`, { left: 112, top: top + 5, width: 168, height: 8 }, {
            visualType: UIVisualType.Filled, texture: textures.barFill, color: rgb(ICE), fillMethod: FillMethod.Horizontal, fillOrigin: FillOrigin.Left, fillAmount: 0,
        });
        const value = label(systems, `${title}Value`, { right: 18, top, width: 60, height: 18 }, { size: 13, color: rgb(ICE), align: TextAlign.Right, spacing: 0.4 });
        return { bar, value };
    });

    const gauge = node(root, 'Gauge', { right: EDGE - 6, bottom: EDGE - 8, width: GAUGE.box, height: GAUGE.box });
    const whole = { left: 0, top: 0, width: GAUGE.box, height: GAUGE.box };
    image(gauge, 'GaugeDial', whole, textures.dial);
    const ring = (name: string, texture: number): Entity => node(gauge, name, whole, {
        visualType: UIVisualType.Filled, texture, fillMethod: FillMethod.Radial360, fillOrigin: FillOrigin.Bottom, fillAmount: 0,
    });
    const commandRing = ring('GaugeCommand', textures.command);
    const driveRing = ring('GaugeDrive', textures.drive);
    const hotRing = ring('GaugeSpeedHot', textures.speedHot);
    const speedRing = ring('GaugeSpeed', textures.speed);
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
    const digits = [0, 1, 2].map((i) => label(gauge, `GaugeDigit${i}`, { left: half - 57 + i * 38, top: half - 34, width: 38, height: 60 }, { size: 56, color: rgb(ICE), align: TextAlign.Center }));
    label(gauge, 'GaugeUnit', { left: half - 70, top: half + 28, width: 140, height: 14 }, { size: 10, color: rgb(HAZE), spacing: 3, align: TextAlign.Center, content: 'M / S' });
    const tag = node(gauge, 'GaugeThrottle', { left: half + 22, top: half + 62, width: 140, height: 64 });
    solid(tag, 'ThrottleRule', { left: 0, top: 0, width: 132, height: 1 }, rgb(ICE, 0.28));
    solid(tag, 'ThrottleTick', { left: 0, top: 0, width: 1, height: 7 }, rgb(ICE, 0.5));
    label(tag, 'ThrottleLabel', { left: 10, top: 9, width: 60, height: 14 }, { size: 10, color: rgb(HAZE), spacing: 2.4, content: 'THRUST' });
    const throttleValue = label(tag, 'ThrottleValue', { left: 8, top: 24, width: 80, height: 30 }, { size: 26, color: rgb(ICE), spacing: 0.5 });
    const commandLabel = label(tag, 'CommandLabel', { left: 76, top: 9, width: 56, height: 14 }, { size: 10, color: rgb(AMBER), spacing: 2.4, content: 'SET', align: TextAlign.Right });
    const commandValue = label(tag, 'CommandValue', { left: 76, top: 30, width: 56, height: 20 }, { size: 15, color: rgb(AMBER), align: TextAlign.Right, spacing: 0.5 });

    const hints = node(root, 'Hints', { left: 0, right: 0, bottom: EDGE - 4, height: 24 });
    const HINTS: readonly (readonly [string, number, string])[] = [['W', 24, ''], ['S', 24, 'THRUST'], ['DRAG', 50, 'ORBIT'], ['1 – 6', 50, 'VIEWS'], ['SPACE', 58, 'AUTO TOUR']];
    const wide = HINTS.reduce((sum, [, cap, text]) => sum + cap + (text ? 14 + text.length * 8.6 + 26 : 5), -26);
    const row = spawnUIEntity({ world, parent: hints, node: { ...{ position: UIPositionType.Absolute, pointerEvents: UIPointerEvents.None }, insetLeft: percent(50), insetTop: px(0), width: px(wide), height: px(24), marginLeft: px(-wide / 2), opacity: 0.78 } });
    world.insert(row, Name, { value: 'HintRow' });
    let cursor = 0;
    for (const [key, cap, text] of HINTS) {
        sliced(row, `Key${key}`, { left: cursor, top: 0, width: cap, height: 24 }, textures.keycap, 9);
        label(row, `KeyText${key}`, { left: cursor, top: 0, width: cap, height: 22 }, { size: 10, color: rgb(ICE), align: TextAlign.Center, spacing: 0.8, content: key });
        cursor += cap;
        if (!text) { cursor += 5; continue; }
        label(row, `KeyHint${key}`, { left: cursor + 9, top: 0, width: text.length * 8.6 + 8, height: 24 }, { size: 10, color: rgb(HAZE), spacing: 2, content: text, strong: false });
        cursor += 14 + text.length * 8.6 + 26;
    }

    const planet = world.findEntityByName('Planet');
    const body = node(root, 'Body', { left: 0, top: 0, width: 24, height: 24 });
    world.update(body, UINode, (n) => { n.marginLeft = px(-12); n.marginTop = px(-34); });
    const globe = planet === null ? null : world.get(planet, Transform);
    const altitude = globe ? Math.hypot(globe.position.x, globe.position.y, globe.position.z) - globe.scale.x : 0;
    world.insert(body, UIWorldAnchor, { clampToEdges: false });
    image(body, 'BodyMark', { left: 0, top: 0, width: 24, height: 24 }, textures.body);
    solid(body, 'BodyLeader', { left: 26, top: 12, width: 28, height: 1 }, rgb(ICE, 0.45));
    label(body, 'BodyName', { left: 62, top: -3, width: 220, height: 14 }, { size: 11, color: rgb(ICE), spacing: 3, content: 'KARIS IV' });
    const bodyRange = label(body, 'BodyRange', { left: 62, top: 14, width: 220, height: 14 }, { size: 10, color: rgb(HAZE), spacing: 2, strong: false });

    const marker = node(root, 'Waypoint', { left: 0, top: 0, width: 72, height: 72 });
    world.update(marker, UINode, (n) => { n.marginLeft = px(-36); n.marginTop = px(-36); });
    world.insert(marker, UIWorldAnchor, { offset: { ...WAYPOINT }, clampToEdges: true, edgeMargin: 64, edgeInsets: { left: 12, top: 76, right: 12, bottom: 340 } });
    const bracket = sliced(marker, 'WaypointBracket', { left: 0, top: 0, width: 72, height: 72 }, textures.bracket, 34);
    const diamond = image(marker, 'WaypointDiamond', { left: 24, top: 24, width: 24, height: 24 }, textures.diamond);
    const chevron = image(marker, 'WaypointChevron', { left: 12, top: 12, width: 48, height: 48 }, textures.chevron);
    const callout = sliced(marker, 'WaypointCallout', { left: 86, top: 2, width: 232, height: 68 }, textures.plate, 26);
    const waypointName = label(callout, 'WaypointName', { left: 14, top: 9, width: 190, height: 14 }, { size: 10, color: rgb(AMBER), spacing: 2.6 });
    const waypointRange = label(callout, 'WaypointRange', { left: 14, top: 24, width: 190, height: 24 }, { size: 19, color: rgb(ICE), spacing: 0.6 });
    const waypointEta = label(callout, 'WaypointEta', { left: 14, top: 47, width: 190, height: 14 }, { size: 10, color: rgb(HAZE), spacing: 2, strong: false });
    const camera = world.findEntityByName('Camera');

    const model = { reactor: 0.18, capacitor: 1, heat: 0, leg: 3, range: LEG_KM, primed: false };
    const pad = (n: number, width: number): string => String(Math.max(0, Math.round(n))).padStart(width, '0');
    const stamp = (seconds: number): string => `${pad(Math.floor(seconds / 60), 2)}:${pad(Math.floor(seconds % 60), 2)}`;

    return (_world, dt) => {
        const load = 0.18 + 0.74 * ship.throttle * ship.throttle;
        const reserve = 1 - 0.52 * ship.throttle * ship.throttle;
        if (!model.primed) { model.reactor = load; model.capacitor = reserve; model.heat = ship.throttle * ship.throttle; model.primed = true; }
        model.reactor += (load - model.reactor) * Math.min(1, dt * 1.6);
        model.capacitor += (reserve - model.capacitor) * Math.min(1, dt * 0.35);
        model.heat += (ship.throttle * ship.throttle - model.heat) * Math.min(1, dt * 0.45);
        model.range -= (ship.speed * dt) / 1000;
        if (model.range <= 0) { model.range += LEG_KM; model.leg = (model.leg % 9) + 1; }

        say(clock, `PATROL LEG ${pad(model.leg, 2)}   T+ ${stamp(ship.time)}`);

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

        const kelvin = 380 + 1460 * model.heat;
        const strained = model.reactor > 0.82;
        say(systemsState, strained ? 'HIGH LOAD' : 'NOMINAL');
        ink(systemsState, strained ? rgb(AMBER) : rgb(HAZE));
        const readings: readonly (readonly [number, string, Rgba])[] = [
            [ship.throttle, `${Math.round(ship.throttle * 100)} %`, rgb(ICE)],
            [model.reactor, `${Math.round(model.reactor * 100)} %`, strained ? rgb(AMBER) : rgb(ICE)],
            [model.capacitor, `${Math.round(model.capacitor * 100)} %`, model.capacitor < 0.55 ? rgb(AMBER) : rgb(ICE)],
            [model.heat, `${Math.round(kelvin)} K`, model.heat > 0.85 ? rgb(ALERT) : model.heat > 0.6 ? rgb(AMBER) : rgb(ICE)],
        ];
        readings.forEach(([amount, text, color], i) => {
            fill(rows[i]!.bar, Math.round(amount * BAR_CELLS) / BAR_CELLS);
            ink(rows[i]!.bar, color, UIVisual);
            say(rows[i]!.value, text);
            ink(rows[i]!.value, color);
        });

        const pace = clamp(ship.speed / GAUGE.fullScale, 0, 1);
        const fast = ship.speed >= GAUGE.redline;
        fill(hotRing, pace * GAUGE.sweep);
        fill(speedRing, Math.min(pace, GAUGE.redline / GAUGE.fullScale) * GAUGE.sweep);
        fill(driveRing, ship.throttle * GAUGE.sweep);
        fill(commandRing, ship.wanted * GAUGE.sweep);
        const pipAt = around(ship.wanted, GAUGE.command);
        place(commandPip, pipAt.x - 8, pipAt.y - 8);
        const figures = pad(ship.speed, 3);
        const lead = figures.length - String(Math.round(ship.speed)).length;
        digits.forEach((digit, i) => {
            say(digit, figures[i]!);
            ink(digit, i < lead ? rgb(ICE, 0.2) : fast ? rgb(AMBER) : rgb(ICE));
        });
        say(throttleValue, `${pad(ship.throttle * 100, 3)}`);
        const changing = Math.abs(ship.wanted - ship.throttle) > 0.012;
        say(commandValue, `${pad(ship.wanted * 100, 3)}`);
        fade(commandLabel, changing ? 1 : 0.45);
        fade(commandValue, changing ? 1 : 0.45);
        fade(commandPip, changing ? 0.7 + 0.3 * Math.sin(ship.time * 9) : 1);

        const anchor = world.get(marker, UIWorldAnchor);
        const screen = app.getResource(ScreenOverlay);
        const across = screen.vpH > 0 ? (DESIGN.height * screen.vpW) / screen.vpH : DESIGN.width;
        const at = world.get(marker, UINode).insetLeft.value;
        const flipped = at > across - 380;
        place(callout, flipped ? -246 : 86, 2);
        fade(bracket, anchor.clamped ? 0 : 1);
        fade(diamond, anchor.clamped ? 0 : 1);
        fade(chevron, anchor.clamped ? 0.75 + 0.25 * Math.sin(ship.time * 5) : 0);
        if (anchor.clamped && camera !== null) {
            const eye = world.get(camera, Transform);
            const q = eye.worldRotation, from = eye.worldPosition;
            const v = { x: WAYPOINT.x - from.x, y: WAYPOINT.y - from.y, z: WAYPOINT.z - from.z };
            const tx = 2 * (-q.y * v.z + q.z * v.y), ty = 2 * (-q.z * v.x + q.x * v.z), tz = 2 * (-q.x * v.y + q.y * v.x);
            const right = v.x + q.w * tx + (-q.y * tz + q.z * ty), up = v.y + q.w * ty + (-q.z * tx + q.x * tz);
            const turn = Math.atan2(up, right) / 2;
            world.update(chevron, Transform, (t) => { t.rotation = { x: 0, y: 0, z: Math.sin(turn), w: Math.cos(turn) }; });
        }
        say(waypointName, `NAV ${pad(model.leg, 2)}  KESTREL GATE`);
        say(waypointRange, `${model.range.toFixed(1)} KM`);
        say(waypointEta, ship.speed > 1 ? `ETA ${stamp((model.range * 1000) / ship.speed)}` : 'ETA  HOLDING');

        say(bodyRange, `ALTITUDE ${Math.round(altitude).toLocaleString('en-US').replace(/,/g, ' ')} KM`);
        if (globe && camera !== null) {
            const eye = world.get(camera, Transform);
            const held = world.get(body, UIWorldAnchor);
            const q = eye.worldRotation, from = eye.worldPosition, c = globe.position, r = globe.scale.x;
            const up = { x: 2 * (q.x * q.y - q.w * q.z), y: 1 - 2 * (q.x * q.x + q.z * q.z), z: 2 * (q.y * q.z + q.w * q.x) };
            const d = { x: c.x - from.x, y: c.y - from.y, z: c.z - from.z };
            const far = Math.hypot(d.x, d.y, d.z) || 1;
            d.x /= far; d.y /= far; d.z /= far;
            const along = up.x * d.x + up.y * d.y + up.z * d.z;
            const side = { x: up.x - along * d.x, y: up.y - along * d.y, z: up.z - along * d.z };
            const span = Math.hypot(side.x, side.y, side.z) || 1;
            side.x /= span; side.y /= span; side.z /= span;
            const level = { x: d.y * side.z - d.z * side.y, y: d.z * side.x - d.x * side.z, z: d.x * side.y - d.y * side.x };
            const sin = Math.min(1, r / far), cos = Math.sqrt(1 - sin * sin);
            const lens = world.get(camera, Camera);
            const view = { position: from, rotation: q, perspective: true, fov: lens.fov, orthoSize: lens.orthoSize, near: lens.nearPlane };
            const frame = { width: across, height: DESIGN.height };
            const bow = placeOnScreen({ x: 0, y: 0, z: HULL_HALF }, view, frame, false, 0), stern = placeOnScreen({ x: 0, y: 0, z: -HULL_HALF }, view, frame, false, 0);
            const keel = { x: stern.left - bow.left, y: stern.top - bow.top };
            const length = keel.x * keel.x + keel.y * keel.y || 1;
            let limb = held.offset, best = Infinity;
            for (let step = 0; step <= 48; step++) {
                const turn = (step % 2 === 0 ? 1 : -1) * Math.ceil(step / 2) * 0.05;
                const cs = Math.cos(turn) * cos, sn = Math.sin(turn) * cos;
                const p = {
                    x: Math.round(c.x + r * (cs * side.x + sn * level.x - sin * d.x)),
                    y: Math.round(c.y + r * (cs * side.y + sn * level.y - sin * d.y)),
                    z: Math.round(c.z + r * (cs * side.z + sn * level.z - sin * d.z)),
                };
                const on = placeOnScreen(p, view, frame, false, 0);
                const room = Math.min(on.left - (on.top > 520 ? 480 : 120), frame.width - 420 - on.left, on.top - 150, frame.height - 240 - on.top);
                const t = clamp(((on.left - bow.left) * keel.x + (on.top - bow.top) * keel.y) / length, 0, 1);
                const clear = bow.behind || stern.behind ? 999 : Math.hypot(on.left - bow.left - keel.x * t, on.top - bow.top - keel.y * t);
                if (on.onScreen && room > 0 && clear > 110 && Math.abs(turn) < best) { best = Math.abs(turn); limb = p; }
            }
            if (held.offset.x !== limb.x || held.offset.y !== limb.y || held.offset.z !== limb.z) world.update(body, UIWorldAnchor, (anchored) => { anchored.offset = limb; });
            fade(body, best < Infinity && held.onScreen ? 1 : 0);
        } else {
            fade(body, 0);
        }
        state.waypointClamped = anchor.clamped;
    };
}
