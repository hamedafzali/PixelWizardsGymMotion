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
const frame = sample(motion, 1.4);   // { pose, cue, working, phase, load }
const skeleton = solve(frame.pose);  // joint positions in metres, Y up, facing +Z
```

`sample` moves through the key poses on a spline, with a minimum-jerk speed
profile. On top of that it adds breathing and a slight sway: the figure
breathes out through the working half and never freezes in a hold. Pass
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
- `tempo` and `camera` are optional.

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
