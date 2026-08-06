// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  assetDocumentOps.ts — reading and writing an OPEN asset document by path.
 *
 * The scene has `apply_scene_ops`; the eight asset editors (animation clips,
 * timelines, tilesets, materials, material graphs, animator/state/behaviour
 * graphs) had nothing an agent could reach. They did not need eight tool sets:
 * they all extend {@link AssetDocument}, whose `edit(label, mutate)` is already
 * the one undoable write door each editor's own UI goes through. What was
 * missing was a way to name a field of the typed asset from outside — a closure
 * does not cross a tool call.
 *
 * So the address is a dotted path, the same shape `set_field` uses for a
 * component ("frames.0.duration"), and one call is one undo step. Nothing here
 * knows what a clip or a tileset IS; it walks whatever the document holds. That
 * is what keeps a ninth editor from needing a ninth tool.
 */
import { AssetDocument } from './AssetDocument';
import { DirtyRegistry } from './DirtyRegistry';

/** One open editor document, as the agent sees it in a listing. */
export interface AssetDocumentInfo {
  docId: string;
  path: string | null;
  dirty: boolean;
}

/** A field write: `"frames.0.duration"` → value. */
export interface AssetDocumentChange {
  path: string;
  value: unknown;
}

export const openAssetDocuments = (): AssetDocumentInfo[] =>
  AssetDocument.openDocuments().map((d) => ({ docId: d.docId, path: d.filePath, dirty: d.dirty }));

/**
 * The document to act on: the named one, or the only one open.
 *
 * Refusing when several are open and none was named is deliberate — picking
 * "the first" would edit whichever editor happened to be constructed first,
 * which is not a thing the caller can predict or see.
 */
function resolve(docId?: string): AssetDocument<unknown> {
  const open = AssetDocument.openDocuments();
  if (open.length === 0) throw new Error('no asset document is open (open_asset first)');
  if (docId) {
    const found = open.find((d) => d.docId === docId);
    if (!found) {
      throw new Error(`no open asset document with docId "${docId}" (open: ${open.map((d) => d.docId).join(', ')})`);
    }
    return found;
  }
  if (open.length > 1) {
    throw new Error(`several asset documents are open — name one with docId: ${open.map((d) => d.docId).join(', ')}`);
  }
  return open[0];
}

/** An open document's typed content, exactly as its editor holds it. */
export function readAssetDocument(docId?: string): { docId: string; path: string | null; asset: unknown } {
  const doc = resolve(docId);
  return { docId: doc.docId, path: doc.filePath, asset: doc.asset };
}

/**
 * Walk a dotted path and write the leaf, creating nothing.
 *
 * Missing segments are an ERROR rather than an autovivified object: the assets
 * here are typed documents with schemas their editors rely on, and inventing
 * `frames.7` on a clip with three frames produces a file that loads as
 * something else. Numeric segments index arrays; everything else is a key.
 */
export function setByPath(root: unknown, path: string, value: unknown): void {
  const parts = path.split('.').filter((p) => p !== '');
  if (parts.length === 0) throw new Error('empty path');

  let at: unknown = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (at === null || typeof at !== 'object') {
      throw new Error(`"${path}": ${parts.slice(0, i).join('.') || '<root>'} is not an object`);
    }
    const next = (at as Record<string, unknown>)[key];
    if (next === undefined) throw new Error(`"${path}": no ${parts.slice(0, i + 1).join('.')}`);
    at = next;
  }

  const last = parts[parts.length - 1];
  if (at === null || typeof at !== 'object') throw new Error(`"${path}": parent is not an object`);
  if (Array.isArray(at)) {
    const index = Number(last);
    if (!Number.isInteger(index) || index < 0 || index >= at.length) {
      throw new Error(`"${path}": index ${last} is outside an array of ${at.length}`);
    }
    at[index] = value;
    return;
  }
  if (!(last in (at as Record<string, unknown>))) {
    throw new Error(`"${path}": no such field (present: ${Object.keys(at as object).join(', ')})`);
  }
  (at as Record<string, unknown>)[last] = value;
}

/**
 * Apply `changes` to an open document as ONE undo step.
 *
 * Through the document's own `edit`, so the panel re-renders and the undo entry
 * is indistinguishable from one the editor's UI made — there is no second way to
 * write these files.
 */
export function editAssetDocument(
  changes: readonly AssetDocumentChange[],
  docId?: string,
  label = 'Edit asset',
): { docId: string; applied: number } {
  if (!Array.isArray(changes) || changes.length === 0) throw new Error('`changes` must be a non-empty array');
  const doc = resolve(docId);
  if (!doc.asset) throw new Error(`asset document "${doc.docId}" holds nothing`);

  doc.edit(label, (draft) => {
    changes.forEach((change, i) => {
      if (!change || typeof change.path !== 'string') throw new Error(`changes[${i}] needs a "path"`);
      setByPath(draft, change.path, change.value);
    });
  });
  return { docId: doc.docId, applied: changes.length };
}

/**
 * Persist an open asset document — the save its own panel performs.
 *
 * Not a JSON write of what {@link readAssetDocument} returns: a tileset and a
 * timeline have their own serializers, and a material graph COMPILES a sibling
 * `.esshader` that every material on it reads. Writing the file directly would
 * leave that shader stale — an edit that saves, reloads, and still renders the
 * old thing. So the one save per document lives in `dirtyDocs.ts` and this only
 * says WHICH.
 *
 * Until this existed the only save a driver could reach was `project.save` via
 * run_editor_command, which is context-aware: it saves the ACTIVE dock panel's
 * document and otherwise the scene. Driving it from outside meant an edit landed
 * in the scene file, or nowhere, depending on which tab the user last clicked.
 */
export async function saveAssetDocument(
  docId?: string,
): Promise<{ docId: string; path: string; saved: boolean }> {
  const doc = resolve(docId);
  if (!doc.filePath) {
    throw new Error(
      `asset document "${doc.docId}" has no file path — it has never been saved, and naming a new one `
      + 'is a Save As dialog that nothing here can answer',
    );
  }
  // A document nobody registered would report "did not save" for the same
  // reason a clean one does. That is an editor bug, not an answer.
  if (!DirtyRegistry.knows(doc.docId)) {
    throw new Error(`asset document "${doc.docId}" registered no save with the editor — this is a bug`);
  }
  // false = it was already clean, which is not a failure: the caller asked for
  // the file to match the document, and it does.
  const saved = await DirtyRegistry.saveDoc(doc.docId);
  return { docId: doc.docId, path: doc.filePath, saved };
}
