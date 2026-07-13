// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    FlipbookViewportPreview.ts
 * @brief   Edit-mode viewport preview of the selected entity's sprite flipbook —
 *          the clip→World projection mirroring TimelinePreview (sample, write,
 *          base-pose capture/restore), for SpriteAnimator.
 *
 * When the selection carries a SpriteAnimator whose .esanim resolves, a rAF
 * clock samples the frame sequence and writes the frame's UV window onto the
 * Sprite — so the flipbook loops in the viewport without entering Play. If the
 * clip is open in the Flipbook editor, the document's live asset is sampled
 * instead of the file, so frame edits animate as you make them.
 *
 * Only sheet-cell frames preview (writing uvOffset/uvScale on the existing
 * sheet texture); legacy per-texture clips would need live handle resolution
 * and keep their panel-only preview. Restores the captured Sprite on deselect,
 * play-mode entry, or the Preview FX flag going off. The scene saves from the
 * MODEL, never the World, so these transient writes cannot leak into the file.
 */

import {
  getComponent, parseAnimClipAsset, animClipCellUv,
  type AnimClipAssetData, type AnimClipFrameData,
} from 'esengine';
import { AnimClipDocument } from '@/flipbook/AnimClipDocument';
import { useSelection } from '@/store/selectionStore';
import { useEditorStore } from '@/store/editorStore';
import { ProjectStore } from '@/project/ProjectStore';
import { EngineHost } from './EngineHost';
import { SceneModel } from './SceneModel';

const clone = <T>(v: T): T =>
  typeof structuredClone === 'function' ? structuredClone(v) : (JSON.parse(JSON.stringify(v)) as T);

/** The frame under a running clock, honoring per-frame durations and loop. */
export function flipbookFrameAt(asset: AnimClipAssetData, t: number): AnimClipFrameData | null {
  const frames = asset.frames;
  if (frames.length === 0) return null;
  const fps = asset.fps ?? 12;
  const dur = (f: AnimClipFrameData) => (f.duration !== undefined && f.duration > 0 ? f.duration : 1 / fps);
  let total = 0;
  for (const f of frames) total += dur(f);
  if (total <= 0) return frames[0];
  let tt = (asset.loop ?? true) ? t % total : Math.min(t, total);
  for (const f of frames) {
    tt -= dur(f);
    if (tt < 0) return f;
  }
  return frames[frames.length - 1];
}

interface Binding {
  entity: number;
  clipPath: string;
}

export class FlipbookViewportPreviewImpl {
  private attached = false;
  private bound: Binding | null = null;
  private asset: AnimClipAssetData | null = null;
  private baseSprite: unknown = null;
  private clock = 0;
  private lastTs: number | null = null;
  private raf = 0;
  private loadSeq = 0;

  /** Begin reacting to selection / play mode / the open flipbook document. Idempotent. */
  attach(): void {
    if (this.attached) return;
    this.attached = true;
    useSelection.subscribe(() => this.sync());
    useEditorStore.subscribe(() => this.sync());
    AnimClipDocument.subscribe(() => this.onDocumentChange());
    this.sync();
  }

  /** The (entity, clip) the preview should be driving right now, or null. */
  private desiredBinding(): Binding | null {
    const st = useEditorStore.getState();
    if (st.isPlaying || !st.previewFx) return null;
    const sourceId = useSelection.getState().selectedId;
    if (sourceId == null) return null;
    const world = EngineHost.mutableWorld();
    if (!world) return null;
    const rt = SceneModel.runtimeFor(sourceId);
    if (rt == null || !world.valid(rt)) return null;
    const SpriteAnimator = getComponent('SpriteAnimator');
    const Sprite = getComponent('Sprite');
    if (!SpriteAnimator || !Sprite) return null;
    if (!world.has(rt, SpriteAnimator) || !world.has(rt, Sprite)) return null;
    const clip = (world.get(rt, SpriteAnimator) as { clip?: string } | undefined)?.clip;
    if (!clip) return null;
    const path = ProjectStore.assetInfo(clip)?.path;
    return path ? { entity: rt as number, clipPath: path } : null;
  }

  private sync(): void {
    const want = this.desiredBinding();
    if (want?.entity === this.bound?.entity && want?.clipPath === this.bound?.clipPath) return;
    this.unbind();
    if (!want) return;
    this.bound = want;
    this.captureBase();
    void this.loadAsset(want.clipPath);
  }

  /** Live-follow the Flipbook editor when it has this very clip open. */
  private onDocumentChange(): void {
    if (!this.bound) return;
    if (AnimClipDocument.isOpen && AnimClipDocument.filePath === this.bound.clipPath) {
      this.asset = AnimClipDocument.asset;
      this.clock = 0;
    }
  }

  private async loadAsset(path: string): Promise<void> {
    if (AnimClipDocument.isOpen && AnimClipDocument.filePath === path) {
      this.asset = AnimClipDocument.asset;
    } else {
      const seq = ++this.loadSeq;
      try {
        const parsed = parseAnimClipAsset(JSON.parse(await window.estella.fs.read(path)));
        if (seq !== this.loadSeq || this.bound?.clipPath !== path) return;
        this.asset = parsed;
      } catch {
        return; // unreadable clip: no preview
      }
    }
    this.clock = 0;
    this.lastTs = null;
    this.startLoop();
  }

  private captureBase(): void {
    const world = EngineHost.mutableWorld();
    const Sprite = getComponent('Sprite');
    if (!world || !Sprite || !this.bound) return;
    this.baseSprite = clone(world.get(this.bound.entity, Sprite));
  }

  private unbind(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    const world = EngineHost.mutableWorld();
    const Sprite = getComponent('Sprite');
    if (world && Sprite && this.bound && this.baseSprite != null
      && world.valid(this.bound.entity) && world.has(this.bound.entity, Sprite)) {
      world.set(this.bound.entity, Sprite, clone(this.baseSprite));
    }
    this.bound = null;
    this.asset = null;
    this.baseSprite = null;
  }

  private startLoop(): void {
    cancelAnimationFrame(this.raf);
    const tick = (ts: number) => {
      if (!this.bound || !this.asset) return;
      if (this.lastTs != null) this.clock += (ts - this.lastTs) / 1000;
      this.lastTs = ts;
      this.applyFrame();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private applyFrame(): void {
    const world = EngineHost.mutableWorld();
    const Sprite = getComponent('Sprite');
    if (!world || !Sprite || !this.bound || !this.asset) return;
    const sheet = this.asset.sheet;
    const frame = flipbookFrameAt(this.asset, this.clock);
    if (!sheet || !frame || frame.cell === undefined) return;
    if (!world.valid(this.bound.entity) || !world.has(this.bound.entity, Sprite)) return;
    const uv = animClipCellUv(sheet, frame.cell);
    const sprite = world.get(this.bound.entity, Sprite) as { uvOffset: unknown; uvScale: unknown };
    world.set(this.bound.entity, Sprite, { ...sprite, uvOffset: uv.uvOffset, uvScale: uv.uvScale });
  }
}

/** The app's default-session flipbook viewport preview. */
export const FlipbookViewportPreview = new FlipbookViewportPreviewImpl();
