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
 * Deliberately NOT supported: blockquotes, images, footnotes, HTML. They do not
 * appear in this transcript, and each one is more surface to get subtly wrong on
 * partial input.
 *
 * Tables WERE on that list and should not have been: asked to compare a handful
 * of entities or field values, a model reaches for one, and the fallback — a
 * paragraph of raw pipes, wrapped in a 384px column — is the least readable
 * thing this renderer can produce.
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'em'; text: string }
  | { kind: 'link'; text: string; href: string };

export type Align = 'left' | 'center' | 'right';

export type Block =
  | { kind: 'p'; spans: Inline[] }
  | { kind: 'h'; level: number; spans: Inline[] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }
  | { kind: 'rule' }
  /** `open` while the closing fence has not arrived — still being written. */
  | { kind: 'code'; lang: string; text: string; open: boolean }
  /** Rows are already fitted to the header's width, so rendering never has to
   *  ask what a ragged row means. */
  | { kind: 'table'; align: Align[]; head: Inline[][]; rows: Inline[][][] };

const FENCE = /^\s*```(\S*)\s*$/;
const HEADING = /^(#{1,4})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const RULE = /^\s*([-*_])\1{2,}\s*$/;
/**
 * A leading pipe is REQUIRED of a table row, though the standard would also take
 * `a | b`. Without it an ordinary sentence that happens to contain a pipe
 * ("group them by A | B") turns into a one-row table as soon as the line under
 * it looks like a rule — and being wrong in that direction is unrecoverable for
 * the reader, while being wrong the other way just leaves a paragraph.
 */
const TABLE_ROW = /^\s*\|/;
const DIVIDER_CELL = /^:?-+:?$/;

/**
 * `| a | b |` → `['a', 'b']`, with `\|` kept as a literal pipe.
 *
 * The trailing empty cell a closing pipe produces is dropped; interior empty
 * cells are not, because `| a | | c |` is a three-column row with a blank in
 * the middle and squeezing it would shift every cell after it left.
 */
function cells(line: string): string[] {
  const out: string[] = [];
  const s = line.trim();
  let cur = '';
  for (let i = s.startsWith('|') ? 1 : 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
    if (s[i] === '|') { out.push(cur.trim()); cur = ''; continue; }
    cur += s[i];
  }
  if (cur.trim() !== '') out.push(cur.trim());
  return out;
}

/**
 * The `|---|:--:|` line as per-column alignment, or null if that is not what
 * this line is.
 *
 * `width` must match, which is what keeps a half-written divider from briefly
 * rendering as a narrower table: mid-stream `|--` parses as one perfectly good
 * column, and the header above it has three.
 */
function alignments(line: string, width: number): Align[] | null {
  const parts = cells(line);
  if (parts.length !== width || !parts.every((p) => DIVIDER_CELL.test(p))) return null;
  return parts.map((p) => {
    if (p.startsWith(':') && p.endsWith(':')) return 'center';
    return p.endsWith(':') ? 'right' : 'left';
  });
}

/** A row as the header's width, padded or truncated — never ragged. */
const fit = (row: string[], width: number): string[] =>
  Array.from({ length: width }, (_, i) => row[i] ?? '');

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

    // A table is only a table once its divider has arrived. Until then the
    // header is an ordinary paragraph — which is exactly what it looks like,
    // and what it may still turn out to be.
    if (TABLE_ROW.test(line)) {
      const head = cells(line);
      const align = alignments(lines[i + 1] ?? '', head.length);
      if (align) {
        flushParagraph();
        const rows: Inline[][][] = [];
        for (i += 2; i < lines.length && TABLE_ROW.test(lines[i]); i++) {
          rows.push(fit(cells(lines[i]), head.length).map(parseInline));
        }
        i--; // the loop's own i++ must land on the line that ended the table
        blocks.push({ kind: 'table', align, head: head.map(parseInline), rows });
        continue;
      }
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
