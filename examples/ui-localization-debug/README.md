# UI localization debug

Open this project and use Window → UI Debugger → Text. Wait for layout and
capture again. Original / Accents + 35% / Accents + 100% inspect a snapshot
without editing or saving scene content. Select jumps to the authored entity.
Box and text sizes are local display pixels, before Clip / Ellipsis truncation.

Play the scene. Switch locale cycles English, Chinese, Japanese, Korean,
Arabic and Thai. Stress text toggles runtime pseudolocalization; Resize box
changes the localized label between 220 and 600 pixels. These runtime changes
do not rewrite the catalog. The first narrow label and wrapped paragraph
intentionally overflow.

The ordinary glyph renderer does not implement Arabic joining / bidi or Thai
shaping. These rows require visual verification and cannot receive an automatic
fit verdict. Custom font assets, rich text and unresolved boxes are also marked
for review. Bounds cover glyph advances and line height, not stroke, shadow or
ink overhang. Host fonts can differ; inspect the exported game on each target.

Focus order shows the editor snapshot of the runtime Tab policy: ascending
indices, stable ECS query order on ties, disabled/hidden controls skipped and
open dialog subtrees restricting traversal. It does not move focus; edit a
control, capture again, then Select to find it in Details. The host must expose
resolved visibility, otherwise a warning is shown. This does not verify actual
keyboard delivery, screen readers or IME on a target device.

UI Debugger opens on Elements. Pick element arms the viewport or running-game
view for one selection; the selection click is consumed, then normal input
returns. Escape cancels picking. The hierarchy preserves real UI ancestry and
selection is shared with Details. The property view reads current component
values; editor computed layout refreshes while the panel is open. Edit through
Details. Runtime-only changes revert when play stops.

Screen UI picking and outlines use the renderer's ScreenOverlay projection;
world UI uses the UI camera. Picking is the engine editor selection query,
not proof of actual game event delivery. Only one hovered editor element gets
an extra outline. No clipping estimates or automatic input-success verdicts
are presented. Text and Focus order remain auxiliary snapshot views.

This is a partial RM-009 delivery. Actual running-game event acceptance, platform shaping,
IME/device acceptance and layout cache performance remain separate work.


Events is an opt-in recorder of the entity event channel used by UI, including
custom event types. Start recording during Play, operate the game, then stop
to inspect the recorded target and actual dispatch nodes. Each node records
propagation/default flags after its handlers. Filter retains all recorded
steps of matching events; selecting a node opens its runtime details.

The recorder keeps at most 200 dispatch rows and reports discarded rows, so
a displayed path can be incomplete. It excludes payloads, never drains the
game queue and detaches on stop or session teardown. No records alone are
not a fault verdict. Ordinary Web fixture dispatch checks do not establish
actual game pointer delivery or device acceptance.


To verify actual Play pointer delivery in an ordinary browser, build the SDK
and editor host artifacts, then run `node tools/ui-events-play-browser.mjs`
from the repository root and open http://127.0.0.1:5195/__events-play. This
stages the official Play page/host, SDK and WASM through buildPlayRealm. A
test-server-only URL substitution maps the native project URL to localhost;
the production protocol, picking, project script and Events panel run intact.

Start Play, record, and click Inside: its text counter increments and width
alternates 120/160; its click reaches InnerMask, OuterMask and Canvas. Click
Partial in its visible region: InnerMask stops propagation and prevents the
default. These fixture ancestors intentionally have Interactable enabled
with raycastTarget/blockRaycast false. Ordinary layout parents are skipped
by UI bubbling; blockRaycast can end the walk without stopPropagation.

Stop recording and click again: game reactions continue, history stays fixed.
Toggle the panel off and read the diagnostic snapshot to verify recording is
false. Stop/Start Play rebuilds the world; recording defaults off with no old
history. This covers browser Play, not desktop custom-scheme or device QA.


Focus now samples the current world's actual Tab policy every 250 ms. During
Play it reads FocusManager focus and visibility state through the realm; in
Edit it shows authored traversal policy. Selecting a row only inspects the
entity. Game focus differs from DOM/browser focus; the panel does not assert
keyboard delivery success. Connected-device focus queries remain unavailable.

In the browser Play fixture, Inside also toggles a runtime-generated button.
Focus lists it with Tab index 2, Elements shows its actual hierarchy and
components, and a second activation deletes it. Start Play, open Focus, click
Inside, press Tab and then Enter to exercise real keyboard activation and
auto-updating traversal. Continuous Tab may move browser focus out of the
game iframe; this remains an input follow-up, not a passed keyboard gate.


Web keyboard verification uses `node tools/ui-events-play-browser.mjs` and
`http://127.0.0.1:5195/__events-play` with the built production Play host and SDK.
Use Focus, click Inside, then cycle Tab and Shift+Tab; Enter/Space trigger its
actual project handler. Check both the live FocusManager row and browser focus.
Host buttons/forms retain browser navigation. Keep device IME/accessibility
acceptance separate from these Web input and DOM guard checks.


For live modal checks, first click Inside to create Runtime button. Game key M
marks the runtime button as a UIDialog; the Focus view should mark Inside and
Partial outside the dialog and clear their old game focus. Tab then Enter
confirms the dialog. D disables the current focus; E restores those controls;
R removes the test dialog. These keys run normal project systems in Play.


While the test dialog is open, H hides its parent container and V restores it.
The Focus view should free the visible page controls while the dialog is
hierarchically hidden, then restrict traversal again when its parent returns.


T adds/removes a real createTextInput field. Click it or use Tab/Shift+Tab, enter
mixed English/Chinese text, then Enter submits. While recording, Events shows
actual change/submit; select its event node and Read runtime snapshot to check
TextInput.value. Fixture keys do not run while editing. This validates character
entry and focus handoff, not an OS IME candidate-window session.

For authored widget inspection, run `node tools/ui-localization-browser.mjs`
and open `http://127.0.0.1:5194/__localization` in the built-in browser. The
disposable scene uses SceneCommands to add TextInput to Inside and UIDialog
to OuterMask. After the verification report, open Window → UI Debugger.
Elements exposes these components; edit Value in Details and check that
TextInput.value updates here. Reading the inspector never writes scene data.

The Play browser fixture now mounts the complete UI Debugger. Start recording
in Events, enter a filter, then switch to Elements or Focus and operate the
game. Returning to Events keeps recording, the filter and dispatch history.
Toggle panel closes the debugger and stops observation; opening it again
restores recorded history without automatically recording. Stop Play also
ends observation.

For nested modal focus, click Inside to create Runtime button, then press N.
An outer UIDialog contains Runtime button and Nested confirm (another UIDialog).
Only Nested confirm should remain in the Tab ring. Tab and Shift+Tab stay there;
Enter dismisses it, and Tab returns to Runtime button in the outer modal.
R closes the fixture's dialogs. Independent modal stacking is not covered here.

Click Inside, then press O repeatedly to cycle Clip → Ellipsis → Visible on
the same long text. The layout must change without changing the text or box.
Visible may still be clipped by the fixture's actual ancestor mask.

Press K twice while the game has focus to change Inside from `A|B` / `Arial`
to `A` / `B|Arial`. Text and font family change together; the canvas must show
only `A` after the second press. Elements → Inside → Text exposes both values.

For a repeatable CPU cache comparison, run `node tools/ui-text-cache-benchmark.mjs`,
open `http://127.0.0.1:5196/__text-cache-benchmark` in the built-in browser and
press Run comparison. The same 200 bilingual labels run with the real SDK
renderer cache retained or cleared each frame, at 0/1/10/100% update rates.
The warmed Canvas bitmap atlas uses an in-memory page store and submission sink.
This isolates CPU geometry/cache work; GPU uploads, WASM copies, Yoga reflow,
complex shaping and full game-frame acceptance are excluded. The page checks
exact submitted geometry outside timing and exposes raw paired samples and
environment metadata. Statistics describe ten batch-average frame times, not
individual-frame P95. A representative run is saved in
`cache-cpu-web-2026-10-09.json`; timings vary with JIT and background load.

For the real Yoga/WASM layout comparison, run `node tools/ui-layout-cpu-benchmark.mjs`
and open `http://127.0.0.1:5197/__layout-cpu-benchmark`. It serves the existing
editor WASM build and records its SHA-256. The fixture has one Canvas, twenty
Flex rows and four hundred controls. It compares a correct manual dirty signal
with forced property refresh; both retain Yoga nodes. Timings include component
writes and one layout call, excluding App scheduling, Transform pass, text and
GPU. Four update ratios and both width states compare all 421 nodes' local
positions and computed dimensions. Raw paired data is in
`layout-cpu-web-2026-10-09.json`. This does not benchmark a fresh Yoga rebuild;
the incremental-layout SDK regression separately compares against fresh registries.
