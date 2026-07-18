/**
 * Anchor registry — MUST mirror docs/60-anchors.md (three-place rule now spans:
 * this file, docs/60, and <Anchor id> usages in apps/web). Checked by
 * `pnpm check:anchors`. IDs are per-domain, monotonic, never recycled.
 */
export interface AnchorInfo {
  title: string;
  contract: string;
  doc: string;
  status: "spec" | "placeholder";
}

export const ANCHORS: Record<string, AnchorInfo> = {
  "ONB-1": { title: "Welcome / threshold screen", contract: "Entry offers signup or logged-out browsing; identity is device-local, no account", doc: "docs/20 §Onboarding", status: "spec" },
  "ONB-2": { title: "Quick vs Advanced signup (welcome screen)", contract: "One screen: Quick card active, Advanced card greyed placeholder with explainer sheet", doc: "docs/20 §Onboarding · docs/30 ADR-6", status: "spec" },
  "ONB-3": { title: "Recovery verse (Advanced)", contract: "12-word phrase display + keep confirmation — deferred", doc: "docs/20 §Onboarding · docs/30 ADR-7", status: "placeholder" },
  "ONB-4": { title: "Server pick + view source (Advanced)", contract: "Relay/server selectable at signup — deferred", doc: "docs/20 §Onboarding · docs/30 ADR-5", status: "placeholder" },
  "ONB-5": { title: "Name entry", contract: "Display name is self-asserted, editable, not unique", doc: "docs/20 §Onboarding", status: "spec" },
  "DIS-1": { title: "Gatherings | Offers segments", contract: "Discovery is the default surface; events and offers are parallel browse sets", doc: "docs/20 §Discovery", status: "spec" },
  "DIS-2": { title: "Public event card", contract: "Public events render for everyone incl. logged-out", doc: "docs/20 §Discovery", status: "spec" },
  "DIS-3": { title: "Gated event card", contract: "Visibility predicate returns items or NOTHING — never a locked/teaser state", doc: "docs/20 §Event visibility", status: "spec" },
  "DIS-4": { title: "Map view", contract: "Same visibility predicate as list; gated markers only when opened", doc: "docs/20 §Discovery", status: "spec" },
  "DIS-5": { title: "Logged-out state + join pitch", contract: "Public browse without identity; pitch explains member benefits", doc: "docs/20 §Onboarding", status: "spec" },
  "HST-1": { title: "Create form", contract: "Host-authored event record; location can be gated separately from existence", doc: "docs/20 §Events", status: "spec" },
  "HST-2": { title: "Tier picker + rings visual", contract: "Tiers: Public / The Commons / Friends / Close friends, mapped to ladder minimums", doc: "docs/20 §Event visibility", status: "spec" },
  "HST-3": { title: "Advanced fold (steps)", contract: "Path-distance limit (1–3 steps) is advanced; default 2", doc: "docs/20 §Event visibility", status: "spec" },
  "HST-4": { title: "Reach list", contract: "Consenting people's names + approximate remainder; never non-consenting names", doc: "docs/20 §Consent", status: "spec" },
  "HST-5": { title: "Publish action", contract: "Publishing distributes per ADR-1 mechanism; host can edit/withdraw", doc: "docs/20 §Events · docs/30 ADR-1", status: "spec" },
  "CER-1": { title: "Share composer", contract: "Offered level preset (Contact default); channels QR default + NFC, AirDrop deferred, no links", doc: "docs/20 §Handshake", status: "spec" },
  "CER-2": { title: "Advanced atomic permissions", contract: "Pre-share permission atoms; skippable, adjustable later", doc: "docs/20 §Permissions", status: "spec" },
  "CER-3": { title: "Handshake payload (QR)", contract: "DID, name, enc key, nonce+TTL, offered level; offline-capable; replay bar → ADR-13", doc: "docs/20 §Handshake", status: "spec" },
  "CER-4": { title: "Scan + confirm", contract: "Human confirms the person, picks level; auto-filled event context", doc: "docs/20 §Handshake", status: "spec" },
  "CER-5": { title: "Mutual confirmation + celebration", contract: "Counter-attestation completes the pair; celebration only on mutual", doc: "docs/20 §Handshake", status: "spec" },
  "WEB-1": { title: "Rings layout", contract: "Ego-centric rings, never a global graph; ring 1 direct, ring 2 through-connections", doc: "docs/20 §Web view", status: "spec" },
  "WEB-2": { title: "Person node + path sheet", contract: "Named path explanations; no numeric trust values", doc: "docs/20 §Web view", status: "spec" },
  "WEB-4": { title: "Asymmetry labeling", contract: "Symmetric by default; one-way visibility always labeled 'sees you: no'", doc: "docs/20 §Consent", status: "spec" },
  "WEB-5": { title: "Offer badges on nodes", contract: "People offering you something show a mint dot; offers mirror on your node in their webs", doc: "docs/20 §Resources", status: "spec" },
  "INT-1": { title: "Introduction suggestion card", contract: "Quiet, dismissable, max 1–2; inputs are needs/offers/non-adjacency", doc: "docs/20 §Introductions · docs/30 ADR-12", status: "spec" },
  "INT-2": { title: "Introduce flow", contract: "Introducer consents both sides into contact; neither party auto-connected", doc: "docs/20 §Introductions", status: "spec" },
  "PPL-1": { title: "Contact list", contract: "Ladder level + connection state per person; met-in-person context", doc: "docs/20 §Relationships", status: "spec" },
  "PPL-2": { title: "Person sheet", contract: "Card view, level change entry, asymmetry label, placeholder entries", doc: "docs/20 §Relationships", status: "spec" },
  "RES-1": { title: "Offer card (browse)", contract: "Item, owner, tier badge, via-path; same visibility predicate as events", doc: "docs/20 §Resources", status: "spec" },
  "RES-2": { title: "Request sheet", contract: "Request goes to owner as a Chat item; no public request state", doc: "docs/20 §Resources", status: "spec" },
  "RES-3": { title: "My resources management", contract: "Owner lists items w/ per-item tier; Available/Requested/On loan/Returning", doc: "docs/20 §Resources", status: "spec" },
  "RES-4": { title: "Loan state machine", contract: "requested→lent→returned→complete; both parties transition independently", doc: "docs/20 §Resources", status: "spec" },
  "RES-5": { title: "Completion check-in", contract: "'Do you feel complete?' both sides; 'not yet' visible only to own Close circle", doc: "docs/20 §Completions", status: "spec" },
  "RES-6": { title: "Second-degree extension", contract: "Friend asks to offer my item to their web; owner approval; revocable", doc: "docs/20 §Resources", status: "spec" },
  "RES-7": { title: "Anonymous offer via mutual", contract: "Offer visible, identity withheld; connection only through the mutual's introduction", doc: "docs/20 §Resources", status: "spec" },
  "ACT-1": { title: "Chat tab badge", contract: "Counts items awaiting ME; no engagement bait", doc: "docs/20 §Chat", status: "spec" },
  "ACT-2": { title: "Chat feed", contract: "Message threads (intro-gated DMs) + activity items", doc: "docs/20 §Chat", status: "spec" },
  "YOU-1": { title: "Profile + keys section", contract: "Copy reflects signup path (Quick: device-held keys)", doc: "docs/20 §Onboarding", status: "spec" },
  "YOU-2": { title: "Visibility dial", contract: "Symmetric default; exceptions labeled; off = absent, no counts", doc: "docs/20 §Consent", status: "spec" },
  "YOU-3": { title: "What you offer", contract: "Owner-side resource management ('Borrowed by you' is separate)", doc: "docs/20 §Resources", status: "spec" },
  "YOU-4": { title: "Settings", contract: "Keys, upgrade-to-advanced placeholder, source — subscreen under You", doc: "docs/20 §Onboarding", status: "spec" },
  "PLC-1": { title: "Raise a flag (amends)", contract: "PLACEHOLDER — restorative process, not punitive strikes", doc: "docs/70 §Amends", status: "placeholder" },
  "PLC-2": { title: "Tag chips", contract: "PLACEHOLDER — personal labels for future blanket permissions", doc: "docs/70 §Tags", status: "placeholder" },
  "PLC-3": { title: "Blanket permissions by tag", contract: "PLACEHOLDER — per-tag permission atoms manager", doc: "docs/70 §Tags", status: "placeholder" },
};

export type AnchorId = keyof typeof ANCHORS;
