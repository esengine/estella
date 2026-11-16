import { TextAlign, UIVisual } from 'esengine';
import type { Entity } from 'esengine';
import { guns } from './gunnery';
import { ELEVATION_ORDERS, ENGINE_ORDERS, PITCH_RATE, RUDDER_ORDERS, engage, helm, setElevation, setEngine, setRudder, steady } from './helm';
import { AMBER, HAZE, ICE, rgb, type Frame, type Kit } from './hudKit';
import { mining } from './hudMining';
import type { TargetProbe } from './hudTargets';
import { ship } from './shipState';

const TOP = 694;
const CELL = { w: 64, h: 24, gap: 3 };
const RUDDER = { w: 42, h: 24, top: 152 };
const BUTTON = { w: 96, h: 24 };

interface Control { name: string; x: number; y: number; w: number; h: number; press: () => void; lit: () => boolean; when: () => boolean; cap: Entity; text: Entity }

export interface Desk { root: Entity; update(frame: Frame): void; spots: Record<string, { left: number; top: number }> }

export function buildHelm(kit: Kit, probe: TargetProbe): Desk {
    const { root, textures, node, sliced, solid, label, say, ink, fade, place } = kit;
    const desk = node(root, 'Helm', { left: 0, top: TOP, width: 0, height: 0 });
    const controls: Control[] = [];
    const spots: Record<string, { left: number; top: number }> = {};

    const always = (): boolean => true, cruising = (): boolean => !guns.view, fighting = (): boolean => guns.view;
    const control = (name: string, x: number, y: number, w: number, h: number, caption: string, press: () => void, lit: () => boolean, when: () => boolean = always): void => {
        const cap = sliced(desk, `Helm${name}`, { left: x, top: y, width: w, height: h }, textures.keycap, 9, rgb(ICE, 0.55));
        const text = label(desk, `Helm${name}Text`, { left: x, top: y, width: w, height: h - 2 }, { size: 10, color: rgb(HAZE), align: TextAlign.Center, spacing: 1.4, content: caption });
        controls.push({ name, x, y, w, h, press, lit, when, cap, text });
    };
    const header = (name: string, x: number, y: number, w: number, text: string, align: TextAlign = TextAlign.Center): Entity =>
        label(desk, `Helm${name}`, { left: x, top: y, width: w, height: 12 }, { size: 9, color: rgb(HAZE), spacing: 2.2, align, content: text, strong: false });

    const ladder = (count: number): number => count * (CELL.h + CELL.gap) - CELL.gap;
    const engineX = 148, elevationX = -148 - CELL.w, tall = ladder(ENGINE_ORDERS.length);
    header('EngineTitle', engineX - 10, -16, CELL.w + 20, 'ENGINE');
    [...ENGINE_ORDERS].reverse().forEach((order, i) => {
        const caption = order === 1 ? 'FULL' : order === 0 ? 'STOP' : order === 0.5 ? '1 / 2' : `${order * 4} / 4`;
        control(`Engine${order * 100}`, engineX, i * (CELL.h + CELL.gap), CELL.w, CELL.h, caption, () => setEngine(order), () => Math.abs(helm.order - order) < 0.01);
    });
    const engineSet = solid(desk, 'HelmEngineSet', { left: engineX + CELL.w + 4, top: 0, width: 10, height: 3 }, rgb(AMBER));
    const engineNow = solid(desk, 'HelmEngineNow', { left: engineX - 14, top: 0, width: 10, height: 3 }, rgb(ICE));

    header('ElevationTitle', elevationX - 10, -16, CELL.w + 20, 'PITCH');
    [...ELEVATION_ORDERS].reverse().forEach((order, i) => {
        const caption = order === 0 ? 'HOLD' : `${order > 0 ? 'UP' : 'DOWN'} ${Math.abs(order) * 2}`;
        control(`Elevation${order * 100}`, elevationX, i * (CELL.h + CELL.gap), CELL.w, CELL.h, caption, () => setElevation(order), () => helm.mode === 'manual' && Math.abs(helm.elevation - order) < 0.02);
    });
    const elevationSet = solid(desk, 'HelmElevationSet', { left: elevationX - 14, top: 0, width: 10, height: 3 }, rgb(AMBER));
    const elevationNow = solid(desk, 'HelmElevationNow', { left: elevationX + CELL.w + 4, top: 0, width: 10, height: 3 }, rgb(ICE));

    const wide = RUDDER_ORDERS.length * (RUDDER.w + CELL.gap) - CELL.gap, rudderX = -wide / 2;
    header('RudderPort', rudderX - 88, RUDDER.top + 6, 80, 'PORT', TextAlign.Right);
    header('RudderStarboard', -rudderX + 8, RUDDER.top + 6, 100, 'STARBOARD', TextAlign.Left);
    RUDDER_ORDERS.forEach((order, i) => {
        const caption = order === 0 ? 'MID' : String(Math.round(Math.abs(order) * 30));
        control(`Rudder${Math.round(order * 30)}`, rudderX + i * (RUDDER.w + CELL.gap), RUDDER.top, RUDDER.w, RUDDER.h, caption, () => setRudder(order), () => helm.mode === 'manual' && Math.abs(helm.rudder - order) < 0.02);
    });
    const rudderSet = solid(desk, 'HelmRudderSet', { left: 0, top: RUDDER.top + RUDDER.h + 3, width: 3, height: 8 }, rgb(AMBER));
    const rudderNow = solid(desk, 'HelmRudderNow', { left: 0, top: RUDDER.top - 8, width: 3, height: 6 }, rgb(ICE));

    const left = elevationX - 18 - BUTTON.w, right = engineX + CELL.w + 18, rowAt = (i: number): number => (i + 1) * (CELL.h + CELL.gap);
    header('WeaponsTitle', left, -16 + rowAt(0), BUTTON.w, 'TARGET');
    header('AutoTitle', right, -16 + rowAt(0), BUTTON.w, 'AUTOPILOT');
    control('Lock', left, rowAt(0), BUTTON.w, BUTTON.h, 'T   LOCK', () => { probe.next = true; }, () => probe.selected >= 0);
    control('Release', left, rowAt(1), BUTTON.w, BUTTON.h, 'R   RELEASE', () => { probe.release = true; }, () => false);
    control('Mine', left, rowAt(2), BUTTON.w, BUTTON.h, 'F   MINE', () => { mining.armed = !mining.armed; }, () => mining.armed, cruising);
    control('Auto', left, rowAt(2), BUTTON.w, BUTTON.h, 'C   AUTO FIRE', () => { guns.auto = !guns.auto; }, () => guns.auto, fighting);
    control('Guns', left, rowAt(3), BUTTON.w, BUTTON.h, 'G   COMBAT', () => { guns.toggle = true; }, () => guns.view);
    control('Gate', right, rowAt(0), BUTTON.w, BUTTON.h, 'B   GATE', () => engage('align'), () => helm.mode === 'align');
    control('Close', right, rowAt(1), BUTTON.w, BUTTON.h, 'V   CLOSE', () => engage('approach'), () => helm.mode === 'approach');
    control('Level', right, rowAt(2), BUTTON.w, BUTTON.h, 'Z   LEVEL', () => engage('level'), () => helm.mode === 'level');
    control('Steady', right, rowAt(3), BUTTON.w, BUTTON.h, 'X   STEADY', () => steady(), () => false);
    const cruiseHints = header('Hints', -420, RUDDER.top + RUDDER.h + 14, 840, 'W S  ENGINE      A D  RUDDER      Q E  PITCH      Z  LEVEL      DRAG  LOOK      1 - 6  VIEWS      SPACE  TOUR      G  COMBAT');
    const combatHints = header('CombatHints', -420, RUDDER.top + RUDDER.h + 14, 840, 'DRAG  AIM      SPACE OR CLICK  FIRE      TWICE  SALVO      HOLD  KEEP FIRING      C  AUTO FIRE      A D Q E  STEER      G  LEAVE COMBAT');

    const along = (value: number, low: number, high: number): number => {
        const k = Math.max(0, Math.min(1, (value - low) / (high - low)));
        return tall - CELL.h / 2 - k * (tall - CELL.h) - 1.5;
    };

    const update = (frame: Frame): void => {
        const centre = Math.round(frame.across / 2);
        place(desk, centre, TOP);
        let consumed = false;
        fade(cruiseHints, guns.view ? 0 : 1);
        fade(combatHints, guns.view ? 1 : 0);
        ink(combatHints, rgb(AMBER, 0.85));
        for (const c of controls) {
            const here = c.when();
            fade(c.cap, here ? 1 : 0);
            fade(c.text, here ? 1 : 0);
            if (!here) continue;
            spots[c.name] = { left: centre + c.x + c.w / 2, top: TOP + c.y + c.h / 2 };
            const over = frame.pointer.left >= centre + c.x && frame.pointer.left <= centre + c.x + c.w && frame.pointer.top >= TOP + c.y && frame.pointer.top <= TOP + c.y + c.h;
            if (frame.click && !consumed && frame.click.left >= centre + c.x && frame.click.left <= centre + c.x + c.w && frame.click.top >= TOP + c.y && frame.click.top <= TOP + c.y + c.h) {
                c.press();
                consumed = true;
            }
            const lit = c.lit();
            ink(c.cap, lit ? rgb(AMBER, 0.95) : rgb(ICE, over ? 0.95 : 0.55), UIVisual);
            ink(c.text, lit ? rgb(AMBER) : over ? rgb(ICE) : rgb(HAZE));
        }
        place(engineSet, engineX + CELL.w + 4, along(helm.order, 0, 1));
        place(engineNow, engineX - 14, along(ship.throttle, 0, 1));
        place(elevationSet, elevationX - 14, along(helm.elevation, -1, 1));
        place(elevationNow, elevationX + CELL.w + 4, along(helm.pitchRate / PITCH_RATE, -1, 1));
        const across = (value: number): number => Math.max(-1, Math.min(1, value)) * (wide / 2 - RUDDER.w / 2) - 1.5;
        place(rudderSet, across(helm.rudder), RUDDER.top + RUDDER.h + 3);
        place(rudderNow, across(helm.helmAngle), RUDDER.top - 8);
        say(controls.find((c) => c.name === 'Mine')!.text, mining.armed ? 'F   MINING' : 'F   MINE');
        if (consumed) frame.click = null;
    };

    return { root: desk, update, spots };
}
