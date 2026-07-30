// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Prefab Mode's editing environment (engine/prefabEnvironment.ts).
 *        A UI prefab is opened inside a Canvas host so its fractional boxes have
 *        something to resolve against; these pin the two halves of that deal — the
 *        host goes in above the prefab, and it is gone again by the time the asset is
 *        extracted. The round-trip case is the one that matters: hosting must not
 *        change a single byte of the saved `.esprefab`. Pure data (no World).
 */
import { describe, it, expect } from 'vitest';
import { extractPrefab } from 'esengine';
import type { ExtractEntity } from 'esengine';
import {
  needsUIHost,
  hostPrefab,
  authoredEntities,
  isEnvironmentEntity,
  type DocumentEntity,
} from '@/engine/prefabEnvironment';

/** A two-entity UI prefab: a panel with one label. */
function uiPrefab(): { entities: DocumentEntity[]; rootId: number } {
  return {
    rootId: 0,
    entities: [
      { id: 0, name: 'Panel', parent: null, children: [1], components: [{ type: 'Transform', data: {} }, { type: 'UINode', data: {} }] },
      { id: 1, name: 'Label', parent: 0, children: [], components: [{ type: 'Transform', data: {} }, { type: 'UINode', data: {} }, { type: 'Text', data: {} }] },
    ],
  };
}

/** The Canvas host the editor builds from the Create-entity source. */
function canvasHost(firstId = 10): { entities: DocumentEntity[]; rootId: number } {
  return {
    rootId: firstId,
    entities: [
      { id: firstId, name: 'Canvas', parent: null, children: [], components: [{ type: 'Transform', data: {} }, { type: 'Canvas', data: {} }, { type: 'UINode', data: {} }] },
    ],
  };
}

describe('needsUIHost', () => {
  it('hosts a UI prefab that brings no Canvas of its own', () => {
    expect(needsUIHost(uiPrefab().entities)).toBe(true);
  });

  it('leaves a prefab that ships its own Canvas alone', () => {
    const hud = uiPrefab();
    hud.entities[0].components = [{ type: 'Transform', data: {} }, { type: 'Canvas', data: {} }, { type: 'UINode', data: {} }];
    expect(needsUIHost(hud.entities)).toBe(false);
  });

  it('leaves a gameplay prefab alone', () => {
    const coin: DocumentEntity[] = [
      { id: 0, name: 'Coin', parent: null, children: [], components: [{ type: 'Transform', data: {} }, { type: 'Sprite', data: {} }] },
    ];
    expect(needsUIHost(coin)).toBe(false);
  });
});

describe('hostPrefab', () => {
  it('puts the host above the prefab root and flags only the host', () => {
    const doc = hostPrefab(uiPrefab(), canvasHost());

    // Document order is spawn order: the host has to precede what it parents.
    expect(doc.map((e) => e.id)).toEqual([10, 0, 1]);
    expect(doc.filter(isEnvironmentEntity).map((e) => e.id)).toEqual([10]);

    const host = doc.find((e) => e.id === 10)!;
    const root = doc.find((e) => e.id === 0)!;
    expect(host.children).toEqual([0]);
    expect(root.parent).toBe(10);
    // The prefab's own hierarchy is untouched.
    expect(doc.find((e) => e.id === 1)!.parent).toBe(0);
  });

  it('does not mutate the entities it was given', () => {
    const prefab = uiPrefab();
    hostPrefab(prefab, canvasHost());
    expect(prefab.entities[0].parent).toBeNull();
  });
});

describe('authoredEntities', () => {
  it('drops the environment and re-roots what it parented', () => {
    const authored = authoredEntities(hostPrefab(uiPrefab(), canvasHost()));

    expect(authored.map((e) => e.id)).toEqual([0, 1]);
    expect(authored[0].parent).toBeNull();
    expect(authored[1].parent).toBe(0);
  });

  it('strips the environment out of an authored entity’s children', () => {
    // A widget created with nothing selected lands under the Canvas host, so the
    // prefab root can end up listing it — the environment must not survive as a child.
    const doc = hostPrefab(uiPrefab(), canvasHost());
    doc.find((e) => e.id === 0)!.children = [1, 10];

    expect(authoredEntities(doc).find((e) => e.id === 0)!.children).toEqual([1]);
  });

  it('passes an unhosted document through unchanged', () => {
    const doc = uiPrefab().entities;
    expect(authoredEntities(doc)).toEqual(doc);
  });
});

describe('save-back round trip', () => {
  it('extracts the same asset whether or not the prefab was hosted', () => {
    const bare = uiPrefab();
    const hosted = hostPrefab(uiPrefab(), canvasHost());
    const stableId = (id: number): string => `id-${id}`;

    const fromBare = extractPrefab(bare.entities as unknown as ExtractEntity[], bare.rootId, 'Panel', stableId);
    const fromHosted = extractPrefab(authoredEntities(hosted) as unknown as ExtractEntity[], bare.rootId, 'Panel', stableId);

    expect(fromHosted).toEqual(fromBare);
  });

  it('never mints an identity for an environment entity', () => {
    const hosted = hostPrefab(uiPrefab(), canvasHost());
    const minted = authoredEntities(hosted).map((e) => e.id);

    expect(minted).not.toContain(10);
  });
});
