// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024-present ESEngine Team
/**
 * @file    AgentDrawer.tsx
 * @brief   The conversation with the built-in agent, rendered from AgentStore's
 *          projection of what main is doing.
 *
 * Three decisions carried over from the design, because they are what make this
 * different from a chat panel bolted onto an editor:
 *
 *   A RUN IS THE UNIT.  Each turn gets its own header — what was asked, and the
 *   numbers you actually check afterwards. Only the run you are IN sticks; every
 *   past header sticking would stack into a pile the moment there are three.
 *   Finished runs fold to that header, because the stat line already IS the
 *   summary and the transcript below is the evidence for it.
 *
 *   DECISIONS ARE PASSAGES, NOT DIALOGS.  A modal would steal focus while you
 *   are watching the viewport for the result. A confirmation is a passage in the
 *   transcript with a rule above and below and a coloured edge — and the path it
 *   wants to write is never truncated, because approving a write to a file whose
 *   name has been hidden is the one thing this interaction must not do.
 *
 *   COLOUR MEANS SOMETHING.  Green added, red failed, amber needs you. Nothing
 *   is tinted for belonging to the agent.
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  X, Plus, PanelRight, ArrowUp, Square, ChevronRight, ChevronDown, Check, TriangleAlert,
  Loader, Copy, Pencil, Eye, KeyRound, Boxes, Stethoscope, Image as ImageIcon,
} from 'lucide-react';
import { useEditorStore } from '@/store/editorStore';
import {
  useAgent, sendAgentMessage, stopAgentTurn, confirmAgentCall, resetAgentSession,
  peekEntities, entitiesInInput, effectiveSelection, selectAgentModel,
  type AgentTurn, type AgentEntry, type AgentToolEntry,
} from '@/store/AgentStore';
import {
  agentProviders, agentProvider, agentKeyId, parseModelList, subscribeProviders, providersRevision,
} from '@/agent/providers';
import { secretStatus, subscribeSecrets, secretRevision } from '@/store/SecretStore';
import { useSettings } from '@/store/settingsStore';
import { t } from '@/i18n';

const TOOL_ICON: Record<string, typeof Eye> = {
  read: Eye,
  undoable: Pencil,
  irreversible: TriangleAlert,
};

function ToolRow({ entry, onConfirm }: { entry: AgentToolEntry; onConfirm: (allow: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const Icon = TOOL_ICON[entry.effect ?? 'read'] ?? Eye;
  const arg = summarizeInput(entry.input);
  const touches = entitiesInInput(entry.input);
  return (
    <>
      <div
        className={`ag-call ag-call--${entry.state}`}
        onMouseEnter={() => touches.length && peekEntities(touches)}
        onMouseLeave={() => touches.length && peekEntities([])}
      >
        <button type="button" className="ag-call-top" onClick={() => setOpen((o) => !o)}>
          <span className="ag-call-g"><Icon size={13} strokeWidth={1.8} /></span>
          <span className="ag-call-nm">{entry.name}</span>
          <span className="ag-call-arg">{arg}</span>
          <span className="ag-call-out">
            {entry.state === 'queued' && t('agent.queued')}
            {entry.state === 'running' && <Loader size={11} className="ag-spin" />}
            {entry.state === 'awaiting' && <TriangleAlert size={11} />}
            {entry.state === 'stopped' && t('agent.stopped')}
            {entry.state === 'declined' && t('agent.declined')}
            {(entry.state === 'ok' || entry.state === 'error') && entry.summary}
          </span>
        </button>
        {open && entry.summary && <div className="ag-call-detail">{entry.summary}</div>}
      </div>
      {entry.state === 'awaiting' && <ConfirmPassage entry={entry} onConfirm={onConfirm} />}
    </>
  );
}

/**
 * The one thing the agent cannot do without you. Scrolled into view
 * unconditionally when it appears — a question you never saw is a turn that
 * looks hung.
 */
function ConfirmPassage({ entry, onConfirm }: { entry: AgentToolEntry; onConfirm: (allow: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const target = describeTarget(entry.input);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'nearest' });
  }, []);
  return (
    <div ref={ref} className="ag-ask ag-ask--confirm">
      <span className="ag-ask-g"><TriangleAlert size={16} strokeWidth={1.8} /></span>
      <span className="ag-ask-hd">{t('agent.confirm.title', { tool: entry.name })}</span>
      <div className="ag-ask-d">
        {entry.reason === 'arbitrary_code'
          ? t('agent.confirm.why.arbitrary_code')
          : t('agent.confirm.why.irreversible')}
      </div>
      {/* Never truncated, and it wraps rather than scrolls: this is the whole
          basis on which someone says yes. Absent when the call names no target —
          echoing the tool name back is noise, and the heading already said it. */}
      {target && <div className="ag-ask-tgt">{target}</div>}
      <div className="ag-ask-acts">
        <button type="button" className="ag-go" onClick={() => onConfirm(true)}>{t('agent.confirm.allow')}</button>
        <button type="button" onClick={() => onConfirm(false)}>{t('agent.confirm.deny')}</button>
      </div>
    </div>
  );
}

function Thinking({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`ag-think${open ? ' open' : ''}`}>
      <button type="button" className="ag-think-t" onClick={() => setOpen((o) => !o)}>
        <ChevronRight size={10} strokeWidth={2} className="ag-car" />
        <span>{t('agent.thinking')}</span>
      </button>
      {open && <div className="ag-think-body">{text}</div>}
    </div>
  );
}

function Prose({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="ag-say">
      {text}
      <button
        type="button"
        className="ag-say-copy"
        title={t('agent.copy')}
        onClick={() => {
          void navigator.clipboard?.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 900);
        }}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
    </div>
  );
}

/** Consecutive tool rows are one hairline-divided block; prose breaks the run. */
function Entries({ entries, onConfirm }: {
  entries: readonly AgentEntry[];
  onConfirm: (callId: string, allow: boolean) => void;
}) {
  const out: React.ReactNode[] = [];
  let run: AgentToolEntry[] = [];
  const flush = () => {
    if (run.length === 0) return;
    const group = run;
    run = [];
    out.push(
      <div className="ag-steps" key={`steps-${group[0].id}`}>
        {group.map((tool) => (
          <ToolRow key={tool.id} entry={tool} onConfirm={(allow) => onConfirm(tool.id, allow)} />
        ))}
      </div>,
    );
  };
  entries.forEach((entry, i) => {
    if (entry.kind === 'tool') {
      run.push(entry);
      return;
    }
    flush();
    if (entry.kind === 'error') {
      out.push(
        <div className="ag-ask ag-ask--fail" key={i}>
          <span className="ag-ask-g"><TriangleAlert size={16} strokeWidth={1.8} /></span>
          <span className="ag-ask-hd">{entry.message}</span>
        </div>,
      );
    } else if (entry.kind === 'thinking') out.push(<Thinking key={i} text={entry.text} />);
    else out.push(<Prose key={i} text={entry.text} />);
  });
  flush();
  return <>{out}</>;
}

/** Waiting on the first token: a shimmer, not a spinner — it says how much is
 *  coming, and a spinner in a text column says only "something". */
function Skeleton() {
  return (
    <div className="ag-wait">
      <div className="ag-wait-t"><span className="ag-dots"><i /><i /><i /></span>{t('agent.waiting')}</div>
      <div className="ag-skel" /><div className="ag-skel s2" /><div className="ag-skel s3" />
    </div>
  );
}

function Turn({ turn, isLast, running }: { turn: AgentTurn; isLast: boolean; running: boolean }) {
  // Past runs arrive folded; the one you are in stays open. Local state so the
  // user's own fold survives the next event landing in the store.
  const [folded, setFolded] = useState(!isLast);
  useEffect(() => {
    if (isLast) setFolded(false);
  }, [isLast]);

  const tokens = turn.inputTokens + turn.outputTokens;
  const empty = turn.entries.length === 0;
  return (
    <div className={`ag-turn${folded ? ' folded' : ''}${isLast ? ' current' : ''}`}>
      <button type="button" className="ag-th" onClick={() => setFolded((f) => !f)}>
        <span className="ag-hrow">
          <ChevronRight size={12} strokeWidth={2} className="ag-fold" />
          <span className="ag-req">{turn.prompt}</span>
        </span>
        <span className="ag-stat">
          {tokens > 0 && <span>↑{compact(turn.inputTokens)} ↓{compact(turn.outputTokens)}</span>}
          <span className="ag-sp" />
          {turn.reason === 'aborted' && <span className="ag-warn">{t('agent.turn.aborted')}</span>}
          {turn.reason === 'refusal' && <span className="ag-warn">{t('agent.turn.refusal')}</span>}
          {turn.steps > 0 && <span className="ag-add">{t('agent.checkpoint.steps', { count: turn.steps })}</span>}
        </span>
      </button>
      {!folded && (
        <div className="ag-tb">
          {empty && running && isLast ? <Skeleton /> : (
            <Entries entries={turn.entries} onConfirm={confirmAgentCall} />
          )}
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  const ready = useAgent((s) => s.status.ready);
  const openSettings = useEditorStore((s) => s.openSettings);
  if (!ready) {
    return (
      <div className="ag-empty">
        <KeyRound size={30} strokeWidth={1.2} className="ag-empty-mark" />
        <h4>{t('agent.nokey.title')}</h4>
        <p>{t('agent.nokey.body')}</p>
        <button type="button" className="ag-setup" onClick={() => openSettings('agents')}>
          <KeyRound size={13} strokeWidth={2} />{t('agent.nokey.action')}
        </button>
      </div>
    );
  }
  const suggestions = [
    { Icon: Boxes, text: t('agent.empty.sug1'), hint: t('agent.empty.sug1.h') },
    { Icon: Stethoscope, text: t('agent.empty.sug2'), hint: t('agent.empty.sug2.h') },
    { Icon: ImageIcon, text: t('agent.empty.sug3'), hint: t('agent.empty.sug3.h') },
  ];
  return (
    <div className="ag-empty">
      <h4>{t('agent.empty.title')}</h4>
      <p>{t('agent.empty.body')}</p>
      <div className="ag-sugs">
        {suggestions.map((s) => (
          <button type="button" className="ag-sug" key={s.text} onClick={() => void sendAgentMessage(s.text)}>
            <s.Icon size={14} strokeWidth={1.8} />
            <span>{s.text}<span className="ag-sug-h">{s.hint}</span></span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Which model the next message runs on, next to the box you type it in — a
 * per-message decision (cheap and quick to rename a thing, strong to build one),
 * not a preference buried two dialogs away.
 *
 * Providers with no key are still listed, greyed, and lead to Settings: "you
 * could use this, here is what is missing" beats hiding it and leaving the user
 * to wonder whether the editor supports their provider at all.
 */
function ModelPicker() {
  const [open, setOpen] = useState(false);
  const picked = useAgent((s) => s.selection);
  useAgent((s) => s.status.ready);
  useSyncExternalStore(subscribeSecrets, () => secretRevision());
  useSyncExternalStore(subscribeProviders, providersRevision);
  const providers = agentProviders();
  const current = effectiveSelection();

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  void picked;

  return (
    <div className="ag-picker" onMouseDown={(e) => e.stopPropagation()}>
      <button type="button" className="ag-picker-btn" onClick={() => setOpen((o) => !o)}>
        {current?.model ?? t('agent.picker.none')}
        <ChevronDown size={11} strokeWidth={2} />
      </button>
      {open && (
        <div className="ag-picker-menu">
          {providers.map((p) => {
            const def = resolveProviderModels(p.id);
            const keyed = secretStatus(agentKeyId(p.id))?.configured === true;
            if (def.models.length === 0 && !def.label) return null;
            return (
              <div className="ag-picker-grp" key={p.id}>
                <div className="ag-picker-h">
                  {def.label}
                  {!keyed && <span className="ag-picker-nokey">{t('agent.picker.noKey')}</span>}
                </div>
                {def.models.length === 0 && (
                  <button type="button" className="ag-picker-it empty" onClick={() => openAgentSettings()}>
                    {t('agent.picker.configure')}
                  </button>
                )}
                {def.models.map((m) => (
                  <button
                    type="button"
                    key={m}
                    className={`ag-picker-it${current?.model === m && current.providerId === p.id ? ' on' : ''}${keyed ? '' : ' locked'}`}
                    onClick={() => {
                      setOpen(false);
                      if (keyed) selectAgentModel(p.id, m);
                      else openAgentSettings();
                    }}
                  >
                    {m}
                    {current?.model === m && current.providerId === p.id && <Check size={12} strokeWidth={2.2} />}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const openAgentSettings = () => useEditorStore.getState().openSettings('agents');

/** The custom provider's list comes from settings; the rest ship theirs. */
function resolveProviderModels(id: string): { label: string; models: readonly string[] } {
  const def = agentProvider(id);
  if (!def) return { label: '', models: [] };
  if (def.userDefined) {
    return {
      label: t('agent.picker.custom'),
      models: parseModelList(String(useSettings.getState().getValue('agents.customModels') ?? '')),
    };
  }
  return { label: def.label, models: def.models };
}

function Compose() {
  const status = useAgent((s) => s.status);
  const [draft, setDraft] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const busy = status.phase !== 'idle';

  const autosize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(112, el.scrollHeight)}px`;
  };

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    requestAnimationFrame(autosize);
    void sendAgentMessage(text);
  };

  return (
    <div className={`ag-compose${busy ? ' busy' : ''}`}>
      <div className="ag-cbox">
        <textarea
          ref={ref}
          rows={1}
          value={draft}
          placeholder={busy ? t('agent.compose.busy') : t('agent.compose')}
          aria-label={t('agent.compose')}
          onChange={(e) => { setDraft(e.target.value); autosize(); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <ModelPicker />
        <button
          type="button"
          className="ag-send"
          title={busy ? t('agent.stop') : t('agent.send')}
          aria-label={busy ? t('agent.stop') : t('agent.send')}
          onClick={() => (busy ? stopAgentTurn() : submit())}
        >
          {busy ? <Square size={12} strokeWidth={2.4} /> : <ArrowUp size={14} strokeWidth={2.2} />}
        </button>
      </div>
      <div className="ag-chint">
        <span><b>⏎</b> {t('agent.hint.send')}</span>
        <span><b>⇧⏎</b> {t('agent.hint.newline')}</span>
        <span><b>Esc</b> {t('agent.hint.close')}</span>
      </div>
    </div>
  );
}

export function AgentDrawer() {
  const open = useEditorStore((s) => s.agentDrawer);
  const pinned = useEditorStore((s) => s.agentDrawerPinned);
  const setOpen = useEditorStore((s) => s.setAgentDrawer);
  const setPinned = useEditorStore((s) => s.setAgentDrawerPinned);
  const turns = useAgent((s) => s.turns);
  const status = useAgent((s) => s.status);
  const logRef = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);

  useEffect(() => {
    if (!open || pinned) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, pinned, setOpen]);

  // Follow the tail only while the reader is already at it — yanking someone
  // back down while they read an earlier tool result is the classic log-view bug.
  useLayoutEffect(() => {
    const el = logRef.current;
    if (el && stuck.current) el.scrollTop = el.scrollHeight;
  }, [turns]);

  if (!open) return null;

  const body = (
    <div className="ag-drawer" onMouseDown={(e) => e.stopPropagation()}>
      <div className="ag-head">
        <span className="ag-ttl">{t('agent.title')}</span>
        <span className="ag-sp" />
        <button type="button" title={t('agent.newConversation')} onClick={() => void resetAgentSession()}>
          <Plus size={14} strokeWidth={2} />
        </button>
        <button
          type="button"
          className={pinned ? 'on' : undefined}
          title={t('agent.pin')}
          onClick={() => setPinned(!pinned)}
        >
          <PanelRight size={14} strokeWidth={1.9} />
        </button>
        <button type="button" title={t('agent.close')} onClick={() => setOpen(false)}>
          <X size={14} strokeWidth={2} />
        </button>
      </div>

      <div
        className="ag-log"
        ref={logRef}
        role="log"
        aria-live="polite"
        onScroll={(e) => {
          const el = e.currentTarget;
          stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        {turns.length === 0
          ? <EmptyState />
          : turns.map((turn, i) => (
            <Turn key={turn.id} turn={turn} isLast={i === turns.length - 1} running={status.phase !== 'idle'} />
          ))}
      </div>

      {status.error && <div className="ag-banner">{status.error}</div>}
      <Compose />
    </div>
  );

  // Pinned it is a fourth column; floating it dims what is behind, because then
  // it is the thing you are doing.
  if (pinned) return <div className="ag-column">{body}</div>;
  return (
    <div className="ag-scrim open" onMouseDown={() => setOpen(false)}>
      {body}
    </div>
  );
}

const compact = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

/** One line of the call's arguments — enough to tell two calls apart. */
function summarizeInput(input: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (value === null || value === undefined) continue;
    const text = typeof value === 'object' ? Array.isArray(value) ? `${value.length}` : '…' : String(value);
    parts.push(text.length > 28 ? `${key}=${text.slice(0, 27)}…` : `${key}=${text}`);
    if (parts.length === 3) break;
  }
  return parts.join(' ');
}

/** What an irreversible call is about to touch, in full. See ConfirmPassage. */
function describeTarget(input: Record<string, unknown>): string {
  for (const key of ['path', 'file', 'dest', 'code', 'command']) {
    const value = input[key];
    if (typeof value === 'string' && value) return value;
  }
  return Object.entries(input)
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join('\n');
}
