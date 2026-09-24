import { cn } from "./cn";

/**
 * Tiny SVG charts. Series colours come from the categorical `--series-N`
 * CSS tokens (validated palette, fixed order) — never from status colours.
 */

export function Sparkline({
  values,
  width = 96,
  height = 28,
  colorVar = "--series-1",
  label,
  className,
}: {
  values: number[];
  width?: number;
  height?: number;
  colorVar?: string;
  label: string;
  className?: string;
}) {
  const max = Math.max(...values, 0.0001);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const pts = values.map((v, i) => [i * step, height - 3 - (v / max) * (height - 6)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  const last = pts.at(-1);
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
      className={cn("overflow-visible", className)}
    >
      <title>{label}</title>
      <path d={area} style={{ fill: `var(${colorVar})`, opacity: 0.12 }} />
      <path
        d={line}
        fill="none"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
        style={{ stroke: `var(${colorVar})` }}
      />
      {last && (
        <circle
          cx={last[0]}
          cy={last[1]}
          r={3}
          strokeWidth={2}
          className="stroke-surface"
          style={{ fill: `var(${colorVar})` }}
        />
      )}
    </svg>
  );
}

export interface StackSegment {
  key: string;
  label: string;
  value: number;
  colorVar: string;
}

/** Horizontal part-to-whole bar with 2px surface gaps between segments. */
export function StackedBar({
  segments,
  total,
  label,
  className,
}: {
  segments: StackSegment[];
  total?: number;
  label: string;
  className?: string;
}) {
  const sum = total ?? segments.reduce((s, x) => s + x.value, 0);
  const visible = segments.filter((s) => s.value > 0);
  return (
    <div
      role="img"
      aria-label={label}
      className={cn(
        "flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full bg-surface-3",
        className,
      )}
    >
      {visible.map((s) => (
        <div
          key={s.key}
          title={`${s.label}: ${s.value}`}
          className="h-full first:rounded-l-full last:rounded-r-full"
          style={{ width: `${sum ? (s.value / sum) * 100 : 0}%`, background: `var(${s.colorVar})` }}
        />
      ))}
    </div>
  );
}
