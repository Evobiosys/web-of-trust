import { useEffect, useRef, useState } from "react";
import { TIER_LABEL } from "@ew/contract";
import type { EventRecord, Offer } from "@ew/contract";
import type { Nav } from "../App";
import { useApp } from "../lib/connector-context";
import { Anchor } from "../components/Anchor";
import {
  Avatar,
  Badge,
  Btn,
  Card,
  Hdr,
  PathBox,
  Seg,
  SheetMeta,
  SheetTitle,
  useSheet,
} from "../components/ui";

const PRIVATE_CARD = "bg-gradient-to-br from-[#F6FBF8] to-[#F0F6FB] border-l-[3px] border-mint";

const CHIPS = ["This week", "Ecstatic Dance", "Biodanza", "Contact Improv", "Hangouts"];

const MAP_CAPTION = "The city at night. Each light is a gathering; threads are your people between them.";
const LIST_CAPTION = "Public events in your city. What your web opens, appears here too — quietly.";

export function DiscoverScreen({ nav }: { nav: Nav }) {
  const { state, actions } = useApp();
  const sheet = useSheet();
  const [top, setTop] = useState<"gatherings" | "offers">("gatherings");
  const [gath, setGath] = useState<"list" | "map">("list");

  const nameById: Record<string, string> = {};
  state.people.forEach((p) => {
    nameById[p.id] = p.name;
  });
  if (state.me) nameById["me"] = state.me.name;
  const nameOf = (id?: string) =>
    (id && nameById[id]) || (id ? id.charAt(0).toUpperCase() + id.slice(1) : "Someone");

  function openOffersLocked() {
    sheet.open(
      <div>
        <SheetTitle>Offers live inside the web</SheetTitle>
        <SheetMeta>
          Speakers, DJ tables, cacao, venues — shared between people who have actually met. Join to
          see what your people offer.
        </SheetMeta>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <Hdr title="Discover" right={<span>Buenos Aires ▾</span>} />

      <div className="flex-1 overflow-y-auto px-4 pb-28">
        <Anchor id="DIS-1">
          <Seg
            options={[
              { value: "gatherings", label: "Gatherings" },
              { value: "offers", label: "Offers" },
            ]}
            value={top}
            onChange={(v) => {
              if (v === "offers" && state.guest) {
                openOffersLocked();
                return;
              }
              setTop(v);
            }}
          />
        </Anchor>

        {top === "gatherings" ? (
          <div className="mt-3">
            <Seg
              options={[
                { value: "list", label: "List" },
                { value: "map", label: "Map" },
              ]}
              value={gath}
              onChange={setGath}
            />

            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {CHIPS.map((c, i) => (
                <button
                  key={c}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-[13px] font-semibold ${
                    i === 0 ? "bg-vio text-white" : "bg-mist text-ink-soft"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>

            {gath === "list" ? (
              <div className="mt-3 flex flex-col gap-3">
                {state.guest && (
                  <Anchor id="DIS-5">
                    <Card className={PRIVATE_CARD}>
                      <h3 className="text-lg font-semibold">This is the public floor</h3>
                      <div className="mt-1 text-[13px] leading-relaxed text-ink-soft">
                        Join the web of trust and more appears — private gatherings your friends open
                        to you, things to borrow from your people, and the people they hold. Built on
                        real, in-person meetings.
                      </div>
                    </Card>
                  </Anchor>
                )}

                {state.visibleEvents.map((ev) => (
                  <EventCard key={ev.id} ev={ev} />
                ))}

                <p className="px-1 pt-1 text-[12px] leading-relaxed text-ink-soft">{LIST_CAPTION}</p>
              </div>
            ) : (
              <Anchor id="DIS-4">
                <div className="mt-3">
                  <MapView unlocked={state.unlocked} />
                  <p className="px-1 pt-2 text-[12px] leading-relaxed text-ink-soft">{MAP_CAPTION}</p>
                </div>
              </Anchor>
            )}
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            {state.visibleOffers.map((offer) => (
              <Anchor id="RES-1" key={offer.id}>
                <OfferCard offer={offer} nameOf={nameOf} onOpen={() => openOfferSheet(offer)} />
              </Anchor>
            ))}
            <p className="px-1 pt-1 text-[12px] leading-relaxed text-ink-soft">
              What your web shares. Ask, borrow, bring it back — and both of you say whether it felt
              complete.
            </p>
          </div>
        )}
      </div>

      <button
        className="absolute right-4 bottom-24 rounded-full bg-coral px-5 py-3.5 font-bold text-white shadow-[0_8px_24px_rgba(255,113,91,0.4)]"
        onClick={() => {
          if (state.guest) {
            sheet.open(
              <div>
                <SheetTitle>Hosting needs a web</SheetTitle>
                <SheetMeta>
                  Join first — then you can host gatherings and decide exactly who can see them:
                  everyone, the commons, friends, or close friends only.
                </SheetMeta>
              </div>
            );
            return;
          }
          nav.openOverlay("host");
        }}
      >
        ＋ Host
      </button>
    </div>
  );

  function openOfferSheet(offer: Offer) {
    if (offer.mine) {
      const stateLabel = offer.state === "available" ? "Available" : offer.state;
      sheet.open(
        <Anchor id="RES-3">
          <SheetTitle>{offer.item}</SheetTitle>
          <SheetMeta>
            Offered to: <b>{TIER_LABEL[offer.tier]}</b> · state: <b>{stateLabel}</b>
            {offer.extendedVia?.length
              ? ` · also reaches ${nameOf(offer.extendedVia[0])}'s web (you can withdraw that anytime)`
              : ""}
          </SheetMeta>
          <PathBox>
            You decide who can even see this — same doors as gatherings. Requests arrive in Chat;
            nothing is public.
          </PathBox>
        </Anchor>
      );
      return;
    }

    if (offer.identityWithheld) {
      const via = nameOf(offer.viaId);
      sheet.open(
        <Anchor id="RES-7">
          <SheetTitle>Someone, via {via}</SheetTitle>
          <SheetMeta>
            They offer <b>{offer.item}</b> to {via}'s web — without sharing their name or how to reach
            them.
          </SheetMeta>
          <PathBox>
            Want it? {via} can connect you — introductions happen only with both sides' yes.
          </PathBox>
          <Btn onClick={() => sheet.close()}>Ask {via} to connect you</Btn>
        </Anchor>
      );
      return;
    }

    const owner = nameOf(offer.ownerId);
    sheet.open(
      <Anchor id="RES-2">
        <SheetTitle>{offer.item}</SheetTitle>
        <SheetMeta>
          {owner} · offered to {TIER_LABEL[offer.tier]}
        </SheetMeta>
        <PathBox>{offer.description}</PathBox>
        {offer.state === "available" ? (
          <Btn
            variant="coral"
            onClick={() => {
              actions.requestBorrow(offer.id);
              sheet.close();
            }}
          >
            Ask to borrow
          </Btn>
        ) : (
          <div className="text-[13.5px] font-semibold text-mint-deep">
            {offer.state === "requested"
              ? `Requested — waiting for ${owner}`
              : "Borrowed by you — mark it returned in Chat"}
          </div>
        )}
      </Anchor>
    );
  }
}

function EventCard({ ev }: { ev: EventRecord }) {
  const gated = ev.tier !== "public";
  return (
    <Anchor id={gated ? "DIS-3" : "DIS-2"}>
      <Card className={`${gated ? `${PRIVATE_CARD} reveal` : ""}`}>
        <h3 className="text-lg font-semibold">{ev.name}</h3>
        <div className="mt-1 text-[13px] leading-relaxed text-ink-soft">{ev.meta}</div>
        <div className="mt-2">
          <EventBadge ev={ev} />
        </div>
        {gated &&
          (ev.mine ? (
            <div className="mt-2 text-[13px] text-mint-deep">
              ☾ Doors: {TIER_LABEL[ev.tier].toLowerCase()}, within {ev.steps} step
              {ev.steps > 1 ? "s" : ""}
            </div>
          ) : (
            <div className="mt-2 text-[13px] text-mint-deep">
              ☾ Opened by your web{ev.reachedVia ? ` — via ${ev.reachedVia}` : ""}
            </div>
          ))}
      </Card>
    </Anchor>
  );
}

function EventBadge({ ev }: { ev: EventRecord }) {
  if (ev.linked) return <Badge kind="link">Linked · CI</Badge>;
  if (ev.kind === "hangout") return <Badge kind="hang">Hangout</Badge>;
  if (ev.tier === "public") return <Badge kind="pub">Public</Badge>;
  return <Badge kind="priv">{`Private · ${ev.mine ? "yours" : "your web"}`}</Badge>;
}

function OfferCard({
  offer,
  nameOf,
  onOpen,
}: {
  offer: Offer;
  nameOf: (id?: string) => string;
  onOpen: () => void;
}) {
  const anonymous = Boolean(offer.identityWithheld);
  const owner = offer.mine ? "Yours" : anonymous ? `Someone · via ${nameOf(offer.viaId)}` : nameOf(offer.ownerId);
  return (
    <Card className="cursor-pointer" onClick={onOpen}>
      <h3 className="text-lg font-semibold">{offer.item}</h3>
      <div className="mt-1 text-[13px] leading-relaxed text-ink-soft">{offer.description}</div>
      <div className="mt-2 flex items-center gap-2 text-[13px] font-semibold text-ink">
        {anonymous ? (
          <Avatar dashed name="Someone" size={26} />
        ) : (
          <Avatar id={offer.mine ? "me" : offer.ownerId} name={nameOf(offer.mine ? "me" : offer.ownerId)} size={26} />
        )}
        <span>{owner}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge kind="pub">{TIER_LABEL[offer.tier]}</Badge>
        {offer.state === "requested" && <Badge kind="loan">Requested</Badge>}
        {offer.state === "lent" && <Badge kind="loan">{offer.mine ? "On loan" : "Borrowed by you"}</Badge>}
        {offer.extendedVia?.length ? (
          <Badge kind="priv">{`Also offered via ${nameOf(offer.extendedVia[0])}`}</Badge>
        ) : null}
      </div>
    </Card>
  );
}

function MapView({ unlocked }: { unlocked: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const x = canvas.getContext("2d");
    if (!x) return;

    const W = canvas.clientWidth || 356;
    const H = 300;
    canvas.width = W;
    canvas.height = H;
    const sx = W / 356;
    x.setTransform(sx, 0, 0, 1, 0, 0);

    x.clearRect(0, 0, 356, 300);
    const g = x.createLinearGradient(0, 0, 356, 300);
    g.addColorStop(0, "#221038");
    g.addColorStop(1, "#0E2A40");
    x.fillStyle = g;
    x.fillRect(0, 0, 356, 300);

    // faint street hints
    x.strokeStyle = "rgba(237,230,242,.07)";
    x.lineWidth = 1;
    for (let i = 0; i < 7; i++) {
      x.beginPath();
      x.moveTo(i * 60 - 30, 0);
      x.lineTo(i * 60 + 30, 300);
      x.stroke();
      x.beginPath();
      x.moveTo(0, i * 50 - 20);
      x.lineTo(356, i * 50 + 20);
      x.stroke();
    }

    const pts: number[][] = [
      [90, 80],
      [240, 70],
      [170, 160],
      [70, 220],
      [280, 210],
    ];
    if (unlocked) pts.push([225, 145]);

    // threads
    x.lineWidth = 1.4;
    for (let j = 0; j < pts.length - 1; j++) {
      const lg = x.createLinearGradient(pts[j][0], pts[j][1], pts[j + 1][0], pts[j + 1][1]);
      lg.addColorStop(0, "rgba(79,215,160,.5)");
      lg.addColorStop(1, "rgba(18,168,227,.5)");
      x.strokeStyle = lg;
      x.beginPath();
      x.moveTo(pts[j][0], pts[j][1]);
      x.quadraticCurveTo(
        (pts[j][0] + pts[j + 1][0]) / 2 + 18,
        (pts[j][1] + pts[j + 1][1]) / 2 - 18,
        pts[j + 1][0],
        pts[j + 1][1]
      );
      x.stroke();
    }

    // markers
    for (let k = 0; k < pts.length; k++) {
      const isPriv = unlocked && k === pts.length - 1;
      const col = isPriv ? "#4FD7A0" : "#12A8E3";
      const rg = x.createRadialGradient(pts[k][0], pts[k][1], 1, pts[k][0], pts[k][1], 16);
      rg.addColorStop(0, col);
      rg.addColorStop(1, "rgba(0,0,0,0)");
      x.fillStyle = rg;
      x.beginPath();
      x.arc(pts[k][0], pts[k][1], 16, 0, 7);
      x.fill();
      x.fillStyle = "#fff";
      x.beginPath();
      x.arc(pts[k][0], pts[k][1], 3.2, 0, 7);
      x.fill();
    }
  }, [unlocked]);

  return <canvas ref={ref} className="w-full rounded-2xl" style={{ height: 300 }} />;
}
