# Contributing

Thanks for helping. Everything in this package is procedural and self-made:
no third-party or paid 3D models, textures or motion capture. Please keep it
that way — contributions must be your own work under the MIT licence.

## Setup

```sh
npm ci
npm test       # build + all tests
npm run demo   # http://localhost:4180
```

## Adding or changing an exercise

An exercise is plain data in `src/catalog.ts`: a movement `pattern` with
`params`, the `equipment` parts, and optional `phases` and `camera`.

- Run `npm test`. The contact sweep plays every exercise through a full cycle
  and fails if a hand misses its grip, a pad sinks into a limb or a foot
  leaves its deck. Fix the pose or the part, not the test.
- Look at it in the demo from the front and the side before opening a PR,
  and attach a screenshot.

## Adding equipment

Parts live in `src/three/equipment.ts`, `stations.ts` and `cardio.ts`. Mark
every place the body belongs with `touch()` / `touchEach()` (see
`src/three/contact.ts`). A part that follows the body and presses on it should
`settle()` onto the limb instead of using a fixed distance.

## Pull requests

- One change per PR, with a line in `CHANGELOG.md` under the unreleased version.
- Keep the core (`src/*.ts` outside `three/`) free of dependencies.
