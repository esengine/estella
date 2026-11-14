// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  weatherClock.ts
 * @brief Where a Weather and a TimeOfDay are at any moment of a run: functions of the time since the run began, not sums of frames.
 *
 * @details A run begins with the fields a component had then (`start`); `weatherAt` and `hourAt` answer for any `t` seconds into it, in any
 *          order, so a game can be shown at minute four without playing the three before, a cutscene can scrub, and the same `t` is the same
 *          sky on every machine. The rule is the one the weather always had: a transition in hand finishes over what is left of its duration,
 *          then each entry of the sequence holds for `hold` seconds and turns to the next over `duration`.
 */
import { blendWeather, weatherPresetId, WEATHER_NONE } from './weather';

/** The fields of a Weather a run depends on. @experimental */
export interface WeatherStart {
    preset: number;
    target: number;
    progress: number;
    duration: number;
    sequence: string;
    hold: number;
}

/** Where a Weather is: the preset it is in, the one it is turning to (`WEATHER_NONE` when none) and how far. @experimental */
export interface WeatherMoment { preset: number; target: number; progress: number }

/** The preset a name or an id in a sequence stands for. */
export function presetOf(token: string): number | undefined {
    const trimmed = token.trim();
    if (trimmed === '') return undefined;
    const named = weatherPresetId(trimmed.toLowerCase());
    if (named !== undefined) return named;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : undefined;
}

/** The presets a sequence names, in order; fewer than two is no sequence. */
export function sequenceOf(sequence: string): number[] {
    return sequence ? sequence.split(',').map(presetOf).filter((v): v is number => v !== undefined) : [];
}

/**
 * Where a Weather that began as `start` is `t` seconds later.
 *
 * @experimental
 */
export function weatherAt(start: WeatherStart, t: number): WeatherMoment {
    const duration = Math.max(start.duration, 0.01);
    let preset = start.preset;
    let s = Math.max(t, 0);
    if (start.target !== WEATHER_NONE) {
        const left = (1 - Math.min(Math.max(start.progress, 0), 1)) * duration;
        if (s < left) return { preset, target: start.target, progress: start.progress + s / duration };
        preset = start.target;
        s -= left;
    }
    const list = sequenceOf(start.sequence);
    if (list.length < 2) return { preset, target: WEATHER_NONE, progress: 0 };
    // Joins the sequence where the weather is: the first entry that is it, else the start (and keeps its own preset until the first turn).
    const at = Math.max(list.indexOf(preset), 0);
    const hold = Math.max(start.hold, 0);
    const period = hold + duration;
    const k = Math.floor(s / period);
    const within = s - k * period;
    const current = k === 0 ? preset : list[(at + k) % list.length]!;
    if (within < hold) return { preset: current, target: WEATHER_NONE, progress: 0 };
    return { preset: current, target: list[(at + k + 1) % list.length]!, progress: (within - hold) / duration };
}

/**
 * The hour of a TimeOfDay that began at `hour` and runs a day in `daySeconds` (0: a clock that stands still), `t` seconds later.
 *
 * @experimental
 */
export function hourAt(hour: number, daySeconds: number, t: number): number {
    if (!(daySeconds > 0)) return hour;
    const h = (hour + Math.max(t, 0) * 24 / daySeconds) % 24;
    return h < 0 ? h + 24 : h;
}

/**
 * The weather's wind summed over the first `t` seconds of a run (seconds of wind at its own strength): what the clouds drift by, which a
 * product of the wind now and the time would get wrong across every change of weather.
 */
export function windSecondsAt(start: WeatherStart, t: number, step = 0.05): number {
    let sum = 0;
    for (let s = 0; s < t; s += step) {
        const dt = Math.min(step, t - s);
        const m = weatherAt(start, s + dt / 2);
        sum += blendWeather(m.preset, m.target, m.progress).wind * dt;
    }
    return sum;
}
