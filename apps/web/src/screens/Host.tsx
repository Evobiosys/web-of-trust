import { useState } from "react";
import { TIER_LABEL } from "@ew/contract";
import type { Tier } from "@ew/contract";
import { useApp } from "../lib/connector-context";
import { Anchor } from "../components/Anchor";
import { Btn, Hdr } from "../components/ui";

const TIERS: Tier[] = ["public", "commons", "friends", "close"];

const SUBLABEL: Record<Tier, string> = {
  public: "Everyone — even without joining",
  commons: "Anyone connected to us, any closeness",
  friends: "Friends or closer — the usual bar",
  close: "The inner room",
};

const EXPLAINER: Record<Tier, string> = {
  public: "The whole city — no web needed.",
  commons: "Everyone woven into your community's web, however lightly.",
  friends: "Only friends or closer. For everyone else, this gathering doesn't exist.",
  close: "Only your close friends. The quietest room.",
};

// glow[0] = center dot, glow[1..3] = rings (r26, r40, r54)
const GLOW: Record<Tier, number[]> = {
  public: [1, 1, 1, 1],
  commons: [1, 1, 1, 0],
  friends: [1, 1, 0, 0],
  close: [1, 0, 0, 0],
};

export function HostScreen({ close }: { close: () => void }) {
  const { state, actions } = useApp();
  const [adv, setAdv] = useState(false);
  const form = state.hostForm;
  const tier = form.tier;

  return (
    <div className="flex h-full flex-col">
      <Hdr
        title="Host a gathering"
        right={
          <Btn variant="ghost" size="sm" onClick={close}>
            Cancel
          </Btn>
        }
      />

      <div className="flex-1 overflow-y-auto px-5 pb-16">
        <Anchor id="HST-1">
          <div className="flex flex-col gap-2.5">
            <Field label="Name" value={form.name} onChange={(v) => actions.setHostForm({ name: v })} />
            <Field label="When" value={form.when} onChange={(v) => actions.setHostForm({ when: v })} />
            <Field label="Where" value={form.where} onChange={(v) => actions.setHostForm({ where: v })} />
          </div>
        </Anchor>

        <Anchor id="HST-2">
          <p className="mt-4 mb-2 text-[12px] font-semibold tracking-wide text-ink-soft uppercase">
            Who can see this?
          </p>

          <RingsViz tier={tier} />

          <div className="flex flex-col gap-2">
            {TIERS.map((t) => {
              const on = t === tier;
              return (
                <button
                  key={t}
                  onClick={() => actions.setHostForm({ tier: t })}
                  className={`flex items-center gap-3 rounded-2xl border-[1.5px] p-3.5 text-left ${
                    on ? "border-vio bg-vio/8" : "border-ink/10 bg-white"
                  }`}
                >
                  <span
                    className={`h-3.5 w-3.5 shrink-0 rounded-full border-[1.5px] ${
                      on ? "border-vio bg-vio" : "border-ink/25 bg-transparent"
                    }`}
                  />
                  <span>
                    <span className="block text-[15px] font-semibold text-ink">{TIER_LABEL[t]}</span>
                    <span className="block text-[12.5px] text-ink-soft">{SUBLABEL[t]}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <p className="mt-1 px-1 text-[12px] text-ink-soft">{EXPLAINER[tier]}</p>
        </Anchor>

        <Anchor id="HST-4">
          <div className="my-3.5 rounded-xl bg-gradient-to-br from-mint/12 to-electric/12 p-3.5 text-[13.5px] leading-relaxed">
            {tier === "public" ? (
              <>
                <b>Open doors.</b> Anyone in Vienna can find this.
              </>
            ) : state.reach ? (
              <>
                <b>{state.reach.names.join(", ")}</b> and {state.reach.approxMore} more can see this
                right now — {TIER_LABEL[tier].toLowerCase()}, within {form.steps} step
                {form.steps > 1 ? "s" : ""} of your circle. Those who consent show by name; the rest
                count privately. Everyone else: nothing exists.
              </>
            ) : null}
          </div>
        </Anchor>

        <Anchor id="HST-3">
          <button
            onClick={() => setAdv((a) => !a)}
            className="text-[13.5px] font-semibold text-electric-deep underline"
          >
            {adv ? "Hide advanced" : "Advanced: how far through the web"}
          </button>
          {adv && (
            <div className="mt-2.5 flex items-center gap-3">
              <button
                onClick={() => actions.setHostForm({ steps: Math.max(1, form.steps - 1) })}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-mist text-lg font-bold text-ink"
              >
                −
              </button>
              <b className="text-lg">{form.steps}</b>
              <button
                onClick={() => actions.setHostForm({ steps: Math.min(3, form.steps + 1) })}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-mist text-lg font-bold text-ink"
              >
                ＋
              </button>
              <span className="text-[13px] text-ink-soft">
                steps from your circle — how many handshakes away the doors reach
              </span>
            </div>
          )}
        </Anchor>

        <Anchor id="HST-5">
          <Btn
            variant="coral"
            className="mt-3.5 w-full"
            onClick={() => {
              actions.publishGathering();
              close();
            }}
          >
            Open the doors
          </Btn>
          <Btn variant="ghost" className="w-full" onClick={close}>
            Cancel
          </Btn>
        </Anchor>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block rounded-2xl bg-white p-3.5 shadow-[0_2px_14px_rgba(36,27,46,0.07)]">
      <span className="block text-[12px] font-semibold tracking-wide text-ink-soft uppercase">
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full bg-transparent text-[15px] text-ink outline-none"
      />
    </label>
  );
}

function RingsViz({ tier }: { tier: Tier }) {
  const glow = GLOW[tier];
  const ring = (r: number, on: number) => (
    <circle
      cx="60"
      cy="60"
      r={r}
      fill={on ? "rgba(79,215,160,.16)" : "none"}
      stroke={on ? "#4FD7A0" : "rgba(36,27,46,.15)"}
      strokeWidth="1.6"
      strokeDasharray={on ? undefined : "3 5"}
    />
  );
  return (
    <svg className="mx-auto mb-3 block" width="120" height="120" viewBox="0 0 120 120" aria-hidden="true">
      {ring(54, glow[3])}
      {ring(40, glow[2])}
      {ring(26, glow[1])}
      <circle cx="60" cy="60" r="10" fill={glow[0] ? "#4FD7A0" : "rgba(36,27,46,.2)"} />
    </svg>
  );
}
