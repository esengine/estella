/**
 * @file  LogStore source parsing — the two log line shapes that flow through
 *        console into the Output Log: the SDK logger's "[time] [LEVEL] [cat] msg"
 *        and EngineHost's "[source] msg".
 */
import { describe, it, expect } from 'vitest';
import { parseSource } from '@/store/LogStore';

describe('parseSource', () => {
  it('extracts the category from the SDK logger format', () => {
    expect(parseSource('[12:00:00.088] [WARN ] [scene] Unknown component type: X')).toEqual({
      source: 'scene',
      message: 'Unknown component type: X',
    });
  });

  it('extracts the source from the EngineHost / editor format', () => {
    expect(parseSource('[wasm] esengine.wasm instantiated')).toEqual({
      source: 'wasm',
      message: 'esengine.wasm instantiated',
    });
    expect(parseSource('[engine] boot ok')).toEqual({ source: 'engine', message: 'boot ok' });
  });

  it('leaves a plain line untouched', () => {
    expect(parseSource('just a message')).toEqual({ source: '', message: 'just a message' });
  });

  it('does not mistake a leading timestamp tag for a source', () => {
    const r = parseSource('[12:00:00] hello');
    expect(r.source).toBe('');
    expect(r.message).toBe('[12:00:00] hello');
  });
});
