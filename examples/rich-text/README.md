# Rich Text

A live playground for the **`Text`** component's rich-text markup and the
**`createTextInput`** widget, wired together:

- **The preview** (top) is one rich `Text`. It renders `<b>`, `<i>`,
  `<color=#RRGGBB>` and `<font size=N>` runs — nested and mixed with CJK.
- **The input** (middle) is a `TextInput` holding the *raw markup*. Every edit —
  including **IME composition** for Chinese/Japanese/Korean — fires `change`,
  which re-parses the markup and re-renders the preview above. **Reset** restores
  the seed sample.
- **The legend** (bottom) is a column of static rich `Text` lines, one per
  supported tag, so the demo doubles as a quick reference.

Type `你好 <color=#66ccff>世界</color> <b>bold</b>` into the field and watch it
render live — the clearest way to see the markup pipeline and the text field
(caret, focus, IME) working together.

## How it works

The scene (`assets/scenes/main.esscene`) lays out a `Panel` column with named
slots — `PreviewSlot`, `ComposerRow`, `ShowcaseSlot`. The startup `BuildSystem`
(`src/systems/build.ts`) finds them once the scene tree exists and mounts:

- a rich `Text` filling the preview card, seeded with `SEED_MARKUP`;
- a `createTextInput` whose `onChange` points the preview's `content` at the
  current markup (a single `world.insert` — no diffing);
- one static rich `Text` per line in `SAMPLES` (`src/config.ts`).

The field text is plain (you see the literal `<b>…</b>` tags); the preview is
what those tags *mean*.

## Note on `<img>`

Inline images (`<img src="…" width=N height=N/>`) **parse** into an
`ImageSegment` but the built-in text renderer does not draw them yet, so this
demo leaves `<img>` out of the legend. Compose an icon next to text with flexbox
instead. See the [Text guide](../../docs/astro/src/content/docs/guides/ui-text.mdx).

## Run

Open the folder in the Estella editor and press **Play**, or build and run it
like the other examples.
