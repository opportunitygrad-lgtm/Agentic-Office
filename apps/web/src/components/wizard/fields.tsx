"use client";

import {
  useId,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { X } from "lucide-react";
import { cn } from "@aibos/ui";

const control =
  "w-full rounded-lg border border-line bg-surface px-3 text-[13.5px] text-fg placeholder:text-fg-faint transition-colors hover:border-line-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 aria-[invalid=true]:border-rose-500 aria-[invalid=true]:ring-rose-500/20";

function FieldShell({
  id,
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <label htmlFor={id} className="mb-1.5 block text-[12.5px] font-medium text-fg">
        {label}
        {required && (
          <span className="ml-0.5 text-rose-500" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children}
      {error ? (
        <p
          id={`${id}-error`}
          className="mt-1.5 text-[12px] font-medium text-rose-600 dark:text-rose-400"
          role="alert"
        >
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-[12px] text-fg-faint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const describedBy = (id: string, error?: string, hint?: string) =>
  error ? `${id}-error` : hint ? `${id}-hint` : undefined;

type BaseProps = {
  label: string;
  hint?: string;
  error?: string;
  className?: string;
  prefix?: string;
};

export function TextField({
  label,
  hint,
  error,
  className,
  required,
  prefix,
  ...rest
}: BaseProps & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <FieldShell
      id={id}
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={className}
    >
      <div className="relative">
        {prefix && (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-fg-faint">
            {prefix}
          </span>
        )}
        <input
          id={id}
          required={required}
          aria-required={required}
          aria-invalid={!!error}
          aria-describedby={describedBy(id, error, hint)}
          className={cn(control, "h-10", prefix && "pl-12")}
          {...rest}
        />
      </div>
    </FieldShell>
  );
}

export function TextArea({
  label,
  hint,
  error,
  className,
  required,
  ...rest
}: BaseProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  return (
    <FieldShell
      id={id}
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={className}
    >
      <textarea
        id={id}
        rows={3}
        aria-invalid={!!error}
        aria-describedby={describedBy(id, error, hint)}
        className={cn(control, "resize-y py-2 leading-relaxed")}
        {...rest}
      />
    </FieldShell>
  );
}

export function SelectField({
  label,
  hint,
  error,
  className,
  required,
  options,
  ...rest
}: BaseProps &
  SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[] }) {
  const id = useId();
  return (
    <FieldShell
      id={id}
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={className}
    >
      <select
        id={id}
        required={required}
        aria-invalid={!!error}
        aria-describedby={describedBy(id, error, hint)}
        className={cn(
          control,
          "h-10 appearance-none bg-[length:16px] bg-[right_10px_center] bg-no-repeat pr-9",
        )}
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%237d8697' stroke-width='2'%3E%3Cpath d='m7 10 5 5 5-5'/%3E%3C/svg%3E\")",
        }}
        {...rest}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

export function TagInput({
  label,
  hint,
  error,
  values,
  onChange,
  placeholder,
  className,
}: BaseProps & { values: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const id = useId();
  const [draft, setDraft] = useState("");
  const add = (raw: string) => {
    const v = raw.trim().replace(/,$/, "").trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setDraft("");
  };
  return (
    <FieldShell
      id={id}
      label={label}
      hint={hint ?? "Press Enter to add"}
      error={error}
      className={className}
    >
      <div
        className={cn(
          "flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-1.5 transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25",
          error && "border-rose-500",
        )}
      >
        {values.map((v) => (
          <span
            key={v}
            className="inline-flex max-w-full items-center gap-1 rounded-md bg-accent-soft py-0.5 pl-2 pr-1 text-[12.5px] font-medium text-accent"
          >
            <span className="truncate">{v}</span>
            <button
              type="button"
              onClick={() => onChange(values.filter((x) => x !== v))}
              aria-label={`Remove ${v}`}
              className="focus-ring grid size-4 place-items-center rounded hover:bg-accent/15"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={draft}
          placeholder={values.length ? "" : placeholder}
          aria-describedby={describedBy(id, error, hint ?? "Press Enter to add")}
          onChange={(e) => {
            if (e.target.value.endsWith(",")) add(e.target.value);
            else setDraft(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(draft);
            } else if (e.key === "Backspace" && !draft && values.length) {
              onChange(values.slice(0, -1));
            }
          }}
          onBlur={() => draft && add(draft)}
          className="h-7 min-w-[120px] flex-1 bg-transparent px-1 text-[13.5px] outline-none placeholder:text-fg-faint"
        />
      </div>
    </FieldShell>
  );
}

export function Switch({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-line bg-surface-2/50 p-3.5">
      <div className="min-w-0">
        <p id={`${id}-label`} className="text-[13px] font-medium">
          {label}
        </p>
        {description && (
          <p id={`${id}-desc`} className="mt-0.5 text-[12px] text-fg-muted">
            {description}
          </p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={description ? `${id}-desc` : undefined}
        onClick={() => onChange(!checked)}
        className={cn(
          "focus-ring relative h-6 w-10 shrink-0 rounded-full transition-colors",
          checked ? "bg-accent" : "bg-surface-3 ring-1 ring-inset ring-line-strong",
        )}
      >
        <span
          className={cn(
            "absolute top-1 size-4 rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-5" : "translate-x-1",
          )}
        />
      </button>
    </div>
  );
}
