# UI localization debug

Open this project and use Window → UI Inspector → Text. Wait for layout and
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

Layout and input shows resolved local dimensions and world axis-aligned bounds
for all UINodes. It reports disabled/hidden controls, ancestor pointer-events
passthrough, raycast-target configuration and parent masks. Expand a row for
bounds, then Select to locate its existing viewport handles. Scene edits make
the snapshot stale and disable selection until capture again.

An input candidate is a configuration result, not a successful pointer hit.
World bounds do not account for clipping or occlusion; parent masks need review.
Inspection does not raycast, change hover/focus, or add persistent gizmos.

Masked rows also show their ancestor mask chain (nearest first), mask mode and
bounds. Unrotated 2D scissor rectangles report estimated containment, partial
clipping or full clipping, plus the remaining world bounds. Stencil, rotated,
unresolved and invalid-hierarchy cases require review. This estimate excludes
camera projection, screen pixel rounding, stencil alpha and actual pointer
delivery. The browser verification fixture finishes with a dedicated nested
mask scene containing Inside / Partial / Outside controls.

This is a partial RM-009 delivery. Actual pointer hits, platform shaping,
real IME/device acceptance and layout cache performance remain separate work.
