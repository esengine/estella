/**
 * @file  Unknown / user-component inspector (REARCH_EDITOR_MODEL.md E1). Project
 *        components never run in the editor realm, so the engine registry doesn't
 *        know them — their field shapes come from `schemas.json`. The inspector
 *        reads the MODEL, so it lists + edits them and the model round-trips
 *        losslessly. No World / wasm needed: unknown components are model-only
 *        (the Reconciler skips projecting them), so this is a pure model+schema
 *        test — SceneCommands/SceneQuery don't even import EngineHost.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { SceneData } from 'esengine';
import { SceneModel } from '@/engine/SceneModel';
import { SceneQuery } from '@/engine/SceneQuery';
import { SceneCommands } from '@/engine/SceneCommands';
import { setUserSchemas } from '@/engine/schema';
import { EditorHistory } from '@/engine/EditorHistory';

const WAVE_SCHEMA = {
  name: 'WaveMotion',
  isTag: false,
  default: { amplitude: 5, phase: 1.5 },
  colorKeys: [],
};

function sceneWithWave(): SceneData {
  return {
    version: '1.0',
    name: 'waves',
    entities: [
      {
        id: 1,
        name: 'Hero',
        parent: null,
        children: [],
        components: [
          {
            type: 'Transform',
            data: {
              position: { x: 0, y: 0, z: 0 },
              rotation: { w: 1, x: 0, y: 0, z: 0 },
              scale: { x: 1, y: 1, z: 1 },
            },
          },
          { type: 'WaveMotion', data: { amplitude: 5, phase: 1.5 } }, // unknown to the engine
        ],
      },
    ],
  } as unknown as SceneData;
}

describe('Unknown-component inspector (schemas.json consumer)', () => {
  beforeEach(() => {
    SceneModel.clear();
    EditorHistory.clear();
    setUserSchemas([WAVE_SCHEMA]);
    // Bind source id 1 to a placeholder runtime id; unknown components are never
    // projected, so the value is irrelevant — the model is the truth here.
    SceneModel.adopt(sceneWithWave(), new Map([[1, 1]]));
  });

  it('lists an unknown component with its schema fields', () => {
    const wave = SceneQuery.readInspector(1).find((c) => c.name === 'WaveMotion');
    expect(wave).toBeDefined();
    expect(wave!.fields.map((f) => f.key).sort()).toEqual(['amplitude', 'phase']);
    expect(wave!.fields.find((f) => f.key === 'amplitude')!.value).toBe(5);
  });

  it('edits an unknown component field; the model round-trips losslessly', () => {
    SceneCommands.setField(1, 'WaveMotion', 'amplitude', 'number', 9);
    expect(SceneQuery.getFieldValue(1, 'WaveMotion', 'amplitude')).toBe(9);

    const saved = SceneModel.serialize()!;
    const wave = saved.entities[0].components.find((c) => c.type === 'WaveMotion')!.data as {
      amplitude: number;
      phase: number;
    };
    expect(wave.amplitude).toBe(9);
    expect(wave.phase).toBe(1.5); // untouched field preserved verbatim
  });

  it('undo reverts an unknown-component edit', () => {
    SceneCommands.setField(1, 'WaveMotion', 'amplitude', 'number', 9);
    EditorHistory.undo();
    expect(SceneQuery.getFieldValue(1, 'WaveMotion', 'amplitude')).toBe(5);
  });

  it('infers editable fields from the data even without a schema', () => {
    setUserSchemas([]); // no schemas.json for this component
    SceneModel.clear();
    SceneModel.adopt(sceneWithWave(), new Map([[1, 1]]));
    const wave = SceneQuery.readInspector(1).find((c) => c.name === 'WaveMotion');
    expect(wave).toBeDefined();
    expect(wave!.fields.find((f) => f.key === 'amplitude')!.value).toBe(5);
  });
});
