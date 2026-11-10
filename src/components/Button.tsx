import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { LoaderCircle } from 'lucide-react'

type Variant = 'primary' | 'secondary' | 'danger' | 'success' | 'ghost'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-terracotta text-white hover:bg-terracotta-deep',
  secondary: 'border-2 border-sand-deep bg-sand text-ink hover:bg-sand-deep',
  danger: 'bg-danger text-white hover:brightness-95',
  success: 'bg-reunited text-white hover:brightness-95',
  ghost: 'text-ink underline-offset-4 hover:underline',
}

/** 56px-tall, full-width touch target (spec section 13). */
export function Button({
  variant = 'primary',
  icon,
  busy,
  children,
  className = '',
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; icon?: ReactNode; busy?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex min-h-14 w-full items-center justify-center gap-3 rounded-2xl px-5 text-lg font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {busy ? <LoaderCircle className="size-6 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  )
}
