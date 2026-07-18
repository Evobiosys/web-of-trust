import { describe, expect, it } from "vitest";
import {
  DEFAULT_GRANT,
  Edge,
  EventRecord,
  Offer,
  eventVisible,
  offerVisible,
  pathReaches,
} from "../src/index.js";

const g = (over: Partial<Edge> & Pick<Edge, "a" | "b">): Edge => ({
  levelAtoB: "friend",
  levelBtoA: "friend",
  state: "mutual",
  grantAtoB: DEFAULT_GRANT,
  grantBtoA: DEFAULT_GRANT,
  ...over,
});

// me — maria — sofia ; me — lucia(close) ; me —pending— tomas
const graph = {
  edges: [
    g({ a: "me", b: "maria" }),
    g({ a: "maria", b: "sofia" }),
    g({ a: "me", b: "lucia", levelAtoB: "close", levelBtoA: "close" }),
    g({ a: "me", b: "tomas", state: "pending_out" }),
  ],
};

const ev = (over: Partial<EventRecord>): EventRecord => ({
  id: "e",
  name: "Moon Ceremony",
  meta: "",
  tier: "friends",
  steps: 2,
  hostIds: ["sofia"],
  kind: "ceremony",
  ...over,
});

describe("pathReaches", () => {
  it("finds a 2-hop friend path", () => {
    expect(pathReaches(graph, "me", ["sofia"], "friend", 2)).toBe(true);
  });
  it("respects the steps limit", () => {
    expect(pathReaches(graph, "me", ["sofia"], "friend", 1)).toBe(false);
  });
  it("every hop must satisfy the tier minimum", () => {
    expect(pathReaches(graph, "me", ["sofia"], "close", 2)).toBe(false);
  });
  it("pending edges are not usable — mutual only", () => {
    expect(pathReaches(graph, "me", ["tomas"], "contact", 1)).toBe(false);
  });
  it("effective level is the min of both directions", () => {
    const asym = { edges: [g({ a: "me", b: "x", levelAtoB: "close", levelBtoA: "contact" })] };
    expect(pathReaches(asym, "me", ["x"], "friend", 1)).toBe(false);
    expect(pathReaches(asym, "me", ["x"], "contact", 1)).toBe(true);
  });
});

describe("eventVisible — the invisibility predicate", () => {
  it("public is visible to guests (null viewer)", () => {
    expect(eventVisible(graph, null, ev({ tier: "public" }))).toBe(true);
  });
  it("anything gated is invisible to guests", () => {
    expect(eventVisible(graph, null, ev({ tier: "commons" }))).toBe(false);
  });
  it("friends tier opens through a qualifying path", () => {
    expect(eventVisible(graph, "me", ev({}))).toBe(true);
  });
  it("close tier stays closed over friend-level hops", () => {
    expect(eventVisible(graph, "me", ev({ tier: "close" }))).toBe(false);
  });
  it("close tier opens over a close direct edge", () => {
    expect(eventVisible(graph, "me", ev({ tier: "close", hostIds: ["lucia"], steps: 1 }))).toBe(true);
  });
});

describe("offerVisible", () => {
  const offer = (over: Partial<Offer>): Offer => ({
    id: "o",
    item: "speakers",
    description: "",
    ownerId: "lucia",
    tier: "friends",
    state: "available",
    ...over,
  });
  it("direct owner path works like events", () => {
    expect(offerVisible(graph, "me", offer({}))).toBe(true);
  });
  it("anonymous offers anchor on the via person, never the owner", () => {
    const o = offer({ ownerId: undefined, identityWithheld: true, viaId: "maria" });
    expect(offerVisible(graph, "me", o)).toBe(true);
    const oNoVia = offer({ ownerId: undefined, identityWithheld: true });
    expect(offerVisible(graph, "me", oNoVia)).toBe(false);
  });
  it("guests see no offers", () => {
    expect(offerVisible(graph, null, offer({}))).toBe(false);
  });
  it("per-offer steps limit is honored", () => {
    // sofia is 2 hops away; an offer of hers with steps:1 must be invisible
    const o = offer({ ownerId: "sofia", steps: 1 });
    expect(offerVisible(graph, "me", o)).toBe(false);
    expect(offerVisible(graph, "me", offer({ ownerId: "sofia", steps: 2 }))).toBe(true);
  });
});
