"use client";

import { cx } from "@/components/ui";

export type Spot = { id: string; label: string; position: { x: number; y: number }; state: "free" | "taken" | "selected" };

/** Positions are 0..1 relative to the image, so the same config renders at any size. */
export function FloorPlanMap({ image, spots, onSelect, readOnly }: { image: string; spots: Spot[]; onSelect?: (id: string) => void; readOnly?: boolean }) {
  return (
    <div className="glass relative overflow-hidden rounded-3xl">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image} alt="Floor plan" className="block h-auto w-full select-none opacity-95" draggable={false} />
      {spots.map((s) => (
        <button
          key={s.id}
          type="button"
          disabled={readOnly || s.state === "taken"}
          onClick={() => onSelect?.(s.id)}
          aria-label={`${s.label}${s.state === "taken" ? " (taken)" : ""}`}
          style={{ left: `${s.position.x * 100}%`, top: `${s.position.y * 100}%` }}
          className={cx(
            "tactile absolute flex h-9 min-w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full px-2 text-xs font-medium",
            s.state === "selected" && "scale-110 bg-accent text-accent-ink shadow-lift ring-4 ring-accent/25",
            s.state === "free" && "glass-strong text-charcoal hover:scale-105 hover:bg-white",
            s.state === "taken" && "bg-charcoal/15 text-charcoal/40 line-through",
            readOnly && "pointer-events-none",
          )}
        >
          {s.label.replace(/^[A-Za-z]+\s/, "")}
        </button>
      ))}
    </div>
  );
}
