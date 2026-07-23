// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    keyframeInspectorModel.ts
 * @brief   The Sequencer's selected keyframe (value + interpolation) as shared-
 *          inspector components, pushed through the generic inspection-source
 *          channel as an OVERRIDE — so clicking a keyframe shows its properties
 *          in the one Details panel, replacing the bespoke interp popover. Time
 *          is edited by dragging the key in the timeline (not here), so the
 *          selection key stays valid across edits. Writes route through
 *          TimelineCommands (one undo step each).
 */
import { InterpType, type TimelineAsset } from 'esengine';
import type { InspectorComponent, InspectorFieldType, GradientValue, CurveValue, DimensionValue, MapValue } from '@/types';
import { buildTimelineRows, findChannel, type ChannelRef } from './timelineView';
import { TimelineCommands } from './TimelineCommands';
import { TimelineDocument } from './TimelineDocument';
import { t } from '@/i18n';

// InterpType is a STRING enum; the shared `enum` field takes int options, so map
// it to an index (label ← friendly i18n, value ← position) and back on write.
const INTERP_ORDER = [InterpType.Hermite, InterpType.Linear, InterpType.Step, InterpType.EaseInOut];
const INTERP_OPTIONS = [
  { label: t('seq.interp.auto'), value: 0 },
  { label: t('seq.interp.linear'), value: 1 },
  { label: t('seq.interp.step'), value: 2 },
  { label: t('seq.interp.easeInOut'), value: 3 },
];

/** Resolve `${rowId}@${time}` to its channel ref + live keyframe (or null). */
function resolve(asset: TimelineAsset, selectedKey: string): { ref: ChannelRef; time: number; value: number; interp: InterpType } | null {
  const at = selectedKey.lastIndexOf('@');
  if (at < 0) return null;
  const rowId = selectedKey.slice(0, at);
  const time = parseFloat(selectedKey.slice(at + 1));
  const row = buildTimelineRows(asset).find((r) => r.id === rowId);
  if (!row?.ref) return null;
  const kf = findChannel(asset, row.ref)?.keyframes.find((k) => Math.abs(k.time - time) < 1e-4);
  if (!kf) return null;
  return { ref: row.ref, time: kf.time, value: kf.value, interp: kf.interpolation ?? InterpType.Hermite };
}

/** True when `selectedKey` addresses a live keyframe in `asset`. */
export function keyframeExists(asset: TimelineAsset | null, selectedKey: string | null): boolean {
  return !!asset && !!selectedKey && resolve(asset, selectedKey) != null;
}

export function buildKeyframeComponents(asset: TimelineAsset, selectedKey: string): InspectorComponent[] {
  const r = resolve(asset, selectedKey);
  if (!r) return [];
  return [
    {
      name: 'Keyframe',
      label: t('seq.insp.keyframe'),
      fields: [
        { key: 'value', label: t('seq.field.value'), type: 'number', value: r.value, step: 0.1 },
        { key: 'interpolation', label: t('seq.field.interp'), type: 'enum', value: Math.max(0, INTERP_ORDER.findIndex((x) => x === r.interp)), options: INTERP_OPTIONS },
      ],
    },
  ];
}

export function makeKeyframeWrite(selectedKey: string) {
  return (key: string, _type: InspectorFieldType, value: number | boolean | string | number[] | GradientValue | CurveValue | DimensionValue | MapValue): void => {
    const asset = TimelineDocument.asset;
    if (!asset) return;
    const r = resolve(asset, selectedKey);
    if (!r) return;
    switch (key) {
      case 'value':
        TimelineCommands.setKeyValue(r.ref, r.time, value as number);
        break;
      case 'interpolation':
        TimelineCommands.setKeyInterp(r.ref, r.time, INTERP_ORDER[value as number] ?? InterpType.Hermite);
        break;
    }
  };
}
