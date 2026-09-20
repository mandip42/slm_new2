'use client';

/**
 * UI primitives.
 *
 * Deliberately small and unopinionated: the instrument look comes from the CSS
 * layer in globals.css, and these components exist to keep touch targets, focus
 * handling and ARIA semantics consistent across every screen.
 */

import type { ReactNode } from 'react';

export type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'info';

const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-muted',
  good: 'text-ok',
  warn: 'text-warn',
  bad: 'text-bad',
  info: 'text-accent',
};

const TONE_BORDER: Record<Tone, string> = {
  neutral: 'border-line',
  good: 'border-ok/40',
  warn: 'border-warn/50',
  bad: 'border-bad/50',
  info: 'border-accent/40',
};

const TONE_BG: Record<Tone, string> = {
  neutral: 'bg-panel-raised',
  good: 'bg-ok/10',
  warn: 'bg-warn/10',
  bad: 'bg-bad/10',
  info: 'bg-accent/10',
};

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------

export function Panel({
  children,
  className,
  as: Tag = 'section',
}: {
  children: ReactNode;
  className?: string;
  as?: 'section' | 'div' | 'article';
}) {
  return <Tag className={cx('panel p-3', className)}>{children}</Tag>;
}

export function PanelHeader({
  title,
  action,
  hint,
}: {
  title: ReactNode;
  action?: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="mb-2 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="label label-strong">{title}</h2>
        {hint ? <p className="mt-0.5 text-[11px] leading-snug text-faint">{hint}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function Button({
  children,
  onClick,
  variant = 'default',
  size = 'md',
  disabled,
  type = 'button',
  className,
  ariaLabel,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'default' | 'primary' | 'danger' | 'ghost' | 'accent';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  type?: 'button' | 'submit';
  className?: string;
  ariaLabel?: string;
  title?: string;
}) {
  const base =
    'inline-flex items-center justify-center gap-1.5 rounded-lg border font-semibold transition-colors select-none disabled:opacity-40 disabled:cursor-not-allowed';
  const sizes = {
    sm: 'px-2.5 py-1.5 text-xs min-h-9',
    md: 'px-3.5 py-2 text-sm touch',
    lg: 'px-5 py-3 text-base min-h-12',
  };
  const variants = {
    default: 'border-line-strong bg-panel-raised text-ink hover:bg-line active:bg-line',
    primary: 'border-ok/60 bg-ok/20 text-ok hover:bg-ok/30 active:bg-ok/40',
    accent: 'border-accent/60 bg-accent/15 text-accent hover:bg-accent/25 active:bg-accent/35',
    danger: 'border-bad/60 bg-bad/15 text-bad hover:bg-bad/25 active:bg-bad/35',
    ghost: 'border-transparent bg-transparent text-muted hover:text-ink hover:bg-panel-raised',
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
      className={cx(base, sizes[size], variants[variant], className)}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  title?: string;
  disabled?: boolean;
}

/**
 * Segmented control, rendered as a radiogroup so screen readers announce it
 * correctly and arrow keys work.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  size = 'md',
  className,
}: {
  options: ReadonlyArray<SegmentOption<T>>;
  value: T;
  onChange: (value: T) => void;
  label: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const pad = size === 'sm' ? 'px-2 py-1 text-[11px] min-h-8' : 'px-3 py-2 text-xs touch';
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx('inline-flex overflow-hidden rounded-lg border border-line', className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            role="radio"
            aria-checked={active}
            disabled={option.disabled}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={cx(
              'font-semibold transition-colors border-r border-line last:border-r-0 disabled:opacity-35',
              pad,
              active ? 'bg-accent/20 text-accent' : 'bg-panel text-muted hover:text-ink'
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}) {
  // As with Field, the description sits outside the <label> so it does not become
  // part of the switch's accessible name.
  return (
    <div className={cx('py-2', disabled && 'opacity-50')}>
      <label className="flex items-start justify-between gap-3">
        <span className="min-w-0 text-sm font-medium text-ink">{label}</span>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          disabled={disabled}
          onClick={() => onChange(!checked)}
          className={cx(
            'relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition-colors',
            checked ? 'border-accent/60 bg-accent/30' : 'border-line-strong bg-panel-sunken'
          )}
        >
          <span
            className={cx(
              'absolute top-0.5 h-4 w-4 rounded-full transition-all',
              checked ? 'left-6 bg-accent' : 'left-0.5 bg-faint'
            )}
          />
        </button>
      </label>
      {description ? (
        <p className="mt-0.5 pr-14 text-[11px] leading-snug text-faint">{description}</p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Labelled form field.
 *
 * The hint and error are rendered *outside* the `<label>` element on purpose. A
 * `<label>` contributes its entire text content to the accessible name of the
 * control it wraps, so nesting a sentence of help text inside it turns the field's
 * name into "Source What produced the sound." for screen reader users. Keeping the
 * label element to the label text alone keeps the name precise.
 */
export function Field({
  label,
  hint,
  children,
  error,
  required,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  error?: string | null;
  required?: boolean;
}) {
  return (
    <div className="block">
      <label className="block">
        <span className="label label-strong">
          {label}
          {required ? <span className="ml-1 text-bad">*</span> : null}
        </span>
        <span className="mt-1 block">{children}</span>
      </label>
      {error ? (
        <span className="mt-1 block text-[11px] text-bad">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-[11px] leading-snug text-faint">{hint}</span>
      ) : null}
    </div>
  );
}

const INPUT_CLASS =
  'w-full rounded-lg border border-line bg-panel-sunken px-3 py-2 text-sm text-ink placeholder:text-faint tnum touch';

export function TextInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  maxLength,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  maxLength?: number;
  autoFocus?: boolean;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      aria-label={ariaLabel}
      maxLength={maxLength}
      autoFocus={autoFocus}
      className={INPUT_CLASS}
    />
  );
}

export function TextArea({
  value,
  onChange,
  placeholder,
  rows = 3,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
  ariaLabel?: string;
}) {
  return (
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      rows={rows}
      aria-label={ariaLabel}
      className={cx(INPUT_CLASS, 'resize-y leading-relaxed')}
    />
  );
}

/**
 * Numeric input that keeps the raw text while the user is typing.
 *
 * Parsing on every keystroke makes it impossible to type "-" or "1." — which
 * matters here because most values entered are signed decibel readings.
 */
export function NumberInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
  step,
  min,
  max,
  suffix,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
}) {
  return (
    <div className="relative">
      <input
        type="number"
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        step={step}
        min={min}
        max={max}
        className={cx(INPUT_CLASS, suffix && 'pr-12')}
      />
      {suffix ? (
        <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-faint">
          {suffix}
        </span>
      ) : null}
    </div>
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<{ value: T; label: string; disabled?: boolean }>;
  ariaLabel?: string;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value as T)}
      aria-label={ariaLabel}
      className={cx(INPUT_CLASS, 'appearance-none pr-8')}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function Slider({
  value,
  onChange,
  min,
  max,
  step = 1,
  label,
  format,
}: {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  label: string;
  format?: (value: number) => string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="label label-strong">{label}</span>
        <span className="tnum text-xs text-muted">{format ? format(value) : value}</span>
      </div>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-bold tracking-wider uppercase',
        TONE_BORDER[tone],
        TONE_BG[tone],
        TONE_TEXT[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

export function Banner({
  children,
  tone = 'warn',
  title,
  action,
}: {
  children: ReactNode;
  tone?: Tone;
  title?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      role={tone === 'bad' ? 'alert' : 'status'}
      className={cx(
        'rounded-lg border-l-4 p-3 text-xs leading-relaxed',
        tone === 'bad'
          ? 'border-l-bad bg-bad/10 text-bad'
          : tone === 'warn'
            ? 'border-l-warn bg-warn/10 text-warn'
            : tone === 'good'
              ? 'border-l-ok bg-ok/10 text-ok'
              : 'border-l-accent bg-accent/10 text-accent'
      )}
    >
      {title ? <div className="mb-1 font-bold tracking-wide uppercase">{title}</div> : null}
      <div className={tone === 'neutral' ? 'text-muted' : ''}>{children}</div>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/** Key/value metric tile. */
export function Metric({
  label,
  value,
  unit,
  tone = 'neutral',
  hint,
  size = 'md',
}: {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  tone?: Tone;
  hint?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  const valueSize = size === 'lg' ? 'text-3xl' : size === 'sm' ? 'text-lg' : 'text-2xl';
  return (
    <div className="panel-sunken px-2.5 py-2">
      <div className="label truncate">{label}</div>
      <div className={cx('readout mt-0.5 font-semibold', valueSize, TONE_TEXT[tone] === 'text-muted' ? 'text-ink' : TONE_TEXT[tone])}>
        {value}
        {unit ? <span className="ml-1 text-[11px] font-normal text-faint">{unit}</span> : null}
      </div>
      {hint ? <div className="mt-0.5 text-[10px] leading-tight text-faint">{hint}</div> : null}
    </div>
  );
}

export function KeyValue({
  entries,
  columns = 1,
}: {
  entries: ReadonlyArray<[ReactNode, ReactNode]>;
  columns?: 1 | 2;
}) {
  return (
    <dl
      className={cx(
        'grid gap-x-4 gap-y-1.5 text-xs',
        columns === 2 ? 'sm:grid-cols-2' : ''
      )}
    >
      {entries.map(([key, value], index) => (
        <div key={index} className="flex items-baseline justify-between gap-3 border-b border-line/60 pb-1">
          <dt className="shrink-0 text-faint">{key}</dt>
          <dd className="tnum min-w-0 text-right break-words text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="panel-sunken px-4 py-8 text-center">
      <p className="text-sm font-semibold text-muted">{title}</p>
      {children ? (
        <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-faint">{children}</p>
      ) : null}
      {action ? <div className="mt-3 flex justify-center">{action}</div> : null}
    </div>
  );
}

/** Horizontally scrollable row of controls, for narrow phone screens. */
export function ControlRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('no-scrollbar -mx-3 flex gap-2 overflow-x-auto px-3 pb-0.5', className)}>
      {children}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <span role="status" aria-live="polite" className="inline-flex items-center gap-2 text-xs text-faint">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
      {label}
    </span>
  );
}
