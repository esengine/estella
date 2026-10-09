// SPDX-License-Identifier: Apache-2.0
import '../desktop/src/main';
import { captureUITextRows } from '../desktop/src/panels/UITextDebugPanel';
import { EngineHost } from '../desktop/src/engine/EngineHost';
import { SceneModel } from '../desktop/src/engine/SceneModel';
import { useEditorStore } from '../desktop/src/store/editorStore';
import { inspectTextLayout, pseudoLocalize } from 'esengine';

const status = document.createElement('pre');
status.style.cssText = 'position:fixed;left:20px;bottom:20px;z-index:1001;max-width:600px;background:#19191d;color:white;padding:12px';
document.body.append(status);
EngineHost.setSceneBootstrap(async () => { await EngineHost.loadScene('/__localization-scene.json'); });
useEditorStore.getState().enterEditor();
const deadline = Date.now() + 45000;
while (EngineHost.getSnapshot().status !== 'ready' && Date.now() < deadline) await new Promise(r => setTimeout(r, 100));
if (EngineHost.getSnapshot().status !== 'ready') throw new Error(JSON.stringify(EngineHost.getSnapshot()));
EngineHost.syncEditorViewToScene();
for (let i = 0; i < 12; i++) await new Promise(requestAnimationFrame);
const before = JSON.stringify(SceneModel.serialize());
const rows = captureUITextRows();
let passed = 0, failed = 0;
const check = (ok: boolean, label: string) => { ok ? passed++ : failed++; status.textContent += `${ok ? 'PASS' : 'FAIL'} ${label}\n`; };
check(rows.length === 12, `Actual Text + UINode rows: ${rows.length}`);
check(rows.every(row => row.width > 0 && row.height > 0), 'Computed Yoga boxes resolved');
const english = rows.find(row => row.name === 'English')!;
const options = { width: english.width, height: english.height, fontSize: english.text.fontSize, fontFamily: english.text.fontFamily };
check(inspectTextLayout(english.text.content, options).horizontalOverflow, 'Narrow English detects overflow before Ellipsis');
check(inspectTextLayout(pseudoLocalize(english.text.content, { expansion: 1 }), options).horizontalOverflow, '100% preview detects overflow');
for (const name of ['Chinese', 'Japanese', 'Korean']) {
  const row = rows.find(row => row.name === name)!;
  const result = inspectTextLayout(row.text.content, { ...options, width: row.width, height: row.height });
  check(result.unsupported === null && !result.horizontalOverflow, `${name} ordinary bounds fit`);
}
for (const name of ['Arabic — shaping unverified', 'Thai — shaping unverified']) {
  const row = rows.find(row => row.name === name)!;
  check(inspectTextLayout(row.text.content, options).unsupported === 'complex-script', `${name}: no false automatic pass`);
}
const wrapped = rows.find(row => row.name === 'Wrapped paragraph')!;
check(inspectTextLayout(wrapped.text.content, { ...options, width: wrapped.width, height: wrapped.height, wordWrap: true }).verticalOverflow, 'Wrapped paragraph detects vertical truncation');
check(JSON.stringify(SceneModel.serialize()) === before, 'Inspection / pseudolocalization leave authored scene unchanged');
status.textContent += `RESULT ${passed} passed, ${failed} failed · ${EngineHost.activeBackend}`;
const dismiss = document.createElement('button');
dismiss.textContent = 'Dismiss verification report';
dismiss.onclick = () => { status.style.display = 'none'; };
status.append(document.createElement('br'), dismiss);
