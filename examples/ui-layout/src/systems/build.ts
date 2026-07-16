import {
    defineSystem, Query, Res, GetWorld,
    Canvas, UIEvents,
    Text, UIVisual, FlexContainer,
    spawnUIEntity, createButton,
    themeColors, px,
    UIPositionType, FlexDirection, FlexWrap, JustifyContent, AlignItems, AlignContent,
    TextAlign, TextVerticalAlign,
} from 'esengine';
import type { Entity, World, Color, ThemeColors, UIEventQueue, TextData } from 'esengine';

import {
    CTRL_W, CTRL_H, CTRL_GAP, DEMO_W, DEMO_H, DEMO_TOP, DEMO_PAD, DEMO_GAP,
    ITEM_W, ITEM_HEIGHTS, DIRECTIONS, JUSTIFY, ALIGN, WRAP, COUNTS, itemColor,
    type Opt,
} from '../config';
import { state } from '../state';

// Builds the demo FlexContainer, item boxes, and the cycle-buttons that drive it.
export const buildSystem = defineSystem(
    [Query(Canvas), Res(UIEvents), GetWorld()],
    (canvases: Iterable<[Entity, unknown]>, events: UIEventQueue, world: World) => {
        if (state.container) return; // startup runs once

        let canvas: Entity | null = null;
        for (const [entity] of canvases) { canvas = entity; break; }
        if (canvas === null) return;

        const c = themeColors();

        const fullWidthAt = (top: number, height: number, text: TextInit): Entity =>
            spawnUIEntity({
                world, parent: canvas!,
                node: { position: UIPositionType.Absolute, insetLeft: px(0), insetRight: px(0),
                    insetTop: px(top), height: px(height) },
                text,
            });

        fullWidthAt(18, 28, { content: 'Flexbox Layout — live', fontSize: 20, bold: true, color: c.onPrimary });

        // Control bar: a flex row of cycle-buttons, centred across the canvas.
        const bar = spawnUIEntity({
            world, parent: canvas,
            node: { position: UIPositionType.Absolute, insetLeft: px(0), insetRight: px(0),
                insetTop: px(56), height: px(CTRL_H) },
        });
        world.insert(bar, FlexContainer, {
            direction: FlexDirection.Row, wrap: 0,
            justifyContent: JustifyContent.Center, alignItems: AlignItems.Center, alignContent: 0,
            gap: { x: CTRL_GAP, y: 0 }, padding: { left: 0, top: 0, right: 0, bottom: 0 },
        });

        // The demo container whose FlexContainer the controls drive.
        state.container = spawnUIEntity({
            world, parent: canvas,
            node: {
                position: UIPositionType.Absolute,
                width: px(DEMO_W), height: px(DEMO_H),
                insetLeft: px((800 - DEMO_W) / 2), insetTop: px(DEMO_TOP),
            },
            visual: { color: c.surfaceElevated },
        });

        state.readout = spawnUIEntity({
            world, parent: canvas,
            node: { position: UIPositionType.Absolute, insetLeft: px(0), insetRight: px(0),
                insetTop: px(DEMO_TOP + DEMO_H + 12), height: px(22) },
            text: { content: '', fontSize: 13, color: { r: 0.55, g: 0.55, b: 0.58, a: 1 } },
        });

        // inner helpers (close over world / c / events / state)

        function spawnItem(i: number): Entity {
            const box = spawnUIEntity({
                world, parent: state.container,
                node: { width: px(ITEM_W), height: px(ITEM_HEIGHTS[i % ITEM_HEIGHTS.length]!), flexShrink: 0 },
                visual: { color: itemColor(i) },
            });
            spawnUIEntity({
                world, parent: box, node: { fill: true },
                text: { content: String(i + 1), fontSize: 18, bold: true, color: { r: 1, g: 1, b: 1, a: 1 } },
            });
            return box;
        }

        function ensureItems(n: number): void {
            while (state.items.length > n) {
                const e = state.items.pop();
                if (e !== undefined && world.valid(e)) world.despawn(e);
            }
            while (state.items.length < n) state.items.push(spawnItem(state.items.length));
        }

        function apply(): void {
            ensureItems(COUNTS[state.count]!);
            world.insert(state.container, FlexContainer, {
                direction: DIRECTIONS[state.dir]!.value as FlexDirection,
                wrap: WRAP[state.wrap]!.value as FlexWrap,
                justifyContent: JUSTIFY[state.just]!.value as JustifyContent,
                alignItems: ALIGN[state.align]!.value as AlignItems,
                alignContent: AlignContent.Start,
                gap: { x: DEMO_GAP, y: DEMO_GAP },
                padding: { left: DEMO_PAD, top: DEMO_PAD, right: DEMO_PAD, bottom: DEMO_PAD },
            });
            setText(world, state.readout,
                'flex-direction: ' + DIRECTIONS[state.dir]!.css +
                '    ·    justify-content: ' + JUSTIFY[state.just]!.css +
                '    ·    align-items: ' + ALIGN[state.align]!.css +
                '    ·    flex-wrap: ' + WRAP[state.wrap]!.css);
        }

        function makeControl(caption: string, opts: Opt[], get: () => number, set: (v: number) => void): void {
            let label: Entity = 0 as Entity;
            const refresh = (): void => setText(world, label, caption + ': ' + opts[get()]!.short);
            const btn = createButton({
                world, events, parent: bar,
                node: { width: px(CTRL_W), height: px(CTRL_H) },
                states: controlStates(c),
                onClick: () => { set((get() + 1) % opts.length); refresh(); apply(); },
            });
            label = spawnUIEntity({
                world, parent: btn.entity, node: { fill: true },
                text: { content: '', fontSize: 13, color: c.onPrimary,
                    align: TextAlign.Center, verticalAlign: TextVerticalAlign.Middle },
            });
            refresh();
        }

        const countOpts: Opt[] = COUNTS.map((n) => ({ short: String(n), css: String(n), value: n }));

        makeControl('Dir', DIRECTIONS, () => state.dir, (v) => { state.dir = v; });
        makeControl('Justify', JUSTIFY, () => state.just, (v) => { state.just = v; });
        makeControl('Align', ALIGN, () => state.align, (v) => { state.align = v; });
        makeControl('Wrap', WRAP, () => state.wrap, (v) => { state.wrap = v; });
        makeControl('Items', countOpts, () => state.count, (v) => { state.count = v; });

        apply();
    },
    { name: 'BuildSystem' },
);

// shared helpers

interface TextInit {
    content: string;
    fontSize?: number;
    bold?: boolean;
    color?: Color;
}

function controlStates(c: ThemeColors): Record<string, { color: Color }> {
    return { normal: { color: c.control }, hover: { color: c.controlHover }, pressed: { color: c.controlActive } };
}

function setText(world: World, entity: Entity, content: string): void {
    if (!world.valid(entity) || !world.has(entity, Text)) return;
    const t = world.get(entity, Text) as TextData;
    t.content = content;
    world.insert(entity, Text, t);
}
