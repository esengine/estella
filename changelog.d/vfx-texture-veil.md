---
section: Fixed
commits:
  - "fix(pipeline): effect textures clear to their edges, a cone's angle as its half-angle, and one number for a size"
  - "fix(editor): field_sweep requires the field it takes, and every tool schema is checked for it"
  - "fix(editor): image_write says when a picture is almost invisible"
  - "fix(editor): vfx tools warn of a texture veil, keep other effects out of a preview, and take one number for a size"
---
**Effects no longer draw lit squares from a faint veil in their textures, and several agent tools that misled were fixed.**
- **Textures.** Some of the built-in effect textures were not fully clear at their edges. Each particle of an additive
  layer added that faint square, and a dozen overlapping particles summed it into a visible box. All of them now fade to
  nothing before the edge, and a test holds them to it. `vfx_write` checks every texture a layer uses, every frame of a
  sheet included, and warns before an effect shows a square.
- **Cone angle.** A cone's `angle` in `vfx_write` was written as the whole opening, so cones came out half as wide as
  described. It is now the half-angle, as documented.
- **Size.** `size` takes one number for a size that does not change.
- **Preview.** Other effects placed in the scene no longer play into the preview's frames.
- **`image_write`.** It now says when a picture is almost invisible, where before it only reported a coverage of 0.
- **`field_sweep`.** The tool could not be called at all: its schema required an argument it did not declare. A test now
  checks every tool's schema for this.
