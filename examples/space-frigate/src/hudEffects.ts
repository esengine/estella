import {
    Assets, Canvas, CanvasEffect, Name, Parent, ScaleMode, UIPointerEvents, UIVisual, UIWorldAnchor,
    defineSystem, GetWorld, spawnUIEntity,
} from 'esengine';
import type { App, Entity } from 'esengine';
import { DESIGN } from './hudKit';

const MATERIALS = { lens: 'assets/ui-effects/lens.esmaterial', frost: 'assets/ui-effects/frost.esmaterial' } as const;
const LAYERS = { marks: 1, display: 2 } as const;
const FROSTED = ['Systems'] as const;

export function installHudEffects(app: App): void {
    const assets = app.getResource(Assets);
    let materials: { lens: number; frost: number } | null = null;
    let marks: Entity | null = null;
    Promise.all([assets.loadMaterial(MATERIALS.lens), assets.loadMaterial(MATERIALS.frost)]).then(
        ([lens, frost]) => { materials = { lens: lens.handle, frost: frost.handle }; },
        (err: unknown) => { console.error(`space-frigate HUD effects did not load: ${err instanceof Error ? err.message : String(err)}`); },
    );

    app.addSystem(defineSystem([GetWorld()], (world) => {
        if (!materials) return;
        const display = world.findEntityByName('Hud'), root = world.findEntityByName('HudRoot');
        if (display === null || root === null) return;
        if (marks === null) {
            const { lens, frost } = materials;
            world.update(display, Canvas, (c) => { c.layer = LAYERS.display; });
            world.insert(display, CanvasEffect, { material: lens });
            const sheet = spawnUIEntity({ world, node: { pointerEvents: UIPointerEvents.None } });
            world.insert(sheet, Name, { value: 'HudMarks' });
            world.insert(sheet, Canvas, { designResolution: { x: DESIGN.width, y: DESIGN.height }, scaleMode: ScaleMode.FixedHeight, layer: LAYERS.marks });
            marks = spawnUIEntity({ world, parent: sheet, node: { fill: true, pointerEvents: UIPointerEvents.None } });
            world.insert(marks, Name, { value: 'HudMarksRoot' });
            for (const name of FROSTED) {
                const panel = world.findEntityByName(name);
                if (panel !== null) world.update(panel, UIVisual, (v) => { v.material = frost; });
            }
        }
        for (const anchored of world.getEntitiesWithComponents([UIWorldAnchor, Parent])) {
            if (world.get(anchored, Parent).entity === root) world.setParent(anchored, marks);
        }
    }));
}
