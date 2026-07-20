// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    AnimClipCommands.ts
 * @brief   Undoable mutations on the open .esanim flipbook.
 *          Each routes through AnimClipDocument.edit → one EditorHistory snapshot
 *          step; the panel never mutates the asset directly.
 */

import { serializeAnimClip, type AnimClipSheetData } from 'esengine';
import { AnimClipDocument } from './AnimClipDocument';
import { Toasts } from '@/store/Toasts';
import { t } from '@/i18n';

type GridPatch = Partial<Pick<AnimClipSheetData, 'cellWidth' | 'cellHeight' | 'margin' | 'spacing'>>;

export const AnimClipCommands = {
  /** Edit the sheet grid geometry; every cell frame follows the new slicing. */
  setGrid(patch: GridPatch): void {
    AnimClipDocument.edit('Edit Sheet Grid', (a) => {
      if (!a.sheet) return;
      for (const k of Object.keys(patch) as (keyof GridPatch)[]) {
        const v = patch[k];
        if (typeof v === 'number' && Number.isFinite(v) && v >= 0) a.sheet[k] = Math.floor(v);
      }
      if (a.sheet.cellWidth < 1) a.sheet.cellWidth = 1;
      if (a.sheet.cellHeight < 1) a.sheet.cellHeight = 1;
    });
  },

  /** Re-bake the sheet's page size from the image's natural size (UV math reads it). */
  bakePageSize(pageWidth: number, pageHeight: number): void {
    const sheet = AnimClipDocument.asset?.sheet;
    if (!sheet || (sheet.pageWidth === pageWidth && sheet.pageHeight === pageHeight)) return;
    AnimClipDocument.edit('Re-bake Sheet Size', (a) => {
      if (!a.sheet) return;
      a.sheet.pageWidth = Math.max(1, Math.floor(pageWidth));
      a.sheet.pageHeight = Math.max(1, Math.floor(pageHeight));
    });
  },

  /** Append sheet cells as frames (one stroke = one undo step). */
  appendFrames(cells: number[]): void {
    const clean = cells.filter((c) => Number.isInteger(c) && c >= 0);
    if (clean.length === 0) return;
    AnimClipDocument.edit('Add Frames', (a) => {
      for (const cell of clean) a.frames.push({ cell });
    });
  },

  removeFrame(index: number): void {
    AnimClipDocument.edit('Remove Frame', (a) => {
      if (index >= 0 && index < a.frames.length) a.frames.splice(index, 1);
    });
  },

  clearFrames(): void {
    AnimClipDocument.edit('Clear Frames', (a) => {
      a.frames.length = 0;
    });
  },

  moveFrame(from: number, to: number): void {
    AnimClipDocument.edit('Reorder Frames', (a) => {
      if (from === to || from < 0 || to < 0 || from >= a.frames.length || to >= a.frames.length) return;
      const [f] = a.frames.splice(from, 1);
      a.frames.splice(to, 0, f);
    });
  },

  /** Per-frame duration in seconds; `undefined` falls back to 1/fps. */
  setFrameDuration(index: number, seconds: number | undefined): void {
    AnimClipDocument.edit('Edit Frame Duration', (a) => {
      const f = a.frames[index];
      if (!f) return;
      if (seconds !== undefined && Number.isFinite(seconds) && seconds > 0) f.duration = seconds;
      else delete f.duration;
    });
  },

  setFps(fps: number): void {
    if (!Number.isFinite(fps) || fps < 1) return;
    AnimClipDocument.edit('Edit FPS', (a) => {
      a.fps = Math.min(240, Math.floor(fps));
    });
  },

  setLoop(loop: boolean): void {
    AnimClipDocument.edit(loop ? 'Enable Loop' : 'Disable Loop', (a) => {
      a.loop = loop;
    });
  },

  /** Add a frame event at @p frame (kept sorted by frame). */
  addEvent(frame: number, name: string): void {
    AnimClipDocument.edit('Add Event', (a) => {
      if (!a.events) a.events = [];
      a.events.push({ frame: Math.max(0, Math.floor(frame)), name });
      a.events.sort((x, y) => x.frame - y.frame);
    });
  },

  removeEvent(index: number): void {
    AnimClipDocument.edit('Remove Event', (a) => {
      if (a.events && index >= 0 && index < a.events.length) a.events.splice(index, 1);
    });
  },

  setEventFrame(index: number, frame: number): void {
    AnimClipDocument.edit('Move Event', (a) => {
      const e = a.events?.[index];
      if (!e) return;
      e.frame = Math.max(0, Math.floor(frame));
      a.events!.sort((x, y) => x.frame - y.frame);
    });
  },

  setEventName(index: number, name: string): void {
    AnimClipDocument.edit('Rename Event', (a) => {
      const e = a.events?.[index];
      if (e && name) e.name = name;
    });
  },

  /** Persist the open flipbook to its file. */
  async save(): Promise<void> {
    const asset = AnimClipDocument.asset;
    const path = AnimClipDocument.filePath;
    if (!asset || !path) return;
    try {
      await window.estella.fs.write(path, JSON.stringify(serializeAnimClip(asset), null, 2) + '\n');
      AnimClipDocument.markSaved();
      Toasts.push(t('fb.toast.saved'), 'info');
    } catch (e) {
      Toasts.push(t('fb.toast.saveFailed', { error: String(e) }), 'error');
    }
  },
};
