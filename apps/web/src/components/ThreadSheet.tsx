/**
 * useOpenThread — opens a live DM thread sheet for a ring-1 person {ACT-2}.
 * The sheet hosts a component (not a snapshot) so new messages render as the
 * connector emits; sending goes through actions.sendMessage (ring-1 only —
 * ADR-14; the connector rejects non-connections as status.lastError).
 */
import { useState } from "react";
import { useApp } from "../lib/connector-context";
import { SheetMeta, SheetTitle, useSheet } from "./ui";

function ThreadView({ personId, name }: { personId: string; name: string }) {
  const { state, actions } = useApp();
  const [draft, setDraft] = useState("");
  const thread = state.threads.find((t) => t.personId === personId);

  const send = () => {
    if (!draft.trim()) return;
    actions.sendMessage(personId, draft);
    setDraft("");
  };

  return (
    <div>
      <SheetTitle>{name}</SheetTitle>
      <SheetMeta>End-to-end between the two of you — carried by your own thread.</SheetMeta>

      <div className="my-3 flex flex-col gap-2">
        {thread?.msgs.map((m, i) => (
          <div
            key={i}
            className={
              m.who === "me"
                ? "max-w-[80%] self-end rounded-2xl bg-electric px-3.5 py-2 text-[13.5px] leading-snug text-white"
                : "max-w-[80%] self-start rounded-2xl bg-white px-3.5 py-2 text-[13.5px] leading-snug shadow-[0_1px_6px_rgba(36,27,46,0.08)]"
            }
          >
            {m.text}
          </div>
        ))}
      </div>

      <input
        className="w-full rounded-full border-[1.5px] border-ink/15 bg-white px-4 py-2.5 text-[14px] focus:border-electric focus:outline-none"
        placeholder={`Message ${name}…`}
        aria-label={`Message ${name}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") send();
        }}
      />
    </div>
  );
}

export function useOpenThread() {
  const { open } = useSheet();
  return (personId: string, name: string) => {
    open(<ThreadView personId={personId} name={name} />);
  };
}
