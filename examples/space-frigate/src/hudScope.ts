import { TextAlign, Transform, UIVisual } from 'esengine';
import { AMBER, HAZE, ICE, rgb, type Frame, type Kit, type Rock } from './hudKit';
import type { TargetProbe } from './hudTargets';

const SCOPE = { radius: 104, range: 2000, lift: 40, tilt: 1.12, top: 776, sweep: 1.5 } as const;

export function buildScope(kit: Kit, rocks: readonly Rock[], probe: TargetProbe): (frame: Frame) => void {
    const { world, root, textures, image, solid, label, pivot, tilt, glow, fade, place, size, ink, turn } = kit;
    const R = SCOPE.radius;
    const scope = pivot(root, 'Scope', { left: 0, top: SCOPE.top });
    label(scope, 'ScopeTitle', { left: -R - 4, top: -84, width: 120, height: 13 }, { size: 10, color: rgb(HAZE), spacing: 2.6, content: 'TACTICAL' });
    label(scope, 'ScopeRange', { left: R - 116, top: -84, width: 120, height: 13 }, { size: 10, color: rgb(HAZE), spacing: 1.8, content: `${(SCOPE.range / 1000).toFixed(1)} KM`, align: TextAlign.Right, strong: false });
    const plane = pivot(scope, 'ScopePlane', { left: 0, top: 0 });
    image(plane, 'ScopeDial', { left: -R - 10, top: -R - 10, width: 2 * R + 20, height: 2 * R + 20 }, textures.scope);
    const sweep = glow(image(plane, 'ScopeSweep', { left: -R, top: -R, width: 2 * R, height: 2 * R }, textures.sweep, rgb(0x7cd3ff, 0.55)));
    const post = (name: string): { at: ReturnType<typeof pivot>; stem: ReturnType<typeof solid>; pip: ReturnType<typeof image> } => {
        const at = pivot(plane, `ScopePost${name}`, { left: 0, top: 0 });
        return { at, stem: solid(at, `ScopeStem${name}`, { left: 0, top: 0, width: 1, height: 1 }, rgb(ICE, 0.38)), pip: image(at, `ScopePip${name}`, { left: 0, top: 0, width: 10, height: 10 }, textures.dot, rgb(ICE, 0.85)) };
    };
    const eye = post('Eye');
    fade(eye.stem, 0);
    ink(eye.pip, rgb(AMBER, 0.95), UIVisual);
    const blips = rocks.map((rock) => post(String(rock.index)));
    const half = (v: number): number => Math.round(v * 2) / 2;
    const k = R / SCOPE.range;

    return (frame) => {
        place(scope, half(frame.across / 2), SCOPE.top);
        const lean = SCOPE.tilt - frame.sway.x * 0.6;
        tilt(plane, -lean, frame.sway.y * 0.5);
        turn(sweep, -frame.time * SCOPE.sweep);
        rocks.forEach((rock, i) => {
            const at = world.get(rock.entity, Transform).position;
            const blip = blips[i]!;
            if (Math.hypot(at.x, at.z) > SCOPE.range) { fade(blip.at, 0); return; }
            const chosen = i === probe.current, locked = chosen && probe.selected >= 0;
            const rise = Math.max(-SCOPE.lift, Math.min(SCOPE.lift, at.y * k));
            const dot = locked ? 17 : chosen ? 14 : rock.big ? 14 : 10;
            place(blip.at, half(-at.x * k), half(-at.z * k));
            tilt(blip.at, lean, 0);
            place(blip.pip, -dot / 2, half(-rise - dot / 2));
            size(blip.pip, dot, dot);
            ink(blip.pip, locked ? rgb(AMBER) : rgb(ICE, chosen ? 1 : rise < 0 ? 0.55 : 0.88), UIVisual);
            place(blip.stem, -0.5, half(Math.min(0, -rise)));
            size(blip.stem, 1, Math.max(1, half(Math.abs(rise))));
            fade(blip.at, 1);
        });
        if (frame.lens) {
            const q = frame.lens.rotation;
            const fx = -2 * (q.x * q.z + q.w * q.y), fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
            const flat = Math.hypot(fx, fz) || 1;
            place(eye.at, half((fx / flat) * R), half((fz / flat) * R));
            tilt(eye.at, lean, 0);
            place(eye.pip, -6, -6);
            size(eye.pip, 12, 12);
            fade(eye.at, 1);
        } else {
            fade(eye.at, 0);
        }
    };
}
