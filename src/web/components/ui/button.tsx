import * as React from "react"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

// Valet's one button (AGENTS.md, "Design tokens"): two sizes, 28 and 36; ghost, tonal or solid. Fills are the ink at a
// strength (--fill-*), so a button reads in light and dark alike. Focus is the page's one ring, so none is drawn here.
const BASE =
  "inline-flex shrink-0 items-center justify-center gap-1.5 font-medium whitespace-nowrap transition-[color,background-color,box-shadow,transform] disabled:pointer-events-none disabled:opacity-50 aria-invalid:ring-1 aria-invalid:ring-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-icon"

// variants as plain lookup tables (no class-variance-authority needed)
const VARIANT = {
  /** words on the card's own surface; the fill comes on hover */
  ghost: "text-muted-foreground hover:bg-fill-1 hover:text-foreground aria-pressed:bg-fill-2 aria-pressed:text-foreground",
  /** the usual quiet button: one fill step */
  tonal: "bg-fill-1 text-foreground hover:bg-fill-2 aria-pressed:bg-fill-3",
  /** the one thing to do: the ink itself */
  solid: "bg-foreground text-(--card-tint) hover:bg-foreground/90",
  /** the accent, for the rare button that leads */
  default: "bg-primary text-primary-foreground hover:bg-primary/90",
  destructive: "bg-destructive text-white hover:bg-destructive/90 dark:bg-destructive/60",
  outline: "shadow-[inset_0_0_0_1px_var(--input)] hover:bg-fill-1",
  /** shadcn's name for tonal */
  secondary: "bg-fill-1 text-foreground hover:bg-fill-2 aria-pressed:bg-fill-3",
  link: "text-primary underline-offset-4 hover:underline",
} as const

// heights follow density (--spacing); corners follow the height: a chip's at 28, a control's at 36 and up
const SIZE = {
  sm: "h-7 rounded-chip px-3 text-body has-[>svg]:pl-2.5",
  default: "h-9 rounded-control px-4 text-body has-[>svg]:pl-3",
  lg: "h-11 rounded-control px-5 text-item",
  "icon-sm": "size-7 rounded-chip",
  icon: "size-9 rounded-control",
  "icon-lg": "size-10 rounded-control",
  /** shadcn's own, kept for its components */
  xs: "h-6 gap-1 rounded-tag px-2 text-meta has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
  "icon-xs": "size-6 rounded-tag [&_svg:not([class*='size-'])]:size-3",
} as const

export type ButtonVariant = keyof typeof VARIANT
export type ButtonSize = keyof typeof SIZE

function buttonVariants({ variant = "tonal", size = "default", className }: { variant?: ButtonVariant | null; size?: ButtonSize | null; className?: string } = {}) {
  return cn(BASE, VARIANT[variant ?? "tonal"], SIZE[size ?? "default"], className)
}

function Button({
  className,
  variant = "tonal",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & {
  variant?: ButtonVariant
  size?: ButtonSize
  asChild?: boolean
}) {
  const Comp = asChild ? Slot.Root : "button"
  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={buttonVariants({ variant, size, className })}
      {...props}
    />
  )
}

export { Button, buttonVariants }
