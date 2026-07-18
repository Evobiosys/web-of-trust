/**
 * Shared UI primitives. Screens compose ONLY from these + Tailwind utilities so
 * the app reads as one system. Palette + voice rules: CONTRIBUTING.md.
 */
import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useState,
} from "react";

/* ---------- buttons ---------- */
export function Btn({
  variant = "electric",
  size = "md",
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "electric" | "coral" | "ghost" | "plc";
  size?: "md" | "sm";
}) {
  const base =
    "rounded-full font-semibold transition-transform active:scale-95 disabled:opacity-45 disabled:active:scale-100 cursor-pointer";
  const sizes = size === "sm" ? "px-4 py-2 text-[13px]" : "px-6 py-3.5 text-[15px]";
  const variants: Record<string, string> = {
    electric: "bg-electric text-white",
    coral: "bg-coral text-white",
    ghost: "bg-transparent text-electric-deep",
    plc: "border-[1.5px] border-dashed border-ink/30 text-ink-soft opacity-55 bg-transparent",
  };
  return <button className={`${base} ${sizes} ${variants[variant]} ${className}`} {...rest} />;
}

/* ---------- cards / badges / chips ---------- */
export function Card({
  className = "",
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-2xl bg-white p-4 shadow-[0_2px_14px_rgba(36,27,46,0.07)] ${className}`}
      {...rest}
    />
  );
}

export function Badge({
  kind = "pub",
  children,
}: {
  kind?: "pub" | "priv" | "hang" | "link" | "loan";
  children: ReactNode;
}) {
  const kinds: Record<string, string> = {
    pub: "bg-mist text-vio-deep",
    priv: "bg-mint/15 text-mint-deep",
    hang: "bg-linen text-[#7a5c2e] border border-[#7a5c2e]/25",
    link: "bg-[#fbf0e9] text-[#a34d2e]",
    loan: "bg-[#fdeee9] text-[#a3472f]",
  };
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide ${kinds[kind]}`}>
      {children}
    </span>
  );
}

export function Seg<T extends string>({
  options,
  value,
  onChange,
  className = "",
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={`flex rounded-full bg-mist p-[3px] ${className}`}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`flex-1 cursor-pointer rounded-full py-2 text-[13.5px] font-semibold ${
            value === o.value ? "bg-white text-ink shadow-sm" : "text-ink-soft"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- header ---------- */
export function Hdr({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between px-5 pt-[max(16px,env(safe-area-inset-top))] pb-3">
      <h2 className="text-[26px] font-semibold">{title}</h2>
      {right ? <div className="flex items-center gap-3 text-[13px] text-ink-soft">{right}</div> : null}
    </div>
  );
}

/* ---------- avatar ---------- */
export const AVA_GRADS: Record<string, string> = {
  me: "linear-gradient(135deg,#9A37F0,#12A8E3)",
  maria: "linear-gradient(135deg,#FF715B,#9A37F0)",
  lucia: "linear-gradient(135deg,#12A8E3,#4FD7A0)",
  rafa: "linear-gradient(135deg,#9A37F0,#12A8E3)",
  tomas: "linear-gradient(135deg,#4FD7A0,#12A8E3)",
  bruno: "linear-gradient(135deg,#FF715B,#F2B25B)",
  sofia: "linear-gradient(135deg,#9A37F0,#FF715B)",
  nico: "linear-gradient(135deg,#0B5E80,#4FD7A0)",
};

export function Avatar({
  id,
  name,
  size = 46,
  offdot = false,
  dashed = false,
}: {
  id?: string;
  name: string;
  size?: number;
  offdot?: boolean;
  dashed?: boolean;
}) {
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white ${
        dashed ? "border-[1.5px] border-dashed border-ink-soft/40 bg-mist text-ink-soft" : ""
      }`}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: dashed ? undefined : AVA_GRADS[id ?? ""] ?? AVA_GRADS.me,
      }}
    >
      {name.charAt(0).toUpperCase()}
      {offdot && (
        <span className="absolute -top-0.5 -right-0.5 h-[15px] w-[15px] rounded-full bg-mint shadow-[0_0_0_2.5px_#fff]" />
      )}
    </span>
  );
}

/* ---------- bottom sheet ---------- */
const SheetCtx = createContext<{
  open: (node: ReactNode) => void;
  close: () => void;
}>({ open: () => {}, close: () => {} });

export function useSheet() {
  return useContext(SheetCtx);
}

export function SheetProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<ReactNode | null>(null);
  const open = useCallback((node: ReactNode) => setContent(node), []);
  const close = useCallback(() => setContent(null), []);
  return (
    <SheetCtx.Provider value={{ open, close }}>
      {children}
      {content !== null && (
        <>
          <div className="absolute inset-0 z-40 bg-ink/40" onClick={close} />
          <div className="absolute inset-x-0 bottom-0 z-50 max-h-[72%] overflow-y-auto rounded-t-[26px] bg-linen px-5 pt-3.5 pb-[max(28px,env(safe-area-inset-bottom))] shadow-[0_-10px_40px_rgba(36,27,46,0.25)]">
            <div className="mx-auto mb-3.5 h-[5px] w-11 rounded bg-ink/20" />
            {content}
          </div>
        </>
      )}
    </SheetCtx.Provider>
  );
}

/** Standard sheet content pieces */
export function SheetTitle({ children }: { children: ReactNode }) {
  return <h3 className="mb-1 text-xl font-semibold">{children}</h3>;
}
export function SheetMeta({ children }: { children: ReactNode }) {
  return <div className="text-[13px] leading-relaxed text-ink-soft">{children}</div>;
}
export function PathBox({
  children,
  tone = "mint",
}: {
  children: ReactNode;
  tone?: "mint" | "warn";
}) {
  return (
    <div
      className={`my-3.5 rounded-xl bg-white p-3.5 text-[13.5px] leading-relaxed border-l-[3px] ${
        tone === "mint" ? "border-mint" : "border-[#e0906f]"
      }`}
    >
      {children}
    </div>
  );
}
