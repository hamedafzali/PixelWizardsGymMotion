# Changelog

## 0.1.0 — unreleased

First release.

- Core (no dependencies): 114 exercise motions as plain data, 30+ movement patterns, two-bone IK rig, timeline with cues and lift progress (`Frame.load`), muscle highlight map, damped `Spring`.
- Motion phases: a rep or loop as named parts, each with a target position (number or name), time, cue, effort, breath, ease and optional own keys. `checkPhases`, `phasesOf`, `withTempo`, `peakTime`. The old tempo/cues/effort format still plays.
- `pixelwizards-gym-motion/three`: sculpted figure with muscle highlighting; gym equipment built from data — selectorised weight stacks that rise with each rep, cable towers with pulleys, lever machines mounted to their frames, a leg-press sled, racks, Smith machine, cardio machines; `GymScene` (no renderer needed) and `GymViewer` (renderer, lights, drag-to-orbit, views, reduced motion, renders only when visible and moving).
- `pixelwizards-gym-motion/react`: `<GymMotion>` component.
