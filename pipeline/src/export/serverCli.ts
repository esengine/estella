// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  serverCli.ts — the CLI's side of `export --platform server`: read the project, export its server.
 *        The web export that goes into `web/` is the ordinary one, run by the CLI as itself.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadEsbuild } from '../bundle/esbuildRuntime';
import { parseManifest, PROJECT_MANIFEST_FILE } from '../project/format';
import { projectServerProblem, serverUrlOf } from '../project/serverConfig';
import { exportServer, type ServerExportResult } from './exportServer';

export async function serverExportCommand(opts: {
  projectDir: string; outDir: string; sdkDistDir: string; serverUrl?: string; wasmDir?: string; nodePaths: string[]; minify: boolean; web: boolean;
}): Promise<ServerExportResult> {
  const text = readFileSync(path.join(opts.projectDir, PROJECT_MANIFEST_FILE), 'utf8');
  const raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as Record<string, unknown>;
  const manifest = parseManifest(raw);
  if (!manifest.server) throw new Error(projectServerProblem(raw.server));
  const server = opts.serverUrl ? { ...manifest.server, url: serverUrlOf(opts.serverUrl) } : manifest.server;
  return exportServer({
    projectDir: opts.projectDir, name: manifest.name, server, outDir: opts.outDir,
    sdkDistDir: opts.sdkDistDir, wasmDir: opts.wasmDir, nodePaths: opts.nodePaths, minify: opts.minify, web: opts.web,
  }, await loadEsbuild());
}
