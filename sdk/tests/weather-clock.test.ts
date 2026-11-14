// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect } from 'vitest';
import { hourAt, sequenceOf, weatherAt, windSecondsAt, type WeatherStart } from '../src/postprocess/weatherClock';
import { WEATHER_CLEAR, WEATHER_MIST, WEATHER_NONE, WEATHER_RAIN, WEATHER_STORM } from '../src/postprocess/weather';

const run = (over: Partial<WeatherStart>): WeatherStart => ({
    preset: WEATHER_CLEAR, target: WEATHER_NONE, progress: 0, duration: 10, sequence: 'clear,mist,rain', hold: 8, ...over,
});

/** The weather as it was advanced before: a frame at a time, its place in the sequence kept beside it. */
function stepped(start: WeatherStart, dt: number, frames: number): { preset: number; target: number; progress: number }[] {
    const d = { ...start };
    let cycle: { index: number; held: number } | null = null;
    const out = [];
    for (let f = 0; f < frames; f++) {
        if (d.target !== WEATHER_NONE) {
            d.progress += dt / Math.max(d.duration, 0.01);
            if (d.progress >= 1) { d.preset = d.target; d.target = WEATHER_NONE; d.progress = 0; }
        } else {
            const list = sequenceOf(d.sequence);
            if (list.length >= 2) {
                if (!cycle) { const at = list.indexOf(d.preset); cycle = { index: at < 0 ? 0 : at, held: 0 }; }
                cycle.held += dt;
                if (cycle.held >= d.hold) { cycle.held = 0; cycle.index = (cycle.index + 1) % list.length; d.target = list[cycle.index]!; d.progress = 0; }
            }
        }
        out.push({ preset: d.preset, target: d.target, progress: d.progress });
    }
    return out;
}

describe('the weather and the clock as functions of time', () => {
    it('holds, turns and comes round the sequence at the moments its hold and duration say', () => {
        const start = run({});
        expect(weatherAt(start, 4)).toEqual({ preset: WEATHER_CLEAR, target: WEATHER_NONE, progress: 0 });
        const turning = weatherAt(start, 13);
        expect(turning.preset).toBe(WEATHER_CLEAR);
        expect(turning.target).toBe(WEATHER_MIST);
        expect(turning.progress).toBeCloseTo(0.5, 9);
        expect(weatherAt(start, 19)).toEqual({ preset: WEATHER_MIST, target: WEATHER_NONE, progress: 0 });
        const round = weatherAt(start, 45);
        expect(round.preset).toBe(WEATHER_RAIN);
        expect(round.target).toBe(WEATHER_CLEAR);
        expect(round.progress).toBeCloseTo(0.1, 9);
        expect(weatherAt(start, 54 + 4).preset).toBe(WEATHER_CLEAR);
    });

    it('finishes a turn in hand before the sequence, from where it had got to', () => {
        const start = run({ target: WEATHER_RAIN, progress: 0.5, sequence: '' });
        expect(weatherAt(start, 2).progress).toBeCloseTo(0.7, 9);
        expect(weatherAt(start, 6)).toEqual({ preset: WEATHER_RAIN, target: WEATHER_NONE, progress: 0 });
    });

    it('keeps a weather the sequence does not name until its first turn, then joins the sequence at its second entry', () => {
        const start = run({ preset: WEATHER_STORM, sequence: 'clear,rain' });
        expect(weatherAt(start, 7).preset).toBe(WEATHER_STORM);
        const turn = weatherAt(start, 9);
        expect(turn.preset).toBe(WEATHER_STORM);
        expect(turn.target).toBe(WEATHER_RAIN);
    });

    it('is what advancing a frame at a time gave, but for the frames that way lost at each turn', () => {
        // A frame at a time dropped what a transition ran past 1 and started the next hold a frame late, so it fell behind by a frame or two
        // a turn. Every frame it gave is the weather at a moment no more than that far before the one asked for, and in the same order.
        const dt = 1 / 60;
        for (const start of [run({}), run({ preset: WEATHER_STORM, sequence: 'clear,rain', hold: 3, duration: 2 }), run({ target: WEATHER_MIST, progress: 0.3 })]) {
            const frames = stepped(start, dt, 60 * 120);
            const period = start.hold + start.duration;
            frames.forEach((was, f) => {
                const t = (f + 1) * dt;
                const lag = Math.ceil(t / period + 1) * 3;
                let found = false;
                for (let k = 0; k <= lag && !found; k++) {
                    const now = weatherAt(start, t - k * dt);
                    found = was.preset === now.preset && was.target === now.target && Math.abs(was.progress - now.progress) <= dt / start.duration * 1.01;
                }
                expect(found, `frame ${f}: ${JSON.stringify(was)}`).toBe(true);
            });
        }
    });

    it('turns the hour round the clock, and stands when the day has no length', () => {
        expect(hourAt(23, 240, 20)).toBeCloseTo(1, 9);
        expect(hourAt(6, 0, 1000)).toBe(6);
        expect(hourAt(6, 96, 24)).toBeCloseTo(12, 9);
        expect(hourAt(6, 96, -5)).toBe(6);
    });

    it('sums the wind a run has blown, which clear air does at its own strength', () => {
        expect(windSecondsAt(run({ sequence: '' }), 10)).toBeCloseTo(10, 6);
        const stormy = windSecondsAt(run({ preset: WEATHER_STORM, sequence: '' }), 10);
        expect(stormy).toBeGreaterThan(10);
    });
});
