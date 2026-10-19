"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { signOutAction } from "@/server/auth/actions";
import { cn } from "../ui/cn";

export function AccountMenu({
  name,
  email,
  initials,
  isAdmin,
  active,
}: {
  name: string;
  email: string;
  initials: string;
  isAdmin: boolean;
  active?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const item = "block w-full rounded-lg px-3 py-2 text-left text-sm text-ink no-underline hover:bg-surface";
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex size-10 items-center justify-center rounded-full bg-surface text-[13px] font-semibold",
          active ? "border-2 border-ink" : "border border-hairline",
        )}
      >
        {initials}
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          className="absolute right-0 z-20 mt-2 w-64 rounded-xl border border-hairline bg-white p-2 shadow-lg"
        >
          <div className="px-3 py-2">
            <div className="truncate text-sm font-medium">{name || email}</div>
            {name && <div className="truncate text-[13px] text-slate">{email}</div>}
          </div>
          <div className="my-1 h-px bg-divider" />
          <Link role="menuitem" href="/settings" className={item} onClick={() => setOpen(false)}>
            Settings
          </Link>
          {isAdmin && (
            <Link role="menuitem" href="/admin" className={item} onClick={() => setOpen(false)}>
              Admin console
            </Link>
          )}
          <form action={signOutAction}>
            <button role="menuitem" type="submit" className={item}>
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
