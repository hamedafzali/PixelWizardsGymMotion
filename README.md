# pixelwizards-gym-motion

3D gym exercise animations from plain data. A body simulator with inverse
kinematics and muscle highlighting, and the gym machines to go with it: leg
press, lat pulldown, cable stations, chest press, pec deck, Smith machine,
cardio machines and more. It covers 114 exercises.

- **Core** (`pixelwizards-gym-motion`) has no dependencies. It turns an exercise into poses and a skeleton you can draw any way you like.
- **three.js** (`pixelwizards-gym-motion/three`) draws the figure and the equipment, and adds a ready-made viewer.
- **React** (`pixelwizards-gym-motion/react`) wraps the viewer in a `<GymMotion>` component.

```sh
npm install pixelwizards-gym-motion three        # add react for the component
```

## Quick start

### React

```tsx
import { GymMotion } from "pixelwizards-gym-motion/react";

<GymMotion
  exercise={{ id: "e-legpress", name: "Leg press", primaryMuscle: "quads", secondaryMuscles: ["glutes"] }}
  style={{ aspectRatio: "16 / 10" }}
  onCue={(cue) => console.log(cue)}   // "Press", "Lower", …
/>
```

The component draws the canvas and nothing else. Wire your own controls to
`playing`, `speed` and `view` (`"front" | "angle" | "side"` or a yaw in
degrees).

### Plain three.js

```ts
import { GymViewer } from "pixelwizards-gym-motion/three";

const viewer = new GymViewer(document.querySelector("#stage")!, {
  exercise: { id: "custom-1", name: "Incline dumbbell fly", equipment: "dumbbell", primaryMuscle: "chest" },
});
viewer.setView("side");
viewer.toggle();       // pause / play
viewer.dispose();
```

To use your own renderer and loop, add a `GymScene` to your scene and call
`gymScene.step(dt)` once per frame.

### Core only

```ts
import { motionSpecFor, resolveMotion, sample, solve } from "pixelwizards-gym-motion";

const spec = motionSpecFor({ id: "e-pulldown", name: "Lat pulldown" });
const { motion, equipment } = resolveMotion(spec);
const frame = sample(motion, 1.4);   // { pose, cue, phaseName, working, effort, load, rep, ... }
const skeleton = solve(frame.pose);  // joint positions in metres, Y up, facing +Z
```

`sample` moves through the key poses on a spline, with a minimum-jerk speed
profile. On top of that it adds breathing and a slight sway: the figure
breathes as each phase says and never freezes in a hold. Pass
`{ alive: false }` as the fourth argument to get the bare keys.

`musclesFor(spec)` returns the muscles a movement works, as
`{ primary, secondary }`. The viewer uses it to highlight muscles when you
give it a spec without an exercise.

## Exercises it does not know

`motionSpecFor` takes any `{ id, name, equipment?, primaryMuscle? }`:

- If the id is in `EXERCISE_IDS`, you get that exercise's motion.
- Otherwise it picks a movement from the name (for example "fly", "row" or "pulldown"), then from the primary muscle.
- Free-weight lifts are shown on their machine version when one exists. `spec.device` names the machine, for example "Smith machine".

## Data model

A `MotionSpec` is plain JSON:

- `pattern` and `params` give the movement;
- `equipment` is a list of `Part`s;
- `phases`, `positions`, `tempo` and `camera` are optional.

## Phases

Every motion plays as a list of phases. A phase moves the body along the
pattern's path to a position, or holds still, for a number of seconds:

```ts
const pausedSquat: MotionSpec = {
  pattern: "squat",
  positions: { parallel: 0.8 },
  phases: [
    { name: "sit", to: "parallel", time: 2, cue: "Sit back", breath: "in" },
    { name: "pause", time: 1, cue: "Stay tight", effort: 0.6 },
    { name: "stand", to: "start", time: 1, cue: "Drive up", effort: 1, ease: "explosive" },
  ],
};
```

- `to` is a number from 0 (start of the path) to 1 (far end), or a name: `start`, `mid`, `end`, `rest` (where the load sits), `peak` (the far side from it), plus any you add in `positions`. Leave it out to hold.
- `time` is in seconds. `cue` carries over from the previous phase when left out.
- `effort` (0 → 1, default 0) drives `Frame.working`, the highlight glow and the muscle flex.
- `breath` is `"in"`, `"out"` or `"hold"`. By default a rep breathes out on effort, in otherwise, and holds in a pause. A loop breathes freely.
- `ease` is `"linear"` (follow the keys as written), `"smooth"` or `"explosive"`.
- `keys` gives a phase its own poses, for a part that leaves the path.

In a loop, positions only move forwards: going back to 0 finishes the lap.
`checkPhases(motion)` lists any mistakes, and `resolveMotion` throws on them.

Patterns use the standard four phases (`go`, `hold`, `return`, `rest`), so
`spec.tempo` still retimes them. The burpee and thruster have their own parts.
Motions in the old format (`tempo`, two `cues`, `effort: "first" | "second" | "both"`, `period`)
still play, converted to those four phases.

Each `Frame` reports `phaseIndex`, `phaseName`, `phase` (0 → 1 through it),
`effort`, `pulse` and `rep` (completed reps). `working` is false during a
hold unless the hold has effort of its own.

Parts follow body anchors, such as hands, feet or the pelvis, so a lever arm or
a cable always meets the hand. A weight stack rises with `Frame.load`, which
goes from 0 to 1 as the weight is lifted, eased by a spring.

## Accessibility and performance

- The canvas has `role="img"` and a descriptive label.
- Users who prefer reduced motion get a paused frame at the working end of the rep.
- Horizontal drags orbit the camera; vertical drags still scroll the page.
- The viewer renders only while it is on screen and something is moving.

## Demo

```sh
npm run demo        # builds, serves examples/index.html, opens the browser
```

## License

MIT
