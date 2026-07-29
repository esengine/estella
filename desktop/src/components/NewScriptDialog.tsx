// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  NewScriptDialog — create a script the project already runs.
 *
 * The name is validated HERE with the same function the scaffolder uses, so the
 * dialog can never accept one the writer would reject (the handshake
 * NewPluginDialog has with `pluginIdProblem`).
 *
 * It asks for the name rather than dropping the file into the Content Browser's
 * inline rename the way every other creator does, because a script's name is not
 * only its file name: it is the exported identifier, the string a scene
 * serializes, and the specifier the entry imports it by. Renaming it afterwards
 * would leave three of those disagreeing.
 *
 * The two kinds are shown with what each ACTUALLY does to the project — which
 * entry gains a line — because that wiring is the difference between a script the
 * engine runs and a file nothing imports.
 */
import { useMemo, useState } from 'react';
import { Plus, AlertCircle } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/Button';
import { Segmented } from '@/components/Segmented';
import { ProjectStore } from '@/project/ProjectStore';
import {
  SCRIPT_KINDS, scriptNameProblem, scriptTargetDir, scriptModulePath, scriptWiring,
  type ScriptKind,
} from '@/project/scripts';
import { revealAsset } from '@/project/assetReveal';
import { Toasts } from '@/store/Toasts';
import { t, type MsgKey } from '@/i18n';

const KIND_LABEL: Record<ScriptKind, MsgKey> = {
  component: 'script.kind.component',
  system: 'script.kind.system',
};
const KIND_HINT: Record<ScriptKind, MsgKey> = {
  component: 'script.kind.componentHint',
  system: 'script.kind.systemHint',
};
const DEFAULT_NAME: Record<ScriptKind, string> = { component: 'MyComponent', system: 'MySystem' };

export function NewScriptDialog({ dir, onDone }: { dir: string; onDone: (path: string | null) => void }) {
  const [kind, setKind] = useState<ScriptKind>('component');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const entries = ProjectStore.scriptEntries();
  const effective = name.trim() || DEFAULT_NAME[kind];
  const problem = name.trim() ? scriptNameProblem(name) : null;

  // Shown live, so "where does this go and what does it change" is answered
  // before the file exists rather than discovered afterwards.
  const preview = useMemo(() => {
    if (problem) return null;
    const modulePath = scriptModulePath(scriptTargetDir(dir, entries), effective);
    return { modulePath, ...scriptWiring(kind, entries, modulePath) };
  }, [dir, entries, kind, effective, problem]);

  const create = async () => {
    setBusy(true);
    setError(null);
    const res = await window.estella.project.createScript(kind, effective, dir);
    if (!res.ok || !res.path) {
      setError(res.error ?? 'could not create the script');
      setBusy(false);
      return;
    }
    // Deterministic rather than waiting on the watcher: the door's contract is
    // "returned ⇒ usable", and for a component that means its schema is loaded,
    // so the inspector offers it in Add Component the moment the dialog closes.
    await ProjectStore.refreshUserSchemas();
    // Reveal rather than open: this editor has no code editor, and launching the
    // configured external one unbidden would end a successful create on someone
    // else's window — or, with none configured, on an error toast about a program.
    // Double-click takes it there when the user is ready.
    revealAsset(res.path);
    Toasts.push(t('script.created', { path: res.path, entry: res.wiredInto ?? '' }), 'success');
    onDone(res.path);
  };

  return (
    <Modal
      title={t('script.newTitle')}
      onClose={() => onDone(null)}
      width={470}
      footer={(
        <>
          <Button onClick={() => onDone(null)}>{t('ui.cancel')}</Button>
          <Button variant="primary" disabled={busy || !!problem} onClick={() => void create()}>
            <Plus size={13} /> {t('script.create')}
          </Button>
        </>
      )}
    >
      <div className="nsc">
        <div className="nsc__row">
          <span className="nsc__label">{t('script.field.kind')}</span>
          <Segmented
            value={kind}
            onChange={setKind}
            ariaLabel={t('script.field.kind')}
            options={SCRIPT_KINDS.map((k) => ({ value: k, label: t(KIND_LABEL[k]) }))}
          />
        </div>
        <div className="nsc__hint">{t(KIND_HINT[kind])}</div>

        <div className="nsc__row">
          <span className="nsc__label">{t('script.field.name')}</span>
          <input
            value={name}
            spellCheck={false}
            autoFocus
            placeholder={DEFAULT_NAME[kind]}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !problem && !busy) void create();
            }}
          />
        </div>
        {problem && <div className="nsc__hint is-error">{problem}</div>}

        {preview && (
          <div className="nsc__plan">
            <div className="nsc__planRow">
              <span className="nsc__planKey">{t('script.willCreate')}</span>
              <code className="selectable">{preview.modulePath}</code>
            </div>
            <div className="nsc__planRow">
              <span className="nsc__planKey">{t('script.willWire')}</span>
              <code className="selectable">{preview.entry}</code>
            </div>
            <code className="nsc__planLine selectable">{preview.line}</code>
          </div>
        )}

        {error && (
          <div className="nsc__hint is-error">
            <AlertCircle size={12} strokeWidth={2} /> <span className="selectable">{error}</span>
          </div>
        )}
      </div>
    </Modal>
  );
}
