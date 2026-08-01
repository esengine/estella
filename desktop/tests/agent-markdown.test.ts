// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  Parsing what the model writes. The interesting cases are all PARTIAL:
 *        this re-parses on every streamed delta, so half a fence and an
 *        unmatched `**` are normal inputs, not malformed ones — and each has to
 *        render as the thing it is turning into.
 */
import { describe, it, expect } from 'vitest';
import { parseBlocks, parseInline } from '@/components/markdown';

describe('blocks', () => {
  it('reads a fenced block with its language', () => {
    expect(parseBlocks('```ts\nconst a = 1;\n```')).toEqual([
      { kind: 'code', lang: 'ts', text: 'const a = 1;', open: false },
    ]);
  });

  // The closing fence arrives some tokens later. Until then this is a code
  // block being written — not a paragraph that will later turn into one.
  it('treats an unclosed fence as a block still being written', () => {
    const [block] = parseBlocks('```ts\nconst a =');
    expect(block).toEqual({ kind: 'code', lang: 'ts', text: 'const a =', open: true });
  });

  it('keeps consecutive list items in one list, and splits kinds', () => {
    const blocks = parseBlocks('- one\n- two\n\n1. first\n2. second');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ kind: 'list', ordered: false });
    expect(blocks[1]).toMatchObject({ kind: 'list', ordered: true });
    expect((blocks[0] as { items: unknown[] }).items).toHaveLength(2);
  });

  it('reads headings by depth', () => {
    expect(parseBlocks('## Why')[0]).toMatchObject({ kind: 'h', level: 2 });
  });

  // A model answering in a chat writes short lines on purpose; reflowing them
  // the way a document renderer would loses the shape it chose.
  it('keeps the line breaks inside a paragraph', () => {
    const [block] = parseBlocks('one\ntwo');
    expect(block).toEqual({ kind: 'p', spans: [{ kind: 'text', text: 'one\ntwo' }] });
  });

  it('separates paragraphs on a blank line', () => {
    expect(parseBlocks('a\n\nb')).toHaveLength(2);
  });
});

describe('inline spans', () => {
  it('picks out code, bold, italic and links', () => {
    expect(parseInline('run `npm t` now')).toEqual([
      { kind: 'text', text: 'run ' },
      { kind: 'code', text: 'npm t' },
      { kind: 'text', text: ' now' },
    ]);
    expect(parseInline('**bold**')).toEqual([{ kind: 'strong', text: 'bold' }]);
    expect(parseInline('*soft*')).toEqual([{ kind: 'em', text: 'soft' }]);
    expect(parseInline('[docs](https://x.dev)')).toEqual([
      { kind: 'link', text: 'docs', href: 'https://x.dev' },
    ]);
  });

  // Code content is literal — a star inside a code span is a star.
  it('does not read markup inside a code span', () => {
    expect(parseInline('`a **b** c`')).toEqual([{ kind: 'code', text: 'a **b** c' }]);
  });

  // Flickering the styling on as the closing marker lands is worse than waiting.
  it('leaves an unterminated marker as plain text', () => {
    expect(parseInline('half **way')).toEqual([{ kind: 'text', text: 'half **way' }]);
    expect(parseInline('an `open')).toEqual([{ kind: 'text', text: 'an `open' }]);
  });

  it('prefers bold over italic when both could match', () => {
    expect(parseInline('**x**')).toEqual([{ kind: 'strong', text: 'x' }]);
  });
});
