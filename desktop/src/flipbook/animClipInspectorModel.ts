// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    animClipInspectorModel.ts
 * @brief   The open .esanim flipbook as shared-inspector components — an Animation
 *          section (fps / loop) and, for sheet clips, a Sheet section (grid). Same
 *          `InspectorComponent[]` + `FieldWrite` contract the entity and material
 *          inspectors use, so the one ComponentSection engine renders it; edits
 *          route through AnimClipCommands (one undo step each). The point is one
 *          inspector, no bespoke property panel.
 */
import { animClipDrivesPivot, DEFAULT_ANIM_CLIP_PIVOT, type AnimClipAssetData } from 'esengine';
import type { InspectorComponent, InspectorFieldType, GradientValue, CurveValue, DimensionValue, MapValue } from '@/types';
import { AnimClipCommands } from './AnimClipCommands';
import { t } from '@/i18n';

const DEFAULT_FPS = 12;

export function buildAnimClipComponents(asset: AnimClipAssetData): InspectorComponent[] {
  const out: InspectorComponent[] = [
    {
      name: 'Animation',
      label: t('fb.insp.animation'),
      fields: [
        { key: 'fps', label: t('fb.field.fps'), type: 'number', value: asset.fps ?? DEFAULT_FPS, min: 1, max: 240, step: 1, defaultValue: DEFAULT_FPS },
        {
          key: 'loop',
          label: t('fb.field.loopMode'),
          type: 'enum',
          value: (asset.loop ?? true) ? 1 : 0,
          options: [
            { label: t('fb.loopMode.once'), value: 0 },
            { label: t('fb.loopMode.loop'), value: 1 },
          ],
          defaultValue: 1,
        },
      ],
    },
  ];
  // Only once the clip drives anchors — the Flipbook editor's Anchor toggle owns
  // that switch, so the inspector never conjures pivot data into a clip.
  if (animClipDrivesPivot(asset)) {
    const p = asset.pivot ?? DEFAULT_ANIM_CLIP_PIVOT;
    out[0].fields.push({
      key: 'pivot',
      label: t('fb.field.pivot'),
      type: 'vec2',
      value: [p.x, p.y],
      defaultValue: [DEFAULT_ANIM_CLIP_PIVOT.x, DEFAULT_ANIM_CLIP_PIVOT.y],
      tooltip: t('fb.field.pivotTip'),
    });
  }
  const s = asset.sheet;
  if (s) {
    out.push({
      name: 'Sheet',
      label: t('fb.insp.sheet'),
      fields: [
        { key: 'cellWidth', label: t('fb.field.cellW'), type: 'number', value: s.cellWidth, min: 1, step: 1 },
        { key: 'cellHeight', label: t('fb.field.cellH'), type: 'number', value: s.cellHeight, min: 1, step: 1 },
        { key: 'margin', label: t('fb.field.margin'), type: 'number', value: s.margin, min: 0, step: 1 },
        { key: 'spacing', label: t('fb.field.spacing'), type: 'number', value: s.spacing, min: 0, step: 1 },
      ],
    });
  }
  return out;
}

/** A FieldWrite routing inspector edits to the open AnimClipDocument via AnimClipCommands. */
export function makeAnimClipWrite() {
  return (key: string, _type: InspectorFieldType, value: number | boolean | string | number[] | GradientValue | CurveValue | DimensionValue | MapValue): void => {
    switch (key) {
      case 'fps':
        AnimClipCommands.setFps(value as number);
        break;
      case 'loop':
        AnimClipCommands.setLoop(value === 1 || value === true);
        break;
      case 'pivot': {
        const v = value as number[];
        AnimClipCommands.setClipPivot({ x: v[0], y: v[1] });
        break;
      }
      case 'cellWidth':
      case 'cellHeight':
      case 'margin':
      case 'spacing':
        AnimClipCommands.setGrid({ [key]: value as number });
        break;
    }
  };
}
