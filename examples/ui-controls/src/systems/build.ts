import {
    defineSystem, Query, Res, GetWorld,
    Canvas, UIEvents,
    Text, UIVisual, FlexContainer,
    Interactable, UIInteraction,
    spawnUIEntity,
    createButton, createToggle, createSlider, createProgress, createDropdown, createDialog,
    themeColors, px, percent,
    UIPositionType, FlexDirection, JustifyContent, AlignItems, TextAlign, TextVerticalAlign,
} from 'esengine';
import type {
    Entity, World, Color, ThemeColors, UIEventQueue, TextData, UIVisualData,
} from 'esengine';

import {
    PANEL_W, PANEL_H, PANEL_PAD, ROW_GAP, TITLE_H, ROW_H, LABEL_W,
    SLIDER_W, SLIDER_H, PROGRESS_H, CONTROL_H, ACCENTS, type Accent,
} from '../config';
import { state } from '../state';

// Builds the panel and every widget once, at startup, from the widget factories + theme.
export const buildSystem = defineSystem(
    [Query(Canvas), Res(UIEvents), GetWorld()],
    (canvases: Iterable<[Entity, unknown]>, events: UIEventQueue, world: World) => {
        if (state.slider) return; // startup runs once, but stay idempotent

        let canvas: Entity | null = null;
        for (const [entity] of canvases) { canvas = entity; break; }
        if (canvas === null) return;

        const c = themeColors();

        // Centred panel, laid out as a flex column.
        const panel = spawnUIEntity({
            world, parent: canvas,
            node: {
                position: UIPositionType.Absolute,
                width: px(PANEL_W), height: px(PANEL_H),
                insetLeft: percent(50), insetTop: percent(50),
                marginLeft: px(-PANEL_W / 2), marginTop: px(-PANEL_H / 2),
            },
            visual: { color: c.surface },
        });
        world.insert(panel, FlexContainer, {
            direction: FlexDirection.Column,
            wrap: 0,
            justifyContent: JustifyContent.Start,
            alignItems: AlignItems.Stretch,
            alignContent: 0,
            gap: { x: 0, y: ROW_GAP },
            padding: { left: PANEL_PAD, top: PANEL_PAD, right: PANEL_PAD, bottom: PANEL_PAD },
        });

        spawnUIEntity({
            world, parent: panel,
            node: { height: px(TITLE_H) },
            text: { content: 'UI Controls', fontSize: 20, bold: true, color: c.onPrimary,
                align: TextAlign.Left, verticalAlign: TextVerticalAlign.Middle },
        });

        // Modal dialog overlay (hidden until "Open…"), populated with its own children.
        const dialog = createDialog({
            world, parent: canvas, startHidden: true,
            panelNode: {
                position: UIPositionType.Absolute,
                width: px(360), height: px(190),
                insetLeft: percent(50), insetTop: percent(50),
                marginLeft: px(-180), marginTop: px(-95),
            },
            panelVisual: { color: c.surfaceElevated },
        });
        spawnUIEntity({
            world, parent: dialog.panelEntity,
            node: { position: UIPositionType.Absolute, insetLeft: px(0), insetRight: px(0),
                insetTop: px(26), height: px(26) },
            text: { content: 'Hello from a modal', fontSize: 18, bold: true, color: c.onPrimary },
        });
        spawnUIEntity({
            world, parent: dialog.panelEntity,
            node: { position: UIPositionType.Absolute, insetLeft: px(28), insetRight: px(28),
                insetTop: px(66), height: px(48) },
            text: { content: 'A dialog is just a backdrop plus a panel you fill with children.',
                fontSize: 13, color: c.onPrimary, wordWrap: true,
                verticalAlign: TextVerticalAlign.Top },
        });
        createButton({
            world, events, parent: dialog.panelEntity,
            node: { position: UIPositionType.Absolute, width: px(120), height: px(CONTROL_H),
                insetLeft: percent(50), marginLeft: px(-60), insetBottom: px(22) },
            states: controlStates(c),
            text: { content: 'Close', color: c.onPrimary, fontSize: 14 },
            onClick: () => dialog.close(),
        });

        // Button: a click counter in the row label.
        {
            const { row, label } = makeRow(world, panel, c, 'Clicks: 0');
            let clicks = 0;
            createButton({
                world, events, parent: row,
                node: slotNode(140, CONTROL_H),
                states: primaryStates(c),
                text: { content: 'Click me', color: c.onPrimary, fontSize: 14 },
                onClick: () => { clicks += 1; setText(world, label, `Clicks: ${clicks}`); },
            });
        }

        // Toggle: pause/resume the progress animation.
        {
            const { row } = makeRow(world, panel, c, 'Animate');
            createToggle({
                world, events, parent: row,
                node: slotNode(28, 28),
                background: { color: c.control },
                interactionStates: controlStates(c),
                check: { node: { fill: true, marginLeft: px(6), marginTop: px(6),
                    marginRight: px(6), marginBottom: px(6) }, color: c.primary },
                isOn: true,
                onChange: (isOn) => { state.paused = !isOn; },
            });
        }

        // Slider: 0..100 volume; drag handled in controls.ts.
        {
            const { row, label } = makeRow(world, panel, c, 'Volume  60%');
            state.volumeLabel = label;
            const slider = createSlider({
                world, parent: row,
                node: slotNode(SLIDER_W, SLIDER_H),
                min: 0, max: 100, step: 1, value: 60, handleWidth: 14,
                onChange: (v) => setText(world, label, `Volume  ${Math.round(v)}%`),
            });
            // createSlider ships no input — make the track hit-testable for controls.ts.
            world.insert(slider.trackEntity, Interactable,
                { enabled: true, blockRaycast: true, raycastTarget: true });
            world.insert(slider.trackEntity, UIInteraction,
                { hovered: false, pressed: false, justPressed: false, justReleased: false });
            state.slider = slider;
        }

        // Progress: auto-animated in controls.ts.
        {
            const { row } = makeRow(world, panel, c, 'Loading');
            state.progress = createProgress({
                world, parent: row,
                node: slotNode(SLIDER_W, PROGRESS_H),
                fill: { color: ACCENTS[0]!.color },
                value: 0,
            });
        }

        // Dialog opener.
        {
            const { row } = makeRow(world, panel, c, 'Modal');
            createButton({
                world, events, parent: row,
                node: slotNode(140, CONTROL_H),
                states: controlStates(c),
                text: { content: 'Open…', color: c.onPrimary, fontSize: 14 },
                onClick: () => dialog.open(),
            });
        }

        // Dropdown: re-tints the fills. Last row so its popup opens below the panel.
        {
            const { row } = makeRow(world, panel, c, 'Accent');
            createDropdown<Accent>({
                world, events, parent: row,
                node: slotNode(150, CONTROL_H),
                options: ACCENTS,
                optionToLabel: (a) => a.name,
                optionHeight: 30,
                onSelect: (_i, accent) => {
                    if (state.slider) setColor(world, state.slider.fillEntity, accent.color);
                    if (state.progress) setColor(world, state.progress.fillEntity, accent.color);
                },
            });
        }
    },
    { name: 'BuildSystem' },
);

// helpers

interface RowRefs { row: Entity; label: Entity; }

// A row: fixed-height flex item; label pinned left, widget slot pinned right.
function makeRow(world: World, panel: Entity, c: ThemeColors, labelText: string): RowRefs {
    const row = spawnUIEntity({ world, parent: panel, node: { height: px(ROW_H) } });
    const label = spawnUIEntity({
        world, parent: row,
        node: { position: UIPositionType.Absolute, insetLeft: px(0), insetTop: px(0),
            insetBottom: px(0), width: px(LABEL_W) },
        text: { content: labelText, fontSize: 14, color: c.onPrimary,
            align: TextAlign.Left, verticalAlign: TextVerticalAlign.Middle },
    });
    return { row, label };
}

// Widget slot: fixed w×h, pinned to the row's right edge and vertically centred.
function slotNode(w: number, h: number) {
    return {
        position: UIPositionType.Absolute,
        insetRight: px(0), insetTop: px((ROW_H - h) / 2),
        width: px(w), height: px(h),
    };
}

function controlStates(c: ThemeColors): Record<string, { color: Color }> {
    return { normal: { color: c.control }, hover: { color: c.controlHover }, pressed: { color: c.controlActive } };
}

function primaryStates(c: ThemeColors): Record<string, { color: Color }> {
    return { normal: { color: c.primary }, hover: { color: c.primaryHover }, pressed: { color: c.primaryActive } };
}

function setText(world: World, entity: Entity, content: string): void {
    if (!world.valid(entity) || !world.has(entity, Text)) return;
    const t = world.get(entity, Text) as TextData;
    t.content = content;
    world.insert(entity, Text, t);
}

function setColor(world: World, entity: Entity, color: Color): void {
    if (!world.valid(entity) || !world.has(entity, UIVisual)) return;
    const v = world.get(entity, UIVisual) as UIVisualData;
    v.color = { ...color };
    world.insert(entity, UIVisual, v);
}
