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

This is a partial RM-009 delivery. Actual event tracing, platform shaping,
IME/device acceptance and layout cache performance remain separate work.
