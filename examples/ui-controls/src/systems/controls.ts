import {
    defineSystem, Res, GetWorld, Time, UIEvents, UIEventType,
    TextInput, openDialog, closeDialog,
} from 'esengine';
import type { World, UIEventQueue, TimeData, TextInputData } from 'esengine';

import { ACCENTS, DIFFICULTIES, PROGRESS_SPEED } from '../config';
import { ids, state } from '../state';
import { setColor, setFill, setText, dropdownIndex, sliderValue, toggleOn } from '../ui';

export const controlsSystem = defineSystem(
    [Res(UIEvents), Res(Time), GetWorld()],
    (events: UIEventQueue, time: TimeData, world: World) => {
        if (!state.wired) return;
        const hit = (list: readonly { target: number }[], entity: number | null) =>
            entity !== null && list.some((e) => e.target === entity);

        const clicks = events.query(UIEventType.Click);
        if (hit(clicks, ids.ClickButton ?? null)) {
            state.clicks += 1;
            setText(world, ids.ClicksLabel, `Clicks: ${state.clicks}`);
        }
        // A dialog dismisses itself on Escape and on a scrim click — the UIDialog
        // component carries both — so only OPENING needs saying.
        if (hit(clicks, ids.ModalButton ?? null)) openDialog(world, events, ids.Modal!);
        if (hit(clicks, ids.ModalClose ?? null)) closeDialog(world, events, ids.Modal!);

        for (const ev of events.query(UIEventType.Change)) {
            if (ev.target === ids.AnimateToggle) {
                state.paused = !toggleOn(world, ids.AnimateToggle ?? null);
            } else if (ev.target === ids.VolumeSlider) {
                setText(world, ids.VolumeLabel, `Volume  ${Math.round(sliderValue(world, ids.VolumeSlider))}%`);
            } else if (ev.target === ids.AccentDropdown) {
                const accent = ACCENTS[dropdownIndex(world, ids.AccentDropdown ?? null)];
                if (accent) {
                    setColor(world, ids.VolumeSliderFill, accent.color);
                    setColor(world, ids.LoadingBarFill, accent.color);
                }
            } else if (ev.target === ids.NameField) {
                const value = (world.get(ids.NameField!, TextInput) as TextInputData).value;
                setText(world, ids.NameLabel, value ? `Name — ${value}` : 'Name');
            } else {
                // The group keeps exactly one of the three on; the label just
                // reports which, so any of their changes is the same question.
                const picked = DIFFICULTIES.find((d) => toggleOn(world, ids[`${d}Toggle`] ?? null));
                if (picked) setText(world, ids.DifficultyLabel, `Difficulty: ${picked}`);
            }
        }

        if (state.paused) return;
        state.progressT += time.delta * PROGRESS_SPEED * state.progressDir;
        if (state.progressT >= 1) { state.progressT = 1; state.progressDir = -1; }
        else if (state.progressT <= 0) { state.progressT = 0; state.progressDir = 1; }
        setFill(world, ids.LoadingBarFill, state.progressT);
    },
    { name: 'ControlsSystem' },
);
