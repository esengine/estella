import { TextAlign, Transform, UIVisual } from 'esengine';
import { AMBER, DESIGN, HAZE, ICE, rgb, type Frame, type Kit, type Rock } from './hudKit';
import type { TargetProbe } from './hudTargets';

const SCOPE = { width: 260, height: 176, centre: [130, 108], radii: [112, 56], range: 2000, lift: 30, bottom: 50 } as const;

export function buildScope(kit: Kit, rocks: readonly Rock[], probe: TargetProbe): (frame: Frame) => void {
    const { world, root, textures, node, image, solid, label, fade, place, size, ink } = kit;
    const top = DESIGN.height - SCOPE.bottom - SCOPE.height;
    const scope = node(root, 'Scope', { left: 0, top, width: SCOPE.width, height: SCOPE.height });
    image(scope, 'ScopeDial', { left: 0, top: 0, width: SCOPE.width, height: SCOPE.height }, textures.scope);
    label(scope, 'ScopeTitle', { left: 4, top: 16, width: 120, height: 13 }, { size: 10, color: rgb(HAZE), spacing: 2.6, content: 'TACTICAL' });
    label(scope, 'ScopeRange', { left: SCOPE.width - 124, top: 16, width: 120, height: 13 }, { size: 10, color: rgb(HAZE), spacing: 1.8, content: `${(SCOPE.range / 1000).toFixed(1)} KM`, align: TextAlign.Right, strong: false });
    const eye = image(scope, 'ScopeEye', { left: 0, top: 0, width: 12, height: 12 }, textures.dot, rgb(AMBER, 0.9));
    const blips = rocks.map((rock) => ({
        stem: solid(scope, `ScopeStem${rock.index}`, { left: 0, top: 0, width: 1, height: 1 }, rgb(ICE, 0.32)),
        pip: image(scope, `ScopePip${rock.index}`, { left: 0, top: 0, width: 10, height: 10 }, textures.dot, rgb(ICE, 0.8)),
    }));
    const [cx, cy] = SCOPE.centre, [rx, ry] = SCOPE.radii;
    const half = (v: number): number => Math.round(v * 2) / 2;

    return (frame) => {
        place(scope, half(frame.across / 2 - SCOPE.width / 2), top);
        rocks.forEach((rock, i) => {
            const at = world.get(rock.entity, Transform).position;
            const { stem, pip } = blips[i]!;
            const flat = Math.hypot(at.x, at.z);
            if (flat > SCOPE.range) { fade(stem, 0); fade(pip, 0); return; }
            const chosen = i === probe.current, locked = chosen && probe.selected >= 0;
            const x = cx - (at.x / SCOPE.range) * rx, y = cy - (at.z / SCOPE.range) * ry;
            const lift = Math.max(-SCOPE.lift, Math.min(SCOPE.lift, (at.y / SCOPE.range) * rx * 0.9));
            const dot = locked ? 16 : chosen ? 13 : rock.big ? 13 : 9;
            place(pip, half(x - dot / 2), half(y - lift - dot / 2));
            size(pip, dot, dot);
            ink(pip, locked ? rgb(AMBER) : rgb(ICE, chosen ? 1 : lift < 0 ? 0.5 : 0.82), UIVisual);
            fade(pip, 1);
            place(stem, half(x), half(Math.min(y, y - lift)));
            size(stem, 1, Math.max(1, half(Math.abs(lift))));
            fade(stem, 1);
        });
        if (frame.lens) {
            const q = frame.lens.rotation;
            const fx = -2 * (q.x * q.z + q.w * q.y), fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
            const flat = Math.hypot(fx, fz) || 1;
            place(eye, half(cx + (fx / flat) * rx - 6), half(cy + (fz / flat) * ry - 6));
            fade(eye, 1);
        } else {
            fade(eye, 0);
        }
    };
}
