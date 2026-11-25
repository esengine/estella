// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { EXT_TO_TYPE, metaTypeForExt } from '../../../tools/assetMetaTable.js';
import type { EnvironmentImportReport } from './environmentImport';

export interface SourceProducts {
  /** Project-relative paths, in the order they were produced. */
  products: string[];
  /** Other project paths modified by this import, such as a clip detached from its source. */
  additionalChanges?: string[];
  warnings: string[];
}

export interface SourceImportResult extends SourceProducts {
  report?: EnvironmentImportReport;
}

/** The same registrations serve the Content Browser, file watcher and headless import. */
const declarations = [
  { type: 'model', id: 'core:model' },
  { type: 'panorama', id: 'core:panorama' },
  { type: 'layered', id: 'core:psd' },
  { type: 'animated', id: 'core:aseprite' },
] as const;

export type SourceType = typeof declarations[number]['type'];

export function sourceExtensions(type: SourceType): string[] {
  return Object.entries(EXT_TO_TYPE).filter(([, assetType]) => assetType === type).map(([ext]) => ext);
}

export const sourceImporters = declarations.map(declaration => ({
  ...declaration,
  extensions: sourceExtensions(declaration.type).map(ext => ext.slice(1)),
}));

export function sourceTypeFor(file: string): SourceType | undefined {
  const type = metaTypeForExt(file);
  return sourceImporters.find(importer => importer.type === type)?.type;
}
