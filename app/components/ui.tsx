/**
 * Kindred design system — a small set of shared primitives so every page
 * (contacts, dashboard, agent API docs, admin) looks and behaves the same.
 *
 * Palette:
 *   paper (#f8f2e9)        app background
 *   white                  card surfaces
 *   night (#2d545e)        primary text, primary buttons, headings
 *   night-shadow (#12343b) hover/active state for night surfaces
 *   sand (#e1b382)         accents, highlights, badges
 *   sand-shadow (#c89666)  accent text/hover, secondary emphasis
 */
import Link from "next/link";
import type { ButtonHTMLAttributes, InputHTMLAttributes, LabelHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

/* --------------------------------------------------------------- Button */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "md" | "sm";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-night text-white hover:bg-night-shadow disabled:opacity-50",
  secondary: "border border-night/20 text-night hover:bg-sand/20 disabled:opacity-50",
  ghost: "text-night/65 hover:bg-sand/25 hover:text-night disabled:opacity-50",
  danger: "text-red-700 hover:bg-red-50 disabled:opacity-50",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  md: "px-4 py-2.5 text-sm",
  sm: "px-3 py-1.5 text-xs",
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition ${BUTTON_SIZES[size]} ${BUTTON_VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}

export function LinkButton({
  href,
  variant = "primary",
  size = "md",
  className = "",
  children,
}: {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition ${BUTTON_SIZES[size]} ${BUTTON_VARIANTS[variant]} ${className}`}
    >
      {children}
    </Link>
  );
}

/* ----------------------------------------------------------------- Card */

export function Card({ className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-2xl border border-night/10 bg-white p-5 shadow-sm sm:p-6 ${className}`}
      {...props}
    />
  );
}

/* ---------------------------------------------------------- Form fields */

export function Label({ className = "", ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={`mb-1 block text-xs font-bold uppercase tracking-wide text-night/55 ${className}`}
      {...props}
    />
  );
}

const fieldClass =
  "w-full rounded-lg border border-night/20 bg-white px-3 py-2.5 text-sm text-night shadow-sm outline-none transition placeholder:text-night/40 focus:border-sand-shadow focus:ring-2 focus:ring-sand/45 disabled:opacity-50";

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${fieldClass} ${className}`} {...props} />;
}

export function Select({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${fieldClass} ${className}`} {...props} />;
}

export function Textarea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${fieldClass} ${className}`} {...props} />;
}

export function Field({
  label,
  hint,
  htmlFor,
  className = "",
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="mt-1 text-xs text-night/45">{hint}</p>}
    </div>
  );
}

/* ---------------------------------------------------------------- Badge */

type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "bg-night/10 text-night",
  accent: "bg-sand text-night",
  success: "bg-emerald-100 text-emerald-800",
  warning: "bg-amber-100 text-amber-800",
  danger: "bg-red-100 text-red-700",
  info: "bg-blue-100 text-blue-800",
};

export function Badge({
  tone = "neutral",
  className = "",
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-bold ${BADGE_TONES[tone]} ${className}`}>
      {children}
    </span>
  );
}

/* ----------------------------------------------------------- PageHeader */

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && (
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-sand-shadow">{eyebrow}</p>
        )}
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-night sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-night/60">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </div>
  );
}

/* ----------------------------------------------------------- EmptyState */

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl bg-paper p-5 text-center text-sm text-night/60">{children}</p>
  );
}

/* --------------------------------------------------------- Alert / notes */

type AlertTone = "info" | "success" | "danger";

const ALERT_TONES: Record<AlertTone, string> = {
  info: "border-sand-shadow/30 bg-sand/20 text-night",
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  danger: "border-red-200 bg-red-50 text-red-700",
};

export function Alert({ tone = "info", className = "", children }: { tone?: AlertTone; className?: string; children: React.ReactNode }) {
  return (
    <div className={`rounded-xl border p-3 text-sm ${ALERT_TONES[tone]} ${className}`}>{children}</div>
  );
}
