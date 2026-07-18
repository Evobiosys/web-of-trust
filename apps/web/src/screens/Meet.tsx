import { useEffect, useRef } from "react";
import QRCode from "qrcode";
import { Grant, HandshakePayload, LEVEL_LABEL, Level } from "@ew/contract";
import { useApp } from "../lib/connector-context";
import { Anchor } from "../components/Anchor";
import { Avatar, Btn } from "../components/ui";

/* eslint-disable react-hooks/exhaustive-deps */

const LEVELS: Level[] = ["contact", "friend", "close"];

function Orbs() {
  return (
    <>
      <div
        className="pointer-events-none absolute -top-24 -left-16 h-72 w-72 rounded-full blur-2xl"
        style={{ background: "radial-gradient(circle, rgba(154,55,240,0.45), transparent 70%)" }}
      />
      <div
        className="pointer-events-none absolute -right-16 bottom-8 h-72 w-72 rounded-full blur-2xl"
        style={{ background: "radial-gradient(circle, rgba(18,168,227,0.4), transparent 70%)" }}
      />
    </>
  );
}

function LevelPills({
  selected,
  onPick,
}: {
  selected: Level | null;
  onPick: (l: Level) => void;
}) {
  return (
    <div className="mt-3 flex justify-center gap-2">
      {LEVELS.map((l) => (
        <button
          key={l}
          onClick={() => onPick(l)}
          className={`rounded-full border px-4 py-2 text-[13.5px] font-semibold transition-colors ${
            selected === l
              ? "border-mint bg-mint text-[#0d3527]"
              : "border-white/35 text-mist"
          }`}
        >
          {LEVEL_LABEL[l]}
        </button>
      ))}
    </div>
  );
}

/** Renders MY outbound payload from the seam {CER-3} — the connector (backend)
 *  owns DID/keys/nonce; the UI only draws it. */
function QrCard({ payload }: { payload: HandshakePayload | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // key on stable identity fields so unrelated emits don't redraw the code
  const json = payload
    ? JSON.stringify({ ...payload, ts: undefined })
    : null;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !payload) return;
    void QRCode.toCanvas(canvas, JSON.stringify(payload), {
      width: 180,
      margin: 1,
      color: { dark: "#241B2E", light: "#ffffff" },
    });
  }, [json]);

  return (
    <div className="mx-auto rounded-3xl bg-white p-3.5">
      <canvas ref={canvasRef} width={180} height={180} />
    </div>
  );
}

const GRANT_ROWS: { key: keyof Grant; label: string }[] = [
  { key: "contextLimit", label: "Ecstatic-dance context only — widen later if you choose" },
  { key: "offersVisible", label: "May see my offers at their level" },
  { key: "secondRingVisible", label: "May see my second ring (people who consent)" },
];

export function MeetScreen() {
  const { state, actions } = useApp();
  const { step, offeredLevel, channel, confirmedLevel, advancedOpen, grants } = state.ceremony;

  const shell =
    "bg-cosmic text-mist relative flex min-h-full flex-col items-center overflow-y-auto px-6 pt-[max(24px,env(safe-area-inset-top))] pb-10 text-center";

  const eyebrow = (text: string) => (
    <span className="text-[10.5px] tracking-widest text-[#C9AEE8] uppercase">{text}</span>
  );

  if (step === "compose") {
    const grantOn = (key: keyof Grant) =>
      key === "contextLimit" ? Boolean(grants.contextLimit) : Boolean(grants[key]);
    return (
      <div className={shell}>
        <Orbs />
        <Anchor id="CER-1" className="relative z-10 flex w-full flex-col items-center">
          {eyebrow("Meet")}
          <h2 className="mt-1 text-2xl font-medium">Add someone you just met</h2>

          <LevelPills selected={offeredLevel} onPick={(l) => actions.setOfferedLevel(l)} />

          <p className="mt-2 max-w-xs text-[13.5px] text-mist/85">
            {offeredLevel === "contact"
              ? "You’ll hold each other’s cards. The easy default — grow it later."
              : offeredLevel === "friend"
                ? "You’ll be in each other’s web: friend gatherings, offers, second rings."
                : "The inner room: close gatherings and more intimate sharing."}
          </p>

          <Anchor id="CER-3" className="mt-4 flex w-full flex-col items-center">
            {channel === "qr" ? (
              <QrCard payload={state.ceremony.myPayload} />
            ) : (
              <div className="mx-auto flex h-[186px] w-[186px] flex-col items-center justify-center gap-2 rounded-3xl bg-white px-5 text-center text-sm font-semibold text-vio-deep">
                <span className="text-3xl">📳</span>
                Hold your phones together
              </div>
            )}

            <Btn variant="electric" className="mt-4" onClick={() => actions.beginScan()}>
              Scan theirs instead
            </Btn>

            <div className="mt-4 flex items-center justify-center gap-2 text-[13px] font-semibold">
              {(["qr", "nfc"] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => actions.setChannel(c)}
                  className={`rounded-full border px-4 py-1.5 transition-colors ${
                    channel === c ? "border-mint bg-mint/20 text-mist" : "border-white/30 text-mist/80"
                  }`}
                >
                  {c === "qr" ? "QR" : "NFC"}
                </button>
              ))}
              <button
                disabled
                title="Coming later"
                className="rounded-full border border-white/30 px-4 py-1.5 text-mist/80 opacity-40"
              >
                AirDrop
              </button>
            </div>
          </Anchor>

          <Anchor id="CER-2" className="mt-4 flex w-full flex-col items-center">
            <button
              onClick={() => actions.toggleAdvanced()}
              className="text-[13px] font-semibold text-mist underline underline-offset-4"
            >
              {advancedOpen ? "Hide advanced" : "Advanced: what they may reach"}
            </button>

            {advancedOpen && (
              <>
                <div className="mt-3 w-full max-w-sm rounded-xl border border-white/20 bg-white/10 p-3 text-left">
                  {GRANT_ROWS.map(({ key, label }) => {
                    const on = grantOn(key);
                    return (
                      <button
                        key={key}
                        onClick={() => actions.toggleGrant(key)}
                        className="flex w-full items-center justify-between gap-3 py-2 text-[13px] text-mist"
                      >
                        <span>{label}</span>
                        <span
                          className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                            on ? "bg-mint/25 text-mint" : "bg-white/10 text-mist/60"
                          }`}
                        >
                          {on ? "On" : "Off"}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1 max-w-sm px-0.5 text-[11px] text-[#A78CC9]">
                  Skippable — everything here can be adjusted per person, later.
                </p>
              </>
            )}
          </Anchor>

          <p className="mt-6 text-xs text-[#A78CC9]">
            Works with no signal. The floor doesn’t need wifi.
          </p>
        </Anchor>
      </div>
    );
  }

  if (step === "scanning") {
    return (
      <div className={`${shell} justify-center`}>
        <Orbs />
        <Anchor id="CER-4" className="relative z-10 flex w-full flex-col items-center">
          {eyebrow("Meet")}
          <h2 className="mt-1 text-2xl font-medium">Point at their code</h2>
          <div className="relative mt-6 h-[250px] w-[250px] overflow-hidden rounded-[20px] bg-black/45">
            <div className="absolute top-3 left-3 h-7 w-7 border-t-2 border-l-2 border-mint" />
            <div className="absolute top-3 right-3 h-7 w-7 border-t-2 border-r-2 border-mint" />
            <div className="absolute bottom-3 left-3 h-7 w-7 border-b-2 border-l-2 border-mint" />
            <div className="absolute right-3 bottom-3 h-7 w-7 border-r-2 border-b-2 border-mint" />
            <div className="scanline" />
          </div>
          <Btn variant="ghost" className="mt-6 text-mist" onClick={() => actions.cancelScan()}>
            Cancel
          </Btn>
        </Anchor>
      </div>
    );
  }

  const peerName = state.ceremony.peer?.displayName ?? "";
  if (step === "confirm") {
    return (
      <div className={`${shell} justify-center`}>
        <Orbs />
        <Anchor id="CER-4" className="relative z-10 flex w-full flex-col items-center">
          {eyebrow("Found someone")}
          <div className="mt-3">
            <Avatar id={peerName.toLowerCase()} name={peerName} size={104} />
          </div>
          <h2 className="mt-3 text-2xl font-medium">{peerName}</h2>
          <div className="mt-2 rounded-full border border-white/20 bg-white/12 px-3 py-1 text-xs text-mist">
            ☀ Ecstatic Dance Palermo · today
          </div>
          <p className="mt-3 text-[13.5px] text-mist/85">Is this the person in front of you?</p>

          <LevelPills selected={confirmedLevel} onPick={(l) => actions.pickLevel(l)} />

          <p className="mt-2.5 max-w-xs text-[11.5px] text-mist/70">
            Contact = cards only, the easy default. You can grow it later.
          </p>

          <Btn
            variant="coral"
            className="mt-4 w-full max-w-xs"
            disabled={!confirmedLevel}
            onClick={() => actions.confirmPeer()}
          >
            Yes — this is {peerName}
          </Btn>
          <Btn variant="ghost" className="mt-2 text-mist" onClick={() => actions.cancelScan()}>
            Cancel
          </Btn>
        </Anchor>
      </div>
    );
  }

  if (step === "weaving") {
    return (
      <div className={`${shell} justify-center`}>
        <Orbs />
        <div className="relative z-10 flex w-full flex-col items-center">
          {eyebrow("One moment")}
          <h2 className="mt-1 text-2xl font-medium">Weaving…</h2>
          <svg className="mt-4" width={230} height={60} viewBox="0 0 230 60">
            <defs>
              <linearGradient id="wv" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#4FD7A0" />
                <stop offset="1" stopColor="#12A8E3" />
              </linearGradient>
            </defs>
            <path
              d="M5 30 C 60 5, 90 55, 115 30 S 190 5, 225 30"
              fill="none"
              stroke="url(#wv)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray="300"
              strokeDashoffset="300"
            >
              <animate
                attributeName="stroke-dashoffset"
                from="300"
                to="0"
                dur="1.1s"
                fill="freeze"
              />
            </path>
          </svg>
          <p className="mt-2 text-[13.5px] text-mist/85">{peerName} is confirming you on their phone.</p>
        </div>
      </div>
    );
  }

  // step === "celebrate" — App.tsx swaps in CelebrateScreen
  return null;
}
