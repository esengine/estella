// Scene-owned entity builders. Everything a scene creates hangs off entities
// from ctx.spawn(), so SceneManager despawns it all (subtrees included) when
// the scene unloads — no per-scene cleanup code.
import {
    Transform, Sprite, UINode,
    buildUINode, spawnUIEntity, px,
    UIPositionType, TextAlign,
    themeColors,
} from 'esengine';
import type { Color, Entity, SceneContext, ThemeColors, World } from 'esengine';

import { Bobber } from '../components';

/**
 * Scene-owned UI root stretched over the shell's Canvas. Widget factories
 * (createButton, spawnUIEntity) spawn untracked entities, so they must parent
 * under this tracked root — unloading the scene then tears the subtree down.
 */
export function sceneUiRoot(ctx: SceneContext, world: World): Entity {
    const root = ctx.spawn();
    world.insert(root, Transform, {});
    world.insert(root, UINode, buildUINode({ fill: true }));
    const canvas = world.findEntityByName('Canvas');
    if (canvas !== null) world.setParent(root, canvas);
    return root;
}

export function heading(world: World, parent: Entity, content: string): void {
    const c = themeColors();
    spawnUIEntity({
        world, parent,
        node: {
            position: UIPositionType.Absolute,
            insetLeft: px(24), insetTop: px(20),
            width: px(300), height: px(30),
        },
        text: { content, fontSize: 22, bold: true, color: c.text, align: TextAlign.Left },
    });
}

export function platform(
    ctx: SceneContext, world: World,
    x: number, y: number, width: number, color: Color, phase: number,
): void {
    const e = ctx.spawn();
    world.insert(e, Transform, { position: { x, y, z: 0 } });
    world.insert(e, Sprite, { size: { x: width, y: 24 }, color });
    world.insert(e, Bobber, { baseY: y, phase });
}

export function buttonStates(c: ThemeColors): Record<string, { color: Color }> {
    return {
        normal: { color: c.primary },
        hover: { color: c.primaryHover },
        pressed: { color: c.primaryActive },
    };
}
