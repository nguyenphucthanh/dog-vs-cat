import type { ButtonHTMLAttributes, ReactNode } from 'react';

const BUTTON_STYLES = {
  primary: 'bg-amber-400 text-stone-900 border-amber-700 hover:bg-amber-300',
  secondary: 'bg-white text-stone-800 border-stone-400 hover:bg-stone-100',
};

/** Chunky block-style button. The thick bottom edge presses in when clicked. */
export function Button({
  variant = 'secondary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof BUTTON_STYLES }) {
  return (
    <button
      type="button"
      className={`border-2 border-b-4 px-4 py-2 font-bold transition-transform active:translate-y-0.5 active:border-b-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-y-0 disabled:active:border-b-4 ${BUTTON_STYLES[variant]} ${className}`}
      {...props}
    />
  );
}

export function Screen({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center bg-sky-200 px-4 py-8 text-stone-900">{children}</main>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="font-medium text-red-700">
      {children}
    </p>
  );
}
