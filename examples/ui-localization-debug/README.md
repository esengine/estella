# UI localization debug

Open this project and use Window → UI Text Inspector. Wait for layout and
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

This is RM-009 stage one. Focus paths, hit regions, platform shaping,
real IME/device acceptance and layout cache performance remain separate work.
