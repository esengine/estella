// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { describe, it, expect, beforeEach } from 'vitest';
import { createAnimClip } from 'esengine';
import { AnimClipDocument } from '@/flipbook/AnimClipDocument';
import { AnimClipCommands } from '@/flipbook/AnimClipCommands';
import { EditorHistory } from '@/engine/EditorHistory';

function freshClip() {
  // 4×2 grid of 32px cells on a 128×64 sheet.
  return createAnimClip('@uuid:sheet', 32, 32, 128, 64);
}

const asset = () => AnimClipDocument.asset!;

describe('AnimClipCommands', () => {
  beforeEach(() => {
    EditorHistory.clear();
    AnimClipDocument.open(freshClip(), 'run.esanim');
  });

  it('appendFrames adds a whole stroke as one undo step', () => {
    AnimClipCommands.appendFrames([0, 1, 2]);
    expect(asset().frames.map((f) => f.cell)).toEqual([0, 1, 2]);
    EditorHistory.undo();
    expect(asset().frames).toEqual([]);
  });

  it('appendFrames drops negative and non-integer cells', () => {
    AnimClipCommands.appendFrames([-1, 1.5, 3]);
    expect(asset().frames.map((f) => f.cell)).toEqual([3]);
  });

  it('removeFrame and moveFrame reorder the strip', () => {
    AnimClipCommands.appendFrames([0, 1, 2, 3]);
    AnimClipCommands.moveFrame(3, 0);
    expect(asset().frames.map((f) => f.cell)).toEqual([3, 0, 1, 2]);
    AnimClipCommands.removeFrame(1);
    expect(asset().frames.map((f) => f.cell)).toEqual([3, 1, 2]);
    EditorHistory.undo();
    EditorHistory.undo();
    expect(asset().frames.map((f) => f.cell)).toEqual([0, 1, 2, 3]);
  });

  it('setFrameDuration sets seconds and clears back to the fps default', () => {
    AnimClipCommands.appendFrames([0]);
    AnimClipCommands.setFrameDuration(0, 0.25);
    expect(asset().frames[0].duration).toBe(0.25);
    AnimClipCommands.setFrameDuration(0, undefined);
    expect(asset().frames[0].duration).toBeUndefined();
  });

  it('setGrid keeps cells positive and re-slices without touching frames', () => {
    AnimClipCommands.appendFrames([0, 5]);
    AnimClipCommands.setGrid({ cellWidth: 0, spacing: 2 });
    expect(asset().sheet!.cellWidth).toBe(1);
    expect(asset().sheet!.spacing).toBe(2);
    expect(asset().frames.map((f) => f.cell)).toEqual([0, 5]);
  });

  it('bakePageSize updates only on a real change', () => {
    AnimClipCommands.bakePageSize(128, 64); // same as authored — no edit, stays clean
    expect(AnimClipDocument.dirty).toBe(false);
    AnimClipCommands.bakePageSize(256, 64);
    expect(asset().sheet!.pageWidth).toBe(256);
    expect(AnimClipDocument.dirty).toBe(true);
  });

  it('setFps floors and clamps; setLoop toggles', () => {
    AnimClipCommands.setFps(24.9);
    expect(asset().fps).toBe(24);
    AnimClipCommands.setLoop(false);
    expect(asset().loop).toBe(false);
  });

  // — Frame anchors —

  it('setAnchorsEnabled seeds a centered clip anchor and is idempotent', () => {
    expect(asset().pivot).toBeUndefined();
    AnimClipCommands.setAnchorsEnabled(true);
    expect(asset().pivot).toEqual({ x: 0.5, y: 0.5 });

    AnimClipCommands.setAnchorsEnabled(true); // already on — no second undo step
    EditorHistory.undo();
    expect(asset().pivot).toBeUndefined();
  });

  it('setAnchorsEnabled(false) clears the clip anchor AND every frame override', () => {
    AnimClipCommands.appendFrames([0, 1]);
    AnimClipCommands.setAnchorsEnabled(true);
    AnimClipCommands.setFramePivot(1, { x: 0.25, y: 0 });
    expect(asset().frames[1].pivot).toEqual({ x: 0.25, y: 0 });

    AnimClipCommands.setAnchorsEnabled(false);
    expect(asset().pivot).toBeUndefined();
    expect(asset().frames.every((f) => f.pivot === undefined)).toBe(true);

    EditorHistory.undo(); // one step back = anchors as they were
    expect(asset().pivot).toEqual({ x: 0.5, y: 0.5 });
    expect(asset().frames[1].pivot).toEqual({ x: 0.25, y: 0 });
  });

  it('setFramePivot writes an override and clears back to the clip anchor', () => {
    AnimClipCommands.appendFrames([0]);
    AnimClipCommands.setFramePivot(0, { x: 0.4, y: 0.1 });
    expect(asset().frames[0].pivot).toEqual({ x: 0.4, y: 0.1 });
    AnimClipCommands.setFramePivot(0, undefined);
    expect(asset().frames[0].pivot).toBeUndefined();
  });

  it('rejects non-finite anchors instead of writing NaN into the clip', () => {
    AnimClipCommands.appendFrames([0]);
    AnimClipCommands.setClipPivot({ x: Number.NaN, y: 0 });
    AnimClipCommands.setFramePivot(0, { x: 0, y: Number.POSITIVE_INFINITY });
    expect(asset().pivot).toBeUndefined();
    expect(asset().frames[0].pivot).toBeUndefined();
    expect(AnimClipDocument.dirty).toBe(true); // appendFrames only
  });

  it('setClipPivot moves the clip-wide anchor without touching overrides', () => {
    AnimClipCommands.appendFrames([0, 1]);
    AnimClipCommands.setFramePivot(1, { x: 0.25, y: 0 });
    AnimClipCommands.setClipPivot({ x: 0.5, y: 0 });
    expect(asset().pivot).toEqual({ x: 0.5, y: 0 });
    expect(asset().frames[1].pivot).toEqual({ x: 0.25, y: 0 });
  });
});
