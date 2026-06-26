// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    TimelineDocument.ts
 * @brief   The open .estimeline as a reactive editor document — the first
 *          {@link AssetDocument}.
 *
 * The generic reactive + snapshot-undo core lives in AssetDocument; this adds the
 * timeline-specific state: `fps` (editor display metadata — the asset stores time
 * in seconds, the panel renders a frame ruler) and `rootEntity` (which scene
 * entity the timeline previews against).
 */

import { parseTimelineAsset, type TimelineAsset } from 'esengine';
import { AssetDocument } from '@/document/AssetDocument';
import type { EntityId } from '@/types';

export interface TimelineDocMeta {
  filePath: string | null;
  fps: number;
  dirty: boolean;
}

// The design's default authoring rate (12 fps). Editor-side only — not persisted
// in the asset, which is frame-rate-independent (keyframe times are seconds).
const DEFAULT_FPS = 12;

export interface OpenParams {
  asset: TimelineAsset;
  filePath?: string | null;
  fps?: number;
  rootEntity?: EntityId | null;
}

export class TimelineDocumentImpl extends AssetDocument<TimelineAsset> {
  private _fps = DEFAULT_FPS;
  private _root: EntityId | null = null;

  get meta(): TimelineDocMeta {
    return { filePath: this.filePath, fps: this._fps, dirty: this.dirty };
  }
  get rootEntity(): EntityId | null {
    return this._root;
  }

  /** Open an already-parsed timeline asset, optionally bound to a preview entity. */
  open(params: OpenParams): void {
    this._fps = params.fps ?? DEFAULT_FPS;
    this._root = params.rootEntity ?? null;
    this.openAsset(params.asset, params.filePath ?? null);
  }

  /** Open from raw .estimeline JSON (parsed + migrated by the SDK loader). */
  openJson(raw: unknown, params: Omit<OpenParams, 'asset'> = {}): void {
    this.open({ asset: parseTimelineAsset(raw), ...params });
  }

  /** Rebind which scene entity the timeline previews against (its root). */
  setRootEntity(id: EntityId | null): void {
    this._root = id;
    this.bump();
  }

  /** Set the editor display frame rate (view metadata; not persisted in the asset). */
  setFps(fps: number): void {
    const next = Math.max(1, Math.round(fps));
    if (next === this._fps) return;
    this._fps = next;
    this.bump();
  }

  close(): void {
    this._fps = DEFAULT_FPS;
    this._root = null;
    this.closeAsset();
  }
}

/** The app's default timeline document (the one the Sequencer panel drives). */
export const TimelineDocument = new TimelineDocumentImpl();
