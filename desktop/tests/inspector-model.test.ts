/**
 * @file  Unknown / user-component inspector (REARCH_EDITOR_MODEL.md E1). Project
 *        components never run in the editor realm, so the engine registry doesn't
 *        know them — their field shapes come from `schemas.json`. The inspector
 *        reads the MODEL, so it lists + edits them and the model round-trips
 *        losslessly. No World / wasm needed: unknown components are model-only
 *        (the Reconciler skips projecting them; the session's World is null here).
 *
 * Runs in an isolated EditorSession (P2) — fresh model/query/commands/history,
 * no shared-singleton state to clear.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { SceneData } from 'esengine';
import { EditorSession } from '@/engine/EditorSession';
import { setUserSchemas } from '@/engine/schema';

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
  let S: EditorSession;
  beforeEach(() => {
    setUserSchemas([WAVE_SCHEMA]);
    S = EditorSession.create();
    // Bind source id 1 to a placeholder runtime id; unknown components are never
    // projected (and the session's World is null), so the model is the truth here.
    S.model.adopt(sceneWithWave(), new Map([[1, 1]]));
  });

  it('lists an unknown component with its schema fields', () => {
    const wave = S.query.readInspector(1).find((c) => c.name === 'WaveMotion');
    expect(wave).toBeDefined();
    expect(wave!.fields.map((f) => f.key).sort()).toEqual(['amplitude', 'phase']);
    expect(wave!.fields.find((f) => f.key === 'amplitude')!.value).toBe(5);
  });

  it('edits an unknown component field; the model round-trips losslessly', () => {
    S.commands.setField(1, 'WaveMotion', 'amplitude', 'number', 9);
    expect(S.query.getFieldValue(1, 'WaveMotion', 'amplitude')).toBe(9);

    const saved = S.model.serialize()!;
    const wave = saved.entities[0].components.find((c) => c.type === 'WaveMotion')!.data as {
      amplitude: number;
      phase: number;
    };
    expect(wave.amplitude).toBe(9);
    expect(wave.phase).toBe(1.5); // untouched field preserved verbatim
  });

  it('undo reverts an unknown-component edit', () => {
    S.commands.setField(1, 'WaveMotion', 'amplitude', 'number', 9);
    S.history.undo();
    expect(S.query.getFieldValue(1, 'WaveMotion', 'amplitude')).toBe(5);
  });

  it('infers editable fields from the data even without a schema', () => {
    setUserSchemas([]); // no schemas.json for this component
    const fresh = EditorSession.create();
    fresh.model.adopt(sceneWithWave(), new Map([[1, 1]]));
    const wave = fresh.query.readInspector(1).find((c) => c.name === 'WaveMotion');
    expect(wave).toBeDefined();
    expect(wave!.fields.find((f) => f.key === 'amplitude')!.value).toBe(5);
  });

  it('renders a component asset-ref field as an asset control, not a raw uuid', () => {
    const ref = '@uuid:44444444-4444-4444-8444-444444444444';
    const fresh = EditorSession.create();
    fresh.model.adopt(
      {
        version: '1.0',
        name: 's',
        entities: [
          {
            id: 1,
            name: 'S',
            parent: null,
            children: [],
            components: [{ type: 'Sprite', data: { texture: ref, color: { r: 1, g: 1, b: 1, a: 1 } } }],
          },
        ],
      } as unknown as SceneData,
      new Map([[1, 1]]),
    );
    const sprite = fresh.query.readInspector(1).find((c) => c.name === 'Sprite');
    const tex = sprite!.fields.find((f) => f.key === 'texture');
    // Sprite.texture is a builtin asset field → an asset control carrying the ref.
    expect(tex!.type).toBe('asset');
    expect(tex!.assetType).toBe('texture');
    expect(tex!.value).toBe(ref);
  });
});
