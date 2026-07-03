// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Mirror the SDK's type declarations into a project's `.esengine/sdk` so
 *        its tsconfig (`esengine` → ./.esengine/sdk/index.d.ts) resolves in the
 *        IDE the moment the project is opened — before it is ever played. Types
 *        only; the play runtime (js + wasm) is staged separately under
 *        `.esengine/play` by buildPlayRealm.
 */
import { cp, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

/** Copy every `*.d.ts` under `sdkDistDir` into `<root>/.esengine/sdk`, preserving
 *  the directory layout so index.d.ts's chunk imports (shared/, physics/, spine/)
 *  resolve. Overwrites, so a newer SDK refreshes the mirror on the next open. */
export async function syncSdkTypes(root: string, sdkDistDir: string): Promise<void> {
  if (!existsSync(sdkDistDir)) return;
  await copyDeclarations(sdkDistDir, path.join(root, '.esengine', 'sdk'));
}

async function copyDeclarations(src: string, dst: string): Promise<void> {
  let made = false;
  for (const entry of await readdir(src, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      await copyDeclarations(path.join(src, entry.name), path.join(dst, entry.name));
    } else if (entry.name.endsWith('.d.ts')) {
      if (!made) { await mkdir(dst, { recursive: true }); made = true; }
      await cp(path.join(src, entry.name), path.join(dst, entry.name));
    }
  }
}
