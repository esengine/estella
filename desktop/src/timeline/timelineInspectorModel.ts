// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    timelineInspectorModel.ts
 * @brief   The open .estimeline's clip-level settings (duration / fps / wrap
 *          mode) as shared-inspector components, pushed through the generic
 *          inspection-source channel so they render in the one Details panel —
 *          no bespoke Sequencer property panel. `duration`/`wrapMode` are asset
 *          state (undoable via TimelineCommands); `fps` is editor display
 *          metadata on the document. Same contract as the entity/material/clip
 *          inspectors: one ComponentSection engine renders it.
 */
import type { TimelineAsset } from 'esengine';
import { WrapMode } from 'esengine';
import type { InspectorComponent, InspectorFieldType, GradientValue, CurveValue, DimensionValue, MapValue } from '@/types';
import { TimelineCommands } from './TimelineCommands';
import { TimelineDocument } from './TimelineDocument';
import { t } from '@/i18n';

export function buildTimelineComponents(asset: TimelineAsset, fps: number): InspectorComponent[] {
  return [
    {
      name: 'Timeline',
      label: t('seq.insp.timeline'),
      fields: [
        { key: 'duration', label: t('seq.field.duration'), type: 'number', value: asset.duration, min: 0, step: 0.1, unit: 's' },
        { key: 'fps', label: t('seq.field.fps'), type: 'number', value: fps, min: 1, max: 240, step: 1 },
        {
          key: 'wrapMode',
          label: t('seq.field.wrap'),
          type: 'enum',
          value: asset.wrapMode,
          options: [
            { label: t('seq.wrap.once'), value: WrapMode.Once },
            { label: t('seq.wrap.loop'), value: WrapMode.Loop },
            { label: t('seq.wrap.pingPong'), value: WrapMode.PingPong },
          ],
        },
      ],
    },
  ];
}

/** A FieldWrite routing timeline clip-setting edits to the document/commands. */
export function makeTimelineWrite() {
  return (key: string, _type: InspectorFieldType, value: number | boolean | string | number[] | GradientValue | CurveValue | DimensionValue | MapValue): void => {
    switch (key) {
      case 'duration':
        TimelineCommands.setDuration(value as number);
        break;
      case 'fps':
        TimelineDocument.setFps(value as number);
        break;
      case 'wrapMode':
        TimelineCommands.setWrapMode(value as WrapMode);
        break;
    }
  };
}
