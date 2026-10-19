import { useEffect, useRef, type CSSProperties } from "react";
import type { Highlight } from "./muscles.js";
import { GymViewer, type ExerciseWithMuscles, type View } from "./three/viewer.js";
import type { Frame } from "./timeline.js";
import type { MotionSpec } from "./types.js";

// <GymMotion>: the GymViewer as a React component. It owns no UI — wire your
// own play, speed and view controls to the props.

export interface GymMotionProps {
  exercise?: ExerciseWithMuscles;
  spec?: MotionSpec;
  highlight?: Highlight;
  /** Omit to play unless the user prefers reduced motion. */
  playing?: boolean;
  speed?: number;
  view?: View | number;
  background?: string;
  interactive?: boolean;
  shadows?: boolean;
  label?: string;
  onCue?(cue: string): void;
  onFrame?(frame: Frame): void;
  /** Receives the viewer once created, and null when it is disposed. */
  onReady?(viewer: GymViewer | null): void;
  className?: string;
  style?: CSSProperties;
}

export function GymMotion({
  exercise,
  spec,
  highlight,
  playing,
  speed = 1,
  view = "angle",
  background,
  interactive,
  shadows,
  label,
  onCue,
  onFrame,
  onReady,
  className,
  style,
}: GymMotionProps) {
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<GymViewer | null>(null);
  // Callbacks change identity every render; read the latest through a ref.
  const cb = useRef({ onCue, onFrame });
  cb.current = { onCue, onFrame };

  // Renderer-level options need a new viewer.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const v = new GymViewer(el, {
      exercise,
      spec,
      highlight,
      playing,
      speed,
      view,
      background,
      interactive,
      shadows,
      label,
      onCue: (c) => cb.current.onCue?.(c),
      onFrame: (f) => cb.current.onFrame?.(f),
    });
    viewer.current = v;
    onReady?.(v);
    return () => {
      v.dispose();
      viewer.current = null;
      onReady?.(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [background, interactive, shadows]);

  // Content changes swap the scene in place.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    viewer.current?.setContent({ exercise, spec, highlight, label });
  }, [exercise, spec, highlight, label]);

  useEffect(() => {
    if (playing === true) viewer.current?.play();
    else if (playing === false) viewer.current?.pause();
  }, [playing]);
  useEffect(() => viewer.current?.setSpeed(speed), [speed]);
  useEffect(() => viewer.current?.setView(view), [view]);

  return <div ref={host} className={className} style={{ position: "relative", ...style }} />;
}

export type { GymViewer, View };
