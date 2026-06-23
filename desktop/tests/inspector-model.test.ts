// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
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
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { SceneData } from 'esengine';
import { EditorSession } from '@/engine/EditorSession';
import { setUserSchemas, enumFieldOptions } from '@/engine/schema';
import { setPrefabBaseResolver } from '@/engine/SceneQuery';

/** A one-entity scene carrying a Camera with the given component-data overrides. */
function sceneWithCamera(data: Record<string, unknown>): SceneData {
  return {
    version: '1.0',
    name: 'cam',
    entities: [{ id: 1, name: 'Cam', parent: null, children: [], components: [{ type: 'Camera', data }] }],
  } as unknown as SceneData;
}

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

  it('surfaces a builtin int field as an enum with engine-derived options', () => {
    const opts = enumFieldOptions('Camera', 'projectionType');
    expect(opts).not.toBeNull();
    // Labels come straight from the engine's ProjectionType const (no hand-mirror).
    expect(opts!.map((o) => o.label)).toEqual(expect.arrayContaining(['Perspective', 'Orthographic']));
    expect(typeof opts!.find((o) => o.label === 'Orthographic')!.value).toBe('number');
    expect(enumFieldOptions('Camera', 'orthoSize')).toBeNull(); // a plain number, not an enum
  });

  it("builds an enum field as type 'enum' carrying its options + stored int", () => {
    const fresh = EditorSession.create();
    fresh.model.adopt(
      {
        version: '1.0',
        name: 'cam',
        entities: [
          {
            id: 1,
            name: 'Cam',
            parent: null,
            children: [],
            components: [{ type: 'Camera', data: { projectionType: 1, orthoSize: 540 } }],
          },
        ],
      } as unknown as SceneData,
      new Map([[1, 1]]),
    );
    const proj = fresh.query.readInspector(1).find((c) => c.name === 'Camera')!.fields.find((f) => f.key === 'projectionType')!;
    expect(proj.type).toBe('enum');
    expect(proj.value).toBe(1);
    expect(proj.options!.length).toBeGreaterThanOrEqual(2);
  });

  it('lets a user component declare an enum field via its schema', () => {
    setUserSchemas([
      {
        name: 'Mover',
        isTag: false,
        default: { mode: 0 },
        colorKeys: [],
        fields: { mode: { enum: [{ label: 'Walk', value: 0 }, { label: 'Run', value: 1 }] } },
      },
    ]);
    const fresh = EditorSession.create();
    fresh.model.adopt(
      {
        version: '1.0',
        name: 'm',
        entities: [
          { id: 1, name: 'M', parent: null, children: [], components: [{ type: 'Mover', data: { mode: 1 } }] },
        ],
      } as unknown as SceneData,
      new Map([[1, 1]]),
    );
    const mode = fresh.query.readInspector(1).find((c) => c.name === 'Mover')!.fields.find((f) => f.key === 'mode')!;
    expect(mode.type).toBe('enum');
    expect(mode.options!.map((o) => o.label)).toEqual(['Walk', 'Run']);
    expect(mode.value).toBe(1);
  });

  it('attaches numeric range + unit metadata to a builtin number field', () => {
    const fresh = EditorSession.create();
    fresh.model.adopt(
      {
        version: '1.0',
        name: 'cam',
        entities: [
          {
            id: 1,
            name: 'Cam',
            parent: null,
            children: [],
            components: [{ type: 'Camera', data: { fov: 60 } }],
          },
        ],
      } as unknown as SceneData,
      new Map([[1, 1]]),
    );
    const cam = fresh.query.readInspector(1).find((c) => c.name === 'Camera')!;
    const fov = cam.fields.find((f) => f.key === 'fov')!;
    expect(fov.type).toBe('number');
    expect(fov.min).toBe(1);
    expect(fov.max).toBe(179);
    expect(fov.unit).toBe('°');
    expect(fov.slider).toBeFalsy(); // ranged but not a slider
  });

  it('marks a 0..1 field as a slider; an unannotated number stays plain', () => {
    const fresh = EditorSession.create();
    fresh.model.adopt(
      {
        version: '1.0',
        name: 't',
        entities: [
          {
            id: 1,
            name: 'T',
            parent: null,
            children: [],
            components: [{ type: 'TilemapLayer', data: { opacity: 0.5, renderLayer: 3 } }],
          },
        ],
      } as unknown as SceneData,
      new Map([[1, 1]]),
    );
    const tm = fresh.query.readInspector(1).find((c) => c.name === 'TilemapLayer')!;
    const opacity = tm.fields.find((f) => f.key === 'opacity')!;
    expect(opacity.slider).toBe(true);
    expect([opacity.min, opacity.max]).toEqual([0, 1]);
    // renderLayer is an integer-stepped number, not a slider (no finite range).
    const layer = tm.fields.find((f) => f.key === 'renderLayer')!;
    expect(layer.type).toBe('number');
    expect(layer.step).toBe(1);
    expect(layer.slider).toBeFalsy();
  });

  it('lets a user component declare numeric range/unit via its schema', () => {
    setUserSchemas([
      {
        name: 'Spin',
        isTag: false,
        default: { speed: 0, ratio: 0.5 },
        colorKeys: [],
        fields: { speed: { unit: '°/s', min: 0 }, ratio: { min: 0, max: 1, slider: true } },
      },
    ]);
    const fresh = EditorSession.create();
    fresh.model.adopt(
      {
        version: '1.0',
        name: 's',
        entities: [
          { id: 1, name: 'S', parent: null, children: [], components: [{ type: 'Spin', data: { speed: 90, ratio: 0.25 } }] },
        ],
      } as unknown as SceneData,
      new Map([[1, 1]]),
    );
    const spin = fresh.query.readInspector(1).find((c) => c.name === 'Spin')!;
    expect(spin.fields.find((f) => f.key === 'speed')!.unit).toBe('°/s');
    const ratio = spin.fields.find((f) => f.key === 'ratio')!;
    expect(ratio.slider).toBe(true);
    expect([ratio.min, ratio.max]).toEqual([0, 1]);
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

describe('Advanced fields (D5)', () => {
  it('flags rarely-edited builtin fields as advanced, leaving primaries plain', () => {
    const S = EditorSession.create();
    S.model.adopt(sceneWithCamera({ fov: 60, nearPlane: 0.1 }), new Map([[1, 1]]));
    const cam = S.query.readInspector(1).find((c) => c.name === 'Camera')!;
    expect(cam.fields.find((f) => f.key === 'fov')!.advanced).toBeFalsy();
    expect(cam.fields.find((f) => f.key === 'nearPlane')!.advanced).toBe(true);
    expect(cam.fields.find((f) => f.key === 'aspectRatio')!.advanced).toBe(true);
  });

  it('lets a user component mark a field advanced via its schema', () => {
    setUserSchemas([
      {
        name: 'Tuning',
        isTag: false,
        default: { power: 1, debugSeed: 0 },
        colorKeys: [],
        fields: { debugSeed: { advanced: true } },
      },
    ]);
    const S = EditorSession.create();
    S.model.adopt(
      {
        version: '1.0',
        name: 't',
        entities: [{ id: 1, name: 'T', parent: null, children: [], components: [{ type: 'Tuning', data: { power: 1, debugSeed: 0 } }] }],
      } as unknown as SceneData,
      new Map([[1, 1]]),
    );
    const tuning = S.query.readInspector(1).find((c) => c.name === 'Tuning')!;
    expect(tuning.fields.find((f) => f.key === 'power')!.advanced).toBeFalsy();
    expect(tuning.fields.find((f) => f.key === 'debugSeed')!.advanced).toBe(true);
  });
});

describe('Per-component enable (D4)', () => {
  function sceneWith(type: string, data: Record<string, unknown>): SceneData {
    return {
      version: '1.0',
      name: 's',
      entities: [{ id: 1, name: 'E', parent: null, children: [], components: [{ type, data }] }],
    } as unknown as SceneData;
  }
  const enableOf = (S: EditorSession, type: string) =>
    S.query.readInspector(1).find((c) => c.name === type)!;

  it("surfaces a component's enable field + hides it from the body", () => {
    const S = EditorSession.create();
    S.model.adopt(sceneWith('Sprite', { enabled: true, layer: 0 }), new Map([[1, 1]]));
    const sprite = enableOf(S, 'Sprite');
    expect(sprite.enable).toEqual({ key: 'enabled', value: true });
    expect(sprite.fields.some((f) => f.key === 'enabled')).toBe(false); // promoted to header
  });

  it('resolves the differently-named enable field per component', () => {
    const cam = EditorSession.create();
    cam.model.adopt(sceneWith('Camera', { isActive: true }), new Map([[1, 1]]));
    expect(enableOf(cam, 'Camera').enable).toEqual({ key: 'isActive', value: true });

    const tm = EditorSession.create();
    tm.model.adopt(sceneWith('TilemapLayer', { visible: false }), new Map([[1, 1]]));
    expect(enableOf(tm, 'TilemapLayer').enable).toEqual({ key: 'visible', value: false });
  });

  it('reflects a toggle of the enable field', () => {
    const S = EditorSession.create();
    S.model.adopt(sceneWith('Sprite', { enabled: true, layer: 0 }), new Map([[1, 1]]));
    S.commands.setField(1, 'Sprite', 'enabled', 'bool', false);
    expect(enableOf(S, 'Sprite').enable).toEqual({ key: 'enabled', value: false });
  });

  it('has no enable toggle for a component that cannot be disabled', () => {
    const S = EditorSession.create();
    S.model.adopt(
      {
        version: '1.0',
        name: 's',
        entities: [
          {
            id: 1,
            name: 'E',
            parent: null,
            children: [],
            components: [
              { type: 'Transform', data: { position: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } } },
            ],
          },
        ],
      } as unknown as SceneData,
      new Map([[1, 1]]),
    );
    expect(enableOf(S, 'Transform').enable).toBeUndefined();
  });
});

describe('Reset-to-default + override base (D3)', () => {
  afterEach(() => setPrefabBaseResolver(null));

  it('carries the component default as each field reset target', () => {
    const S = EditorSession.create();
    S.model.adopt(sceneWithCamera({ orthoSize: 800 }), new Map([[1, 1]]));
    const cam = S.query.readInspector(1).find((c) => c.name === 'Camera')!;
    const orthoSize = cam.fields.find((f) => f.key === 'orthoSize')!;
    expect(orthoSize.value).toBe(800);
    expect(orthoSize.defaultValue).toBe(540); // an override: value ≠ default
    // A field left untouched reads value === default (not modified).
    const fov = cam.fields.find((f) => f.key === 'fov')!;
    expect(fov.value).toBe(fov.defaultValue);
  });

  it('resetting a field to its defaultValue restores the default', () => {
    const S = EditorSession.create();
    S.model.adopt(sceneWithCamera({ orthoSize: 800 }), new Map([[1, 1]]));
    const before = S.query.readInspector(1).find((c) => c.name === 'Camera')!.fields.find((f) => f.key === 'orthoSize')!;
    S.commands.setField(1, 'Camera', 'orthoSize', 'number', before.defaultValue as number);
    const after = S.query.readInspector(1).find((c) => c.name === 'Camera')!.fields.find((f) => f.key === 'orthoSize')!;
    expect(after.value).toBe(540);
    expect(after.value).toBe(after.defaultValue); // no longer modified
  });

  it('a prefab instance resets to the prefab base, not the class default', () => {
    setPrefabBaseResolver((ref, prefabId) =>
      ref === '@uuid:p' && prefabId === 'root' ? [{ type: 'Camera', data: { orthoSize: 300 } }] : null,
    );
    const S = EditorSession.create();
    S.model.adopt(sceneWithCamera({ orthoSize: 800 }), new Map([[1, 1]]));
    S.model.setPrefabTag(1, { instanceRoot: 1, prefabId: 'root', prefab: '@uuid:p' });
    const cam = S.query.readInspector(1).find((c) => c.name === 'Camera')!;
    const orthoSize = cam.fields.find((f) => f.key === 'orthoSize')!;
    expect(orthoSize.value).toBe(800);
    expect(orthoSize.defaultValue).toBe(300); // prefab base wins over the 540 class default
    // A field the prefab base omits falls back to the class default.
    const fov = cam.fields.find((f) => f.key === 'fov')!;
    expect(fov.defaultValue).toBe(60);
  });

  it('without a registered resolver, a tagged instance just uses the class default', () => {
    const S = EditorSession.create();
    S.model.adopt(sceneWithCamera({ orthoSize: 800 }), new Map([[1, 1]]));
    S.model.setPrefabTag(1, { instanceRoot: 1, prefabId: 'root', prefab: '@uuid:p' });
    const orthoSize = S.query.readInspector(1).find((c) => c.name === 'Camera')!.fields.find((f) => f.key === 'orthoSize')!;
    expect(orthoSize.defaultValue).toBe(540);
  });
});
