// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team

type ClipField = { clip?: string };
type AuthoredState = ClipField & {
  motion?: unknown;
  stateMachine?: { states?: AuthoredState[] };
  blend?: { thresholds?: ClipField[] };
};
interface Controller { states?: AuthoredState[]; layers?: { states?: AuthoredState[] }[] }

/** Visit clip slots in v1 and v2 controller files, including nested state machines and blend children. */
export function visitAnimatorClips(json: Controller, visit: (kind: string | undefined, holder: ClipField) => void): void {
  const walk = (motion: unknown): void => {
    if (!motion || typeof motion !== 'object') return;
    const m = motion as ClipField & { kind?: string; thresholds?: { motion?: unknown }[]; points?: { motion?: unknown }[] };
    if (m.kind === 'blend1d' || m.kind === 'blend2d') {
      for (const child of m.thresholds ?? m.points ?? []) walk(child.motion);
    } else visit(m.kind, m);
  };
  const states = (list: AuthoredState[] | undefined): void => {
    for (const st of list ?? []) {
      walk(st.motion);
      visit('sprite', st);
      for (const stop of st.blend?.thresholds ?? []) visit('sprite', stop);
      states(st.stateMachine?.states);
    }
  };
  states(json.states);
  for (const layer of json.layers ?? []) states(layer.states);
}
