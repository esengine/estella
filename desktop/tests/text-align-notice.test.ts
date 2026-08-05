// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Text align/verticalAlign resolve against a layout box (a UINode laid out
 *        under a Canvas); a boxless Text anchors to its origin instead. The inspector
 *        surfaces that ONLY when the user has set a non-default alignment, so the
 *        anchor behavior is explained rather than looking like a broken field.
 *
 *        The notice also has to name Text.layer. A boxless Text is world content,
 *        and reading only the UI half of this ("add a UINode, put it under a
 *        Canvas") is what sends a board's pieces into a Canvas they do not belong
 *        in — while the thing actually hiding them is a sprite on the same layer
 *        drawn later.
 */
import { describe, it, expect } from 'vitest';
import { componentNotice } from '@/engine/schema';

const entity = (comps: { type: string; data?: unknown }[]) =>
  ({
    id: 1, name: 'T', parent: null, children: [],
    components: comps.map((c) => ({ type: c.type, data: c.data ?? {} })),
  }) as never;

describe('Text alignment notice', () => {
  it('explains anchor-to-origin when a boxless Text has a non-default alignment', () => {
    const e = entity([{ type: 'Transform' }, { type: 'Text', data: { align: 1, verticalAlign: 0 } }]);
    expect(componentNotice('Text', e)).toMatch(/anchors to that origin/);
  });

  it('names Text.layer, the knob that decides whether world text is covered', () => {
    const e = entity([{ type: 'Transform' }, { type: 'Text', data: { align: 1, verticalAlign: 0 } }]);
    const notice = componentNotice('Text', e) ?? '';
    expect(notice).toMatch(/label in the world/);
    expect(notice).toMatch(/Text\.layer/);
  });

  it('stays silent for a default-aligned (Left/Top) boxless Text', () => {
    const e = entity([{ type: 'Transform' }, { type: 'Text', data: { align: 0, verticalAlign: 0 } }]);
    expect(componentNotice('Text', e)).toBeNull();
  });

  it('stays silent once the Text has a UINode layout box (alignment resolves within it)', () => {
    const e = entity([{ type: 'Transform' }, { type: 'UINode' }, { type: 'Text', data: { align: 2, verticalAlign: 1 } }]);
    expect(componentNotice('Text', e)).toBeNull();
  });
});
