// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The built-in agent's brief teaches APIs; this compiles them.
 *
 * A brief is prose, so nothing checked that the code inside it existed — and for
 * six months it taught `input.isMouseButtonPressed(MouseButton.Left)`, which
 * type-checks nowhere: `MouseButton` is the InputMap binding builder. The agent
 * copied it into every game it built and the mouse silently did nothing.
 *
 * Two halves, and both are needed. The fixture must COMPILE against the real SDK
 * .d.ts, and the brief must still be TEACHING what the fixture does — a fixture
 * that drifts from the prose guards nothing.
 */
import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { SYSTEM_PROMPT } from '../electron/agent/prompt';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'fixtures', 'agent-brief-usage.ts');
const SDK_TYPES = path.join(HERE, '..', '..', 'sdk', 'dist', 'index.d.ts');

describe("the agent's brief", () => {
  it('teaches APIs that compile against the SDK', () => {
    // A missing sdk/dist is a stale checkout, not a passing test: say so instead
    // of reporting green on a compile that never happened.
    expect([SDK_TYPES, existsSync(SDK_TYPES)]).toEqual([SDK_TYPES, true]);

    const program = ts.createProgram([FIXTURE], {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      paths: { esengine: [SDK_TYPES] },
    });
    const errors = ts.getPreEmitDiagnostics(program)
      .filter((d) => d.category === ts.DiagnosticCategory.Error)
      .map((d) => {
        const where = d.file && d.start !== undefined
          ? `${path.basename(d.file.fileName)}:${d.file.getLineAndCharacterOfPosition(d.start).line + 1}`
          : '(project)';
        return `${where} TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`;
      });
    expect(errors).toEqual([]);
  });

  it('still says what the fixture proves', () => {
    // Positive coupling, not a blacklist of past mistakes: each of these appears
    // in the brief AND is exercised by the fixture, so the two cannot drift
    // apart silently. A brief that stops teaching one of them fails here, and
    // whoever removes it either updates the fixture or reconsiders.
    for (const taught of [
      'isMouseButtonPressed(0)',
      'input.mouseX/mouseY',
      'camera.screenToWorld(x, y)',
      'camera.getWorldMousePosition()',
      'defineComponent(',
      'addSystemToSchedule',
      'lookup_symbol',
      'check_scripts',
      "Material.setUniform(sprite.material, 'u_amount', v)",
      'Res(Meshes2D)',
      'meshes.setGeometry(entity, { positions, indices })',
    ]) {
      expect([taught, SYSTEM_PROMPT.includes(taught)]).toEqual([taught, true]);
    }
    // The wrong form must not come back. Named, because this one shipped.
    expect(SYSTEM_PROMPT).not.toContain('MouseButton.Left');
  });
});
