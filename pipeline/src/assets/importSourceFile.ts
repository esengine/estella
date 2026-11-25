// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import path from 'node:path';
import { isInsideRoot } from '../fs/pathSandbox';
import { importModelFile, type ImportModelOptions, type ModelImportSettings } from './importModelFile';
import { importEnvironmentFile, type HostImageDecoder } from './importEnvironmentFile';
import type { EnvironmentImportOptions } from './environmentImport';
import { importAsepriteFile, importPsdFile } from './importSpriteFile';
import { sourceTypeFor, type SourceImportResult, type SourceType } from './sourceImportTypes';
import type { SourceFileLocation } from './sourceProducts';

export { sourceTypeFor };

export interface SourceImportOptions extends SourceFileLocation {
  originDir?: string;
  model?: Partial<ModelImportSettings>;
  environment?: EnvironmentImportOptions;
  decodeExtra?: HostImageDecoder;
  onProduct?: ImportModelOptions['onProduct'];
}

/** A standalone output is its own asset root. Within a project, references start at the project root. */
export function sourceImportLocation(absSource: string, dir: string, project?: string | null): SourceFileLocation {
  const root = project && isInsideRoot(project, dir) ? project : dir;
  return { root, projectRoot: project ?? path.dirname(absSource), absSource, destDir: path.relative(root, dir).split(path.sep).join('/') };
}

const converters: Record<SourceType, (options: SourceImportOptions) => Promise<SourceImportResult>> = {
  async model(options) {
    const { products, warnings } = await importModelFile({ ...options, settings: options.model });
    return { products, warnings };
  },
  panorama: options => importEnvironmentFile(options, options.environment, options.decodeExtra),
  layered: importPsdFile,
  animated: importAsepriteFile,
};

export async function importSourceFile(options: SourceImportOptions): Promise<SourceImportResult | null> {
  const type = sourceTypeFor(options.absSource);
  return type ? converters[type](options) : null;
}
