// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  NewPluginDialog — create a plugin the editor can already run.
 *
 * The id is validated HERE with the same function the manifest reader uses, so the
 * dialog can never accept a name the loader would later reject — the failure a
 * scaffolder exists to prevent.
 *
 * Two things this hands main that main deliberately does not read for itself: the
 * editor version (the constant that ENFORCES the `engines.editor` check) and the
 * plugin API typings text. Both come from the renderer because the renderer is
 * where the enforcing copy lives — generating against anything else is how a
 * scaffold ends up born `incompatible`.
 *
 * The result is TRUSTED on creation. Trust exists to gate code you did not write;
 * this is code the editor just wrote at your request, and leaving it sitting behind
 * a "needs trust" prompt would ask the user to vouch for the editor's own template.
 */
import { useState } from 'react';
import { Plus, AlertCircle } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/Button';
import { Segmented } from '@/components/Segmented';
import { PluginHost } from '@/plugins/PluginHost';
import { pluginIdProblem } from '@/plugins/manifest';
import { ProjectStore } from '@/project/ProjectStore';
import { Toasts } from '@/store/Toasts';
import { version as EDITOR_VERSION } from '../../package.json';
// The same text init.ts writes as the project's typings sidecar — see types.ts,
// which is import-free precisely so it can double as the shipped `.d.ts`.
import editorApiTypes from '../../../editor-api/index.ts?raw';
import { t, type MsgKey } from '@/i18n';

type Scope = 'project' | 'user';
type Sample = 'command' | 'panel' | 'inspector' | 'overlay' | 'tool';

const SAMPLES: { id: Sample; label: MsgKey }[] = [
  { id: 'command', label: 'plug.contrib.command' },
  { id: 'panel', label: 'plug.contrib.panel' },
  { id: 'inspector', label: 'plug.contrib.inspector' },
  { id: 'overlay', label: 'plug.contrib.overlay' },
  { id: 'tool', label: 'plug.contrib.tool' },
];

/** `Level Tools` → `level-tools`: a sensible id half, so most users type one field. */
const slug = (s: string): string =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export function NewPluginDialog({ onClose }: { onClose: () => void }) {
  const hasProject = ProjectStore.getSnapshot() !== null;
  const [scope, setScope] = useState<Scope>(hasProject ? 'project' : 'user');
  const [name, setName] = useState('');
  // Kept separately from `name` so typing a name suggests an id, but editing the id
  // stops the suggestion from overwriting the user's own choice.
  const [id, setId] = useState('');
  const [idTouched, setIdTouched] = useState(false);
  const [samples, setSamples] = useState<Sample[]>(['command']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveId = idTouched ? id : name.trim() ? `my.${slug(name)}` : '';
  const idProblem = effectiveId ? pluginIdProblem(effectiveId) : null;
  const canCreate =
    !busy && name.trim() !== '' && !!effectiveId && !idProblem && (scope === 'user' || hasProject);

  const toggle = (s: Sample) =>
    setSamples((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  const create = async () => {
    setBusy(true);
    setError(null);
    const result = await window.estella.plugins.scaffold(scope, {
      id: effectiveId,
      name: name.trim(),
      contributions: samples,
      editorVersion: EDITOR_VERSION,
      apiTypes: editorApiTypes,
    });
    if (!result.ok) {
      setError(result.error ?? 'could not create the plugin');
      setBusy(false);
      return;
    }
    // Approve before the first scan, so it comes up running rather than asking the
    // user to vouch for a template the editor authored a moment ago.
    await window.estella.plugins.trust(effectiveId);
    await PluginHost.refresh();
    Toasts.push(t('plug.created', { name: name.trim() }), 'success');
    onClose();
  };

  return (
    <Modal
      title={t('plug.newTitle')}
      onClose={onClose}
      width={480}
      footer={(
        <>
          <Button onClick={onClose}>{t('ui.cancel')}</Button>
          <Button variant="primary" disabled={!canCreate} onClick={() => void create()}>
            <Plus size={13} /> {t('plug.create')}
          </Button>
        </>
      )}
    >
      <div className="npl">
        <p className="npl__blurb">{t('plug.newBlurb')}</p>

        <div className="npl__row">
          <span className="npl__label">{t('plug.field.name')}</span>
          <input
            value={name}
            spellCheck={false}
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="npl__row">
          <span className="npl__label" title={t('plug.field.idTip')}>{t('plug.field.id')}</span>
          <input
            value={effectiveId}
            spellCheck={false}
            onChange={(e) => {
              setIdTouched(true);
              setId(e.target.value);
            }}
          />
        </div>
        {idProblem && <div className="npl__hint is-error">{idProblem}</div>}

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
        <div className="npl__hint">
          {scope === 'project' ? t('plug.scope.projectHint') : t('plug.scope.userHint')}
        </div>
        {scope === 'project' && !hasProject && (
          <div className="npl__hint is-error">{t('plug.needProject')}</div>
        )}

        <div className="npl__samples">
          <span className="npl__label">{t('plug.samples')}</span>
          <div className="npl__checks">
            {SAMPLES.map((s) => (
              <label key={s.id} className="npl__check">
                <input type="checkbox" checked={samples.includes(s.id)} onChange={() => toggle(s.id)} />
                {t(s.label)}
              </label>
            ))}
          </div>
          <div className="npl__hint">{t('plug.samplesHint')}</div>
        </div>

        {error && (
          <div className="npl__hint is-error">
            <AlertCircle size={12} strokeWidth={2} /> <span className="selectable">{error}</span>
          </div>
        )}
      </div>
    </Modal>
  );
}
