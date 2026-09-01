/**
 * You {YOU-*} — your identity, consent dial, offers, borrows, settings entry.
 * Copy ported from mockup/index.html (v7). Domain via useApp(); sheets via useSheet().
 */
import type { Nav } from "../App";
import { useApp } from "../lib/connector-context";
import { Avatar, Btn, Card, Hdr, SheetMeta, SheetTitle, useSheet } from "../components/ui";
import { Anchor } from "../components/Anchor";

const CHIP = "rounded-full bg-mist px-2.5 py-0.5 text-[11px] text-vio-deep";
const LOAN_CHIP = "rounded-full bg-[#fdeee9] px-2.5 py-0.5 text-[11px] text-[#a3472f]";

export function YouScreen({ nav }: { nav: Nav }) {
  const { state, actions } = useApp();
  const { open } = useSheet();

  const name = state.me?.name ?? "You";
  const boxes = state.visibleOffers.find((o) => o.id === "boxes");
  const boxesExtended = (boxes?.extendedVia?.length ?? 0) > 0;
  const speakers = state.visibleOffers.find((o) => o.id === "speakers");
  const speakersLent = speakers?.state === "lent";

  return (
    <div className="flex h-full flex-col">
      <Hdr title="You" />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-28">
        <div className="flex flex-col gap-3.5">
          <Anchor id="YOU-1" className="flex flex-col items-center gap-1.5 py-3">
            <Avatar id="me" name={name} size={84} />
            <h3 className="text-[22px]">{name}</h3>
            <span className="text-[10.5px] tracking-widest text-ink-soft uppercase">
              This identity lives on this phone
            </span>
          </Anchor>

          <Anchor id="YOU-2">
            <Card>
              <h3>Show me to people my people trust</h3>
              <p className="mt-1 text-ink-soft">
                When this is on, someone your people connect with can see your name in their second
                ring. Off, and you simply don't appear there.
              </p>
              <Btn
                variant={state.dialOn ? "electric" : "ghost"}
                size="sm"
                className="mt-2.5"
                aria-pressed={state.dialOn}
                onClick={() => actions.setDial(!state.dialOn)}
              >
                {state.dialOn ? "On" : "Off"}
              </Btn>
            </Card>
          </Anchor>

          <Anchor id="YOU-3">
            <Card>
              <h3>What you offer</h3>
              <p className="mt-2 flex items-center justify-between gap-2">
                Moving boxes (20, flat-packed)
                <span className={CHIP}>Available{boxesExtended ? " · via Rafa too" : ""}</span>
              </p>
              <Btn
                variant="ghost"
                size="sm"
                className="mt-2.5 pl-0"
                onClick={() =>
                  open(
                    <div>
                      <SheetTitle>Offer something</SheetTitle>
                      <SheetMeta>
                        Name it, photograph it, choose its doors (same tiers as gatherings: The
                        Commons / Friends / Close friends), and it appears to the people you chose.
                        Demo-only in this prototype.
                      </SheetMeta>
                    </div>
                  )
                }
              >
                ＋ Offer something
              </Btn>
            </Card>
          </Anchor>

          <Card>
            <h3>Borrowed by you</h3>
            <p className="mt-2 flex items-center justify-between gap-2">
              {speakersLent ? "Lucía's PA speakers" : "Nothing right now"}
              <span className={speakersLent ? LOAN_CHIP : CHIP}>
                {speakersLent ? "bring back" : "all returned"}
              </span>
            </p>
          </Card>

          <Anchor id="YOU-4">
            <Card
              className="w-full cursor-pointer text-left"
              onClick={() => nav.openOverlay("settings")}
            >
              <h3>Settings ›</h3>
              <p className="mt-1 text-[13px] text-ink-soft">Your keys · upgrades · the source</p>
            </Card>
          </Anchor>

          <Anchor id="PLC-3">
            <Btn
              variant="plc"
              className="w-full"
              onClick={() =>
                open(
                  <div>
                    <SheetTitle>Held for a later pass</SheetTitle>
                    <SheetMeta>
                      Tags will let you group your people (#neighbour, #organizer…) and grant sharing
                      permissions to a whole tag at once — atomic underneath, bulk on top. Spec stub:
                      docs/70.
                    </SheetMeta>
                  </div>
                )
              }
            >
              ＃ Blanket permissions by tag — held for a future circle
            </Btn>
          </Anchor>

          <div className="rounded-2xl border border-mint/35 bg-gradient-to-br from-mint/15 to-white p-4 text-[13px] leading-relaxed">
            <b>Yours, not ours.</b> Your people, your events, your web — stored here, carried by you,
            shown only when you choose. There is no account to close because there is no account.
          </div>
        </div>
      </div>
    </div>
  );
}
