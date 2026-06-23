// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Asset import (Content Browser C4). Copies external files into the open
 *        project and writes a `.meta` sidecar (fresh uuid + type + importer
 *        defaults) so the AssetDatabase scan indexes them immediately — the scan
 *        only sees files that HAVE a `.meta`.
 *
 *        The ext→type table + importer defaults mirror the canonical CLI
 *        `tools/asset-meta.js`; kept in sync by hand (a stable lookup table, and
 *        keeping this desktop-contained avoids reaching into the root tools/).
 */
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { resolveInRoot, META_EXT } from './projectFs';

const META_VERSION = '2.0';

const EXT_TO_TYPE: Record<string, string> = {
  '.png': 'texture', '.jpg': 'texture', '.jpeg': 'texture', '.webp': 'texture', '.bmp': 'texture',
  '.wav': 'audio', '.mp3': 'audio', '.ogg': 'audio', '.aac': 'audio', '.flac': 'audio', '.m4a': 'audio', '.webm': 'audio',
  '.esprefab': 'prefab', '.esscene': 'scene', '.esshader': 'shader', '.esmaterial': 'material', '.esmat': 'material',
  '.estl': 'timeline', '.esanim': 'animation', '.esanimclip': 'animation',
  '.fnt': 'bitmapFont', '.bmfont': 'bitmapFont', '.ttf': 'font', '.otf': 'font', '.woff': 'font', '.woff2': 'font',
  '.tmx': 'tilemap', '.tmj': 'tilemap',
  '.skel': 'spine', '.atlas': 'spine',
};

/** The supported import extensions (no leading dot) — used by the file dialog filter. */
export const IMPORT_EXTENSIONS = Object.keys(EXT_TO_TYPE).map((e) => e.slice(1));

function importerDefaults(type: string): Record<string, unknown> {
  switch (type) {
    case 'texture':
      return { maxSize: 2048, filterMode: 'linear', wrapMode: 'repeat', premultiplyAlpha: false, sliceBorder: { left: 0, right: 0, top: 0, bottom: 0 } };
    case 'prefab':
    case 'scene':
      return { autoMigrate: true };
    case 'spine':
      return { defaultSkin: 'default', premultiplyAlpha: false, scale: 1 };
    default:
      return {};
  }
}

/** A unique destination name in `absDir`: "hero.png" → "hero 2.png" if taken. */
function uniqueName(absDir: string, name: string): string {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let candidate = name;
  for (let i = 2; existsSync(path.join(absDir, candidate)); i++) candidate = `${stem} ${i}${ext}`;
  return candidate;
}

export interface ImportResult {
  /** New project-relative paths of the imported files. */
  imported: string[];
  /** Base names skipped (unknown / unsupported extension). */
  skipped: string[];
}

/**
 * Copy `sources` (absolute, user-picked) into project-relative `destDir`, writing
 * a `.meta` (fresh uuid + extension-derived type) for each. Existing names are
 * deduped, never clobbered; unknown extensions are skipped.
 */
export async function importAssets(root: string, destDir: string, sources: string[]): Promise<ImportResult> {
  const absDir = resolveInRoot(root, destDir);
  await mkdir(absDir, { recursive: true });
  const imported: string[] = [];
  const skipped: string[] = [];
  for (const src of sources) {
    const type = EXT_TO_TYPE[path.extname(src).toLowerCase()];
    if (!type) {
      skipped.push(path.basename(src));
      continue;
    }
    const name = uniqueName(absDir, path.basename(src));
    const absDest = path.join(absDir, name);
    await copyFile(src, absDest);
    const meta = { uuid: randomUUID(), version: META_VERSION, type, importer: importerDefaults(type) };
    await writeFile(absDest + META_EXT, JSON.stringify(meta, null, 2) + '\n', 'utf8');
    imported.push(destDir ? `${destDir}/${name}` : name);
  }
  return { imported, skipped };
}
