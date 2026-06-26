// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  inspectorClipboard.ts
 * @brief The Details panel's copy/paste buffer — one field value, or a whole
 *        component's values. A plain module holder (not the OS clipboard): the
 *        context menus read it when they open, so no subscription is needed. Paste
 *        is type/component-gated so a copied value only lands somewhere compatible.
 */
import type { InspectorFieldType, InspectorFieldValue } from '@/types';

type ClipEntry =
  | { kind: 'component'; comp: string; data: Record<string, unknown> }
  | { kind: 'field'; comp: string; key: string; type: InspectorFieldType; value: InspectorFieldValue };

let entry: ClipEntry | null = null;

export const InspectorClipboard = {
  copyComponent(comp: string, data: Record<string, unknown>): void {
    entry = { kind: 'component', comp, data: structuredClone(data) };
  },
  copyField(comp: string, key: string, type: InspectorFieldType, value: InspectorFieldValue): void {
    entry = { kind: 'field', comp, key, type, value: structuredClone(value) };
  },
  /** The buffered component data if it matches `comp`, else null (paste gate). */
  componentData(comp: string): Record<string, unknown> | null {
    return entry?.kind === 'component' && entry.comp === comp ? structuredClone(entry.data) : null;
  },
  /** The buffered field value if its type matches `type`, else null (paste gate). */
  fieldValue(type: InspectorFieldType): InspectorFieldValue | null {
    return entry?.kind === 'field' && entry.type === type ? structuredClone(entry.value) : null;
  },
};
