// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  ErrorBoundary.tsx — crash isolation for a dock panel. A render error in
 *        one panel renders a recoverable card here instead of unmounting the whole
 *        editor tree, and auto-clears on the next Vite HMR update so fixing the
 *        offending code restores the panel without a full page reload.
 */
import { Component, type ErrorInfo, type ReactNode, type CSSProperties } from 'react';
import { t } from '@/i18n';

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
        <div style={S.title}>
          ⚠ {this.props.label != null ? t('ui.crashTitle', { label: this.props.label }) : t('ui.crashTitleGeneric')}
        </div>
        <div style={S.msg}>{error.message}</div>
        <button type="button" style={S.btn} onClick={this.reset}>
          {t('ui.reloadPanel')}
        </button>
      </div>
    );
  }
}

const S: Record<string, CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, height: '100%', padding: 16, textAlign: 'center', color: 'var(--text)' },
  title: { fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--error)' },
  msg: { fontSize: 'var(--fs-sm)', opacity: 0.75, maxWidth: 480, wordBreak: 'break-word', fontFamily: 'var(--mono)' },
  btn: { padding: '4px 12px', fontSize: 'var(--fs-sm)', borderRadius: 'var(--r-md)', border: '1px solid var(--line)', background: 'var(--srf-3)', color: 'inherit', cursor: 'pointer' },
};
