/**
 * Invisible spec anchors. Every specified surface wraps itself in <Anchor id>.
 * Zero UI by default — renders only a data-anchor attribute. Opening the app
 * with #spec in the URL (dev-only, documented in CONTRIBUTING.md) outlines
 * anchored surfaces and makes them tappable to show their contract.
 */
import { ElementType, ReactNode, useEffect, useState } from "react";
import { ANCHORS } from "@ew/contract";
import { PathBox, SheetMeta, SheetTitle, useSheet } from "./ui";

export function Anchor({
  id,
  as: Tag = "div",
  className,
  children,
}: {
  id: keyof typeof ANCHORS | (string & {});
  as?: ElementType;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tag data-anchor={id} className={className}>
      {children}
    </Tag>
  );
}

export function useSpecMode(): boolean {
  const [on, setOn] = useState(() => window.location.hash === "#spec");
  useEffect(() => {
    const h = () => setOn(window.location.hash === "#spec");
    window.addEventListener("hashchange", h);
    return () => window.removeEventListener("hashchange", h);
  }, []);
  return on;
}

/** Mount once at app root: intercepts taps on anchored surfaces while #spec is on. */
export function SpecTapLayer({ container }: { container: React.RefObject<HTMLElement | null> }) {
  const spec = useSpecMode();
  const { open } = useSheet();
  useEffect(() => {
    const el = container.current;
    if (!spec || !el) return;
    const onClick = (e: MouseEvent) => {
      const t = (e.target as HTMLElement).closest("[data-anchor]");
      if (!t) return;
      e.preventDefault();
      e.stopPropagation();
      const id = t.getAttribute("data-anchor")!;
      const info = ANCHORS[id];
      open(
        <div>
          <span className="mb-2 inline-block rounded-md bg-electric px-2 py-0.5 font-mono text-xs font-bold text-white">
            {id}
          </span>
          <SheetTitle>{info?.title ?? "(unregistered)"}</SheetTitle>
          <PathBox>{info?.contract ?? "Add this ID to packages/contract/src/anchors.ts + docs/60-anchors.md"}</PathBox>
          <SheetMeta>
            Spec: <b>{info?.doc ?? "—"}</b> · registry: packages/contract/src/anchors.ts ·
            three-place rule: CONTRIBUTING.md
          </SheetMeta>
        </div>
      );
    };
    el.addEventListener("click", onClick, true);
    return () => el.removeEventListener("click", onClick, true);
  }, [spec, container, open]);
  useEffect(() => {
    container.current?.setAttribute("data-spec-on", String(spec));
  }, [spec, container]);
  return null;
}
