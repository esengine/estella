import {
    defineSystem, Res, GetWorld,
    UIEvents,
    UINode, Text,
    createTextInput, createButton,
    spawnUIEntity,
    themeColors, px,
    UIPositionType, TextAlign, TextVerticalAlign,
} from 'esengine';
import type { Entity, World, UIEventQueue, TextData } from 'esengine';

import { SEED_MARKUP, SAMPLES } from '../config';
import { state } from '../state';

// The scene provides named layout slots (a Panel column with a preview card, a
// composer row and a legend column); this system fills them once the scene tree
// exists. Everything interactive is built in code so the wiring — input → live
// preview — reads top-to-bottom.
export const buildSystem = defineSystem(
    [Res(UIEvents), GetWorld()],
    (events: UIEventQueue, world: World) => {
        if (state.built) return;
        const previewSlot = world.findEntityByName('PreviewSlot');
        const composerRow = world.findEntityByName('ComposerRow');
        const showcaseSlot = world.findEntityByName('ShowcaseSlot');
        if (previewSlot === null || composerRow === null || showcaseSlot === null) return;
        state.built = true;

        const c = themeColors();

        // Live preview: a rich Text filling the preview card. Its content mirrors
        // whatever markup is in the input, re-parsed + re-rendered on every edit.
        const preview = spawnUIEntity({
            world, parent: previewSlot,
            node: {
                position: UIPositionType.Absolute,
                insetLeft: px(16), insetRight: px(16), insetTop: px(14), insetBottom: px(14),
            },
            text: {
                content: SEED_MARKUP,
                fontSize: 30,
                richText: true,
                wordWrap: true,
                align: TextAlign.Left,
                verticalAlign: TextVerticalAlign.Top,
                color: { r: 1, g: 1, b: 1, a: 1 },
            },
        });
        state.preview = preview;

        // The editable markup source. Typing (incl. IME composition for CJK)
        // fires `change`, which re-renders the preview above.
        state.input = createTextInput({
            world, events, parent: composerRow,
            node: { width: px(580), height: px(36) },
            value: SEED_MARKUP,
            fontSize: 16,
            onChange: (value) => setPreview(world, preview, value),
        });

        // Reset the markup back to the seed sample.
        createButton({
            world, events, parent: composerRow,
            node: { width: px(110), height: px(36) },
            states: { normal: { color: c.primary }, hover: { color: c.primary }, pressed: { color: c.primary } },
            text: { content: 'Reset', color: c.onPrimary, fontSize: 14 },
            onClick: () => {
                state.input?.setValue(SEED_MARKUP);
                setPreview(world, preview, SEED_MARKUP);
            },
        });

        // Static legend: each supported tag rendered next to nothing but itself,
        // so the panel doubles as a quick reference.
        for (const line of SAMPLES) {
            spawnUIEntity({
                world, parent: showcaseSlot,
                node: { height: px(32) },
                text: {
                    content: line,
                    fontSize: 20,
                    richText: true,
                    // Single-line legend rows: no wrap so inline <img> runs render
                    // (wrapping is text-only for now).
                    wordWrap: false,
                    align: TextAlign.Left,
                    verticalAlign: TextVerticalAlign.Middle,
                    color: { r: 0.9, g: 0.9, b: 0.92, a: 1 },
                },
            });
        }
    },
    { name: 'BuildSystem' },
);

/** Point the preview Text at the current markup (skips a redundant write). */
function setPreview(world: World, preview: Entity, markup: string): void {
    if (!world.valid(preview) || !world.has(preview, Text)) return;
    const t = world.get(preview, Text) as TextData;
    if (t.content === markup) return;
    t.content = markup;
    world.insert(preview, Text, t);
}
