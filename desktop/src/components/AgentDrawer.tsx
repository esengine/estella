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
  Loader, Copy, Pencil, Eye, KeyRound, Boxes, Stethoscope, Image as ImageIcon, RotateCcw,
  File as FileIcon,
} from 'lucide-react';
import { useEditorStore } from '@/store/editorStore';
import {
  useAgent, sendAgentMessage, stopAgentTurn, confirmAgentCall, resetAgentSession,
  peekEntities, entitiesInInput, effectiveSelection, selectAgentModel, retryAgentTurn,
  type AgentTurn, type AgentEntry, type AgentToolEntry, type AgentProseEntry,
} from '@/store/AgentStore';
import type { ConfirmAnswer } from '../../electron/agent/types';
import {
  agentProviders, agentProvider, agentKeyId, parseModelList, subscribeProviders, providersRevision,
} from '@/agent/providers';
import { secretStatus, subscribeSecrets, secretRevision } from '@/store/SecretStore';
import { useSettings } from '@/store/settingsStore';
import { MarkdownView } from '@/components/MarkdownView';
import { AgentMark } from '@/components/AgentMark';
import { dockApi } from '@/layout/dockApi';
import { EditorHistory, type HistoryMark } from '@/engine/EditorHistory';
import { useSelection } from '@/store/selectionStore';
import { EditorControlSurface } from '@/engine/EditorSession';
import { ProjectStore } from '@/project/ProjectStore';
import { t } from '@/i18n';

const TOOL_ICON: Record<string, typeof Eye> = {
  read: Eye,
  undoable: Pencil,
  irreversible: TriangleAlert,
};

function ToolRow({ entry, onConfirm }: { entry: AgentToolEntry; onConfirm: (answer: ConfirmAnswer) => void }) {
  const [open, setOpen] = useState(false);
  const Icon = TOOL_ICON[entry.effect ?? 'read'] ?? Eye;
  // While the model is writing them, show the raw text arriving; once the call
  // is complete, the tidied summary. The switch is the point at which there is
  // something better to show, not a timer.
  const composing = entry.state === 'queued' && entry.argText !== '' && !hasInput(entry.input);
  const arg = composing ? entry.argText : summarizeInput(entry.input);
  const touches = entitiesInInput(entry.input);
  return (
    <>
      <div
        className={`ag-call ag-call--${entry.state} ag-call-e--${entry.effect ?? 'read'}`}
        onMouseEnter={() => touches.length && peekEntities(touches)}
        onMouseLeave={() => touches.length && peekEntities([])}
      >
        <button type="button" className="ag-call-top" onClick={() => setOpen((o) => !o)}>
          <span className="ag-call-g"><Icon size={13} strokeWidth={1.8} /></span>
          <span className="ag-call-nm">{entry.name}</span>
          <span className="ag-call-arg">{arg}{composing && <span className="ag-arg-caret" />}</span>
          <span className="ag-call-out">
            {entry.state === 'queued' && t('agent.queued')}
            {entry.state === 'running' && <Loader size={11} className="ag-spin" />}
            {entry.state === 'awaiting' && <TriangleAlert size={11} />}
            {entry.state === 'stopped' && t('agent.stopped')}
            {entry.state === 'declined' && t('agent.declined')}
            {(entry.state === 'ok' || entry.state === 'error') && entry.brief}
          </span>
        </button>
        {/* What the agent looked at, shown without asking: a screenshot row that
            hides its screenshot is a row you have to click to learn anything from. */}
        {entry.image && <img className="ag-shot" src={entry.image} alt={entry.name} />}
        {entry.summary && (
          <Fold open={open}><div className="ag-call-detail">{entry.summary}</div></Fold>
        )}
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
function ConfirmPassage({ entry, onConfirm }: { entry: AgentToolEntry; onConfirm: (answer: ConfirmAnswer) => void }) {
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
        <button type="button" className="ag-go" onClick={() => onConfirm('once')}>{t('agent.confirm.allow')}</button>
        {/* A task that saves eleven files should be one decision, not eleven
            identical ones — a gate that interrupts that often is one people
            learn to click through. Scoped to this run, and says so. */}
        <button
          type="button"
          onClick={() => onConfirm('turn')}
          title={t('agent.confirm.allowTurn.why', { tool: entry.name })}
        >
          {t('agent.confirm.allowTurn')}
        </button>
        <button type="button" onClick={() => onConfirm('no')}>{t('agent.confirm.deny')}</button>
      </div>
    </div>
  );
}

/**
 * Everything that folds does it by animating a grid row from 0fr to 1fr.
 *
 * Once opened it stays MOUNTED, because unmounting is the cheaper thing to write
 * and the wrong thing to see: a panel that reappears instantly reads as a jump
 * cut, and one that had been scrolled inside loses that on every toggle.
 *
 * Until then it holds nothing. A conversation carries every run it ever had, and
 * mounting the body of each so it could animate open — when most are folded and
 * will never be opened — is paying for all of them to get the animation on one.
 */
function Fold({ open, children }: { open: boolean; children: React.ReactNode }) {
  const [everOpen, setEverOpen] = useState(open);
  useEffect(() => { if (open) setEverOpen(true); }, [open]);
  return (
    <div className={`ag-fold-w${open ? ' open' : ''}`}>
      <div className="ag-fold-i">{everOpen ? children : null}</div>
    </div>
  );
}

function Thinking({ entry }: { entry: AgentProseEntry }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`ag-think${open ? ' open' : ''}`}>
      <button type="button" className="ag-think-t" onClick={() => setOpen((o) => !o)}>
        <ChevronRight size={10} strokeWidth={2} className="ag-car" />
        <span>{t('agent.thinking')}</span>
        {/* How long it thought. The reader is already measuring this silence;
            saying it is the difference between "working" and "stuck". */}
        <Elapsed from={entry.startedAt} to={entry.endedAt} className="ag-think-el" />
      </button>
      <Fold open={open}><div className="ag-think-body">{entry.text}</div></Fold>
    </div>
  );
}

function Prose({ text, streaming, onRerun }: { text: string; streaming?: boolean; onRerun?: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="ag-say">
      {/* The caret rides the tail of the text itself — see MarkdownView. */}
      <MarkdownView text={text} entity={entityByName} caret={streaming} />
      {/* On the answer rather than only on the run header: a reply you disagree
          with is the thing you are looking at when you decide to ask again. */}
      <span className="ag-say-acts">
        <button
          type="button"
          title={t('agent.copy')}
          onClick={() => {
            void navigator.clipboard?.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 900);
          }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
        </button>
        {onRerun && (
          <button type="button" title={t('agent.rerun')} onClick={onRerun}>
            <RotateCcw size={12} strokeWidth={1.9} />
          </button>
        )}
      </span>
    </div>
  );
}

/** Consecutive tool rows are one hairline-divided block; prose breaks the run. */
function Entries({ entries, onConfirm, streaming, onRerun }: {
  entries: readonly AgentEntry[];
  onConfirm: (callId: string, answer: ConfirmAnswer) => void;
  /** The run is still taking events, so the last entry is mid-write. */
  streaming?: boolean;
  /** Ask this run again. Absent while one is running — see Turn. */
  onRerun?: () => void;
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
          <ToolRow key={tool.id} entry={tool} onConfirm={(answer) => onConfirm(tool.id, answer)} />
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
    } else if (entry.kind === 'thinking') out.push(<Thinking key={i} entry={entry} />);
    else out.push(<Prose key={i} text={entry.text} streaming={streaming && i === entries.length - 1} onRerun={onRerun} />);
  });
  flush();
  return <>{out}</>;
}

/** Every row has reported; nothing is in flight but the next model call. */
const lastIsSettled = (entries: readonly AgentEntry[]): boolean => {
  const last = entries[entries.length - 1];
  return last?.kind === 'tool' && (last.state === 'ok' || last.state === 'error' || last.state === 'declined');
};

function Waiting() {
  return (
    <div className="ag-wait-t">
      <span className="ag-dots"><i /><i /><i /></span>
      {t('agent.waiting')}
    </div>
  );
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

/**
 * What the turn actually changed — the work product of a run, so it gets
 * first-class presentation rather than a popover hung off the undo bar.
 *
 * Read from EditorHistory rather than from the tool calls: the calls say what
 * was ASKED for, and the history says what the scene now differs by. Steps that
 * declared nothing contribute nothing, so this is a floor — which is why an
 * empty one renders nothing at all rather than "no changes".
 */
function ChangeSet({ turn, until }: { turn: AgentTurn; until: HistoryMark | null }) {
  const [open, setOpen] = useState(true);
  useSyncExternalStore(EditorHistory.subscribe, EditorHistory.getVersion);
  const mark = turn.mark as HistoryMark | null;
  const changes = mark ? EditorHistory.changesSince(mark, until) : [];
  const counts = changeCounts(turn, until);
  if (!counts) return null;
  return (
    <div className={`ag-changes${open ? ' open' : ''}`}>
      <button type="button" className="ag-changes-h" onClick={() => setOpen((o) => !o)}>
        <ChevronRight size={11} strokeWidth={2} className="ag-car" />
        <span className="ag-changes-t">{t('agent.changes')}</span>
        <span className="ag-sp" />
        {counts.add > 0 && <span className="ag-add">+{counts.add}</span>}
        {counts.modify > 0 && <span className="ag-mod">~{counts.modify}</span>}
        {counts.remove > 0 && <span className="ag-del">−{counts.remove}</span>}
      </button>
      <Fold open={open}>
        <div className="ag-changes-l">
          {changes.map((c, i) => (
            <div
              className={`ag-chg ag-chg--${c.kind}`}
              key={i}
              onMouseEnter={() => peekEntities([c.entity])}
              onMouseLeave={() => peekEntities([])}
              onClick={() => useSelection.getState().select(c.entity)}
            >
              <span className="ag-chg-s">{c.kind === 'add' ? '+' : c.kind === 'remove' ? '−' : '~'}</span>
              <span className="ag-chg-p">
                {c.name}
                {c.component && <span className="ag-chg-d"> · {c.component}</span>}
                {c.field && <span className="ag-chg-d">{c.component ? '.' : ' · '}{c.field}</span>}
              </span>
              {c.kind === 'modify' && (c.before !== undefined || c.after !== undefined) && (
                <span className="ag-chg-v">
                  <span className="ag-del">{brief(c.before)}</span>
                  <span className="ag-chg-arrow">→</span>
                  <span className="ag-add">{brief(c.after)}</span>
                </span>
              )}
            </div>
          ))}
        </div>
      </Fold>
    </div>
  );
}

/**
 * Counts for the turn header: what THIS run left behind, in one glance.
 *
 * Bounded above by where the next run started. Without that bound an older run
 * reports everything that happened after it — the runs that followed, and the
 * edits the person made in between — so its header would keep growing while it
 * sat there finished.
 */
function changeCounts(turn: AgentTurn, until: HistoryMark | null): { add: number; modify: number; remove: number } | null {
  const mark = turn.mark as HistoryMark | null;
  const changes = mark ? EditorHistory.changesSince(mark, until) : [];
  if (changes.length === 0) return null;
  return {
    add: changes.filter((c) => c.kind === 'add').length,
    modify: changes.filter((c) => c.kind === 'modify').length,
    remove: changes.filter((c) => c.kind === 'remove').length,
  };
}

/** A field value in one cell. Long values are cut — the row is a summary, and
 *  the field itself is one click away in Details. */
function brief(value: unknown): string {
  if (value === undefined) return '—';
  if (value === null) return 'null';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return text.length > 22 ? `${text.slice(0, 21)}…` : text;
}

/** Ticks while it runs, then freezes at what it took. A turn that takes two
 *  minutes should say so as it happens, not only afterwards. */
function Elapsed({ from, to, className }: { from: number; to: number | null; className?: string }) {
  const [now, setNow] = useState(() => Date.now());
  const live = to === null;
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [live]);
  const ms = (to ?? now) - from;
  return <span className={`${className ?? ''}${live ? ' ag-live' : ''}`.trim()}>{formatElapsed(ms)}</span>;
}

function Turn({ turn, isLast, running, until }: {
  turn: AgentTurn;
  isLast: boolean;
  running: boolean;
  /** Where the NEXT run started, so this one counts only its own steps. */
  until: HistoryMark | null;
}) {
  // A finished run folds to its header: the stat line already IS the summary, so
  // the body becomes detail you ask for rather than detail you scroll past.
  // Keyed on isLast changing, which is the moment a run becomes history — after
  // that the fold is the user's, and re-opening one stays open.
  const [folded, setFolded] = useState(!isLast);
  useEffect(() => { setFolded(!isLast); }, [isLast]);

  useSyncExternalStore(EditorHistory.subscribe, EditorHistory.getVersion);
  const tokens = turn.inputTokens + turn.outputTokens;
  const counts = changeCounts(turn, until);
  const empty = turn.entries.length === 0;
  return (
    <div className={`ag-turn${folded ? ' folded' : ''}${isLast ? ' current' : ''}`}>
      <button type="button" className="ag-th" onClick={() => setFolded((f) => !f)}>
        <span className="ag-hrow">
          <ChevronRight size={12} strokeWidth={2} className="ag-fold" />
          <span className="ag-req">{turn.prompt}</span>
          {/* A bad answer three turns in should cost you that answer, not the
              whole conversation that led to it. */}
          {!running && (
            <span
              role="button"
              tabIndex={0}
              className="ag-rerun"
              title={t('agent.rerun')}
              onClick={(e) => { e.stopPropagation(); void retryAgentTurn(turn.id); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); void retryAgentTurn(turn.id); } }}
            >
              <RotateCcw size={12} strokeWidth={1.9} />
            </span>
          )}
        </span>
        <span className="ag-stat">
          {/* Which model answered THIS run. A conversation can switch between
              them, and the composer's picker only ever says what is next. */}
          {turn.model && <span className="ag-stat-model">{turn.model}</span>}
          <span className="ag-sp" />
          <Elapsed from={turn.startedAt} to={turn.endedAt} />
          {tokens > 0 && <span>↑{compact(turn.inputTokens)} ↓{compact(turn.outputTokens)}</span>}
          {turn.reason === 'aborted' && <span className="ag-warn">{t('agent.turn.aborted')}</span>}
          {turn.reason === 'refusal' && <span className="ag-warn">{t('agent.turn.refusal')}</span>}
          {/* What the run left in the scene — the number the summary is actually
              about, which is why it reads here and not only inside the fold. */}
          {counts && (
            <span className="ag-stat-chg">
              {counts.add > 0 && <span className="ag-add">+{counts.add}</span>}
              {counts.modify > 0 && <span className="ag-mod">~{counts.modify}</span>}
              {counts.remove > 0 && <span className="ag-del">−{counts.remove}</span>}
            </span>
          )}
        </span>
      </button>
      <Fold open={!folded}>
        <div className="ag-tb">
          {empty && running && isLast ? <Skeleton /> : (
            <Entries
              entries={turn.entries}
              onConfirm={confirmAgentCall}
              streaming={running && isLast}
              onRerun={running ? undefined : () => void retryAgentTurn(turn.id)}
            />
          )}
          {/* Between rounds: the last thing that happened was a tool result and
              the model is being asked again. Without this the transcript looks
              finished while a request is in flight. */}
          {running && isLast && turn.entries.length > 0 && lastIsSettled(turn.entries) && <Waiting />}
          {/* How the run ENDED, where the run is — the header's badge survives
              folding, and this says the part that needs a sentence: a stopped
              turn keeps whatever it already did, which is the question anyone
              who just pressed Stop is asking. */}
          {turn.reason === 'aborted' && <div className="ag-sys">{t('agent.turn.aborted.note')}</div>}
          {turn.reason === 'refusal' && <div className="ag-sys">{t('agent.turn.refusal.note')}</div>}
          {turn.reason !== null && <ChangeSet turn={turn} until={until} />}
        </div>
      </Fold>
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
      <AgentMark size={34} />
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

/** One thing `@` can name: something in the scene, or something on disk. */
interface Mention {
  key: string;
  /** What gets typed. An asset goes in as its path — that is what the tools take. */
  insert: string;
  label: string;
  /** Entities light up in the Outliner and the viewport when hovered. */
  entity: number | null;
  detail: string;
}

/**
 * What `@` offers for `query`, entities first.
 *
 * Assets belong here as much as entities do: half of what gets asked for names
 * a texture or a prefab ("use @panel_9slice.png for the buttons"), and without
 * them the alternative is typing a path from memory and hoping it is right.
 */
function mentionMatches(query: string): Mention[] {
  const q = query.toLowerCase();
  const entities: Mention[] = EditorControlSurface.getSceneTree()
    .filter((n) => !q || n.name.toLowerCase().includes(q))
    .slice(0, 24)
    .map((n) => ({ key: `e${n.id}`, insert: n.name, label: n.name, entity: n.id, detail: String(n.id) }));

  const assets: Mention[] = ProjectStore.listAssets()
    .filter((a) => !q || a.name.toLowerCase().includes(q) || a.path.toLowerCase().includes(q))
    .slice(0, 16)
    .map((a) => ({ key: `a${a.ref}`, insert: a.path, label: a.name, entity: null, detail: a.type }));

  return [...entities, ...assets];
}

function Compose() {
  const status = useAgent((s) => s.status);
  const [draft, setDraft] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const busy = status.phase !== 'idle';
  // `@` opens a picker over the scene tree. Read at open time rather than
  // subscribed: it is a menu, and a list reordering under the arrow keys is a
  // menu that picks something other than what was highlighted.
  const [mention, setMention] = useState<{ query: string; items: Mention[]; at: number } | null>(null);
  const [mentionIdx, setMentionIdx] = useState(0);
  const selected = useSelection((s) => s.selectedId);
  const selectedName = selected == null ? null : EditorControlSurface.getEntity(selected)?.name ?? null;

  const openMention = (value: string, caret: number) => {
    const m = /@([^\s@]*)$/.exec(value.slice(0, caret));
    if (!m) { setMention(null); return; }
    setMention({ query: m[1], items: mentionMatches(m[1]), at: caret - m[0].length });
    setMentionIdx(0);
  };

  const insertMention = (name: string) => {
    const el = ref.current;
    const at = mention?.at ?? draft.length;
    const caret = el?.selectionStart ?? draft.length;
    const next = `${draft.slice(0, at)}@${name} ${draft.slice(caret)}`;
    setMention(null);
    setDraft(next);
    requestAnimationFrame(() => {
      el?.focus();
      const pos = at + name.length + 2;
      el?.setSelectionRange(pos, pos);
      autosize();
    });
  };

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
      {mention && mention.items.length > 0 && (
        <div className="ag-mention">
          <div className="ag-mention-h">{t('agent.mention')}</div>
          <div className="ag-mention-l">
            {mention.items.map((item, i) => (
              <button
                type="button"
                key={item.key}
                className={`ag-mention-i${i === mentionIdx ? ' on' : ''}`}
                onMouseEnter={() => { setMentionIdx(i); peekEntities(item.entity === null ? [] : [item.entity]); }}
                onMouseLeave={() => peekEntities([])}
                onMouseDown={(e) => { e.preventDefault(); insertMention(item.insert); }}
              >
                {item.entity === null
                  ? <FileIcon size={12} strokeWidth={1.8} />
                  : <Boxes size={12} strokeWidth={1.8} />}
                {item.label}
                <span className="ag-mention-id">{item.detail}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {/* What you have selected, offered rather than assumed: the editor knows
          what you are looking at, and typing its name again is the editor
          making you repeat yourself. */}
      {selectedName && !draft.includes(`@${selectedName}`) && (
        <button type="button" className="ag-selchip" onClick={() => insertMention(selectedName)}>
          <Boxes size={12} strokeWidth={1.8} />@{selectedName}
        </button>
      )}
      <div className="ag-cbox">
        <textarea
          ref={ref}
          rows={1}
          value={draft}
          placeholder={busy ? t('agent.compose.busy') : t('agent.compose')}
          aria-label={t('agent.compose')}
          onChange={(e) => {
            setDraft(e.target.value);
            autosize();
            openMention(e.target.value, e.target.selectionStart ?? 0);
          }}
          onBlur={() => setMention(null)}
          onKeyDown={(e) => {
            if (mention && mention.items.length > 0) {
              if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIdx((i) => (i + 1) % mention.items.length); return; }
              if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIdx((i) => (i - 1 + mention.items.length) % mention.items.length); return; }
              if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertMention(mention.items[mentionIdx].insert); return; }
              // Esc dismisses the picker without closing the drawer behind it.
              if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMention(null); return; }
            }
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
        <span><b>@</b> {t('agent.hint.mention')}</span>
        <span><b>Esc</b> {t('agent.hint.close')}</span>
      </div>
    </div>
  );
}

/**
 * The conversation itself. Rendered BOTH as a dock panel and as the summoned
 * drawer — the same arrangement the Content Browser has, because "a surface you
 * can dock wherever you like" and "a surface you can summon over your work
 * without rearranging anything" are both wanted, and they are not two features.
 */
export function AgentPanel({ docked }: { docked?: boolean }) {
  const setOpen = useEditorStore((s) => s.setAgentDrawer);
  const turns = useAgent((s) => s.turns);
  const status = useAgent((s) => s.status);
  const queued = useAgent((s) => s.queued);
  const logRef = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  // A question that has scrolled away is a turn that looks hung. Watched per
  // instance rather than through shared state: the dock tab and the drawer can
  // both be mounted, and each has its own scroller.
  const awaiting = status.phase === 'awaiting_confirm';
  const [askOffscreen, setAskOffscreen] = useState(false);
  useEffect(() => {
    if (!awaiting) { setAskOffscreen(false); return; }
    const log = logRef.current;
    const ask = log?.querySelector('.ag-ask--confirm');
    if (!log || !ask) return;
    const io = new IntersectionObserver(([e]) => setAskOffscreen(!e.isIntersecting), { root: log, threshold: 0.5 });
    io.observe(ask);
    return () => io.disconnect();
  }, [awaiting, turns]);

  // Follow the tail only while the reader is already at it — yanking someone
  // back down while they read an earlier tool result is the classic log-view bug.
  useLayoutEffect(() => {
    const el = logRef.current;
    if (el && stuck.current) el.scrollTop = el.scrollHeight;
  }, [turns, queued]);

  return (
    <div className="ag-panel">
      <div className={`ag-head${docked ? ' docked' : ''}`}>
        {/* The mark carries "working" even when the transcript is scrolled away
            from the row that would say so. Docked, the tab already says Agent —
            a second title under it is the same word twice and 40px of nothing. */}
        <AgentMark size={docked ? 13 : 15} live={status.phase !== 'idle'} />
        {!docked && <span className="ag-ttl">{t('agent.title')}</span>}
        <span className="ag-sp" />
        <button type="button" title={t('agent.newConversation')} onClick={() => void resetAgentSession()}>
          <Plus size={14} strokeWidth={2} />
        </button>
        {!docked && (
          <>
            {/* Not a bespoke "pinned" mode any more: it hands the conversation to
                the dock, where it is an ordinary panel the user can put anywhere. */}
            <button
              type="button"
              title={t('agent.dock')}
              onClick={() => { setOpen(false); dockApi.openPanel('agent'); }}
            >
              <PanelRight size={14} strokeWidth={1.9} />
            </button>
            <button type="button" title={t('agent.close')} onClick={() => setOpen(false)}>
              <X size={14} strokeWidth={2} />
            </button>
          </>
        )}
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
        {/* Runs the window no longer holds. Absolute ids make this free to know:
            the first one it has says how many came before it. Said out loud
            because a transcript that starts mid-conversation, silently, reads as
            one that lost something. */}
        {turns.length > 0 && turns[0].id > 0 && (
          <div className="ag-sys">{t('agent.earlier', { count: turns[0].id })}</div>
        )}
        {turns.length === 0
          ? <EmptyState />
          : turns.map((turn, i) => (
            <Turn
              key={turn.id}
              turn={turn}
              isLast={i === turns.length - 1}
              running={status.phase !== 'idle'}
              until={(turns[i + 1]?.mark as HistoryMark | undefined) ?? null}
            />
          ))}
        {/* Held until the run ends. Shown rather than merely promised: a message
            that vanished into a queue nobody can see is one you retype. */}
        {queued.map((text, i) => (
          <div className="ag-sys" key={i}>{t('agent.queued.msg', { text })}</div>
        ))}
      </div>

      {askOffscreen && (
        <button
          type="button"
          className="ag-jump"
          onClick={() => logRef.current?.querySelector('.ag-ask--confirm')
            ?.scrollIntoView({ block: 'center', behavior: 'smooth' })}
        >
          <ChevronDown size={12} strokeWidth={2.2} />{t('agent.jump')}
        </button>
      )}
      {status.error && <div className="ag-banner">{status.error}</div>}
      <Compose />
    </div>
  );
}

/** The summoned overlay: covers the right-hand panels rather than squeezing the
 *  viewport, and dismisses on Esc or an outside click. */
export function AgentDrawer() {
  const open = useEditorStore((s) => s.agentDrawer);
  const setOpen = useEditorStore((s) => s.setAgentDrawer);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;
  return (
    <div className="ag-scrim open" onMouseDown={() => setOpen(false)}>
      <div className="ag-drawer" onMouseDown={(e) => e.stopPropagation()}>
        <AgentPanel />
      </div>
    </div>
  );
}

/** Seconds under a minute, m:ss above — a long turn read as "184.2s" is a number
 *  you have to divide before it means anything. */
function formatElapsed(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m${String(Math.floor(s % 60)).padStart(2, '0')}s`;
}

const hasInput = (input: Record<string, unknown>): boolean => Object.keys(input).length > 0;

/**
 * An entity by the name the model wrote, or null.
 *
 * Read live rather than cached: the tree changes under the conversation — often
 * BECAUSE of it — and a name that resolved when the paragraph streamed may not
 * be the same entity a minute later. Ambiguous names resolve to nothing: two
 * entities called "Panel" make a link that is right half the time, which is
 * worse than no link.
 */
function entityByName(name: string): number | null {
  const hits = EditorControlSurface.getSceneTree().filter((n) => n.name === name);
  return hits.length === 1 ? hits[0].id : null;
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
