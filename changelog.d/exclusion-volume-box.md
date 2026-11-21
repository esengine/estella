---
section: Changed
commits:
  - feat(editor): an exclusion volume is drawn as the box it is, its height included
---
**An exclusion volume is drawn as a box.** Selected, a WaterBody set to Exclusion Volume showed only its outline on its middle plane, so how far up and down it kept the water out (its Size Y) could not be seen. The viewport now draws its outline at its top and its bottom too, joined at every point.
