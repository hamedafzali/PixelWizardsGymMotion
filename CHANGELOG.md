# Changelog

## 0.1.0 — unreleased

First release.

- Core (no dependencies): 114 exercise motions as plain data, 30+ movement patterns, two-bone IK rig, timeline with cues and lift progress (`Frame.load`), muscle highlight map, damped `Spring`.
- Motion phases: a rep or loop as named parts, each with a target position (number or name), time, cue, effort, breath, ease and optional own keys. `checkPhases`, `phasesOf`, `withTempo`, `peakTime`. The old tempo/cues/effort format still plays.
- The body mesh builds in a Web Worker (`preloadBody`, `bodyReady`, `GymViewer.ready`), so the page no longer freezes for about 2 s while it loads. `GymViewer.scene` is undefined until then.
- `pixelwizards-gym-motion/three`: sculpted figure with muscle highlighting; gym equipment built from data — selectorised weight stacks that rise with each rep, cable towers with pulleys, lever machines mounted to their frames, a leg-press sled, racks, Smith machine, cardio machines; `GymScene` (no renderer needed) and `GymViewer` (renderer, lights, drag-to-orbit, views, reduced motion, renders only when visible and moving).
- Machine detail pass: cable towers have post rails with pop-pin carriages and swivel pulleys, and stacks have side shrouds; a full cable crossover; dedicated stations for the T-bar row, hack squat, standing and seated calf raise, glute kickback, lying leg curl, hyperextension, hip thrust, rotary torso, captain's chair and cable row bench; padded stands and box benches in place of plain boxes; rebuilt treadmill, bike, elliptical and stair climber whose cranks and pedals follow the feet.
- Contacts: parts mark where the body meets them, and `GymScene.contacts()`, `measureContacts`, `limbCapsule`, `touch`, `touchEach` and `settle` measure and enforce them. A test sweeps every exercise over a cycle. Followers (pads, lever rollers, kettlebells) now rest on the limb they press: `offset` gives the side and contact sets the distance. Cable single handles held in both hands are a V-handle. Fixed gaps the sweep found: cable grips out of the hands, lying leg curl handles, kickback forearm pads, cable row and bike seat heights, captain's chair back pad, chest-supported pads, bench dip and split squat benches, the floor glute bridge, the hyperextension pad, and the triceps machine (now two arm pads). The knee never goes through the floor (`KNEE_FLOOR`).
- `pixelwizards-gym-motion/react`: `<GymMotion>` component.
