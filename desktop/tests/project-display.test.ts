// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Project Display settings + Canvas design-resolution seed. The project's
 *        reference resolution is a create-time seed for new Canvas entities (the
 *        per-scene Canvas component stays authoritative afterwards), injected into
 *        entitySources to avoid an entitySources ↔ ProjectStore import cycle.
 */
import { describe, it, expect, afterEach } from 'vitest';
import '@/settings';
import { settingsRegistry } from '@/settings/registry';
import { ENTITY_SOURCES, setCanvasDesignSeed } from '@/engine/entitySources';
import { ProjectStore } from '@/project/ProjectStore';

async function canvasDesign(): Promise<{ x: number; y: number }> {
  const src = ENTITY_SOURCES.find((s) => s.id === 'canvas')!;
  const prefab = await src.build({ parent: null });
  const canvas = prefab.entities[0].components.find((c) => c.type === 'Canvas')!.data as Record<string, unknown>;
  return canvas.designResolution as { x: number; y: number };
}

describe('project Display settings + Canvas design-resolution seed', () => {
  // ProjectStore wires this in its constructor; restore it so ordering can't leak a stub.
  afterEach(() => setCanvasDesignSeed(() => ProjectStore.designResolution()));

  it('registers a Display section with width/height design-resolution rows', () => {
    expect(settingsRegistry.allSections().map((s) => s.id)).toContain('display');
    const w = settingsRegistry.get('project.display.width');
    const h = settingsRegistry.get('project.display.height');
    expect(w?.type).toBe('number');
    expect(w?.default).toBe(1920);
    expect(h?.default).toBe(1080);
  });

  it('ProjectStore.designResolution() defaults to the engine Canvas default with no project open', () => {
    expect(ProjectStore.designResolution()).toEqual({ width: 1920, height: 1080 });
  });

  it('the Canvas create source seeds designResolution from the injected project provider', async () => {
    setCanvasDesignSeed(() => ({ width: 1280, height: 720 }));
    expect(await canvasDesign()).toEqual({ x: 1280, y: 720 });
  });

  it('the Canvas seed falls back to 1920×1080 when no project resolution is set', async () => {
    setCanvasDesignSeed(() => ProjectStore.designResolution());
    expect(await canvasDesign()).toEqual({ x: 1920, y: 1080 });
  });
});
