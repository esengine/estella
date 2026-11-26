// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  What the Recorder service adds over the host's recorder: honest
 *        capability answers for a menu, a state a button can show, lengths
 *        kept inside the host's limits, and `last` as the default thing shared.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { App } from 'esengine';

const host = {
  recorder: null as null | Record<string, unknown>,
};

vi.mock('esengine', () => ({
  defineResource: (value: unknown, name: string) => ({ value, name }),
  platformScreenRecorder: () => host.recorder,
}));

const { RecorderAPI } = await import('../src/recorder');

function fakeRecorder(over: Record<string, unknown> = {}) {
  let onFailure: ((e: Error) => void) | null = null;
  const r = {
    limits: { minSeconds: 4, maxSeconds: 300 },
    canShare: true,
    start: vi.fn(async (_s: number, fail: (e: Error) => void) => { onFailure = fail; }),
    pause: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
    stop: vi.fn(async () => ({ durationMs: 1234, path: 'ttfile://run.mp4', highlights: [] })),
    abort: vi.fn(async () => {}),
    highlight: vi.fn(),
    share: vi.fn(async () => {}),
    fail: (e: Error) => onFailure?.(e),
    ...over,
  };
  host.recorder = r;
  return r;
}

beforeEach(() => { host.recorder = null; });

describe('the recorder service', () => {
  it('answers whether it can record and whether it can share, separately', () => {
    const recorder = new RecorderAPI();
    expect(recorder.available).toBe(false);
    expect(recorder.canShare).toBe(false);
    fakeRecorder({ canShare: false });
    expect(recorder.available).toBe(true);
    expect(recorder.canShare).toBe(false);
  });

  it('refuses to start where there is no recorder, naming what to check', async () => {
    await expect(new RecorderAPI().start()).rejects.toThrow('Recorder.available');
  });

  it('asks the host for a length inside its limits', async () => {
    const r = fakeRecorder();
    const recorder = new RecorderAPI();
    await recorder.start();
    await recorder.stop();
    await recorder.start({ maxSeconds: 1 });
    expect(r.start.mock.calls.map((c) => c[0])).toEqual([300, 4]);
  });

  it('walks idle → recording → paused → recording → idle', async () => {
    fakeRecorder();
    const recorder = new RecorderAPI();
    const seen: string[] = [recorder.state];
    await recorder.start(); seen.push(recorder.state);
    await recorder.pause(); seen.push(recorder.state);
    await recorder.resume(); seen.push(recorder.state);
    await recorder.stop(); seen.push(recorder.state);
    expect(seen).toEqual(['idle', 'recording', 'paused', 'recording', 'idle']);
  });

  it('goes back to idle when the host refuses to start', async () => {
    fakeRecorder({ start: async () => { throw new Error('no permission to record screen'); } });
    const recorder = new RecorderAPI();
    await expect(recorder.start()).rejects.toThrow('no permission');
    expect(recorder.state).toBe('idle');
  });

  it('refuses a second start rather than asking the host twice', async () => {
    const r = fakeRecorder();
    const recorder = new RecorderAPI();
    await recorder.start();
    await expect(recorder.start()).rejects.toThrow('while recording');
    expect(r.start).toHaveBeenCalledTimes(1);
  });

  it('tells its listeners when a recording dies on its own, and is idle again', async () => {
    const r = fakeRecorder();
    const recorder = new RecorderAPI();
    const heard = vi.fn();
    recorder.onFailure(heard);
    await recorder.start();
    r.fail(new Error('internal failed'));
    expect(heard).toHaveBeenCalledWith(expect.objectContaining({ message: 'internal failed' }));
    expect(recorder.state).toBe('idle');
  });

  it('passes a highlight only while recording', async () => {
    const r = fakeRecorder();
    const recorder = new RecorderAPI();
    recorder.highlight();
    await recorder.start();
    recorder.highlight(5, 2);
    await recorder.pause();
    recorder.highlight();
    expect(r.highlight.mock.calls).toEqual([[5, 2]]);
  });

  it('shares the last recording by default', async () => {
    const r = fakeRecorder();
    const recorder = new RecorderAPI();
    await expect(recorder.share()).rejects.toThrow('nothing has been recorded');
    await recorder.start();
    const recording = await recorder.stop();
    expect(recorder.last).toBe(recording);
    await recorder.share({ title: 'my run' });
    expect(r.share).toHaveBeenCalledWith(recording, { title: 'my run' });
  });

  it('refuses to share where the host cannot, naming what to check', async () => {
    fakeRecorder({ canShare: false });
    const recorder = new RecorderAPI();
    await recorder.start();
    await recorder.stop();
    await expect(recorder.share()).rejects.toThrow('Recorder.canShare');
  });

  it('finishes and shares a recording on the screen where it started', async () => {
    const first = fakeRecorder();
    const recorder = new RecorderAPI();
    await recorder.start();
    const second = fakeRecorder();
    await recorder.pause();
    await recorder.resume();
    await recorder.stop();
    await recorder.share();
    expect(first.stop).toHaveBeenCalledOnce();
    expect(first.share).toHaveBeenCalledOnce();
    expect(second.pause).not.toHaveBeenCalled();
    await recorder.start();
    first.fail(new Error('late error'));
    expect(recorder.state).toBe('recording');
    await recorder.abort();
    expect(second.abort).toHaveBeenCalledOnce();
  });

  it('aborts only the owning App on a shared mini-game recorder, including during start', async () => {
    let accept!: () => void;
    const shared = fakeRecorder({ start: vi.fn(() => new Promise<void>(resolve => { accept = resolve; })) });
    const priorLife = new AbortController();
    const prior = new RecorderAPI({ signal: priorLife.signal } as App);
    const other = new RecorderAPI();
    const starting = prior.start();
    await expect(other.start()).rejects.toThrow('already recording');
    priorLife.abort();
    accept();
    await starting;
    await vi.waitFor(() => expect(prior.state).toBe('idle'));
    expect(shared.abort).toHaveBeenCalledOnce();
    expect(prior.available).toBe(false);
    const retry = other.start();
    accept();
    await retry;
    await other.stop();
    expect(shared.abort).toHaveBeenCalledOnce();
  });
});
