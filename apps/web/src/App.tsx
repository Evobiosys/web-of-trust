import { useEffect, useRef, useState } from "react";
import { useApp } from "./lib/connector-context";
import { Btn, SheetProvider } from "./components/ui";
import { SpecTapLayer } from "./components/Anchor";
import { OnboardingScreen } from "./screens/Onboarding";
import { DiscoverScreen } from "./screens/Discover";
import { HostScreen } from "./screens/Host";
import { MeetScreen } from "./screens/Meet";
import { CelebrateScreen } from "./screens/Celebrate";
import { WebScreen } from "./screens/Web";
import { ChatScreen } from "./screens/Chat";
import { YouScreen } from "./screens/You";
import { SettingsScreen } from "./screens/Settings";

export type Tab = "discover" | "chat" | "meet" | "web" | "you";
export type Overlay = "host" | "settings" | null;

export interface Nav {
  tab: Tab;
  overlay: Overlay;
  go: (t: Tab) => void;
  openOverlay: (o: Exclude<Overlay, null>) => void;
  closeOverlay: () => void;
}

function TabIcon({ tab }: { tab: Exclude<Tab, "meet"> }) {
  const paths: Record<string, React.ReactNode> = {
    discover: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.5-4.5" />
      </>
    ),
    chat: <path d="M4.5 7C4.5 5.3 5.8 4 7.5 4h9c1.7 0 3 1.3 3 3v6c0 1.7-1.3 3-3 3h-6.3L6 19.6V16h-.3c-.7-.5-1.2-1.3-1.2-2.2z" />,
    web: (
      <>
        <circle cx="12" cy="12" r="2.5" />
        <circle cx="12" cy="12" r="7" strokeDasharray="2 3" />
        <circle cx="12" cy="12" r="10.5" strokeDasharray="2 3" />
      </>
    ),
    you: (
      <>
        <circle cx="12" cy="8.5" r="3.8" />
        <path d="M5.5 20.5c.7-4 3.4-6.2 6.5-6.2s5.8 2.2 6.5 6.2" />
      </>
    ),
  };
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {paths[tab]}
    </svg>
  );
}

export function App() {
  const { state, actions } = useApp();
  const [tab, setTab] = useState<Tab>("discover");
  const [overlay, setOverlay] = useState<Overlay>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const nav: Nav = {
    tab,
    overlay,
    go: (t) => {
      setOverlay(null);
      setTab(t);
    },
    openOverlay: (o) => setOverlay(o),
    closeOverlay: () => setOverlay(null),
  };

  const onboarded = state.me !== null;
  const celebrating = state.ceremony.step === "celebrate";
  const pending = state.activity.filter((a) => !a.done).length;

  // leaving the meet tab resets an in-progress (non-celebrating) ceremony
  useEffect(() => {
    if (tab !== "meet" && !celebrating && state.ceremony.step !== "compose") {
      actions.resetCeremony();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  return (
    <SheetProvider>
      <div
        ref={rootRef}
        className="relative mx-auto flex h-dvh w-full max-w-[520px] flex-col overflow-hidden bg-linen sm:shadow-[0_10px_60px_rgba(36,27,46,0.25)]"
      >
        <SpecTapLayer container={rootRef} />

        {!onboarded && !state.guest ? (
          <OnboardingScreen />
        ) : celebrating ? (
          <CelebrateScreen goDiscover={() => nav.go("discover")} />
        ) : overlay === "host" ? (
          <HostScreen close={nav.closeOverlay} />
        ) : overlay === "settings" ? (
          <SettingsScreen close={nav.closeOverlay} />
        ) : (
          <>
            <div className="min-h-0 flex-1">
              {tab === "discover" && <DiscoverScreen nav={nav} />}
              {tab === "chat" && <ChatScreen />}
              {tab === "meet" && <MeetScreen />}
              {tab === "web" && <WebScreen />}
              {tab === "you" && <YouScreen nav={nav} />}
            </div>

            {state.guest ? (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-linen from-45% to-transparent px-4 pt-7 pb-[max(20px,env(safe-area-inset-bottom))]">
                <Btn variant="coral" className="pointer-events-auto w-full" onClick={() => actions.leaveGuest()}>
                  Join the web of trust
                </Btn>
              </div>
            ) : (
              <nav className="z-30 flex items-stretch justify-around border-t border-ink/10 bg-white/90 px-2 pt-1.5 pb-[max(20px,env(safe-area-inset-bottom))] backdrop-blur-md">
                {(["discover", "chat"] as const).map((t) => (
                  <TabBtn key={t} t={t} tab={tab} nav={nav} badge={t === "chat" ? pending : 0} />
                ))}
                <button
                  aria-label="Meet someone"
                  onClick={() => nav.go("meet")}
                  className="bg-sunrise -mt-6 flex h-[62px] w-[62px] shrink-0 cursor-pointer flex-col items-center justify-center self-start rounded-full text-white shadow-[0_8px_24px_rgba(154,55,240,0.4),0_0_0_5px_var(--color-linen)]"
                >
                  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round">
                    <circle cx="9" cy="12" r="6" />
                    <circle cx="15" cy="12" r="6" />
                  </svg>
                  <span className="text-[9px] leading-none font-bold tracking-wide">Meet</span>
                </button>
                {(["web", "you"] as const).map((t) => (
                  <TabBtn key={t} t={t} tab={tab} nav={nav} badge={0} />
                ))}
              </nav>
            )}
          </>
        )}
      </div>
    </SheetProvider>
  );
}

function TabBtn({
  t,
  tab,
  nav,
  badge,
}: {
  t: Exclude<Tab, "meet">;
  tab: Tab;
  nav: Nav;
  badge: number;
}) {
  const labels: Record<string, string> = { discover: "Discover", chat: "Chat", web: "Web", you: "You" };
  return (
    <button
      onClick={() => nav.go(t)}
      data-anchor={t === "chat" ? "ACT-1" : undefined}
      className={`relative flex w-[60px] cursor-pointer flex-col items-center gap-0.5 pt-1 text-[10.5px] font-semibold ${
        tab === t ? "text-vio" : "text-ink-soft"
      }`}
    >
      <TabIcon tab={t} />
      {labels[t]}
      {badge > 0 && (
        <span className="absolute -top-0.5 right-2 min-w-4 rounded-full bg-coral px-1.5 py-px text-center text-[10px] font-bold text-white">
          {badge}
        </span>
      )}
    </button>
  );
}
