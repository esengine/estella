// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  ImportPluginDialog — see what is in a `.esplugin` before it lands.
 *
 * The whole reason this is a dialog and not a one-click action: a package is a file
 * someone handed you, and the moment to look at it is BEFORE it is on disk. Main
 * reads the archive's central directory without inflating anything, so what is
 * shown here — the manifest, the declared capabilities, the file list — costs
 * nothing and commits to nothing.
 *
 * Installing does NOT approve. The plugin lands needing trust, exactly as a folder
 * copied in by hand would; deciding it is safe stays one separate, deliberate act
 * in the panel.
 */
import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Download, FileArchive, ShieldAlert } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/Button';
import { Segmented } from '@/components/Segmented';
import { PluginHost } from '@/plugins/PluginHost';
import { ProjectStore } from '@/project/ProjectStore';
import { Toasts } from '@/store/Toasts';
import { t, type MsgKey } from '@/i18n';

type Scope = 'project' | 'user';

const CAPABILITY_LABEL: Record<string, MsgKey> = {
  'fs:project': 'plug.cap.fsProject',
  net: 'plug.cap.net',
  shell: 'plug.cap.shell',
  process: 'plug.cap.process',
};

type Picked = Awaited<ReturnType<typeof window.estella.plugins.pickPackage>>;

const kb = (n: number): string => (n < 1024 ? `${n} B` : `${Math.round(n / 1024)} KB`);

export function ImportPluginDialog({ onClose }: { onClose: () => void }) {
  const hasProject = ProjectStore.getSnapshot() !== null;
  const [scope, setScope] = useState<Scope>(hasProject ? 'project' : 'user');
  const [picked, setPicked] = useState<Picked | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Held in a ref so the picker effect below can depend on NOTHING. `onClose` is a
  // fresh closure on every parent render, and listing it as a dependency re-ran the
  // effect — which opened a second OS file dialog behind the first one.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Opening this dialog IS the file picker — there is nothing to show until one is
  // chosen, and a dialog whose only content is a "Choose file" button is a step.
  // Runs exactly once per mount: showing a native dialog is not a repeatable effect.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const result = await window.estella.plugins.pickPackage();
      if (!alive) return;
      if (result.canceled) {
        onCloseRef.current();
        return;
      }
      setPicked(result);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const install = async () => {
    if (!picked?.file) return;
    setBusy(true);
    setError(null);
    const result = await window.estella.plugins.installPackage(picked.file, scope);
    if (!result.ok) {
      setError(result.error ?? 'could not install the package');
      setBusy(false);
      return;
    }
    await PluginHost.refresh();
    Toasts.push(t('plug.installed', { name: picked.name ?? result.id ?? '' }), 'success');
    onClose();
  };

  if (!picked) return null;

  const canInstall = picked.ok && !busy && (scope === 'user' || hasProject);

  return (
    <Modal
      title={t('plug.importTitle')}
      onClose={onClose}
      width={500}
      footer={(
        <>
          <Button onClick={onClose}>{t('ui.cancel')}</Button>
          <Button variant="primary" disabled={!canInstall} onClick={() => void install()}>
            <Download size={13} /> {t('plug.install')}
          </Button>
        </>
      )}
    >
      <div className="npl">
        {!picked.ok ? (
          <div className="npl__hint is-error">
            <AlertCircle size={12} strokeWidth={2} />
            <span className="selectable">{picked.error}</span>
          </div>
        ) : (
          <>
            <div className="plug-pkg__head">
              <FileArchive size={16} strokeWidth={2} />
              <span className="plug-pkg__name">{picked.name}</span>
              <span className="plug-row__version">{picked.manifest?.version}</span>
            </div>

            {/* Capabilities shown HERE, not only at the trust gate — the decision to
                put something on disk deserves the same disclosure as running it. */}
            <div className="plug-trust__caps">
              <span className="plug-trust__capsLabel">{t('plug.capabilities')}:</span>
              {picked.capabilities?.length === 0 ? (
                <span className="plug-muted">{t('plug.noCapabilities')}</span>
              ) : (
                picked.capabilities?.map((c) => (
                  <span key={c} className="plug-cap">{CAPABILITY_LABEL[c] ? t(CAPABILITY_LABEL[c]) : c}</span>
                ))
              )}
            </div>

            <div className="npl__row">
              <span className="npl__label">{t('plug.field.scope')}</span>
              <Segmented
                value={scope}
                onChange={setScope}
                ariaLabel={t('plug.field.scope')}
                options={[
                  { value: 'project', label: t('plug.scope.project') },
                  { value: 'user', label: t('plug.scope.user') },
                ]}
              />
            </div>
            {scope === 'project' && !hasProject && (
              <div className="npl__hint is-error">{t('plug.needProject')}</div>
            )}

            <div className="plug-pkg__files">
              <span className="npl__label">{t('plug.packageContents', { n: picked.files?.length ?? 0 })}</span>
              <ul className="plug-pkg__list">
                {picked.files?.map((f) => (
                  <li key={f.name}>
                    <span className="plug-pkg__file selectable">{f.name}</span>
                    <span className="plug-pkg__size">{kb(f.size)}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="npl__hint">
              <ShieldAlert size={12} strokeWidth={2} />
              {t('plug.installUntrusted')}
            </div>
          </>
        )}

        {error && (
          <div className="npl__hint is-error">
            <AlertCircle size={12} strokeWidth={2} /> <span className="selectable">{error}</span>
          </div>
        )}
      </div>
    </Modal>
  );
}
