// SPDX-License-Identifier: LicenseRef-PolyForm-Noncommercial-1.0.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file  BuildDialog.tsx — the UE5-style "Package Project" modal.
 *        Pick a platform + configuration + output, hit Build, watch the
 *        cook → bundle → copy run, then reveal the output. Web is the live target;
 *        WeChat/Playable/Native are shown disabled (the engine has those wasm
 *        targets, but the project export only wires Web today).
 */
import { useState, useSyncExternalStore } from 'react';
import { Loader2, FolderOpen, CheckCircle2, AlertCircle, Boxes } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { ProjectStore } from '@/project/ProjectStore';
import { useEditorStore } from '@/store/editorStore';

type Phase = 'idle' | 'running' | 'done' | 'error';
type Config = 'development' | 'shipping';
interface Result {
  ok: boolean;
  outDir: string;
  included: number;
  warnings: string[];
  errors: string[];
}

const PLATFORMS = [
  { id: 'web', label: 'Web', ready: true },
  { id: 'desktop', label: 'Desktop', ready: true },
  { id: 'wechat', label: 'WeChat', ready: false },
  { id: 'playable', label: 'Playable', ready: false },
] as const;

type Platform = 'web' | 'desktop';

export function BuildDialog() {
  const close = () => useEditorStore.getState().setBuildOpen(false);
  const project = useSyncExternalStore(ProjectStore.subscribe, ProjectStore.getSnapshot);

  const [platform, setPlatform] = useState<Platform>('web');
  const [config, setConfig] = useState<Config>('shipping');
  const [outDir, setOutDir] = useState('dist-game');
  const [openFolder, setOpenFolder] = useState(true);
  const [sourceMaps, setSourceMaps] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<Result | null>(null);

  const running = phase === 'running';

  const browse = async () => {
    const dir = await window.estella.project?.chooseDirectory?.();
    if (dir) setOutDir(dir);
  };

  const build = async () => {
    setPhase('running');
    setResult(null);
    try {
      const res = (await ProjectStore.exportGame({
        platform,
        outDir,
        minify: config === 'shipping',
        sourcemap: sourceMaps,
      })) as Result | null;
      if (!res) {
        setResult({ ok: false, outDir, included: 0, warnings: [], errors: ['no project open'] });
        setPhase('error');
        return;
      }
      setResult(res);
      setPhase(res.ok ? 'done' : 'error');
      if (res.ok && openFolder) void window.estella.shell?.openPath?.(res.outDir);
    } catch (err) {
      setResult({ ok: false, outDir, included: 0, warnings: [], errors: [err instanceof Error ? err.message : String(err)] });
      setPhase('error');
    }
  };

  const footer = (
    <>
      <button type="button" className="btn-soft" onClick={close} disabled={running}>
        {phase === 'done' ? 'Close' : 'Cancel'}
      </button>
      <button type="button" className="btn-soft is-primary" onClick={() => void build()} disabled={running || !project}>
        {running ? (
          <>
            <Loader2 size={14} className="spin" /> Building…
          </>
        ) : (
          <>
            <Boxes size={14} /> Build
          </>
        )}
      </button>
    </>
  );

  return (
    <Modal title="Package Project" onClose={running ? () => {} : close} footer={footer} width={500}>
      <div className="build">
        <div className="build__label">Platform</div>
        <div className="build__platforms">
          {PLATFORMS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`build__plat${platform === p.id ? ' on' : ''}`}
              disabled={!p.ready}
              aria-pressed={platform === p.id}
              title={p.ready ? p.label : 'Coming soon'}
              onClick={() => p.ready && setPlatform(p.id as Platform)}
            >
              {p.label}
              {!p.ready && <span className="soon">soon</span>}
            </button>
          ))}
        </div>

        <div className="build__row">
          <span className="build__label">Configuration</span>
          <div className="build__seg">
            <button type="button" className={config === 'development' ? 'on' : ''} onClick={() => setConfig('development')}>
              Development
            </button>
            <button type="button" className={config === 'shipping' ? 'on' : ''} onClick={() => setConfig('shipping')}>
              Shipping
            </button>
          </div>
        </div>

        <div className="build__row">
          <span className="build__label">Output</span>
          <div className="build__out">
            <input value={outDir} spellCheck={false} onChange={(e) => setOutDir(e.target.value)} />
            <button type="button" className="btn-soft" onClick={() => void browse()}>
              <FolderOpen size={13} /> Browse
            </button>
          </div>
        </div>

        <label className="build__opt">
          <input type="checkbox" checked={openFolder} onChange={(e) => setOpenFolder(e.target.checked)} />
          Open output folder when done
        </label>
        <label className="build__opt">
          <input type="checkbox" checked={sourceMaps} onChange={(e) => setSourceMaps(e.target.checked)} />
          Include source maps
        </label>

        <div className="build__summary">
          Entry: <strong>{project?.defaultScene ?? '—'}</strong>
        </div>

        {phase !== 'idle' && (
          <div className={`build__status ${phase}`}>
            {phase === 'running' && (
              <span className="build__status-line">
                <Loader2 size={14} className="spin" /> Cooking assets, bundling the game host…
              </span>
            )}
            {phase === 'done' && result && (
              <span className="build__status-line">
                <CheckCircle2 size={14} /> Built {result.included} assets → {result.outDir}
              </span>
            )}
            {phase === 'error' && result && (
              <span className="build__status-line">
                <AlertCircle size={14} /> {result.errors[0] ?? 'Build failed'}
              </span>
            )}
            {result && result.warnings.length > 0 && (
              <div className="build__warn">{result.warnings.length} warning(s): {result.warnings[0]}</div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
