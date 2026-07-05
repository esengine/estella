// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  ErrorBoundary.tsx — crash isolation for a dock panel. A render error in
 *        one panel renders a recoverable card here instead of unmounting the whole
 *        editor tree, and auto-clears on the next Vite HMR update so fixing the
 *        offending code restores the panel without a full page reload.
 */
import { Component, type ErrorInfo, type ReactNode, type CSSProperties } from 'react';

interface Props {
  /** Human label for the crashed region, shown in the fallback. */
  label?: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };
  private offHot?: () => void;

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const where = this.props.label ? ` [${this.props.label}]` : '';
    console.error(`Panel${where} render crashed:`, error, info.componentStack);
  }

  componentDidMount() {
    // Vite fires 'vite:afterUpdate' after applying an HMR patch. Clearing the
    // error then lets the (now-fixed) child re-render; if it still throws, the
    // boundary simply catches again.
    if (import.meta.hot) {
      const reset = () => this.setState((s) => (s.error ? { error: null } : s));
      import.meta.hot.on('vite:afterUpdate', reset);
      this.offHot = () => import.meta.hot?.off('vite:afterUpdate', reset);
    }
  }

  componentWillUnmount() {
    this.offHot?.();
  }

  private reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div style={S.root} role="alert">
        <div style={S.title}>⚠ {this.props.label ?? 'This panel'} hit an error</div>
        <div style={S.msg}>{error.message}</div>
        <button type="button" style={S.btn} onClick={this.reset}>
          Reload panel
        </button>
      </div>
    );
  }
}

const S: Record<string, CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, height: '100%', padding: 16, textAlign: 'center', color: 'var(--text, #cbd2da)' },
  title: { fontSize: 13, fontWeight: 600, color: 'var(--danger, #e06c75)' },
  msg: { fontSize: 12, opacity: 0.75, maxWidth: 480, wordBreak: 'break-word', fontFamily: 'var(--mono, ui-monospace, monospace)' },
  btn: { padding: '4px 12px', fontSize: 12, borderRadius: 4, border: '1px solid var(--border, #333)', background: 'var(--panel, #232830)', color: 'inherit', cursor: 'pointer' },
};
