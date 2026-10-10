// SPDX-License-Identifier: Apache-2.0
// Uses the production PlayRealm controller, realm host and Events panel.
import { createRoot } from 'react-dom/client';
import { useCallback, useState, useSyncExternalStore } from 'react';
import '../desktop/src/theme/tokens.css';
import '../desktop/src/theme/global.css';
import '../desktop/src/theme/controls.css';
import '../desktop/src/theme/uiTextDebug.css';
import { PlayInspect } from '../desktop/src/engine/PlayInspect';
import { PlayRealm } from '../desktop/src/engine/PlayRealm';
import { UITextDebugPanel } from '../desktop/src/panels/UITextDebugPanel';
import { useSelection } from '../desktop/src/store/selectionStore';
// Only staging uses an adapter; the realm protocol and actual game are unchanged.
(window as any).estella = { project: {
  preparePlayRealm: async () => ({ ok: true, hostPath: '.esengine/play/play.html', errors: [] }),
  buildScripts: async () => ({ ok: true }),
} };
const scene = await (await fetch('/__events-scene.json')).json();
// Decorative ancestors deliberately accept bubbling, without becoming pointer targets.
for (const entity of scene.entities) {
  if (['Inside', 'Partial'].includes(entity.name)) entity.components.push({ type: 'Focusable', data: { tabIndex: entity.name === 'Inside' ? 0 : 1 } });
  if (['InnerMask', 'OuterMask', 'Canvas'].includes(entity.name))
    entity.components.push({ type: 'Interactable', data: { enabled: true, raycastTarget: false, blockRaycast: false } });
}
function Fixture() {
  const realm = useSyncExternalStore(PlayRealm.subscribe, PlayRealm.getSnapshot);
  const selected = useSelection(state => state.selectedRef);
  const attach = useCallback((element: HTMLDivElement | null) => { if(element) PlayRealm.attach(element); }, []);
  const [state, setState] = useState('Ready to start');
  const [mounted, setMounted] = useState(true);
  const start = async () => { setState('Starting'); try { await PlayRealm.start({ sceneData: scene, assetManifest: {}, physicsEnabled: false }); PlayInspect.start(); setState('Play ready'); } catch(error) { setState(String(error)); } };
  const inspect = async () => {
    const ref = useSelection.getState().selectedRef;
    const data = await PlayRealm.snapshot(ref && 'live' in ref ? ref.live : null);
    const trace = await PlayRealm.uiEvents();
    setState(JSON.stringify({ selected: data?.selected?.name, components: data?.selected?.components.filter(component => component.type === 'Text' || component.type === 'UINode' || component.type === 'TextInput'), recording: trace?.recording, rows: trace?.rows.length, dropped: trace?.dropped }));
  };
  return <main style={{ padding: 16, height: '100vh', display: 'flex', flexDirection: 'column', gap: 12 }}>
    <h2>UI Events · production Play realm browser verification</h2>
    <div><button onClick={() => void start()}>Start Play</button> <button onClick={() => { PlayInspect.stop(); PlayRealm.stop(); }}>Stop Play</button> <button onClick={() => setMounted(value => !value)}>Toggle panel</button> <button onClick={() => void inspect()}>Read runtime snapshot</button></div>
    <small>Game keys: M opens a dialog; N opens a nested confirmation; R closes dialogs; D disables current focus; E restores controls; H hides the dialog parent; V shows it; O cycles text overflow; K changes text/font cache keys; T toggles a text input (outside text editing).</small>
    <p role="status">{realm.playing ? 'Playing' : 'Stopped'} · {realm.ready ? 'Ready' : 'Not ready'} · {realm.error ?? ''}</p>
    <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0 }}>
      <div style={{ width: 800, height: 600, flexShrink: 0 }} ref={attach} />
      <section style={{ flex: 1, minWidth: 300, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>{mounted && <UITextDebugPanel />}</section>
    </div>
    <output style={{maxHeight: 90, overflow: 'auto', fontSize: 11}}>{state}</output>
    <output aria-label="Selected runtime nodes">{JSON.stringify(selected)}</output>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);

