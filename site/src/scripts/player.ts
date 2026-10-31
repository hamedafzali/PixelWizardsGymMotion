import { DEVICE, MOTIONS } from "pixelwizards-gym-motion";
import { GymViewer, type View } from "pixelwizards-gym-motion/three";

// Mounts a live 3D player in a `.stage` element. The poster stays until the
// body has built (it loads in a worker), then fades out under the canvas.
export interface Player {
  viewer: GymViewer;
  show(id: string, spec?: unknown): void;
}

export function mountPlayer(stage: HTMLElement, id: string, label = (i: string) => i): Player {
  const cue = stage.querySelector<HTMLElement>(".cue");
  const tempo = stage.querySelector<HTMLElement>(".tempo");
  const device = stage.querySelector<HTMLElement>(".device");
  const viewer = new GymViewer(stage, { spec: MOTIONS[id], onCue: (c: string) => cue && (cue.textContent = c) });
  stage.prepend(viewer.canvas);
  viewer.ready.then(() => stage.classList.add("live"));

  function show(next: string, spec?: unknown) {
    const s = (spec ?? MOTIONS[next]) as (typeof MOTIONS)[string];
    viewer.setContent({ spec: { ...s, device: DEVICE[next] }, label: `Animated 3D guide: ${label(next)}` });
    if (device) device.textContent = DEVICE[next] ?? "";
    viewer.ready.then(() => {
      const r = viewer.repSeconds;
      if (tempo) tempo.textContent = r ? `${r.toFixed(1)}s / rep` : "";
    });
  }
  show(id);

  // Controls next to the stage: data-act="play" | "speed" | "view:<name>".
  const root = stage.parentElement ?? document;
  for (const b of root.querySelectorAll<HTMLButtonElement>("[data-act]")) {
    const act = b.dataset.act!;
    b.addEventListener("click", () => {
      if (act === "play") {
        const on = viewer.toggle();
        b.textContent = on ? "Pause" : "Play";
        b.setAttribute("aria-pressed", String(!on));
      } else if (act === "speed") {
        const half = b.textContent === "1×";
        viewer.setSpeed(half ? 0.5 : 1);
        b.textContent = half ? "½×" : "1×";
      } else if (act.startsWith("view:")) {
        viewer.setView(act.slice(5) as View);
        for (const o of root.querySelectorAll("[data-act^='view:']")) o.setAttribute("aria-pressed", String(o === b));
      }
    });
  }
  return { viewer, show };
}
