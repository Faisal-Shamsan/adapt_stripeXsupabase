import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "quiet"; size?: "md" | "lg" | "sm" };

export function Button({ variant = "primary", size = "md", className, ...rest }: ButtonProps) {
  const sizes = { sm: "h-9 px-4 text-sm", md: "h-11 px-6 text-[15px]", lg: "h-13 px-8 text-base" };
  const variants = {
    primary: "bg-accent text-accent-ink shadow-soft hover:shadow-lift disabled:opacity-40 disabled:shadow-none",
    ghost: "glass text-charcoal hover:bg-white/70",
    quiet: "text-charcoal-2 hover:text-charcoal hover:bg-charcoal/[0.04]",
  };
  return <button className={cx("tactile inline-flex items-center justify-center gap-2 rounded-full font-medium tracking-tight disabled:pointer-events-none", sizes[size], variants[variant], className)} {...rest} />;
}

export function Card({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx("glass rounded-3xl p-6 md:p-8", className)} {...rest}>
      {children}
    </div>
  );
}

export function Chip({ active, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      className={cx(
        "tactile h-9 rounded-full px-4 text-sm font-medium",
        active ? "bg-charcoal text-ivory shadow-soft" : "glass text-charcoal-2 hover:text-charcoal hover:bg-white/75",
        className,
      )}
      {...rest}
    />
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(
        "h-12 w-full rounded-2xl border border-charcoal/10 bg-white/70 px-4 text-[15px] text-charcoal placeholder:text-stone-2 outline-none transition-[box-shadow,border-color] duration-200 focus:border-accent/60 focus:shadow-[0_0_0_4px_color-mix(in_oklab,var(--accent)_18%,transparent)]",
        className,
      )}
      {...rest}
    />
  );
}

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium uppercase tracking-[0.14em] text-stone">
      {children}
    </label>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx("text-xs font-medium uppercase tracking-[0.18em] text-stone", className)}>{children}</p>;
}

export function Display({ children, className, as: Tag = "h1" }: { children: ReactNode; className?: string; as?: "h1" | "h2" | "h3" }) {
  return <Tag className={cx("font-display text-balance font-medium leading-[1.02] tracking-tight text-charcoal", className)}>{children}</Tag>;
}

export function Money({ cents, currency }: { cents: number; currency: string }) {
  const s = new Intl.NumberFormat("en-GB", { style: "currency", currency: currency.toUpperCase(), minimumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);
  return <span className="tabular-nums">{s}</span>;
}

export function Divider({ className }: { className?: string }) {
  return <div className={cx("h-px w-full bg-charcoal/10", className)} />;
}

export { cx };
