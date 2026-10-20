# Changelog

## 0.1.0 — unreleased

First release.

- Core (no dependencies): 114 exercise motions as plain data, 30+ movement patterns, two-bone IK rig, timeline with cues and lift progress (`Frame.load`), muscle highlight map, damped `Spring`.
- Motion phases: a rep or loop as named parts, each with a target position (number or name), time, cue, effort, breath, ease and optional own keys. `checkPhases`, `phasesOf`, `withTempo`, `peakTime`. The old tempo/cues/effort format still plays.
- The body mesh builds in a Web Worker (`preloadBody`, `bodyReady`, `GymViewer.ready`), so the page no longer freezes for about 2 s while it loads. `GymViewer.scene` is undefined until then.
- `pixelwizards-gym-motion/three`: sculpted figure with muscle highlighting; gym equipment built from data — selectorised weight stacks that rise with each rep, cable towers with pulleys, lever machines mounted to their frames, a leg-press sled, racks, Smith machine, cardio machines; `GymScene` (no renderer needed) and `GymViewer` (renderer, lights, drag-to-orbit, views, reduced motion, renders only when visible and moving).
- Machine detail pass: cable towers have post rails with pop-pin carriages and swivel pulleys, and stacks have side shrouds; a full cable crossover; dedicated stations for the T-bar row, hack squat, standing and seated calf raise, glute kickback, lying leg curl, hyperextension, hip thrust, rotary torso, captain's chair and cable row bench; padded stands and box benches in place of plain boxes; rebuilt treadmill, bike, elliptical and stair climber whose cranks and pedals follow the feet.
- `pixelwizards-gym-motion/react`: `<GymMotion>` component.
