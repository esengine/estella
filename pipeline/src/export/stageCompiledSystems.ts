// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { existsSync } from 'node:fs';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import type { AotModuleConfig } from 'esengine';
import { AOT_SHARED_WASM, AOT_WASM, nativeAotModule } from '../bundle/aotArtifacts';
import type { BuildCompiledResult } from '../bundle/buildCompiledSystems';
import { resolveInside } from '../fs/pathSandbox';

const ownedModules = [AOT_WASM, AOT_SHARED_WASM, ...['win32', 'darwin', 'linux'].map(nativeAotModule)];

/** Stage the modules named by the package config and remove obsolete engine modules from a previous export. */
export async function stageCompiledSystems(output: string, built?: BuildCompiledResult): Promise<AotModuleConfig | undefined> {
  const dir = path.join(output, 'aot');
  const files = new Map<string, string>();
  let config: AotModuleConfig | undefined;
  if (built?.modulePath && built.manifest) {
    const main = path.basename(built.modulePath);
    files.set(main, built.modulePath);
    config = { module: `aot/${main}`, manifest: built.manifest };
    const shared = built.modules?.[AOT_SHARED_WASM];
    if (shared) {
      files.set(AOT_SHARED_WASM, shared);
      config.sharedModule = `aot/${AOT_SHARED_WASM}`;
    }
    await mkdir(resolveInside(output, 'aot', 'build output'), { recursive: true });
    for (const [name, source] of files) {
      await copyFile(source, resolveInside(output, `aot/${name}`, 'build output'));
    }
  } else if (!existsSync(dir)) return undefined;

  for (const name of ownedModules) {
    if (!files.has(name)) {
      await rm(resolveInside(output, `aot/${name}`, 'build output'), { force: true });
    }
  }
  return config;
}
