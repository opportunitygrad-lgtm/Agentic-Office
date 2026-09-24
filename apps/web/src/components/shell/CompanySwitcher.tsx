"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, ChevronsUpDown, Layers, Plus } from "lucide-react";
import type { CompanyRef } from "@aibos/shared";
import { Monogram, cn } from "@aibos/ui";

type Option = { slug: string | null; name: string; accentColor: string | null };

/**
 * Global ↔ company scope switcher. The scope lives in the `?company=` query
 * parameter so every view is linkable and the server can filter data.
 */
export function CompanySwitcher({ companies }: { companies: CompanyRef[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = searchParams.get("company");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const options: Option[] = [
    { slug: null, name: "All companies", accentColor: null },
    ...companies,
  ];
  const selected = companies.find((c) => c.slug === current) ?? null;
  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.slug === (selected?.slug ?? null)),
  );

  useEffect(() => {
    if (!open) return;
    listRef.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function openList() {
    setActiveIndex(selectedIndex);
    setOpen(true);
  }

  function choose(opt: Option) {
    setOpen(false);
    buttonRef.current?.focus();
    const params = new URLSearchParams(searchParams.toString());
    if (opt.slug) params.set("company", opt.slug);
    else params.delete("company");
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  function onListKey(e: KeyboardEvent<HTMLUListElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveIndex(options.length - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const opt = options[activeIndex];
      if (opt) choose(opt);
    } else if (e.key === "Escape" || e.key === "Tab") {
      setOpen(false);
      if (e.key === "Escape") buttonRef.current?.focus();
    }
  }

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`Company scope: ${selected?.name ?? "All companies"}`}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            openList();
          }
        }}
        className="focus-ring flex h-9 min-w-0 max-w-[260px] items-center gap-2 rounded-lg border border-line bg-surface pl-1.5 pr-2 text-left hover:border-line-strong"
      >
        {selected ? (
          <Monogram name={selected.name} color={selected.accentColor} size="sm" />
        ) : (
          <span className="grid size-6 shrink-0 place-items-center rounded-md bg-accent-soft text-accent">
            <Layers className="size-3.5" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-medium uppercase leading-none tracking-wider text-fg-faint">
            {selected ? "Company" : "Scope"}
          </span>
          <span className="block truncate text-[13px] font-semibold leading-tight">
            {selected?.name ?? "All companies"}
          </span>
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-fg-faint" />
      </button>

      {open && (
        <div className="absolute left-0 top-[calc(100%+8px)] z-50 w-72 animate-fade-up overflow-hidden rounded-xl border border-line bg-surface shadow-xl shadow-black/10">
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            tabIndex={-1}
            aria-label="Select company scope"
            aria-activedescendant={`${listId}-opt-${activeIndex}`}
            onKeyDown={onListKey}
            className="max-h-80 overflow-y-auto p-1.5 outline-none"
          >
            {options.map((opt, i) => {
              const isSelected = i === selectedIndex;
              return (
                <li
                  key={opt.slug ?? "all"}
                  id={`${listId}-opt-${i}`}
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => choose(opt)}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px]",
                    i === activeIndex && "bg-surface-2",
                    i === 0 && "mb-1",
                  )}
                >
                  {opt.slug ? (
                    <Monogram name={opt.name} color={opt.accentColor} size="sm" />
                  ) : (
                    <span className="grid size-6 place-items-center rounded-md bg-accent-soft text-accent">
                      <Layers className="size-3.5" />
                    </span>
                  )}
                  <span className="flex-1 truncate font-medium">{opt.name}</span>
                  {isSelected && <Check className="size-4 text-accent" aria-hidden="true" />}
                </li>
              );
            })}
          </ul>
          <div className="border-t border-line p-1.5">
            <Link
              href="/companies/new"
              onClick={() => setOpen(false)}
              className="focus-ring flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] font-medium text-accent hover:bg-accent-soft"
            >
              <Plus className="size-4" /> Add company
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
