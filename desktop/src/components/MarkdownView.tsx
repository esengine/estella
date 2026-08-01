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
import { t } from '@/i18n';

function Spans({ spans }: { spans: readonly Inline[] }) {
  return (
    <>
      {spans.map((s, i) => {
        if (s.kind === 'code') return <code className="md-code" key={i}>{s.text}</code>;
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

export function MarkdownView({ text }: { text: string }) {
  const blocks = useMemo(() => parseBlocks(text), [text]);
  return (
    <div className="md">
      {blocks.map((b, i) => {
        switch (b.kind) {
          case 'code':
            return <CodeBlock key={i} block={b} />;
          case 'h': {
            const Tag = (`h${Math.min(b.level + 2, 6)}`) as 'h3';
            return <Tag className="md-h" key={i}><Spans spans={b.spans} /></Tag>;
          }
          case 'list':
            return b.ordered ? (
              <ol className="md-list" key={i}>
                {b.items.map((item, j) => <li key={j}><Spans spans={item} /></li>)}
              </ol>
            ) : (
              <ul className="md-list" key={i}>
                {b.items.map((item, j) => <li key={j}><Spans spans={item} /></li>)}
              </ul>
            );
          case 'rule':
            return <hr className="md-rule" key={i} />;
          default:
            return <p className="md-p" key={i}><Spans spans={b.spans} /></p>;
        }
      })}
    </div>
  );
}
