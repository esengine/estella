---
section: Fixed
commits:
  - fix(postprocess): the temporal pass a level adds goes before the bloom, the grading and the grain - with no auto exposure in the chain it was put at the end, after the film grain, the vignette and the sharpening, and smoothed the grain away; it now goes before the first lens, colour or stylize effect, after the lighting and the fog, as it always meant to
---
**Temporal anti-aliasing no longer smooths away the film grain.** When a quality level asks for temporal smoothing and the scene has not listed it, the engine adds the pass to the chain. It was meant to go after the lighting and the fog and before the exposure and the grading, but it was only placed right when the chain had an auto exposure; otherwise it went to the end, after the bloom, the grading, the sharpening, the film grain and the vignette, and blended the grain across frames until it was gone. It now goes before the first lens, colour or stylize effect in every chain.
