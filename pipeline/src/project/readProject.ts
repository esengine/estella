// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Opening a project: the manifest, and the workspace beside it.
 *
 * The first thing any build does, and the first thing the editor does. One
 * reader, so a headless build and an open window agree on what the project says.
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  PROJECT_MANIFEST_FILE,
  WORKSPACE_DIR,
  WORKSPACE_FILE,
  parseManifest,
  ignoredManifestKeys,
  type ProjectManifest,
  type OpenedProject,
  type WorkspaceState,
} from './format';

/**
 * Read a project file as text, without the byte-order mark. A BOM is an encoding
 * hint that `JSON.parse` treats as a syntax error, and any Windows tool can
 * leave one. Stripped at this door rather than at each parse — the parses are
 * many and the door is one.
 */
export async function readTextInRoot(abs: string): Promise<string> {
  const text = await readFile(abs, 'utf8');
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

async function readManifestJson(root: string): Promise<unknown> {
  const manifestPath = path.join(root, PROJECT_MANIFEST_FILE);
  if (!existsSync(manifestPath)) {
    throw new Error(`not an Estella project (missing ${PROJECT_MANIFEST_FILE}): ${root}`);
  }
  return JSON.parse(await readTextInRoot(manifestPath));
}

/** Require + parse a project's `project.esproject` manifest (no workspace load). */
export async function readManifest(root: string): Promise<ProjectManifest> {
  return parseManifest(await readManifestJson(root));
}

/** Open a project: require + parse `project.esproject`, load workspace if present. */
export async function openProject(root: string): Promise<OpenedProject> {
  const raw = await readManifestJson(root);
  const manifest = parseManifest(raw);
  const ignoredKeys = ignoredManifestKeys(raw);

  let workspace: WorkspaceState = {};
  const wsPath = path.join(root, WORKSPACE_DIR, WORKSPACE_FILE);
  if (existsSync(wsPath)) {
    try {
      workspace = JSON.parse(await readTextInRoot(wsPath)) as WorkspaceState;
    } catch {
      // A corrupt workspace file is non-fatal — start clean.
    }
  }
  return { root, manifest, workspace, ...(ignoredKeys.length > 0 ? { ignoredKeys } : {}) };
}
