// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    markdown.ts — the subset a model actually writes, parsed for display.
 *
 * Purpose-built rather than a library, for two reasons that both matter here.
 *
 * STREAMING. This re-parses on every delta, against text that is by definition
 * half-finished: a fence that has not closed, a `**` with no partner, a list
 * item mid-word. Every one of those has to render as the thing it is turning
 * into, not as an error and not as raw punctuation — so "unterminated" is a
 * normal state of the input, not a parse failure.
 *
 * TYPOGRAPHY. The drawer's whole design is that hierarchy comes from type, not
 * boxes. Rendering into our own small block/inline model means a heading is the
 * editor's heading and a code span is the editor's mono — instead of importing
 * a stylesheet built for a document and then fighting it.
 *
 * Deliberately NOT supported: tables, blockquotes, images, footnotes, HTML.
 * They do not appear in this transcript, and each one is more surface to get
 * subtly wrong on partial input.
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'em'; text: string }
  | { kind: 'link'; text: string; href: string };

export type Block =
  | { kind: 'p'; spans: Inline[] }
  | { kind: 'h'; level: number; spans: Inline[] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }
  | { kind: 'rule' }
  /** `open` while the closing fence has not arrived — still being written. */
  | { kind: 'code'; lang: string; text: string; open: boolean };

const FENCE = /^\s*```(\S*)\s*$/;
const HEADING = /^(#{1,4})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const RULE = /^\s*([-*_])\1{2,}\s*$/;

/**
 * Split text into blocks. Total: any input is a valid document, because the
 * input is a prefix of one.
 */
export function parseBlocks(source: string): Block[] {
  const lines = source.split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    // Newlines inside a paragraph are kept as written. A model answering in a
    // chat writes short lines on purpose; reflowing them the way a document
    // renderer would loses the shape it chose.
    blocks.push({ kind: 'p', spans: parseInline(paragraph.join('\n')) });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = FENCE.exec(line);
    if (fence) {
      flushParagraph();
      const lang = fence[1] ?? '';
      const body: string[] = [];
      let closed = false;
      for (i++; i < lines.length; i++) {
        if (FENCE.test(lines[i])) { closed = true; break; }
        body.push(lines[i]);
      }
      blocks.push({ kind: 'code', lang, text: body.join('\n'), open: !closed });
      continue;
    }

    if (RULE.test(line)) {
      flushParagraph();
      blocks.push({ kind: 'rule' });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({ kind: 'h', level: heading[1].length, spans: parseInline(heading[2]) });
      continue;
    }

    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = !bullet;
      const last = blocks[blocks.length - 1];
      const item = parseInline((bullet ?? numbered)![1]);
      if (last?.kind === 'list' && last.ordered === ordered) last.items.push(item);
      else blocks.push({ kind: 'list', ordered, items: [item] });
      continue;
    }

    if (line.trim() === '') {
      flushParagraph();
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  return blocks;
}

// Code first: its content is literal, so a `**` inside a code span is two stars.
const INLINE = [
  { kind: 'code' as const, re: /`([^`\n]+)`/ },
  { kind: 'link' as const, re: /\[([^\]\n]*)\]\(([^)\s]+)\)/ },
  { kind: 'strong' as const, re: /\*\*([^*\n]+)\*\*/ },
  { kind: 'em' as const, re: /(?<![*\w])\*([^*\n]+)\*(?!\*)/ },
];

/**
 * Split one block's text into spans. An unterminated marker stays literal text
 * — mid-stream that is exactly right, because the closing one is still coming
 * and flickering the styling on and off as it arrives is worse than waiting.
 */
export function parseInline(source: string): Inline[] {
  const spans: Inline[] = [];
  let rest = source;

  while (rest) {
    let best: { at: number; len: number; span: Inline } | null = null;
    for (const { kind, re } of INLINE) {
      const m = re.exec(rest);
      if (!m || (best && m.index >= best.at)) continue;
      const span: Inline = kind === 'link'
        ? { kind, text: m[1], href: m[2] }
        : { kind, text: m[1] };
      best = { at: m.index, len: m[0].length, span };
    }
    if (!best) break;
    if (best.at > 0) spans.push({ kind: 'text', text: rest.slice(0, best.at) });
    spans.push(best.span);
    rest = rest.slice(best.at + best.len);
  }
  if (rest) spans.push({ kind: 'text', text: rest });
  return spans;
}
