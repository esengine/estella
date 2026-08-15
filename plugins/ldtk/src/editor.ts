// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import { definePlugin, type PluginContext } from '@estella/editor-api';
import { tiledFromLdtk, type LdtkProject } from './convert';

export default definePlugin({
  activate(ctx: PluginContext) {
    ctx.assets.registerType({
      id: 'level',
      extensions: ['ldtk'],
      badge: 'LDTK',
      tint: 'var(--info-warm)',
    });

    ctx.assets.registerImporter({
      id: 'levels',
      extensions: ['ldtk'],
      async import(path) {
        const project = JSON.parse(await ctx.fs.readProject(path)) as LdtkProject;
        const files = tiledFromLdtk(project, path);
        for (const file of files) await ctx.fs.writeProject(file.path, file.text);
        ctx.log.info(`${path} → ${files.length} map(s)`);
      },
    });

    ctx.agentTools.register({
      name: 'estella_ldtk_import',
      description: 'Convert an LDtk project (.ldtk) into Tiled maps the engine loads. '
        + 'Use after adding or editing a .ldtk file; the maps land in a folder named after it.',
      schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      effect: 'journaled',
      run: async (input) => {
        const { path } = input as { path: string };
        await ctx.assets.reimport(path);
        return { imported: path };
      },
    });
  },
});
