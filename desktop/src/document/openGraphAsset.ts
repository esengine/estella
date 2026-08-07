// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    openGraphAsset.ts
 * @brief   Open / create a graph-shaped asset — the shared door behind
 *          openStateMachine / openAnimatorController / openBehaviorTree.
 * @details A `.esfsm` / `.esanimator` / `.esbt` all IS their runtime definition
 *          (nodes carry x/y layout the interpreter ignores), so there is no
 *          compile step — Save just writes the JSON, Create writes the
 *          definition + .meta. The three differ only by their document, panel,
 *          format factory, extension, and toast strings — a {@link GraphAssetKind}.
 */
import { ProjectStore } from '@/project/ProjectStore';
import { AssetRegistry } from '@/project/AssetRegistry';
import { confirmDiscardDoc } from '@/project/discardGuard';
import { dockApi } from '@/layout/dockApi';
import { baseName } from '@/project/assetMeta';
import { Toasts } from '@/store/Toasts';
import { t, type MsgKey } from '@/i18n';

/** The open/reveal surface of a graph document singleton (see AssetDocument). */
export interface GraphDocument {
  readonly isOpen: boolean;
  readonly filePath: string | null;
  readonly dirty: boolean;
  openJson(raw: unknown, filePath: string | null): void;
}

export interface GraphAssetKind {
  document: GraphDocument;
  /** dockview panel id (also serves as its component type). */
  panelId: string;
  /** i18n key for the panel tab title. */
  titleKey: MsgKey;
  /** File extension without the dot (e.g. `esfsm`). */
  ext: string;
  /** Base name for a freshly created asset (e.g. `NewStateMachine`). */
  defaultName: string;
  /** `.meta` type minted for a created asset. */
  metaType: string;
  /** A blank definition for a newly created asset. */
  emptyDef(): unknown;
  /** Normalize parsed JSON before it enters the document (e.g. assign BT ids). */
  parse?(json: unknown): unknown;
  toast: { openFailed: MsgKey; createFailed: MsgKey; created: MsgKey };
}

/** Open an existing graph asset into its editor and reveal the panel. */
export async function openGraphAsset(kind: GraphAssetKind, path: string): Promise<void> {
  const front = (): void => dockApi.openPanel(kind.panelId);
  // Already-open file: just front the panel — a reload would clobber unsaved edits.
  if (kind.document.isOpen && kind.document.filePath === path) {
    front();
    return;
  }
  if (!(await confirmDiscardDoc(kind.document.dirty, t('discard.openAsset', { name: baseName(path) })))) return;
  try {
    const json: unknown = JSON.parse(await window.estella.fs.read(path));
    kind.document.openJson(kind.parse ? kind.parse(json) : json, path);
    front();
  } catch (e) {
    Toasts.push(t(kind.toast.openFailed, { error: String(e) }), 'error');
  }
}

/** Create a new graph asset (+ .meta) in @p dir, then open it. */
export async function createGraphAsset(kind: GraphAssetKind, dir: string): Promise<void> {
  const folder = dir ? (dir.endsWith('/') ? dir : `${dir}/`) : '';
  let rel = `${folder}${kind.defaultName}.${kind.ext}`;
  for (let n = 1; AssetRegistry.assetRef(rel); n++) rel = `${folder}${kind.defaultName}-${n}.${kind.ext}`;

  try {
    await window.estella.fs.write(rel, JSON.stringify(kind.emptyDef(), null, 2) + '\n');
    await window.estella.fs.write(
      rel + '.meta',
      JSON.stringify({ uuid: crypto.randomUUID(), version: '1.0', type: kind.metaType, importer: { autoMigrate: true } }, null, 2) + '\n',
    );
  } catch (e) {
    Toasts.push(t(kind.toast.createFailed, { error: String(e) }), 'error');
    return;
  }
  await ProjectStore.refreshAssets();
  Toasts.push(t(kind.toast.created, { name: baseName(rel) }), 'info');
  await openGraphAsset(kind, rel);
}
