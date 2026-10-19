"use client";

import { useEffect, useState } from "react";
import { SideNav } from "@/components/layout/SideNav";

const SECTIONS = [
  { id: "profile", label: "Profile" },
  { id: "security", label: "Security" },
  { id: "privacy", label: "Privacy & data" },
  { id: "ai-provider", label: "AI provider" },
] as const;

/** Side nav for the settings page. The item for the section nearest the top of the view is active. */
export function SettingsNav() {
  const [active, setActive] = useState<string>(SECTIONS[0].label);

  useEffect(() => {
    const labelById: Record<string, string> = {};
    for (const s of SECTIONS) labelById[s.id] = s.label;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const first = visible[0];
        if (first) setActive(labelById[first.target.id] ?? SECTIONS[0].label);
      },
      { rootMargin: "-15% 0px -70% 0px" },
    );
    for (const s of SECTIONS) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <SideNav
      label="Settings"
      active={active}
      items={SECTIONS.map((s) => ({ label: s.label, href: `/settings#${s.id}` }))}
    />
  );
}
