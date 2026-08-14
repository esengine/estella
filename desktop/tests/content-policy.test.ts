// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The single authority on what counts as project content, and the separate
 *        question of what the watcher reports. These came apart when editor plugins
 *        landed: plugin sources live under `.esengine/` (so they are NOT content —
 *        they must stay out of the Content Browser and the asset scan) but they DO
 *        need watching, because they drive plugin hot reload.
 *
 *        The loop hazard is what makes this worth pinning: the editor writes its own
 *        caches and the generated plugin typings under `.esengine/`, and reporting
 *        those would make the editor retrigger itself forever.
 */
import { describe, it, expect } from 'vitest';
import { isContentDir, isContentFile, isNonContentPath, isPluginSourcePath, isWatchedPath } from '../../pipeline/src/assets/contentPolicy';

describe('content classification', () => {
  it('excludes dot entries, dependency and build dirs', () => {
    expect(isContentDir('assets')).toBe(true);
    expect(isContentDir('.esengine')).toBe(false);
    expect(isContentDir('node_modules')).toBe(false);
    expect(isContentDir('dist')).toBe(false);
    expect(isContentFile('hero.png')).toBe(true);
    expect(isContentFile('hero.png.meta')).toBe(false);
    expect(isContentFile('.DS_Store')).toBe(false);
  });

  it("excludes an export's output, whichever platform wrote it", () => {
    // A build's output is made OF content, so every file in it looks like one.
    // Adopted, the registry treats a finished build as authored assets and the
    // next build ships the previous one's manifest inside itself.
    for (const dir of ['dist-web', 'dist-android', 'dist-wechat', 'dist-playable', 'dist-native']) {
      expect(isContentDir(dir)).toBe(false);
      expect(isNonContentPath(`${dir}/assets/hero.png`)).toBe(true);
    }
    // Not a prefix match on "dist": a folder of distortion sprites is content.
    expect(isContentDir('distortion')).toBe(true);
  });

  it('treats any dot or build segment in a path as leaving content space', () => {
    expect(isNonContentPath('assets/hero.png')).toBe(false);
    expect(isNonContentPath('.esengine/cache/assets.json')).toBe(true);
    expect(isNonContentPath('src/node_modules/x.ts')).toBe(true);
    expect(isNonContentPath('assets\\sub\\hero.png')).toBe(false); // windows separators
  });
});

describe('plugin sources are watched but are not content', () => {
  const pluginEntry = '.esengine/plugins/acme.tools/src/editor.ts';

  it('recognizes a plugin source path', () => {
    expect(isPluginSourcePath(pluginEntry)).toBe(true);
    expect(isPluginSourcePath('.esengine/plugins/acme.tools/plugin.json')).toBe(true);
    expect(isPluginSourcePath('.esengine/plugins')).toBe(false); // the dir itself
    expect(isPluginSourcePath('.esengine/cache/assets.json')).toBe(false);
    expect(isPluginSourcePath('assets/hero.png')).toBe(false);
  });

  it('keeps plugin sources OUT of content space', () => {
    // If this flipped, plugin sources would show up in the Content Browser and be
    // scanned as assets.
    expect(isNonContentPath(pluginEntry)).toBe(true);
  });

  it('reports plugin sources to the watcher anyway', () => {
    expect(isWatchedPath(pluginEntry)).toBe(true);
    expect(isWatchedPath('assets/hero.png')).toBe(true);
  });

  it('never watches the editor`s own writes under .esengine', () => {
    // Each of these is written BY the editor; watching one would loop.
    expect(isWatchedPath('.esengine/cache/assets.json')).toBe(false);
    expect(isWatchedPath('.esengine/cache/scripts.mjs')).toBe(false);
    expect(isWatchedPath('.esengine/workspace.json')).toBe(false);
    // The generated plugin typings sit INSIDE the plugin dir, so they need the
    // dot-prefix rule specifically — the plugin-source allowance would otherwise
    // let the editor's own write retrigger a plugin reload.
    expect(isWatchedPath('.esengine/plugins/.types/editor-api.d.ts')).toBe(false);
    expect(isPluginSourcePath('.esengine/plugins/.types/editor-api.d.ts')).toBe(false);
  });

  it('handles windows separators in plugin paths', () => {
    expect(isPluginSourcePath('.esengine\\plugins\\acme.tools\\src\\editor.ts')).toBe(true);
  });
});
