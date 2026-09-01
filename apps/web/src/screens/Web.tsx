/**
 * WebScreen — the ego-centric web of trust {WEB-*}. Two views:
 *   Rings  — nodes on dashed rings, threads drawn between the people who hold
 *            each other; taps open path-explaining sheets. {WEB-1/2/4, RES-7, INT-1/2}
 *   People — a flat contact list for ring-1 people. {PPL-1/2}
 * All domain data comes through useApp(); nothing is invented locally.
 */
import { ReactNode, useState } from "react";
import { LEVEL_LABEL, PersonView } from "@ew/contract";
import { useApp } from "../lib/connector-context";
import { Anchor } from "../components/Anchor";
import { Avatar, Btn, Card, Hdr, PathBox, Seg, SheetMeta, SheetTitle, useSheet } from "../components/ui";
import { useOpenThread } from "../components/ThreadSheet";

type View = "rings" | "people";

/** deg=0 is up (12 o'clock). Coordinates are in a 0–100 percent space. */
function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function threadPath(x1: number, y1: number, x2: number, y2: number): string {
  const mx = (x1 + x2) / 2 + (y2 - y1) * 0.12;
  const my = (y1 + y2) / 2 + (x1 - x2) * 0.12;
  return `M${x1} ${y1} Q${mx} ${my} ${x2} ${y2}`;
}

const FIXED: Record<1 | 2, Record<string, number>> = {
  1: { lucia: 210, rafa: 330, maria: 90 },
  2: { bruno: 235, sofia: 55, nico: 125, "anon-projector": 160 },
};

interface Node {
  p: PersonView;
  x: number;
  y: number;
}

function layout(people: PersonView[], fixed: Record<string, number>, r: number): Node[] {
  const unfixed = people.filter((p) => !(p.id in fixed));
  return people.map((p) => {
    const deg =
      p.id in fixed
        ? fixed[p.id]
        : (360 / Math.max(unfixed.length, 1)) * unfixed.indexOf(p);
    const [x, y] = polar(50, 50, r, deg);
    return { p, x, y };
  });
}

function TagChips({ tags }: { tags: string[] }) {
  const chip = "rounded-full border border-dashed border-ink/30 px-2.5 py-1 text-[11px] font-semibold text-ink-soft";
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {tags.map((t) => (
        <span key={t} className={chip}>
          {t}
        </span>
      ))}
      <span className={`${chip} opacity-60`}>＋ tag</span>
    </div>
  );
}

export function WebScreen() {
  const { state, actions } = useApp();
  const { open, close } = useSheet();
  const openThread = useOpenThread();
  const [view, setView] = useState<View>("rings");

  const ring1 = state.people.filter((p) => p.ring === 1);
  const ring2 = state.people.filter((p) => p.ring === 2);
  const intro = state.intro;

  /* ---------- sheets ---------- */
  const openFlag = () =>
    open(
      <div>
        <SheetTitle>Held for a future circle</SheetTitle>
        <SheetMeta>
          When someone causes harm in a trusted space, there will be a path that repairs rather than
          punishes — context-scoped, no public marks, restoration named by the people affected. It
          isn't designed yet, on purpose: the community shapes it first. Spec stub: docs/70.
        </SheetMeta>
      </div>
    );

  const openRing1 = (p: PersonView) => {
    const lvl = p.level ? LEVEL_LABEL[p.level] : "";
    open(
      <Anchor id="WEB-2">
        <SheetTitle>{p.name}</SheetTitle>
        <SheetMeta>
          {lvl} · met at {p.metContext}
        </SheetMeta>
        <PathBox>
          You ⟷ <b>{p.name}</b> — Connected in person, confirmed both ways — you hold each other's
          thread.
        </PathBox>
        {p.offer && (
          <PathBox>
            ◉ Offers {p.offer} — see it under Discover → Offers.
          </PathBox>
        )}
        <Anchor id="PLC-2">
          <TagChips tags={["#neighbour", "#handy", "#organizer"]} />
        </Anchor>
        <div className="mt-3 flex flex-col gap-2">
          <Btn variant="electric" className="w-full" onClick={() => openThread(p.id, p.name)}>
            Message
          </Btn>
          <Btn variant="ghost" className="w-full">
            Open their card
          </Btn>
          <Btn variant="ghost" className="w-full">
            Vouch for something they do
          </Btn>
          <Anchor id="PLC-1">
            <Btn variant="plc" className="w-full" onClick={openFlag}>
              ⚑ Raise a flag — held for a future circle
            </Btn>
          </Anchor>
        </div>
      </Anchor>
    );
  };

  const openRing2 = (p: PersonView) =>
    open(
      <div>
        <SheetTitle>{p.name}</SheetTitle>
        <SheetMeta>In your second ring — you haven't met yet.</SheetMeta>
        <PathBox>
          You ⟷ <b>{p.via}</b> ⟷ <b>{p.name}</b> — {p.via} knows them in person. Meet them to add
          your own connection.
        </PathBox>
        {p.seesYou === false && (
          <PathBox tone="warn">
            <b>⚠ Sees you: no.</b> {p.name} turned their dial off for this path, so they can't see
            you here. Visibility is mutual by default — when it isn't, it's always shown, never
            silent.
          </PathBox>
        )}
        <Btn variant="ghost" className="w-full">
          Ask {p.via} to introduce you
        </Btn>
        <p className="mt-2 text-xs text-ink-soft">
          Direct messages open after an introduction — consent first.
        </p>
      </div>
    );

  const openAnon = (p: PersonView) =>
    open(
      <Anchor id="RES-7">
        <SheetTitle>Someone, via Maria</SheetTitle>
        <SheetMeta>
          They offer <b>a projector</b> to Maria's web — without sharing their name or how to reach
          them.
        </SheetMeta>
        <PathBox>
          Want it? Maria can connect you — introductions happen only with both sides' yes.
        </PathBox>
        <Btn variant="electric" className="w-full" onClick={close}>
          Ask Maria to connect you
        </Btn>
      </Anchor>
    );

  const openPerson = (p: PersonView) => {
    if (p.anonymous) return openAnon(p);
    if (p.ring === 1) return openRing1(p);
    return openRing2(p);
  };

  const openIntroConfirm = () =>
    open(
      <Anchor id="INT-2">
        <SheetTitle>Introduce Rafa and Lucía</SheetTitle>
        <SheetMeta>
          You'd share each of their cards with the other — nothing more. They each choose whether to
          meet. Neither is connected to the other until they do their own twenty seconds, face to
          face.
        </SheetMeta>
        <div className="mt-3 flex flex-col gap-2">
          <Btn
            variant="coral"
            className="w-full"
            onClick={() => {
              if (intro) actions.introduce(intro.id);
              close();
            }}
          >
            Share both cards
          </Btn>
          <Btn variant="ghost" className="w-full" onClick={close}>
            Cancel
          </Btn>
        </div>
      </Anchor>
    );

  /* ---------- node rendering ---------- */
  const r1nodes = layout(ring1, FIXED[1], 22);
  const r2nodes = layout(ring2, FIXED[2], 40);
  const byName = new Map<string, Node>();
  for (const n of r1nodes) byName.set(n.p.name, n);

  const threads: string[] = [];
  for (const n of r1nodes) threads.push(threadPath(50, 50, n.x, n.y));
  for (const n of r2nodes) {
    const via = n.p.via ? byName.get(n.p.via) : undefined;
    if (via) threads.push(threadPath(via.x, via.y, n.x, n.y));
  }

  const renderNode = (n: Node): ReactNode => {
    const p = n.p;
    const anon = !!p.anonymous;
    const asym = p.seesYou === false;
    const anchorId = anon ? "RES-7" : asym ? "WEB-4" : undefined;
    const sub = "text-[9.5px] text-ink-soft";
    const node = (
      <button
        onClick={() => openPerson(p)}
        className="flex flex-col items-center gap-[3px] text-center"
      >
        <Avatar id={p.id} name={p.name} size={46} offdot={!!p.offer && !p.anonymous} dashed={p.anonymous} />
        <span className="text-[11.5px] font-semibold">{anon ? "Someone" : p.name}</span>
        {anon ? (
          <span className={sub}>
            offers {p.offer} · via {p.via}
          </span>
        ) : (
          <>
            {p.ring === 1 && p.level && <span className={sub}>{LEVEL_LABEL[p.level]}</span>}
            {p.ring === 2 && p.via && <span className={sub}>via {p.via}</span>}
            {p.offer && <span className="text-[9.5px] font-medium text-mint-deep">offers {p.offer}</span>}
            {asym && <span className="text-[9.5px] text-[#a3472f]">⚠ sees you: no</span>}
          </>
        )}
      </button>
    );
    return (
      <div
        key={p.id}
        className="absolute"
        style={{ left: `${n.x}%`, top: `${n.y}%`, transform: "translate(-50%,-50%)" }}
      >
        {anchorId ? <Anchor id={anchorId}>{node}</Anchor> : node}
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col">
      <Hdr
        title="Your Web"
        right={
          <span>
            {ring1.length} connected · {ring2.length} beyond
          </span>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto pb-28">
        <div className="px-5">
          <Seg<View>
            options={[
              { value: "rings", label: "Rings" },
              { value: "people", label: "People" },
            ]}
            value={view}
            onChange={setView}
          />
        </div>

        {view === "rings" ? (
          <>
            <Anchor
              id="WEB-1"
              className="relative mx-auto mt-4 h-[min(92vw,380px)] w-[min(92vw,380px)]"
            >
              <svg viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 h-full w-full">
                <defs>
                  <linearGradient id="ew-thread" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor="#4FD7A0" />
                    <stop offset="1" stopColor="#12A8E3" />
                  </linearGradient>
                </defs>
                {[22, 40].map((r) => (
                  <circle
                    key={r}
                    cx="50"
                    cy="50"
                    r={r}
                    fill="none"
                    stroke="rgba(154,55,240,.20)"
                    strokeWidth="1.4"
                    strokeDasharray="3 6"
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
                {threads.map((d, i) => (
                  <path
                    key={i}
                    d={d}
                    fill="none"
                    stroke="url(#ew-thread)"
                    strokeWidth="1.8"
                    opacity="0.75"
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </svg>

              {r1nodes.map(renderNode)}
              {r2nodes.map(renderNode)}

              <div
                className="absolute"
                style={{ left: "50%", top: "50%", transform: "translate(-50%,-50%)" }}
              >
                <div className="flex flex-col items-center gap-[3px]">
                  <span
                    className="inline-flex rounded-full"
                    style={{ boxShadow: "0 0 0 3px #fff, 0 0 22px rgba(154,55,240,.55)" }}
                  >
                    <Avatar id="me" name={state.me?.name ?? "You"} size={56} />
                  </span>
                  <span className="text-[11.5px] font-semibold">{state.me?.name ?? "You"}</span>
                </div>
              </div>
            </Anchor>

            <p className="mx-auto mt-3 max-w-[300px] px-5 text-center text-[13px] leading-relaxed text-ink-soft">
              People you have met, and the people they hold. Tap anyone to see the path between you.
            </p>

            {intro && intro.status !== "dismissed" && (
              <div className="px-5">
                <div className="pt-[22px] pb-1.5 text-center text-[11px] uppercase tracking-[0.14em] text-ink-soft">
                  Threads that could meet
                </div>
                <Anchor id="INT-1">
                  <Card className="bg-gradient-to-br from-[#f6fbf8] to-[#f7f3fb] text-[13.5px] leading-relaxed">
                    {intro.status === "done" ? (
                      <span>
                        <b>Introduced ✓</b> Rafa and Lucía each hold the other's card now. The rest
                        is theirs.
                      </span>
                    ) : (
                      <>
                        <span>
                          <b>Rafa</b> is looking for speakers for Sunday. <b>Lucía</b> has a pair —
                          they don't know each other, but they both know you.
                        </span>
                        <div className="mt-2.5 flex gap-2">
                          <Btn variant="electric" size="sm" onClick={openIntroConfirm}>
                            Introduce them
                          </Btn>
                          <Btn variant="ghost" size="sm" onClick={() => actions.dismissIntro(intro.id)}>
                            Let it be
                          </Btn>
                        </div>
                      </>
                    )}
                  </Card>
                </Anchor>
              </div>
            )}
          </>
        ) : (
          <Anchor id="PPL-1" className="block px-5 pt-4">
            <div className="flex flex-col gap-2">
              {ring1.map((p) => (
                <button
                  key={p.id}
                  onClick={() => openPeople(p)}
                  className="flex items-center gap-3 rounded-2xl bg-white p-3.5 text-left shadow-[0_2px_14px_rgba(36,27,46,0.07)]"
                >
                  <Avatar id={p.id} name={p.name} />
                  <div className="min-w-0 flex-1">
                    <b className="block text-[15.5px]">{p.name}</b>
                    <span className="block text-[12.5px] text-ink-soft">{p.metContext}</span>
                  </div>
                  {p.state === "mutual" ? (
                    <span className="rounded-full bg-mint/15 px-2.5 py-1 text-[11px] font-bold text-mint-deep">
                      Connected
                    </span>
                  ) : p.state === "pending_out" ? (
                    <span className="rounded-full bg-electric/10 px-2.5 py-1 text-[11px] font-bold text-electric-deep">
                      Pending
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
            <p className="mt-3 px-1 text-[13px] text-ink-soft">
              {ring1.length} people, all met in person. Tap anyone for their card.
            </p>
          </Anchor>
        )}
      </div>
    </div>
  );

  /* ---------- People-view sheet ---------- */
  function openPeople(p: PersonView) {
    open(
      <Anchor id="PPL-2">
        <SheetTitle>{p.name}</SheetTitle>
        <SheetMeta>{p.metContext}</SheetMeta>
        <PathBox>
          <b>Their card</b> — What {p.name} chooses to share with you: how to reach them, what's
          going on nearby, what they offer. Updates itself when they change it.
        </PathBox>
        <Anchor id="PLC-2">
          <TagChips tags={["#neighbour"]} />
        </Anchor>
        <div className="mt-3 flex flex-col gap-2">
          <Btn variant="electric" className="w-full" onClick={() => openThread(p.id, p.name)}>
            Message
          </Btn>
          <Btn variant="ghost" className="w-full">
            Grow this connection
          </Btn>
          {p.state === "pending_out" && (
            <Btn variant="ghost" className="w-full">
              Waiting for {p.name} to confirm
            </Btn>
          )}
          <Anchor id="PLC-1">
            <Btn variant="plc" className="w-full" onClick={openFlag}>
              ⚑ Raise a flag — held for a future circle
            </Btn>
          </Anchor>
        </div>
      </Anchor>
    );
  }
}
