// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';
import { Trash2, ArrowDownToLine, Clock, ListFilter, Check } from 'lucide-react';
import { LogStore, type LogLevel, type LogEntry } from '@/store/LogStore';
import { ContextMenu, type MenuItem } from '@/components/Menu';
import { usePanelWindow } from '@/components/PanelWindow';
import { SearchField } from '@/components/SearchField';
import { IconButton } from '@/components/IconButton';
import { Toasts } from '@/store/Toasts';
import { t } from '@/i18n';

type Filter = 'all' | LogLevel;
const NO_CAT = t('log.noCategory');
const TIME_KEY = 'estella.log.showTime';

// Plain-text rendering of a row for copy / save — always carries the full record
// (time + category + verbosity) regardless of what columns the panel is showing.
function formatEntry(e: LogEntry): string {
  const src = e.source ? ` [${e.source}]` : '';
  return `[${e.time}]${src} ${e.level.toUpperCase()}: ${e.message}`;
}

function saveLog(rows: LogEntry[]): void {
  const text = rows.map(formatEntry).join('\n');
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `OutputLog-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  Toasts.push(t('log.savedLines', { count: rows.length }), 'info', 1800);
}

// A stay-open category filter popover (UE5's "Categories" submenu): toggling one
// category must not dismiss the menu, so this can't reuse the click-to-close
// ContextMenu. Anchored under the trigger, clamped on-screen, closes on an
// outside press / scroll / Escape.
function CategoryMenu({
  anchor,
  categories,
  hidden,
  onToggle,
  onShowAll,
  onHideAll,
  onClose,
}: {
  anchor: { left: number; top: number };
  categories: [string, number][];
  hidden: Set<string>;
  onToggle: (src: string) => void;
  onShowAll: () => void;
  onHideAll: () => void;
  onClose: () => void;
}) {
  const win = usePanelWindow();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(anchor);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 8;
    const left =
      anchor.left + r.width > win.innerWidth - pad
        ? Math.max(pad, win.innerWidth - r.width - pad)
        : anchor.left;
    setPos({ left, top: anchor.top });
  }, [anchor, win]);

  useEffect(() => {
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    win.addEventListener('mousedown', close);
    win.addEventListener('scroll', close, true);
    win.addEventListener('keydown', onKey);
    return () => {
      win.removeEventListener('mousedown', close);
      win.removeEventListener('scroll', close, true);
      win.removeEventListener('keydown', onKey);
    };
  }, [onClose, win]);

  return createPortal(
    <div
      ref={ref}
      className="ctx log-cats"
      role="menu"
      style={{ left: pos.left, top: pos.top }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="lc-head">
        <button type="button" className="lc-act" onClick={onShowAll}>
          {t('log.showAll')}
        </button>
        <button type="button" className="lc-act" onClick={onHideAll}>
          {t('log.hideAll')}
        </button>
      </div>
      <div className="ctx-sep" />
      {categories.length === 0 && <div className="lc-none">{t('log.noCategoriesYet')}</div>}
      {categories.map(([src, count]) => (
        <button key={src || NO_CAT} type="button" className="ctx-item" onClick={() => onToggle(src)}>
          <span className="ci">{!hidden.has(src) ? <Check size={13} strokeWidth={2.4} /> : null}</span>
          <span className="cl">{src || NO_CAT}</span>
          <span className="ck">{count}</span>
        </button>
      ))}
    </div>,
    win.document.body,
  );
}

export function OutputLog() {
  const entries = useSyncExternalStore(LogStore.subscribe, LogStore.getSnapshot);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [showTime, setShowTime] = useState(() => localStorage.getItem(TIME_KEY) !== '0');
  const [catAnchor, setCatAnchor] = useState<{ left: number; top: number } | null>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; selection: string } | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true); // stay pinned to the bottom unless the user scrolls up

  useEffect(() => localStorage.setItem(TIME_KEY, showTime ? '1' : '0'), [showTime]);

  const counts = useMemo(() => {
    let warn = 0;
    let error = 0;
    for (const e of entries) {
      if (e.level === 'warn') warn++;
      else if (e.level === 'error') error++;
    }
    return { warn, error };
  }, [entries]);

  // Distinct sources (with counts) for the category filter, alphabetical.
  const categories = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entries) m.set(e.source, (m.get(e.source) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [entries]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter(
      (e) =>
        (filter === 'all' || e.level === filter) &&
        !hidden.has(e.source) &&
        (!q || e.message.toLowerCase().includes(q) || e.source.toLowerCase().includes(q)),
    );
  }, [entries, filter, query, hidden]);

  // Auto-scroll to the newest line while pinned to the bottom.
  useEffect(() => {
    const el = bodyRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [visible]);

  const onScroll = () => {
    const el = bodyRef.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };
  const scrollToBottom = () => {
    const el = bodyRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
      stick.current = true;
    }
  };

  const toggleCat = (src: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(src)) next.delete(src);
      else next.add(src);
      return next;
    });

  // Capture the live selection at right-click time: opening the menu (a mousedown
  // elsewhere) would otherwise collapse it before "Copy" reads it.
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setCtx({ x: e.clientX, y: e.clientY, selection: window.getSelection()?.toString() ?? '' });
  };

  const ctxItems: MenuItem[] = ctx
    ? [
        {
          label: t('log.copy'),
          disabled: !ctx.selection,
          onClick: () => void navigator.clipboard?.writeText(ctx.selection),
        },
        {
          label: t('log.copyAll'),
          disabled: visible.length === 0,
          onClick: () => void navigator.clipboard?.writeText(visible.map(formatEntry).join('\n')),
        },
        { sep: true },
        { label: t('log.saveLog'), disabled: entries.length === 0, onClick: () => saveLog(entries) },
        { sep: true },
        { label: t('log.clear'), danger: true, onClick: () => LogStore.clear() },
      ]
    : [];

  const Chip = ({ id, label, count }: { id: Filter; label: string; count?: number }) => (
    <button
      type="button"
      className={`chip log-chip${id !== 'all' ? ` ${id}` : ''}${filter === id ? ' on' : ''}`}
      onClick={() => setFilter(id)}
    >
      {id !== 'all' && <i className="d" />}
      {label}
      {count ? <span className="ct">{count}</span> : null}
    </button>
  );

  return (
    <div className="panel">
      <div className="phead">
        <div className="log-chips">
          <Chip id="all" label={t('log.all')} />
          <Chip id="info" label={t('log.info')} />
          <Chip id="warn" label={t('log.warnings')} count={counts.warn} />
          <Chip id="error" label={t('log.errors')} count={counts.error} />
        </div>
        <SearchField className="log-search" iconSize={12} placeholder={t('log.filterPlaceholder')} value={query} onChange={setQuery} />
        <IconButton
          active={hidden.size > 0}
          title={t('log.categories')}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setCatAnchor((a) => (a ? null : { left: r.left, top: r.bottom + 4 }));
          }}
        >
          <ListFilter size={14} strokeWidth={1.85} />
        </IconButton>
        <IconButton
          active={showTime}
          title={t('log.showTimestamps')}
          onClick={() => setShowTime((s) => !s)}
        >
          <Clock size={14} strokeWidth={1.85} />
        </IconButton>
        <IconButton title={t('log.scrollToBottom')} onClick={scrollToBottom}>
          <ArrowDownToLine size={14} strokeWidth={1.85} />
        </IconButton>
        <IconButton title={t('log.clearLog')} onClick={() => LogStore.clear()}>
          <Trash2 size={14} strokeWidth={1.85} />
        </IconButton>
      </div>

      <div ref={bodyRef} className="log-body" onScroll={onScroll} onContextMenu={onContextMenu}>
        {visible.map((e) => (
          <div key={e.id} className={`log-row ${e.level}`}>
            {showTime && <span className="lt">{e.time}  </span>}
            {e.source && <span className="ls">{e.source}  </span>}
            <span className="lm">{e.message}</span>
          </div>
        ))}
        {visible.length === 0 && (
          <div className="empty-line">
            {entries.length === 0 ? t('log.emptyNoOutput') : t('log.emptyNoMatch')}
          </div>
        )}
      </div>

      {catAnchor && (
        <CategoryMenu
          anchor={catAnchor}
          categories={categories}
          hidden={hidden}
          onToggle={toggleCat}
          onShowAll={() => setHidden(new Set())}
          onHideAll={() => setHidden(new Set(categories.map(([s]) => s)))}
          onClose={() => setCatAnchor(null)}
        />
      )}
      {ctx && <ContextMenu x={ctx.x} y={ctx.y} items={ctxItems} onClose={() => setCtx(null)} />}
    </div>
  );
}
