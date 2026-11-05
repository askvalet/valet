import * as React from "react"
import { cn } from "@/lib/utils"

// Valet's one chip (AGENTS.md, "Design tokens"): 32 high, the chip corner, 13px words. Tonal (a fill step), outline (a
// hairline, for a set you pick from) or selected (the ink, for the one that's on). A leading icon or a status dot is
// optional; `dot` takes a tone (good, warn, bad, off) or any colour, which then glows a little, as a light does.
const BASE =
  "inline-flex h-8 max-w-full flex-none items-center gap-2 rounded-chip px-3 text-body whitespace-nowrap transition-[color,background-color,box-shadow,transform] disabled:opacity-50 has-[>svg:first-child]:pl-2.5 has-[>.dot:first-child]:pl-2.5 has-[>img:first-child]:pl-2 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-icon"

const VARIANT = {
  tonal: "bg-fill-1 [&:is(a,button)]:hover:bg-fill-2",
  outline: "shadow-[inset_0_0_0_1px_var(--fill-3)] [&:is(a,button)]:hover:bg-fill-1",
  selected: "bg-foreground text-(--card-tint) font-medium",
  /** words only until hovered: a suggestion */
  ghost: "text-muted-foreground [&:is(a,button)]:hover:bg-fill-1 [&:is(a,button)]:hover:text-foreground",
} as const

export type ChipVariant = keyof typeof VARIANT
const TONES = new Set(['good', 'warn', 'bad', 'off'])

function chipClass({ variant = "tonal", className }: { variant?: ChipVariant; className?: string } = {}) {
  return cn(BASE, VARIANT[variant], className)
}

/** A status dot or a thing's own colour (a light that's on glows). */
function ChipDot({ dot }: { dot: string }) {
  return TONES.has(dot) ? <i className={cn("dot", `dot-${dot}`)} />
    : <i className="dot" style={{ background: dot, boxShadow: `0 0 6px ${dot}` }} />
}

type ChipProps = {
  variant?: ChipVariant
  icon?: React.ComponentType<{ className?: string }>
  dot?: string | null
  className?: string
  children?: React.ReactNode
}

/** A chip: a button by default, a link with `href`, or words only with `as="span"`. */
function Chip({ className, variant = "tonal", icon: Icon, dot, children, ...props }: ChipProps & (
  | ({ as?: "button" } & Omit<React.ComponentProps<"button">, keyof ChipProps>)
  | ({ as: "a" } & Omit<React.ComponentProps<"a">, keyof ChipProps>)
  | ({ as: "span" } & Omit<React.ComponentProps<"span">, keyof ChipProps>))) {
  const { as = "button", ...rest } = props as { as?: string } & Record<string, unknown>
  const Comp = as as "button"
  return (
    <Comp data-slot="chip" data-variant={variant} {...(as === "button" ? { type: "button" } : {})} {...rest}
      className={cn(as !== "span" && "press", chipClass({ variant, className }))}>
      {Icon && <Icon />}{dot && <ChipDot dot={dot} />}{children}
    </Comp>
  )
}

export { Chip, ChipDot, chipClass }
