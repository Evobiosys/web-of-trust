/**
 * ChatScreen {ACT-2} — intro-gated DM threads on top, then the "waiting on you"
 * activity feed. The badge counts only undone items (App wires that). Every
 * action routes back through actions.activityAction; no data is invented here.
 */
import { useApp } from "../lib/connector-context";
import { Anchor } from "../components/Anchor";
import { Avatar, Btn, Card, Hdr } from "../components/ui";
import { useOpenThread } from "../components/ThreadSheet";

export function ChatScreen() {
  const { state, actions } = useApp();
  const openThread = useOpenThread();

  return (
    <div className="flex h-full flex-col">
      <Hdr title="Chat" right={<span>held between you</span>} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-28">
        <div className="flex flex-col gap-2">
          {state.threads.map((t) => (
            <button
              key={t.personId}
              onClick={() => openThread(t.personId, t.name)}
              className="flex items-center gap-3 rounded-2xl bg-white p-3.5 text-left shadow-[0_2px_14px_rgba(36,27,46,0.07)]"
            >
              <Avatar id={t.personId} name={t.name} />
              <div className="min-w-0 flex-1">
                <b className="block text-[15.5px]">{t.name}</b>
                <span className="block truncate text-[12.5px] text-ink-soft">
                  {t.msgs[t.msgs.length - 1]?.text}
                </span>
              </div>
            </button>
          ))}
        </div>

        <div className="pt-[22px] pb-1.5 text-center text-[11px] uppercase tracking-[0.14em] text-ink-soft">
          Waiting on you
        </div>

        <Anchor id="ACT-2" className="block">
          {state.activity.length === 0 ? (
            <p className="px-2 py-5 text-center text-[13px] leading-relaxed text-ink-soft">
              Nothing waiting on you. Chat only fills when someone needs you — no streaks, no noise.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {state.activity.map((item) => (
                <Card key={item.id} className={item.done ? "opacity-70" : ""}>
                  <div className="font-semibold">
                    {item.icon ? `${item.icon} ` : ""}
                    {item.who}
                  </div>
                  <div className="mt-0.5 text-[13.5px] leading-relaxed">{item.text}</div>
                  {item.subtext && (
                    <div className="mt-1 text-[12.5px] text-ink-soft">{item.subtext}</div>
                  )}
                  {item.resolution && (
                    <div className="mt-2 text-[12.5px] font-semibold text-mint-deep">
                      {item.resolution}
                    </div>
                  )}
                  {!item.done && item.actions.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {item.actions.map((a) => (
                        <Btn
                          key={a.id}
                          size="sm"
                          variant={
                            a.kind === "primary"
                              ? "electric"
                              : a.kind === "ceremonial"
                                ? "coral"
                                : "ghost"
                          }
                          onClick={() => actions.activityAction(item.id, a.id)}
                        >
                          {a.label}
                        </Btn>
                      ))}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </Anchor>
      </div>
    </div>
  );
}
