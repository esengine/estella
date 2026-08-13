// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    newAssetDocument.ts
 * @brief   What a NEW asset of each type is, in one table — the documents the
 *          "New …" menu writes, as data anyone can ask for.
 *
 * Each entry references the definition that already existed (the SDK's empty
 * graph, the shader template's derived defaults) rather than restating a format.
 * A type with no single blank of its own answers null; a caller then supplies
 * the content itself, which is honest about there being nothing to hand over.
 */
import {
  builtinShaderTemplate, compileMaterialGraph, emptyAnimatorController, emptyBt, emptyFsm,
  extractPrefab, newMaterialGraph,
  type ExtractEntity, type PrefabData, type SceneData,
} from 'esengine';
import { blankInputMap } from './inputMapDoc';
import { newMaterialDocument } from '@/material/shaderCatalog';
import { sourceById } from '@/engine/entitySources';

/** The scene a new `.esscene` is: one camera, nothing else. */
export function blankScene(): SceneData {
  return {
    version: '1.0',
    name: 'Untitled',
    entities: [
      {
        id: 0,
        name: 'Camera',
        parent: null,
        children: [],
        components: [
          { type: 'Transform', data: { position: { x: 0, y: 0, z: 10 } } },
          { type: 'Camera', data: { projectionType: 1, orthoSize: 300, isActive: true, priority: 0 } },
        ],
        visible: true,
      },
    ],
  } as unknown as SceneData;
}

/** The prefab a new `.esprefab` is: the Empty entity source, extracted. */
export async function blankPrefab(name: string): Promise<PrefabData> {
  const built = await sourceById('empty')?.build?.({ parent: null });
  const root = built?.entities[0];
  if (!root) throw new Error('the "Empty" entity source is not registered');
  const entity = { id: 0, name, parent: null, children: [], components: root.components, visible: true };
  return extractPrefab([entity as unknown as ExtractEntity], 0, name);
}

const BLANK_LOCALE = { version: 1, locale: 'en', entries: {} };

/** The clip a new `.estimeline` is: five seconds, looping, no tracks. */
export const BLANK_CLIP = { version: '1.1', type: 'timeline', duration: 5, wrapMode: 'loop', tracks: [] };

export interface NewDocumentOptions {
  /** Names the thing inside the document, where the format carries one. */
  name?: string;
  /** A shader template id, for the two types that are born bound to one. */
  template?: string;
}

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/**
 * The text a new asset of `type` starts as, or null when the type has no blank
 * of its own. `type` is create_asset's vocabulary — the `.meta` type, not the
 * extension.
 */
export async function newAssetDocument(
  type: string,
  opts: NewDocumentOptions = {},
): Promise<string | null> {
  const template = opts.template ?? 'sprite-unlit';
  switch (type) {
    case 'scene': return json(blankScene());
    case 'prefab': return json(await blankPrefab(opts.name ?? 'Prefab'));
    case 'material': {
      const material = newMaterialDocument(template);
      return material ? json(material) : null;
    }
    // Source, not JSON: a shader IS its text, and a stock template is the one
    // a "Convert to Unique Shader" would have handed over.
    case 'shader': return builtinShaderTemplate(template)?.source ?? null;
    case 'materialgraph': {
      const graph = newMaterialGraph();
      if (opts.name) graph.name = opts.name;
      return json(graph);
    }
    case 'animation': return json(BLANK_CLIP);
    case 'statemachine': return json(emptyFsm());
    case 'behaviortree': return json(emptyBt());
    case 'animator': return json(emptyAnimatorController());
    case 'locale': return json(BLANK_LOCALE);
    case 'inputmap': return json(blankInputMap());
    default: return null;
  }
}

/** The shader a new material graph compiles to, written beside it. */
export const graphShaderSource = (graphJson: string): string =>
  compileMaterialGraph(JSON.parse(graphJson));
