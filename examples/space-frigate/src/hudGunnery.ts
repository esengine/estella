import { FillMethod, FillOrigin, TextAlign, UIVisual, UIVisualType, placeOnScreen } from 'esengine';
import { GUNNERY, guns } from './gunnery';
import { helm, turnBy } from './helm';
import { ALERT, AMBER, DESIGN, EDGE, HAZE, ICE, pad, reach, rgb, type Frame, type Kit, type Log } from './hudKit';
import type { TargetProbe } from './hudTargets';

const SIGHT = { top: DESIGN.height / 2, arm: 250, gap: 18, tick: 40 };
const ROW = { top: 588, cell: 70, bar: 52 };
const TRIGGER = { right: EDGE + 16, top: 396, width: 168, height: 72, gap: 8, small: 30 };

export function buildGunnery(kit: Kit, log: Log, probe: TargetProbe): (frame: Frame) => void {
    const { root, textures, node, image, sliced, solid, label, pivot, say, ink, fill, fade, place } = kit;
    const line = rgb(ICE, 0.62);

    const sight = pivot(root, 'Sight', { left: 0, top: SIGHT.top });
    solid(sight, 'SightLeft', { left: -SIGHT.arm, top: 0, width: SIGHT.arm - SIGHT.gap, height: 1 }, line);
    solid(sight, 'SightRight', { left: SIGHT.gap, top: 0, width: SIGHT.arm - SIGHT.gap, height: 1 }, line);
    for (let k = 1; k * SIGHT.tick <= SIGHT.arm; k++) {
        const tall = k % 3 === 0 ? 11 : 6;
        solid(sight, `SightTickL${k}`, { left: -k * SIGHT.tick, top: 1, width: 1, height: tall }, line);
        solid(sight, `SightTickR${k}`, { left: k * SIGHT.tick, top: 1, width: 1, height: tall }, line);
    }
    solid(sight, 'SightRise', { left: 0, top: -30, width: 1, height: 14 }, line);
    solid(sight, 'SightDrop', { left: 0, top: 16, width: 1, height: 44 }, line);
    for (let k = 1; k <= 3; k++) solid(sight, `SightStep${k}`, { left: -4, top: 16 + k * 12, width: 9, height: 1 }, line);
    const dot = image(sight, 'SightDot', { left: -4, top: -4, width: 8, height: 8 }, textures.dot, rgb(AMBER));
    label(sight, 'SightTitle', { left: -SIGHT.arm, top: -22, width: 200, height: 14 }, { size: 10, color: rgb(HAZE), spacing: 2.6, content: 'MAIN BATTERY' });
    const bearing = label(sight, 'SightBearing', { left: SIGHT.arm - 200, top: -22, width: 200, height: 14 }, { size: 10, color: rgb(HAZE), spacing: 2.2, align: TextAlign.Right });
    const range = label(sight, 'SightRange', { left: 18, top: 62, width: 220, height: 22 }, { size: 17, color: rgb(ICE), spacing: 0.8 });
    const flight = label(sight, 'SightFlight', { left: 18, top: 84, width: 220, height: 14 }, { size: 10, color: rgb(HAZE), spacing: 2, strong: false });
    const mark = label(sight, 'SightMark', { left: -238, top: 66, width: 220, height: 14 }, { size: 10, color: rgb(HAZE), spacing: 2.4, align: TextAlign.Right });

    const row = pivot(root, 'Battery', { left: 0, top: ROW.top });
    const control = label(row, 'BatteryControl', { left: -260, top: 30, width: 520, height: 13 }, { size: 10, color: rgb(AMBER), spacing: 2.2, align: TextAlign.Center });
    const cells: { key: ReturnType<typeof label>; bar: ReturnType<typeof node>; state: ReturnType<typeof label> }[] = [];
    const pips: { at: ReturnType<typeof pivot>; box: ReturnType<typeof image>; key: ReturnType<typeof label> }[] = [];
    const build = (): void => {
        guns.turrets.forEach((turret, i) => {
            const at = pivot(root, `GunMark${turret.key}`, { left: 0, top: 0 });
            pips.push({
                at,
                box: image(at, `GunMarkBox${turret.key}`, { left: -9, top: -9, width: 18, height: 18 }, textures.bracket, rgb(ICE)),
                key: label(at, `GunMarkKey${turret.key}`, { left: 11, top: -18, width: 20, height: 12 }, { size: 9, color: rgb(ICE), spacing: 1, content: turret.key }),
            });
            const left = (i - (guns.turrets.length - 1) / 2) * ROW.cell - ROW.bar / 2;
            image(row, `BatteryTrack${turret.key}`, { left, top: 16, width: ROW.bar, height: 5 }, textures.barTrack, rgb(ICE));
            cells.push({
                key: label(row, `BatteryKey${turret.key}`, { left, top: 0, width: 16, height: 13 }, { size: 11, color: rgb(ICE), spacing: 1, content: turret.key }),
                bar: node(row, `BatteryBar${turret.key}`, { left, top: 16, width: ROW.bar, height: 5 }, { visualType: UIVisualType.Filled, texture: textures.barFill, color: rgb(ICE), fillMethod: FillMethod.Horizontal, fillOrigin: FillOrigin.Left, fillAmount: 1 }),
                state: label(row, `BatteryState${turret.key}`, { left: left + 16, top: 0, width: ROW.bar - 16, height: 13 }, { size: 9, color: rgb(HAZE), spacing: 1.2, align: TextAlign.Right, strong: false }),
            });
        });
    };

    const trigger = pivot(root, 'Trigger', { left: 0, top: TRIGGER.top });
    const fireCap = sliced(trigger, 'TriggerFire', { left: 0, top: 0, width: TRIGGER.width, height: TRIGGER.height }, textures.keycap, 9, rgb(AMBER, 0.9));
    const fireText = label(trigger, 'TriggerFireText', { left: 0, top: 8, width: TRIGGER.width, height: 34 }, { size: 26, color: rgb(AMBER), align: TextAlign.Center, spacing: 6, content: 'FIRE' });
    const fireNote = label(trigger, 'TriggerFireNote', { left: 0, top: 46, width: TRIGGER.width, height: 14 }, { size: 9, color: rgb(HAZE), align: TextAlign.Center, spacing: 1.8, strong: false });
    const half = (TRIGGER.width - TRIGGER.gap) / 2, below = TRIGGER.height + TRIGGER.gap;
    const salvoCap = sliced(trigger, 'TriggerSalvo', { left: 0, top: below, width: half, height: TRIGGER.small }, textures.keycap, 9, rgb(ICE, 0.55));
    const salvoText = label(trigger, 'TriggerSalvoText', { left: 0, top: below, width: half, height: TRIGGER.small - 2 }, { size: 10, color: rgb(HAZE), align: TextAlign.Center, spacing: 1.6, content: 'SALVO' });
    const autoCap = sliced(trigger, 'TriggerAuto', { left: half + TRIGGER.gap, top: below, width: half, height: TRIGGER.small }, textures.keycap, 9, rgb(ICE, 0.55));
    const autoText = label(trigger, 'TriggerAutoText', { left: half + TRIGGER.gap, top: below, width: half, height: TRIGGER.small - 2 }, { size: 10, color: rgb(HAZE), align: TextAlign.Center, spacing: 1.6, content: 'AUTO' });

    let shown = 0, working = 0, grip = '', pressing = false;
    const spots: Record<string, { left: number; top: number }> = {};
    (guns as { spots?: typeof spots }).spots = spots;

    return (frame) => {
        if (pips.length === 0 && guns.turrets.length > 0) build();
        guns.locked = probe.locked;
        if (guns.note) { log.say(guns.note, AMBER); guns.note = ''; }
        const centre = Math.round(frame.across / 2);
        const left = frame.across - TRIGGER.right - TRIGGER.width;
        const active = guns.view;
        const boxes = {
            fire: { left, top: TRIGGER.top, width: TRIGGER.width, height: TRIGGER.height, on: guns.view },
            salvo: { left, top: TRIGGER.top + below, width: half, height: TRIGGER.small, on: guns.view },
            auto: { left: left + half + TRIGGER.gap, top: TRIGGER.top + below, width: half, height: TRIGGER.small, on: active },
        };
        const over = (name: keyof typeof boxes, at: { left: number; top: number }): boolean => {
            const b = boxes[name];
            return b.on && at.left >= b.left && at.left <= b.left + b.width && at.top >= b.top && at.top <= b.top + b.height;
        };
        for (const name of ['fire', 'salvo', 'auto'] as const) spots[name] = { left: boxes[name].left + boxes[name].width / 2, top: boxes[name].top + boxes[name].height / 2 };
        if (frame.pressing && !pressing) grip = over('fire', frame.pointer) ? 'fire' : over('salvo', frame.pointer) ? 'salvo' : over('auto', frame.pointer) ? 'auto' : '';
        if (frame.pressing && !pressing && grip === 'salvo') guns.clicks += 2;
        if (frame.pressing && !pressing && grip === 'auto') guns.auto = !guns.auto;
        pressing = frame.pressing;
        guns.squeeze = pressing && grip === 'fire';
        guns.holding = pressing && grip !== '';
        if (frame.click && grip !== '') frame.click = null;
        if (!pressing) grip = '';
        if (guns.view && frame.click) { guns.clicks++; frame.click = null; }

        shown += ((guns.view ? 1 : 0) - shown) * Math.min(1, frame.dt * 8);
        working += ((active ? 1 : 0) - working) * Math.min(1, frame.dt * 8);
        place(sight, centre, SIGHT.top);
        place(row, centre, ROW.top);
        place(trigger, left, TRIGGER.top);
        fade(sight, shown);
        fade(row, working);
        fade(trigger, working);
        fade(fireCap, shown);
        fade(fireText, shown);
        fade(fireNote, shown);
        fade(salvoCap, shown);
        fade(salvoText, shown);
        ink(fireCap, guns.squeeze ? rgb(ICE) : rgb(AMBER, guns.ready > 0 ? 0.95 : 0.45), UIVisual);
        ink(fireText, guns.squeeze ? rgb(ICE) : rgb(AMBER, guns.ready > 0 ? 1 : 0.5));
        say(fireNote, guns.ready > 0 ? `${guns.ready} READY   HOLD TO KEEP FIRING` : 'NO GUN READY');
        ink(salvoCap, rgb(ICE, over('salvo', frame.pointer) ? 0.95 : 0.55), UIVisual);
        ink(salvoText, over('salvo', frame.pointer) ? rgb(ICE) : rgb(HAZE));
        ink(autoCap, guns.auto ? rgb(AMBER, 0.95) : rgb(ICE, over('auto', frame.pointer) ? 0.95 : 0.55), UIVisual);
        ink(autoText, guns.auto ? rgb(AMBER) : rgb(HAZE));
        say(autoText, guns.auto ? 'AUTO ON' : 'AUTO');
        if (working < 0.01) { for (const pip of pips) fade(pip.at, 0); return; }

        const auto = guns.source === 'auto';
        say(control, !guns.auto ? '' : auto
            ? `AUTO FIRE   LEAD ${guns.lead.toFixed(1)} S   SPREAD ${((guns.spread * 180) / Math.PI).toFixed(1)}°   SOLUTION ${Math.round(Math.min(1, guns.held / GUNNERY.settle) * 100)} %`
            : 'AUTO FIRE ARMED   LOCK A TARGET');
        ink(control, auto && guns.bearing === 0 ? rgb(ALERT) : rgb(AMBER));
        const onRock = auto || guns.rock >= 0;
        say(range, onRock ? reach(guns.range) : 'NO RETURN');
        ink(range, onRock ? rgb(ICE) : rgb(HAZE));
        say(flight, onRock ? `FLIGHT ${(guns.range / GUNNERY.boltSpeed).toFixed(1)} S` : 'OPEN SPACE');
        say(mark, auto ? `ROCK ${pad(probe.selected + 1, 2)}  AUTO` : guns.rock >= 0 ? `ROCK ${pad(guns.rock + 1, 2)}` : '');
        say(bearing, `${guns.bearing} OF ${guns.turrets.length} BEAR`);
        ink(bearing, guns.bearing === 0 ? rgb(ALERT) : rgb(HAZE));
        ink(dot, guns.ready > 0 ? rgb(ICE) : rgb(AMBER), UIVisual);

        const box = { width: frame.across, height: DESIGN.height };
        guns.turrets.forEach((turret, i) => {
            const pip = pips[i], cell = cells[i];
            if (!pip || !cell) return;
            const loaded = turret.loaded >= 1;
            const tone = !turret.bears ? rgb(ALERT, 0.8) : !turret.onTarget ? rgb(AMBER) : loaded ? rgb(ICE) : rgb(HAZE, 0.8);
            if (frame.lens && guns.aim) {
                const from = turnBy(helm.attitude, turret.mouth), way = turnBy(helm.attitude, turret.bore);
                const far = Math.max(60, Math.hypot(guns.aim.x - from.x, guns.aim.y - from.y, guns.aim.z - from.z));
                const on = placeOnScreen({ x: from.x + way.x * far, y: from.y + way.y * far, z: from.z + way.z * far }, frame.lens, box, false, 0);
                place(pip.at, on.left, on.top);
                fade(pip.at, on.onScreen ? working * (turret.bears ? 1 : 0.55) : 0);
            } else {
                fade(pip.at, 0);
            }
            ink(pip.box, tone, UIVisual);
            ink(pip.key, tone);
            fill(cell.bar, Math.round(turret.loaded * 26) / 26);
            ink(cell.bar, tone, UIVisual);
            ink(cell.key, tone);
            say(cell.state, !turret.bears ? 'MASKED' : !turret.onTarget ? 'TRAIN' : loaded ? 'READY' : 'LOAD');
            ink(cell.state, tone);
        });
    };
}
