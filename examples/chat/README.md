# Chat

The clearest showcase for two UI widgets working together:

- **`createListView`** — the message log. A virtualized list that recycles ~10
  entities for the entire history, so it stays cheap no matter how long the
  conversation grows. New messages auto-scroll into view via `scrollToIndex`.
- **`createTextInput`** — the composer field at the bottom, paired with a Send
  button. Pressing **Enter** or clicking **Send** appends your message and a
  canned bot reply.

## How it works

The scene (`assets/scenes/main.esscene`) lays out a `Panel` with three named
slots — `Title`, `MessagesSlot`, and `ComposerRow`. The startup `BuildSystem`
(`src/systems/build.ts`) finds those slots and mounts the widgets into them:

- Each list row pools a **left** (them) and a **right** (you) bubble, pinned at
  create time. `bind()` only enables the sender's side and fills its label —
  never touches layout — so recycling a row is a couple of component writes.
- The composer's `onSubmit` and the button's `onClick` share one `send()`:
  append your line, clear the field, then append the bot's answer.

The bot (`src/config.ts`) is deterministic — no randomness — so reloads read
identically.

## Run

Open the folder in the Estella editor and press **Play**, or build and run it
like the other examples.
