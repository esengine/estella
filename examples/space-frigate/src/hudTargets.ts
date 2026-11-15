import { TextAlign, Transform, UINode, UIWorldAnchor, placeOnScreen } from 'esengine';
import type { Entity } from 'esengine';
import { clamp } from './flight';
import { AMBER, DESIGN, HAZE, ICE, KEPT_CLEAR, ease, keptClear, pad, sameRoom, rgb, spaced, stamp, towardOnScreen, type Frame, type Kit, type Log, type Rock } from './hudKit';
import { ship } from './shipState';

const WAYPOINT = { x: 0, y: 14, z: 2600 };
const LEG_KM = 86;
const HULL = [{ x: 0, y: 0, z: 52 }, { x: 0, y: 0, z: -52 }, { x: 24, y: 0, z: -40 }, { x: -24, y: 0, z: -40 }, { x: 0, y: 16, z: -20 }, { x: 0, y: -10, z: 0 }, { x: 14, y: 0, z: 20 }, { x: -14, y: 0, z: 20 }];
const MINOR = 6;
const PICK_REACH = 38;
const NEAR = 450;
const LOCK_SECONDS = 0.9;

const HULL_BOXES: readonly (readonly [number, number, number, number, number, number])[] = [
    [-13, -9, -50, 13, 11, 52],
    [-26, -7, -50, 26, 5, -5],
    [-8, 11, -32, 8, 24, 2],
];

function blocked(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }): boolean {
    const origin = [from.x, from.y, from.z], along = [to.x - from.x, to.y - from.y, to.z - from.z];
    return HULL_BOXES.some((box) => {
        let enter = 0, leave = 1;
        for (let axis = 0; axis < 3; axis++) {
            const lo = box[axis]!, hi = box[axis + 3]!, o = origin[axis]!, d = along[axis]!;
            if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return false; continue; }
            const a = (lo - o) / d, b = (hi - o) / d;
            enter = Math.max(enter, Math.min(a, b));
            leave = Math.min(leave, Math.max(a, b));
            if (enter > leave) return false;
        }
        return true;
    });
}

export interface TargetProbe {
    selected: number;
    current: number;
    locked: boolean;
    waypointClamped: boolean;
    picks: { index: number; left: number; top: number }[];
}

export function buildTargets(kit: Kit, rocks: readonly Rock[], planet: Entity | null, log: Log): { update(frame: Frame): void; probe: TargetProbe } {
    const { world, root, textures, node, image, sliced, solid, label, centred, say, ink, fade, place, size, turn } = kit;

    const body = centred(node(root, 'Body', { left: 0, top: 0, width: 24, height: 24 }), 24, 68);
    const globe = planet === null ? null : world.get(planet, Transform);
    const altitude = globe ? Math.hypot(globe.position.x, globe.position.y, globe.position.z) - globe.scale.x : 0;
    world.insert(body, UIWorldAnchor, { clampToEdges: false });
    image(body, 'BodyMark', { left: -4, top: -4, width: 32, height: 32 }, textures.body);
    solid(body, 'BodyLeader', { left: 26, top: 12, width: 28, height: 1 }, rgb(ICE, 0.45));
    label(body, 'BodyName', { left: 62, top: -3, width: 220, height: 14 }, { size: 11, color: rgb(ICE), spacing: 3, content: 'KARIS IV' });
    label(body, 'BodyRange', { left: 62, top: 14, width: 220, height: 14 }, { size: 10, color: rgb(HAZE), spacing: 2, strong: false, content: `ALTITUDE ${spaced(altitude)} KM` });

    const minors = Array.from({ length: MINOR }, (_, i) => {
        const e = centred(node(root, `Contact${i}`, { left: 0, top: 0, width: 22, height: 22 }), 22, 22);
        world.insert(e, UIWorldAnchor, { clampToEdges: false });
        image(e, `ContactTick${i}`, { left: 0, top: 0, width: 22, height: 22 }, textures.bracket, rgb(ICE, 0.75));
        return { node: e, index: -1 };
    });

    const marker = centred(node(root, 'Waypoint', { left: 0, top: 0, width: 72, height: 72 }), 72, 72);
    world.insert(marker, UIWorldAnchor, { offset: { ...WAYPOINT }, clampToEdges: true, edgeMargin: 64, edgeInsets: { ...KEPT_CLEAR } });
    const bracket = sliced(marker, 'WaypointBracket', { left: -6, top: -6, width: 84, height: 84 }, textures.bracket, 34);
    const diamond = image(marker, 'WaypointDiamond', { left: 20, top: 20, width: 32, height: 32 }, textures.diamond);
    const chevron = image(marker, 'WaypointChevron', { left: 12, top: 12, width: 48, height: 48 }, textures.chevron, rgb(AMBER));
    const callout = sliced(marker, 'WaypointCallout', { left: 86, top: 2, width: 232, height: 68 }, textures.plate, 26);
    const waypointName = label(callout, 'WaypointName', { left: 14, top: 9, width: 190, height: 14 }, { size: 10, color: rgb(AMBER), spacing: 2.6 });
    const waypointRange = label(callout, 'WaypointRange', { left: 14, top: 24, width: 190, height: 24 }, { size: 19, color: rgb(ICE), spacing: 0.6 });
    const waypointEta = label(callout, 'WaypointEta', { left: 14, top: 47, width: 190, height: 14 }, { size: 10, color: rgb(HAZE), spacing: 2, strong: false });

    const primary = centred(node(root, 'Target', { left: 0, top: 0, width: 60, height: 60 }), 60, 60);
    world.insert(primary, UIWorldAnchor, { clampToEdges: false, edgeMargin: 112, edgeInsets: { ...KEPT_CLEAR } });
    const reticle = image(primary, 'TargetBracket', { left: 8, top: 8, width: 44, height: 44 }, textures.bracket, rgb(ICE, 0.9));
    const arrow = image(primary, 'TargetArrow', { left: 8, top: 8, width: 44, height: 44 }, textures.chevron, rgb(ICE));
    const brief = node(primary, 'TargetBrief', { left: 58, top: 16, width: 170, height: 30 });
    const briefName = label(brief, 'TargetBriefName', { left: 0, top: 0, width: 170, height: 13 }, { size: 10, color: rgb(ICE), spacing: 2.4 });
    const briefRange = label(brief, 'TargetBriefRange', { left: 0, top: 15, width: 170, height: 13 }, { size: 10, color: rgb(HAZE), spacing: 1.6, strong: false });
    const card = sliced(primary, 'TargetCard', { left: 74, top: -12, width: 214, height: 84 }, textures.plate, 26);
    const cardState = label(card, 'TargetState', { left: 14, top: 9, width: 120, height: 14 }, { size: 10, color: rgb(AMBER), spacing: 2.6 });
    const cardName = label(card, 'TargetName', { left: 84, top: 9, width: 100, height: 14 }, { size: 10, color: rgb(HAZE), spacing: 2.2, align: TextAlign.Right });
    const cardRange = label(card, 'TargetRange', { left: 14, top: 26, width: 180, height: 24 }, { size: 19, color: rgb(ICE), spacing: 0.6 });
    const cardRate = label(card, 'TargetRate', { left: 14, top: 49, width: 180, height: 13 }, { size: 10, color: rgb(HAZE), spacing: 1.8, strong: false });
    const cardSize = label(card, 'TargetSize', { left: 14, top: 63, width: 180, height: 13 }, { size: 10, color: rgb(HAZE), spacing: 1.8, strong: false });

    const probe: TargetProbe = { selected: -1, current: -1, locked: false, waypointClamped: true, picks: [] };
    const model = { leg: 3, range: LEG_KM };
    const seen = rocks.map(() => ({ range: Infinity, left: 0, top: 0, visible: false, free: false }));
    const near = new Set<number>();
    let selected = -1, tracked = -1, shownFor = -1, lockAt = 0, announced = false, rate = 0, before = 0;
    let primed = false;
    let keyT = false, keyR = false, down = false, downAt = 0, downLeft = 0, downTop = 0, moved = 0;

    const choose = (index: number, time: number): void => {
        selected = index;
        lockAt = time;
        announced = false;
        if (index >= 0) log.say(`ROCK ${pad(index + 1, 2)}  ACQUIRING`);
    };

    const update = (frame: Frame): void => {
        const box = { width: frame.across, height: DESIGN.height };
        const hull = frame.lens ? HULL.map((p) => placeOnScreen(p, frame.lens!, box, false, 0)) : [];
        const bow = hull[0], stern = hull[1];
        const keel = bow && stern ? { x: stern.left - bow.left, y: stern.top - bow.top } : { x: 0, y: 0 };
        const length = keel.x * keel.x + keel.y * keel.y || 1;
        const off = (left: number, top: number): number => {
            if (!bow || !stern || bow.behind || stern.behind) return 9999;
            const k = clamp(((left - bow.left) * keel.x + (top - bow.top) * keel.y) / length, 0, 1);
            return Math.hypot(left - bow.left - keel.x * k, top - bow.top - keel.y * k);
        };
        const girth = hull.slice(2).reduce((most, p) => Math.max(most, off(p.left, p.top)), 0) + 14;
        rocks.forEach((rock, i) => {
            const at = world.get(rock.entity, Transform).position;
            const s = seen[i]!;
            s.range = Math.hypot(at.x, at.y, at.z);
            const on = frame.lens ? placeOnScreen(at, frame.lens, box, false, 0) : null;
            s.visible = on !== null && on.onScreen && !blocked(frame.lens!.position, at);
            s.left = on ? on.left : 0;
            s.top = on ? on.top : 0;
            s.free = s.visible && s.left > 90 && s.left < box.width - 300 && s.top > 112 && s.top < box.height - 340 && !(s.left < 470 && s.top < 204);
            if (s.range < NEAR && !near.has(i)) { near.add(i); if (primed) log.say(`PROXIMITY  ROCK ${pad(i + 1, 2)}  ${spaced(s.range)} M`, AMBER); }
            else if (s.range > NEAR * 1.15) near.delete(i);
        });
        const byRange = rocks.map((_, i) => i).sort((a, b) => seen[a]!.range - seen[b]!.range);
        primed = true;

        const t = frame.held('KeyT'), r = frame.held('KeyR');
        if (t && !keyT) {
            const inView = byRange.filter((i) => seen[i]!.visible);
            const pool = inView.length > 0 ? inView : byRange;
            choose(pool[(pool.indexOf(selected) + 1) % pool.length] ?? -1, frame.time);
        }
        if (r && !keyR && selected >= 0) { log.say(`ROCK ${pad(selected + 1, 2)}  RELEASED`); selected = -1; }
        keyT = t; keyR = r;
        if (frame.pressing && !down) { downAt = frame.time; downLeft = frame.pointer.left; downTop = frame.pointer.top; moved = 0; }
        if (frame.pressing) moved = Math.max(moved, Math.hypot(frame.pointer.left - downLeft, frame.pointer.top - downTop));
        if (!frame.pressing && down && moved < 6 && frame.time - downAt < 0.4) {
            let best = PICK_REACH, hit = -1;
            byRange.forEach((i) => {
                const s = seen[i]!;
                const off = Math.hypot(s.left - frame.pointer.left, s.top - frame.pointer.top);
                if (s.visible && off < best) { best = off; hit = i; }
            });
            if (hit >= 0 && hit !== selected) choose(hit, frame.time);
        }
        down = frame.pressing;

        if (selected < 0 && (tracked < 0 || !seen[tracked]!.free)) tracked = byRange.find((i) => seen[i]!.free) ?? -1;
        const current = selected >= 0 ? selected : tracked;
        const held = world.get(primary, UIWorldAnchor);
        const room = keptClear(box.width, world.get(primary, UINode).insetLeft.value, 112, held.onScreen);
        if (current >= 0 && (shownFor !== current || held.clampToEdges !== (selected >= 0) || !sameRoom(held.edgeInsets, room))) {
            const target = rocks[current]!.entity, pinned = selected >= 0;
            world.update(primary, UIWorldAnchor, (anchored) => { anchored.target = target; anchored.clampToEdges = pinned; anchored.edgeInsets = room; });
            shownFor = current;
            rate = 0;
            before = seen[current]!.range;
        }
        if (current < 0) {
            fade(primary, 0);
        } else {
            const s = seen[current]!;
            const lock = selected >= 0 ? clamp((frame.time - lockAt) / LOCK_SECONDS, 0, 1) : 1;
            const settle = ease(lock);
            const span = selected >= 0 ? 56 + (1 - settle) * 72 : 44;
            if (frame.dt > 0) rate += ((before - s.range) / frame.dt - rate) * Math.min(1, frame.dt * 4);
            before = s.range;
            fade(primary, 1);
            fade(reticle, held.clamped ? 0 : selected >= 0 ? 0.35 + 0.65 * settle : 0.85);
            place(reticle, 30 - span / 2, 30 - span / 2);
            size(reticle, span, span);
            turn(reticle, (1 - settle) * 0.9);
            fade(arrow, held.clamped ? 0.75 + 0.25 * Math.sin(frame.time * 5) : 0);
            if (held.clamped && frame.lens) turn(arrow, towardOnScreen(frame.lens, world.get(rocks[current]!.entity, Transform).position));
            const aside = world.get(primary, UINode).insetLeft.value > box.width - 360;
            fade(brief, selected >= 0 && !held.clamped ? 0 : 1);
            place(brief, aside ? -128 : 58, 16);
            ink(briefName, selected >= 0 ? rgb(AMBER) : rgb(ICE));
            fade(card, selected >= 0 && !held.clamped ? settle : 0);
            const name = `ROCK ${pad(current + 1, 2)}`;
            say(briefName, name);
            say(briefRange, `${spaced(s.range)} M`);
            if (selected >= 0) {
                const done = lock >= 1;
                if (done && !announced) { announced = true; log.say(`${name}  LOCKED  ${spaced(s.range)} M`); }
                place(card, aside ? -228 : 74, -12);
                say(cardState, done ? 'LOCKED' : 'ACQUIRING');
                fade(cardState, done ? 1 : 0.55 + 0.45 * Math.sin(frame.time * 14));
                say(cardName, name);
                say(cardRange, `${spaced(s.range)} M`);
                say(cardRate, Math.abs(rate) < 0.5 ? 'HOLDING RANGE' : `${rate > 0 ? 'CLOSING' : 'OPENING'}  ${spaced(Math.abs(rate))} M/S`);
                say(cardSize, `${rocks[current]!.big ? 'MAJOR BODY' : 'DRIFTING'}  ${spaced(world.get(rocks[current]!.entity, Transform).scale.x * 2)} M ACROSS`);
            }
        }

        const others = byRange.filter((i) => i !== current && seen[i]!.free).slice(0, MINOR);
        minors.forEach((minor, slot) => {
            const index = others[slot] ?? -1;
            if (index >= 0 && minor.index !== index) {
                const target = rocks[index]!.entity;
                world.update(minor.node, UIWorldAnchor, (anchored) => { anchored.target = target; });
            }
            minor.index = index;
            fade(minor.node, index >= 0 ? 0.6 : 0);
        });

        model.range -= (ship.speed * frame.dt) / 1000;
        if (model.range <= 0) { model.range += LEG_KM; model.leg = (model.leg % 9) + 1; log.say(`NAV ${pad(model.leg, 2)} SET  KESTREL GATE`, AMBER); }
        const anchor = world.get(marker, UIWorldAnchor);
        const clear = keptClear(box.width, world.get(marker, UINode).insetLeft.value, 64, anchor.onScreen);
        if (!sameRoom(anchor.edgeInsets, clear)) world.update(marker, UIWorldAnchor, (anchored) => { anchored.edgeInsets = clear; });
        place(callout, world.get(marker, UINode).insetLeft.value > box.width - 380 ? -246 : 86, 2);
        fade(bracket, anchor.clamped ? 0 : 1);
        fade(diamond, anchor.clamped ? 0 : 1);
        fade(chevron, anchor.clamped ? 0.75 + 0.25 * Math.sin(frame.time * 5) : 0);
        if (anchor.clamped && frame.lens) turn(chevron, towardOnScreen(frame.lens, WAYPOINT));
        say(waypointName, `NAV ${pad(model.leg, 2)}  KESTREL GATE`);
        say(waypointRange, `${model.range.toFixed(1)} KM`);
        say(waypointEta, ship.speed > 1 ? `ETA ${stamp((model.range * 1000) / ship.speed)}` : 'ETA  HOLDING');

        if (globe && frame.lens) {
            const lens = frame.lens;
            const q = lens.rotation, from = lens.position, c = globe.position, radius = globe.scale.x;
            const up = { x: 2 * (q.x * q.y - q.w * q.z), y: 1 - 2 * (q.x * q.x + q.z * q.z), z: 2 * (q.y * q.z + q.w * q.x) };
            const d = { x: c.x - from.x, y: c.y - from.y, z: c.z - from.z };
            const far = Math.hypot(d.x, d.y, d.z) || 1;
            d.x /= far; d.y /= far; d.z /= far;
            const along = up.x * d.x + up.y * d.y + up.z * d.z;
            const side = { x: up.x - along * d.x, y: up.y - along * d.y, z: up.z - along * d.z };
            const reach = Math.hypot(side.x, side.y, side.z) || 1;
            side.x /= reach; side.y /= reach; side.z /= reach;
            const level = { x: d.y * side.z - d.z * side.y, y: d.z * side.x - d.x * side.z, z: d.x * side.y - d.y * side.x };
            const sin = Math.min(1, radius / far), cos = Math.sqrt(1 - sin * sin);
            const tag = world.get(body, UIWorldAnchor);
            let limb = tag.offset, best = Infinity;
            for (let step = 0; step <= 48; step++) {
                const swing = (step % 2 === 0 ? 1 : -1) * Math.ceil(step / 2) * 0.05;
                const cs = Math.cos(swing) * cos, sn = Math.sin(swing) * cos;
                const p = {
                    x: Math.round(c.x + radius * (cs * side.x + sn * level.x - sin * d.x)),
                    y: Math.round(c.y + radius * (cs * side.y + sn * level.y - sin * d.y)),
                    z: Math.round(c.z + radius * (cs * side.z + sn * level.z - sin * d.z)),
                };
                const on = placeOnScreen(p, lens, box, false, 0);
                const room = Math.min(on.left - (on.top > 520 ? 480 : 120), box.width - 420 - on.left, on.top - 150, box.height - 300 - on.top);
                if (on.onScreen && room > 0 && off(on.left, on.top) > Math.max(110, girth) && Math.abs(swing) < best) { best = Math.abs(swing); limb = p; }
            }
            if (tag.offset.x !== limb.x || tag.offset.y !== limb.y || tag.offset.z !== limb.z) world.update(body, UIWorldAnchor, (anchored) => { anchored.offset = limb; });
            fade(body, best < Infinity && tag.onScreen ? 1 : 0);
        } else {
            fade(body, 0);
        }

        probe.selected = selected;
        probe.current = current;
        probe.locked = selected >= 0 && announced;
        probe.waypointClamped = anchor.clamped;
        probe.picks = byRange.filter((i) => i !== current && seen[i]!.free)
            .sort((a, b) => Math.hypot(seen[a]!.left - box.width / 2, seen[a]!.top - 360) - Math.hypot(seen[b]!.left - box.width / 2, seen[b]!.top - 360))
            .slice(0, 3).map((i) => ({ index: i, left: seen[i]!.left, top: seen[i]!.top }));
    };

    return { update, probe };
}
