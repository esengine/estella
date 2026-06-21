/**
 * @file    LogStore.ts
 * @brief   The editor's Output Log feed. Everything the editor, the SDK, and the
 *          wasm engine emit ultimately goes through `console.*` (EngineHost routes
 *          wasm print/printErr there; the SDK logger's ConsoleLogHandler too), so
 *          intercepting console in one place captures the whole stream. Entries
 *          are kept in a capped ring buffer; the OutputLog panel renders them.
 */
import { createStore } from 'zustand/vanilla';

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  id: number;
  level: LogLevel;
  time: string;
  source: string;
  message: string;
}

const DEFAULT_CAP = 2000; // ring-buffer cap — long sessions can't grow unbounded

const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
function stamp(): string {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function fmtArg(a: unknown): string {
  if (typeof a === 'string') return a;
  if (a instanceof Error) return a.stack || a.message;
  if (a === null) return 'null';
  if (a === undefined) return 'undefined';
  if (typeof a === 'object') {
    try {
      return JSON.stringify(a);
    } catch {
      return String(a);
    }
  }
  return String(a);
}

/** Pull a source tag out of a formatted line, handling both log shapes. */
export function parseSource(raw: string): { source: string; message: string } {
  // SDK logger: "[12:00:00.000] [WARN ] [scene] message"
  let m = /^\[[\d:.]+\]\s*\[[A-Za-z]+\s*\]\s*\[([^\]]+)\]\s*([\s\S]*)$/.exec(raw);
  if (m) return { source: m[1].trim(), message: m[2] };
  // EngineHost / editor: "[source] message" (skip if the tag looks like a time)
  m = /^\[([^\]]+)\]\s*([\s\S]*)$/.exec(raw);
  if (m && !/[:.]/.test(m[1])) return { source: m[1].trim(), message: m[2] };
  return { source: '', message: raw };
}

class LogStoreImpl {
  private readonly store = createStore<{ entries: LogEntry[] }>(() => ({ entries: [] }));
  private seq = 0;
  private installed = false;
  private capturing = false;
  private cap = DEFAULT_CAP;

  subscribe = (fn: () => void): (() => void) => this.store.subscribe(fn);
  getSnapshot = (): LogEntry[] => this.store.getState().entries;

  getCap(): number {
    return this.cap;
  }

  /** Set the ring-buffer cap (the console "max lines" setting); trims overflow. */
  setCap(cap: number): void {
    this.cap = Math.max(100, Math.floor(cap));
    const cur = this.store.getState().entries;
    if (cur.length > this.cap) {
      this.store.setState({ entries: cur.slice(cur.length - this.cap) });
    }
  }

  push(level: LogLevel, source: string, message: string): void {
    const entry: LogEntry = { id: ++this.seq, level, time: stamp(), source, message };
    const cur = this.store.getState().entries;
    const next =
      cur.length >= this.cap ? [...cur.slice(cur.length - this.cap + 1), entry] : [...cur, entry];
    this.store.setState({ entries: next });
  }

  clear(): void {
    this.store.setState({ entries: [] });
  }

  /** Patch console.* once so every log (editor + SDK + wasm) flows into the panel. */
  install(): void {
    if (this.installed) return;
    this.installed = true;
    const wrap = (method: 'log' | 'info' | 'debug' | 'warn' | 'error', level: LogLevel) => {
      const orig = console[method].bind(console);
      console[method] = (...args: unknown[]) => {
        orig(...args);
        if (this.capturing) return; // guard against logs emitted while capturing
        this.capturing = true;
        try {
          const { source, message } = parseSource(args.map(fmtArg).join(' '));
          this.push(level, source, message);
        } catch {
          /* never let logging break the app */
        } finally {
          this.capturing = false;
        }
      };
    };
    wrap('log', 'info');
    wrap('info', 'info');
    wrap('debug', 'info');
    wrap('warn', 'warn');
    wrap('error', 'error');
  }
}

export const LogStore = new LogStoreImpl();
