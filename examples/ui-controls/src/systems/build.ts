import {
    defineSystem, Res, GetWorld,
    UIEvents,
    Text, UIVisual,
    spawnUIEntity,
    createButton, createToggle, createSlider, createProgress, createDropdown, createDialog,
    themeColors, px, percent,
    UIPositionType, TextVerticalAlign,
} from 'esengine';
import type {
    Entity, World, Color, ThemeColors, UIEventQueue, TextData, UIVisualData,
} from 'esengine';

import { SLIDER_W, SLIDER_H, PROGRESS_H, CONTROL_H, ACCENTS, type Accent } from '../config';
import { state } from '../state';

export const buildSystem = defineSystem(
    [Res(UIEvents), GetWorld()],
    (events: UIEventQueue, world: World) => {
        if (state.slider) return;

        const canvas = world.findEntityByName('Canvas');
        if (canvas === null) return;

        const c = themeColors();

        // Dialog content is built ONCE: closing sets display:none on the
        // backdrop root, which hides the whole subtree (text included) and
        // removes it from input. Escape / a scrim click also close it.
        const dialog = createDialog({
            world, events, parent: canvas, startHidden: true,
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

        withRow(world, 'ClicksRow', (row) => {
            const label = world.findEntityByName('ClicksLabel');
            let clicks = 0;
            createButton({
                world, events, parent: row,
                node: slot(140, CONTROL_H),
                states: primaryStates(c),
                text: { content: 'Click me', color: c.onPrimary, fontSize: 14 },
                onClick: () => { clicks += 1; if (label !== null) setText(world, label, `Clicks: ${clicks}`); },
            });
        });

        withRow(world, 'AnimateRow', (row) => {
            createToggle({
                world, events, parent: row,
                node: slot(28, 28),
                background: { color: c.control },
                interactionStates: controlStates(c),
                check: { node: { fill: true, marginLeft: px(6), marginTop: px(6),
                    marginRight: px(6), marginBottom: px(6) }, color: c.primary },
                isOn: true,
                onChange: (isOn) => { state.paused = !isOn; },
            });
        });

        withRow(world, 'VolumeRow', (row) => {
            const label = world.findEntityByName('VolumeLabel');
            // Input is built in: drag the track, or Tab to it and use the
            // arrow keys.
            state.slider = createSlider({
                world, events, parent: row,
                node: slot(SLIDER_W, SLIDER_H),
                min: 0, max: 100, step: 1, value: 60, handleWidth: 14,
                onChange: (v) => { if (label !== null) setText(world, label, `Volume  ${Math.round(v)}%`); },
            });
        });

        withRow(world, 'LoadingRow', (row) => {
            state.progress = createProgress({
                world, parent: row,
                node: slot(SLIDER_W, PROGRESS_H),
                fill: { color: ACCENTS[0]!.color },
                value: 0,
            });
        });

        withRow(world, 'ModalRow', (row) => {
            createButton({
                world, events, parent: row,
                node: slot(140, CONTROL_H),
                states: controlStates(c),
                text: { content: 'Open…', color: c.onPrimary, fontSize: 14 },
                onClick: () => dialog.open(),
            });
        });

        withRow(world, 'AccentRow', (row) => {
            createDropdown<Accent>({
                world, events, parent: row,
                node: slot(150, CONTROL_H),
                options: ACCENTS,
                optionToLabel: (a) => a.name,
                optionHeight: 30,
                onSelect: (_i, accent) => {
                    if (state.slider) setColor(world, state.slider.fillEntity, accent.color);
                    if (state.progress) setColor(world, state.progress.fillEntity, accent.color);
                },
            });
        });
    },
    { name: 'BuildSystem' },
);

function withRow(world: World, name: string, fill: (row: Entity) => void): void {
    const row = world.findEntityByName(name);
    if (row !== null) fill(row);
}

function slot(w: number, h: number) {
    return { width: px(w), height: px(h) };
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
