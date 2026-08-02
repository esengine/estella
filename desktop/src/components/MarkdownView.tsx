// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    MarkdownView.tsx — what the model wrote, rendered.
 *
 * The parse is in markdown.ts and is pure; this is only the mapping onto the
 * editor's own type scale. A fenced block that is still being written gets a
 * copy button anyway — the code is usable before the sentence after it arrives.
 */
import { useMemo, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { parseBlocks, type Block, type Inline } from './markdown';
import type { Align } from './markdown';
import { peekEntities } from '@/store/AgentStore';
import { useSelection } from '@/store/selectionStore';
import { t } from '@/i18n';

function Spans({ spans, entity }: { spans: readonly Inline[]; entity?: (name: string) => number | null }) {
  return (
    <>
      {spans.map((s, i) => {
        if (s.kind === 'code') {
          // A code span naming an entity becomes a way into the scene. Keyed on
          // code rather than prose because models write identifiers as code and
          // English writes "the camera" — matching bare words would turn half a
          // sentence into links and send the reader somewhere they did not point.
          const id = entity?.(s.text) ?? null;
          if (id !== null) return <EntityRef key={i} id={id} name={s.text} />;
          return <code className="md-code" key={i}>{s.text}</code>;
        }
        if (s.kind === 'strong') return <strong key={i}>{s.text}</strong>;
        if (s.kind === 'em') return <em key={i}>{s.text}</em>;
        // `_blank` rather than in-app navigation: main's window-open handler
        // already denies navigation and sends http links to the OS, so this
        // window can never be replaced by a page the model linked to.
        if (s.kind === 'link') {
          return (
            <a key={i} className="md-link" href={s.href} target="_blank" rel="noreferrer">
              {s.text || s.href}
            </a>
          );
        }
        return <span key={i}>{s.text}</span>;
      })}
    </>
  );
}

/** An entity named in the answer: hovering echoes it where the work is, clicking
 *  selects it. The same two gestures the transcript's tool rows already have. */
function EntityRef({ id, name }: { id: number; name: string }) {
  return (
    <button
      type="button"
      className="md-ent"
      onMouseEnter={() => peekEntities([id])}
      onMouseLeave={() => peekEntities([])}
      onClick={() => useSelection.getState().select(id)}
    >
      {name}
    </button>
  );
}

function CodeBlock({ block }: { block: Extract<Block, { kind: 'code' }> }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={`md-pre${block.open ? ' open' : ''}`}>
      <div className="md-pre-bar">
        <span className="md-lang">{block.lang}</span>
        <button
          type="button"
          title={t('agent.copy')}
          onClick={() => {
            void navigator.clipboard?.writeText(block.text);
            setCopied(true);
            setTimeout(() => setCopied(false), 900);
          }}
        >
          {copied ? <Check size={11} strokeWidth={2.4} /> : <Copy size={11} strokeWidth={1.9} />}
        </button>
      </div>
      <pre><code>{block.text}</code></pre>
    </div>
  );
}

/**
 * A comparison the model laid out in columns.
 *
 * It scrolls inside its own box rather than widening anything: the drawer is
 * 384px and most tables want more, and a transcript that scrolls sideways as a
 * whole would take every paragraph with it. Cells do not wrap for the same
 * reason — a wrapped table in a narrow column stops being a table.
 *
 * Cells go through the same inline parse as prose, so a code span naming an
 * entity is still a way into the scene.
 */
function Table({ block, entity }: {
  block: Extract<Block, { kind: 'table' }>;
  entity?: (name: string) => number | null;
}) {
  const at = (i: number): Align => block.align[i] ?? 'left';
  return (
    <div className="md-tw">
      <table className="md-table">
        <thead>
          <tr>
            {block.head.map((cell, i) => (
              <th key={i} style={{ textAlign: at(i) }}><Spans spans={cell} entity={entity} /></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, i) => (
                <td key={i} style={{ textAlign: at(i) }}><Spans spans={cell} entity={entity} /></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MarkdownView({ text, entity, caret }: {
  text: string;
  /** Resolve a code span to a scene entity, making it clickable. */
  entity?: (name: string) => number | null;
  /**
   * Tokens are still arriving, so ride the tail with a caret.
   *
   * It is rendered INSIDE the last block, after the last span, because the whole
   * effect is "the text is being typed": a caret placed after the markdown sits
   * on its own line under the paragraph, which reads as a stray blinking box
   * rather than as a cursor. A fenced block that is still open says so with its
   * own edge (.md-pre.open), so it takes no caret.
   */
  caret?: boolean;
}) {
  const blocks = useMemo(() => parseBlocks(text), [text]);
  const tail = (i: number) => (caret && i === blocks.length - 1 ? <span className="md-caret" /> : null);
  return (
    <div className="md">
      {blocks.map((b, i) => {
        switch (b.kind) {
          case 'code':
            return <CodeBlock key={i} block={b} />;
          // No caret: a table announces that it is still being written by
          // growing a row at a time, and a block-level caret under it would sit
          // on its own line — the stray blinking box this design avoids.
          case 'table':
            return <Table key={i} block={b} entity={entity} />;
          case 'h': {
            const Tag = (`h${Math.min(b.level + 2, 6)}`) as 'h3';
            return <Tag className="md-h" key={i}><Spans spans={b.spans} entity={entity} />{tail(i)}</Tag>;
          }
          case 'list': {
            const items = b.items.map((item, j) => (
              <li key={j}>
                <Spans spans={item} entity={entity} />
                {j === b.items.length - 1 && tail(i)}
              </li>
            ));
            return b.ordered
              ? <ol className="md-list" key={i}>{items}</ol>
              : <ul className="md-list" key={i}>{items}</ul>;
          }
          case 'rule':
            return <hr className="md-rule" key={i} />;
          default:
            return <p className="md-p" key={i}><Spans spans={b.spans} entity={entity} />{tail(i)}</p>;
        }
      })}
    </div>
  );
}
