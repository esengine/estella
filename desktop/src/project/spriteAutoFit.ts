// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  spriteAutoFit.ts — a sprite handed a texture takes that texture's size.
 *
 * `Sprite.size` is world units, deliberately independent of the image, and its
 * authoring default is 100×100 so a textureless sprite is a visible placeholder.
 * That default then outlived its purpose: assigning a 64×48 image left the quad at
 * 100×100 with the art stretched, and nothing on screen said why. Only dragging an
 * image into the viewport was right, because that path alone knew the pixel size.
 *
 * So the size follows the texture at the ONE place a texture is assigned — an edit
 * hook, rather than every caller remembering — and only while the size is still one
 * this rule chose: the untouched default, or the fit to the texture being replaced.
 * An authored size is never overwritten.
 */
import { SceneCommands } from '@/engine/SceneCommands';
import { SceneQuery } from '@/engine/SceneQuery';
import { defaultDataFor } from '@/engine/schema';
import { AssetRegistry } from '@/project/AssetRegistry';
import { imageSize, peekImageSize, type ImageSize } from '@/project/imageSize';

type Vec2 = [number, number];

const vecEq = (a: Vec2 | null, b: Vec2 | null): boolean =>
  !!a && !!b && Math.abs(a[0] - b[0]) < 0.001 && Math.abs(a[1] - b[1]) < 0.001;

const vecOf = (v: unknown): Vec2 | null => (Array.isArray(v) && v.length >= 2 ? [Number(v[0]), Number(v[1])] : null);

const field = (sourceId: number, key: string): unknown => SceneQuery.getFieldValue(sourceId, 'Sprite', key);

/** The image path behind a texture ref (`@uuid:` or a project-relative path), or null. */
const texturePath = (ref: unknown): string | null => AssetRegistry.assetInfo(ref)?.path ?? null;

/**
 * The size a sprite takes from a texture. The drawn region is the texture's pixels
 * through `uvScale`, so a sprite already showing an atlas sub-rect fits that frame
 * rather than the whole sheet.
 */
function fitSize(sourceId: number, natural: ImageSize): Vec2 {
  const uv = vecOf(field(sourceId, 'uvScale')) ?? [1, 1];
  return [Math.round(natural.x * Math.abs(uv[0])), Math.round(natural.y * Math.abs(uv[1]))];
}

/** Whether the current size is one this rule owns: the authoring default, or the fit
 *  to the texture being replaced. Anything else is the creator's number. */
function mayRefit(sourceId: number, previousRef: unknown): boolean {
  const size = vecOf(field(sourceId, 'size'));
  if (!size) return false;
  const dflt = defaultDataFor('Sprite').size as { x: number; y: number } | undefined;
  if (dflt && vecEq(size, [dflt.x, dflt.y])) return true;
  const prev = texturePath(previousRef);
  const prevNatural = prev ? peekImageSize(prev) : null;
  return !!prevNatural && vecEq(size, fitSize(sourceId, prevNatural));
}

/** Its own undo step, named for what it did. The fit necessarily lands after the
 *  texture write it reacts to, so it cannot join that step — which leaves undo saying
 *  "Fit Sprite To Texture" once and "Edit Texture" again, and lets a creator who wants
 *  the texture at the size they had keep it by undoing only the fit. */
function refit(sourceId: number, natural: ImageSize): void {
  const size = fitSize(sourceId, natural);
  if (vecEq(vecOf(field(sourceId, 'size')), size)) return;
  SceneCommands.transact('Fit Sprite To Texture', () => {
    SceneCommands.setField(sourceId, 'Sprite', 'size', 'vec2', size);
  });
}

/** Wire the texture-assigned → size-follows glue (call once at editor boot). */
export function initSpriteAutoFit(): void {
  SceneCommands.addEditHook((sourceId, compName, key, _type, value) => {
    if (compName !== 'Sprite' || key !== 'texture') return false;
    const path = texturePath(value);
    // Both questions are asked BEFORE the write lands: afterwards there is no
    // previous texture left to ask whether the size was fitted to it.
    if (path && mayRefit(sourceId, field(sourceId, 'texture'))) {
      // The hook runs BEFORE the write, so the fit is deferred past it — otherwise
      // `uvScale` and the texture it reads would still describe the old assignment.
      const known = peekImageSize(path);
      if (known) queueMicrotask(() => refit(sourceId, known));
      else void imageSize(path).then((natural) => refit(sourceId, natural));
    }
    return false; // observe-only
  });
}
