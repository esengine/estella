// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  The editor's undo/redo primitive. Every gesture the editor makes rides
 *        on this: LIFO reversal within a transaction, redo invalidation on a new
 *        edit, the single-active-transaction invariant, history trimming, and
 *        error-resilient replay. It had zero coverage — a broken reverse order
 *        or a leaked active transaction would corrupt undo with no test to catch
 *        it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Transaction, TransactionManager } from '../src/ecs/transaction';
import { log } from '../src/logger';

/** A recording op: pushes a marker on forward/reverse so ordering is observable. */
function recordingOp(trace: string[], tag: string) {
  return {
    forward: () => trace.push(`+${tag}`),
    reverse: () => trace.push(`-${tag}`),
  };
}

describe('Transaction', () => {
  it('add() runs forward immediately; addDeferred() does not', () => {
    const trace: string[] = [];
    const tx = new Transaction('edit');
    tx.add(recordingOp(trace, 'a'));
    expect(trace).toEqual(['+a']); // add applied forward
    tx.addDeferred(recordingOp(trace, 'b'));
    expect(trace).toEqual(['+a']); // deferred did not
    expect(tx.opCount).toBe(2);
  });

  it('undo reverses in LIFO order, redo replays in FIFO order', () => {
    const trace: string[] = [];
    const tx = new Transaction('multi');
    tx.add(recordingOp(trace, 'a'));
    tx.add(recordingOp(trace, 'b'));
    tx.add(recordingOp(trace, 'c'));
    expect(trace).toEqual(['+a', '+b', '+c']);
    trace.length = 0;
    tx.undo();
    expect(trace).toEqual(['-c', '-b', '-a']); // LIFO
    trace.length = 0;
    tx.redo();
    expect(trace).toEqual(['+a', '+b', '+c']); // FIFO
  });

  it('a throwing op is caught and logged; siblings still run', () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    const trace: string[] = [];
    const tx = new Transaction('resilient');
    tx.addDeferred(recordingOp(trace, 'a'));
    tx.addDeferred({ forward: () => {}, reverse: () => { throw new Error('boom'); } });
    tx.addDeferred(recordingOp(trace, 'c'));
    expect(() => tx.undo()).not.toThrow();
    // LIFO: c reverses, the middle throws (caught), a still reverses.
    expect(trace).toEqual(['-c', '-a']);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('assigns a unique id and a label; ids do not collide across instances', () => {
    const a = new Transaction('one');
    const b = new Transaction('two');
    expect(a.label).toBe('one');
    expect(a.id).not.toBe(b.id);
    expect(new Transaction('x', 'fixed-id').id).toBe('fixed-id');
  });
});

describe('TransactionManager', () => {
  let mgr: TransactionManager;
  beforeEach(() => { mgr = new TransactionManager(); });

  const commit = (label: string, ops: Array<{ forward(): void; reverse(): void }>) => {
    const tx = mgr.begin(label);
    for (const op of ops) tx.add(op);
    mgr.commit(tx);
    return tx;
  };

  it('commits a non-empty transaction and enables undo', () => {
    expect(mgr.canUndo()).toBe(false);
    const trace: string[] = [];
    commit('edit', [recordingOp(trace, 'a')]);
    expect(mgr.canUndo()).toBe(true);
    expect(mgr.canRedo()).toBe(false);
    expect(mgr.peekUndo()?.label).toBe('edit');
  });

  it('drops an empty transaction silently', () => {
    const tx = mgr.begin('noop');
    mgr.commit(tx);
    expect(mgr.canUndo()).toBe(false);
    expect(mgr.peekUndo()).toBeNull();
  });

  it('begin() rejects a nested transaction', () => {
    mgr.begin('outer');
    expect(() => mgr.begin('inner')).toThrow(/already open/);
  });

  it('commit()/rollback() reject a transaction that is not the active one', () => {
    const active = mgr.begin('active');
    const stranger = new Transaction('stranger');
    expect(() => mgr.commit(stranger)).toThrow(/not the active one/);
    expect(() => mgr.rollback(stranger)).toThrow(/not the active one/);
    mgr.commit(active); // clean up the active slot
  });

  it('rollback reverses applied ops and does not enter the undo stack', () => {
    const trace: string[] = [];
    const tx = mgr.begin('cancelled');
    tx.add(recordingOp(trace, 'a'));
    tx.add(recordingOp(trace, 'b'));
    trace.length = 0;
    mgr.rollback(tx);
    expect(trace).toEqual(['-b', '-a']); // LIFO undo of applied ops
    expect(mgr.canUndo()).toBe(false); // never committed
  });

  it('undo moves a transaction to the redo stack; redo moves it back', () => {
    const trace: string[] = [];
    commit('edit', [recordingOp(trace, 'a')]);
    trace.length = 0;

    const undone = mgr.undo();
    expect(undone?.label).toBe('edit');
    expect(trace).toEqual(['-a']);
    expect(mgr.canUndo()).toBe(false);
    expect(mgr.canRedo()).toBe(true);

    trace.length = 0;
    const redone = mgr.redo();
    expect(redone?.label).toBe('edit');
    expect(trace).toEqual(['+a']);
    expect(mgr.canUndo()).toBe(true);
    expect(mgr.canRedo()).toBe(false);
  });

  it('a new commit invalidates the redo path', () => {
    commit('first', [{ forward() {}, reverse() {} }]);
    mgr.undo();
    expect(mgr.canRedo()).toBe(true);
    commit('second', [{ forward() {}, reverse() {} }]);
    expect(mgr.canRedo()).toBe(false); // redo stack cleared
    expect(mgr.peekRedo()).toBeNull();
  });

  it('undo/redo return null on empty stacks', () => {
    expect(mgr.undo()).toBeNull();
    expect(mgr.redo()).toBeNull();
  });

  it('refuses undo/redo while a transaction is open', () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    commit('done', [{ forward() {}, reverse() {} }]);
    mgr.begin('open');
    expect(mgr.undo()).toBeNull();
    expect(mgr.redo()).toBeNull();
    expect(mgr.canUndo()).toBe(false); // gated while open
    expect(mgr.canRedo()).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('enforces the history limit, dropping the oldest entry', () => {
    const m = new TransactionManager({ historyLimit: 2 });
    const mk = (label: string) => { const tx = m.begin(label); tx.add({ forward() {}, reverse() {} }); m.commit(tx); };
    mk('a'); mk('b'); mk('c'); // 'a' should have been evicted
    expect(m.peekUndo()?.label).toBe('c');
    m.undo(); // c
    m.undo(); // b
    expect(m.canUndo()).toBe(false); // only 2 retained; 'a' is gone
  });

  it('clear() empties both stacks and the active slot', () => {
    commit('edit', [{ forward() {}, reverse() {} }]);
    mgr.undo();
    expect(mgr.canRedo()).toBe(true);
    mgr.begin('dangling'); // leave a transaction open
    mgr.clear();
    expect(mgr.canUndo()).toBe(false);
    expect(mgr.canRedo()).toBe(false);
    expect(() => mgr.begin('fresh')).not.toThrow(); // active slot was cleared
  });
});
