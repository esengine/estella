// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  assetImporter.ts
 * @brief Renders the project's import settings as inspector rows.
 *
 *        What the settings ARE — their keys, defaults and value ranges — is the
 *        project's, and lives in the pipeline so a build with no window reads the
 *        same registry. This side owns only the mapping onto the inspector's
 *        field vocabulary.
 */
import type { InspectorField, InspectorComponent, InspectorFieldValue } from '@/types';
import {
  IMPORTER_SCHEMAS,
  getImporterValueByPath,
  setImporterValueByPath,
} from '../../../pipeline/src/project/importSettings';

/** Build the "Import Settings" component from a type's specs and the asset's
 *  current `importer` block — filling each field's live value (falling back to
 *  the default) and its reset target. */
export function buildImporterComponent(type: string, importer: Record<string, unknown>): InspectorComponent | null {
  const specs = IMPORTER_SCHEMAS[type];
  if (!specs?.length) return null;
  const fields: InspectorField[] = specs.map(({ default: def, ...rest }) => {
    const cur = getImporterValueByPath(importer, rest.key);
    return { ...rest, value: (cur ?? def) as InspectorFieldValue, defaultValue: def };
  });
  return { name: 'Import Settings', label: 'Import Settings', fields };
}

/** Apply one inspector edit to a copy of the `importer` block (dotted keys →
 *  nested), returning the new block. Pure — the caller owns dirty/save. */
export function applyImporterEdit(
  importer: Record<string, unknown>,
  key: string,
  value: InspectorFieldValue,
): Record<string, unknown> {
  const next = structuredClone(importer);
  setImporterValueByPath(next, key, value);
  return next;
}
