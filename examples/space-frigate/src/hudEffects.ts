import {
    Assets, Canvas, CanvasEffect, Material, Name, Parent, ScaleMode, UIPointerEvents, UIVisual, UIWorldAnchor,
    defineSystem, GetWorld, spawnUIEntity,
} from 'esengine';
import type { App, Entity } from 'esengine';
import { clamp } from './flight';
import { DESIGN } from './hudKit';
import { mining } from './hudMining';
import { ship } from './shipState';

const MATERIALS = {
    lens: 'assets/ui-effects/lens.esmaterial',
    marks: 'assets/ui-effects/marks.esmaterial',
    frost: 'assets/ui-effects/frost.esmaterial',
} as const;
const LAYERS = { marks: 1, display: 2 } as const;
const FROSTED = ['Systems', 'WaypointCallout', 'TargetCard'] as const;
const LENS = { fringe: 0.0016, scan: 0.1, glow: 0.22, wake: 2.4 } as const;

export function installHudEffects(app: App): void {
    const assets = app.getResource(Assets);
    let materials: { lens: number; marks: number; frost: number } | null = null;
    let marks: Entity | null = null;
    let since = 0;
    const sent = new Map<string, number>();
    Promise.all([assets.loadMaterial(MATERIALS.lens), assets.loadMaterial(MATERIALS.marks), assets.loadMaterial(MATERIALS.frost)]).then(
        ([lens, flat, frost]) => { materials = { lens: lens.handle, marks: flat.handle, frost: frost.handle }; },
        (err: unknown) => { console.error(`space-frigate HUD effects did not load: ${err instanceof Error ? err.message : String(err)}`); },
    );

    app.addSystem(defineSystem([GetWorld()], (world) => {
        if (!materials) return;
        const display = world.findEntityByName('Hud'), root = world.findEntityByName('HudRoot');
        if (display === null || root === null) return;
        const { lens, frost } = materials;
        if (marks === null) {
            since = ship.time;
            world.update(display, Canvas, (c) => { c.layer = LAYERS.display; });
            world.insert(display, CanvasEffect, { material: lens });
            const sheet = spawnUIEntity({ world, node: { pointerEvents: UIPointerEvents.None } });
            world.insert(sheet, Name, { value: 'HudMarks' });
            world.insert(sheet, Canvas, { designResolution: { x: DESIGN.width, y: DESIGN.height }, scaleMode: ScaleMode.FixedHeight, layer: LAYERS.marks });
            world.insert(sheet, CanvasEffect, { material: materials.marks });
            marks = spawnUIEntity({ world, parent: sheet, node: { fill: true, pointerEvents: UIPointerEvents.None } });
            world.insert(marks, Name, { value: 'HudMarksRoot' });
        }
        for (const anchored of world.getEntitiesWithComponents([UIWorldAnchor, Parent])) {
            if (world.get(anchored, Parent).entity === root) world.setParent(anchored, marks);
        }
        for (const name of FROSTED) {
            const panel = world.findEntityByName(name);
            if (panel !== null && world.get(panel, UIVisual).material !== frost) world.update(panel, UIVisual, (v) => { v.material = frost; });
        }

        const waking = clamp(1 - (ship.time - since) / LENS.wake, 0, 1);
        const heat = clamp(mining.heat, 0, 1);
        const hot = mining.overheated ? 0.5 + 0.5 * Math.sin(ship.time * 31) : 0;
        const push = clamp(Math.abs(ship.wanted - ship.throttle) * 3, 0, 1);
        const set = (name: string, value: number): void => {
            const to = Math.round(value * 10000) / 10000;
            if (sent.get(name) === to) return;
            sent.set(name, to);
            Material.setUniform(lens, name, to);
        };
        set('u_fringe', LENS.fringe + 0.003 * heat * heat + 0.004 * hot + 0.0012 * push + 0.006 * waking * waking);
        set('u_scan', LENS.scan + 0.1 * heat + 0.18 * hot + 0.45 * waking * waking);
        set('u_glow', LENS.glow + 0.25 * heat + 0.3 * hot);
    }));
}
