import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Trash2, ArrowDownToLine, Search } from 'lucide-react';
import { LogStore, type LogLevel } from '@/store/LogStore';

type Filter = 'all' | LogLevel;

export function OutputLog() {
  const entries = useSyncExternalStore(LogStore.subscribe, LogStore.getSnapshot);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true); // stay pinned to the bottom unless the user scrolls up

  const counts = useMemo(() => {
    let warn = 0;
    let error = 0;
    for (const e of entries) {
      if (e.level === 'warn') warn++;
      else if (e.level === 'error') error++;
    }
    return { warn, error };
  }, [entries]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter(
      (e) =>
        (filter === 'all' || e.level === filter) &&
        (!q || e.message.toLowerCase().includes(q) || e.source.toLowerCase().includes(q)),
    );
  }, [entries, filter, query]);

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

  const Pill = ({ id, label, badge }: { id: Filter; label: string; badge?: number }) => (
    <button
      type="button"
      className={`pill${filter === id ? ' is-active' : ''}`}
      onClick={() => setFilter(id)}
    >
      {id !== 'all' && <i className={`dot dot--${id}`} />}
      {label}
      {badge ? <span className="pill__badge">{badge}</span> : null}
    </button>
  );

  return (
    <div className="panel log">
      <div className="panel__toolbar">
        <div className="log__filters">
          <Pill id="all" label="All" />
          <Pill id="info" label="Info" />
          <Pill id="warn" label="Warnings" badge={counts.warn} />
          <Pill id="error" label="Errors" badge={counts.error} />
        </div>
        <div className="log__tools">
          <div className="log__search">
            <Search size={12} strokeWidth={1.9} />
            <input
              value={query}
              spellCheck={false}
              placeholder="Filter"
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <button type="button" className="iconbtn" title="Scroll to bottom" onClick={scrollToBottom}>
            <ArrowDownToLine size={14} strokeWidth={1.85} />
          </button>
          <button type="button" className="iconbtn" title="Clear log" onClick={() => LogStore.clear()}>
            <Trash2 size={14} strokeWidth={1.85} />
          </button>
        </div>
      </div>

      <div ref={bodyRef} className="panel__body log__body mono" onScroll={onScroll}>
        {visible.map((e) => (
          <div key={e.id} className={`logline logline--${e.level}`}>
            <span className="logline__time">{e.time}</span>
            <span className="logline__source">{e.source}</span>
            <span className="logline__msg">{e.message}</span>
          </div>
        ))}
        {visible.length === 0 && (
          <div className="log__empty">
            {entries.length === 0 ? 'No log output yet.' : 'No entries match the filter.'}
          </div>
        )}
      </div>
    </div>
  );
}
