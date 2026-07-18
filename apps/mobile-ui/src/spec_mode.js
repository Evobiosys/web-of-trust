// @ts-check
// Spec mode: the anchor registry (mirrors docs/60-anchors.md) + the badge
// overlay + tap-to-open-contract sheet. Collaborators rely on this.

import { $ } from "./dom.js";
import { openSheet } from "./sheet.js";

/** @type {Record<string, { t: string, c: string, d: string }>} */
export const ANCHORS = {
  "ONB-1": { t: "Welcome / threshold screen", c: "Entry offers signup or logged-out browsing; identity is device-local, no account", d: "docs/20 §Onboarding" },
  "ONB-2": { t: "Quick vs Advanced signup", c: "Two equal paths side-by-side; Quick = auto-managed keys, Advanced = verse + server choice", d: "docs/20 §Onboarding · docs/30 ADR-6" },
  "ONB-3": { t: "Recovery verse (Advanced)", c: "12-word phrase display + keep confirmation", d: "docs/20 §Onboarding · docs/30 ADR-7" },
  "ONB-4": { t: "Server pick + view source", c: "Relay/server selectable at signup; source link communicated", d: "docs/20 §Onboarding · docs/30 ADR-5" },
  "ONB-5": { t: "Name entry", c: "Display name is self-asserted, editable, not unique", d: "docs/20 §Onboarding" },
  "DIS-1": { t: "Gatherings | Offers segments", c: "Discovery is the default surface; events and offers are parallel browse sets", d: "docs/20 §Discovery" },
  "DIS-2": { t: "Public event card", c: "Public events render for everyone incl. logged-out", d: "docs/20 §Discovery" },
  "DIS-3": { t: "Gated event card", c: "Visibility predicate returns items or NOTHING — never a locked/teaser state", d: "docs/20 §Event visibility" },
  "DIS-4": { t: "Map view", c: "Same visibility predicate as list; gated markers only when opened", d: "docs/20 §Discovery" },
  "DIS-5": { t: "Logged-out state + join pitch", c: "Public browse without identity; pitch explains member benefits", d: "docs/20 §Onboarding" },
  "HST-1": { t: "Create form", c: "Host-authored event record; location can be gated separately from existence", d: "docs/20 §Events" },
  "HST-2": { t: "Tier picker + rings visual", c: "Tiers: Public / The Commons / Friends / Close friends, mapped to ladder minimums", d: "docs/20 §Event visibility" },
  "HST-3": { t: "Advanced fold (steps)", c: "Path-distance limit (1–3 steps) is advanced; default 2", d: "docs/20 §Event visibility" },
  "HST-4": { t: "Reach list", c: "Consenting people's names + '+N held privately'; never non-consenting names", d: "docs/20 §Consent" },
  "HST-5": { t: "Publish action", c: "Publishing distributes per ADR-1 mechanism; host can edit/withdraw", d: "docs/20 §Events · docs/30 ADR-1" },
  "CER-1": { t: "Share composer", c: "Offered level preset (Contact default); channel = QR/NFC/AirDrop/link, same payload", d: "docs/20 §Handshake" },
  "CER-2": { t: "Advanced atomic permissions", c: "Pre-share permission atoms (context-limit, sharing types); skippable, adjustable later", d: "docs/20 §Permissions" },
  "CER-3": { t: "Handshake payload (QR)", c: "Payload: DID, name, enc key, nonce, ts, offered level; works offline", d: "docs/20 §Handshake" },
  "CER-4": { t: "Scan + confirm", c: "Human confirms the person, picks level; auto-filled event context", d: "docs/20 §Handshake" },
  "CER-5": { t: "Mutual confirmation + celebration", c: "Counter-attestation completes the pair; celebration only on mutual", d: "docs/20 §Handshake" },
  "WEB-1": { t: "Rings layout", c: "Ego-centric rings, never a global graph; ring 1 direct, ring 2 through-connections", d: "docs/20 §Web view" },
  "WEB-2": { t: "Person node + path sheet", c: "Named path explanations; no numeric trust values", d: "docs/20 §Web view" },
  "WEB-4": { t: "Asymmetry labeling", c: "Symmetric by default; one-way visibility always labeled 'sees you: no'", d: "docs/20 §Consent" },
  "WEB-5": { t: "Offer badges on nodes", c: "People offering you something show a mint dot; your offers mirror on your node in their webs", d: "docs/20 §Resources" },
  "INT-1": { t: "Introduction suggestion card", c: "Quiet, dismissable, max 1–2; inputs are needs/offers/non-adjacency", d: "docs/20 §Introductions · docs/30 ADR-12" },
  "INT-2": { t: "Introduce flow", c: "Introducer consents both sides into contact; neither party auto-connected", d: "docs/20 §Introductions" },
  "PPL-1": { t: "Contact list", c: "Ladder level + connection state per person; met-in-person context", d: "docs/20 §Relationships" },
  "PPL-2": { t: "Person sheet", c: "Card view, level change entry, asymmetry label, placeholder entries", d: "docs/20 §Relationships" },
  "RES-1": { t: "Offer card (browse)", c: "Item, owner, tier badge, via-path; same visibility predicate as events", d: "docs/20 §Resources" },
  "RES-2": { t: "Request sheet", c: "Request goes to owner as Activity; no public request state", d: "docs/20 §Resources" },
  "RES-3": { t: "My resources management", c: "Owner lists items w/ per-item tier; Available/Requested/On loan/Returning", d: "docs/20 §Resources" },
  "RES-4": { t: "Loan state machine", c: "requested→lent→returned→complete; both parties transition independently", d: "docs/20 §Resources" },
  "RES-5": { t: "Completion check-in", c: "'Do you feel complete?' both sides; 'not yet' visible only to own Close circle", d: "docs/20 §Completions" },
  "RES-6": { t: "Second-degree extension", c: "Friend asks to offer my item to their web; owner approval required; revocable", d: "docs/20 §Resources" },
  "RES-7": { t: "Anonymous offer via mutual", c: "Offer visible, identity withheld; connection only through the mutual's introduction", d: "docs/20 §Resources" },
  "ACT-1": { t: "Bell + badge", c: "Badge counts items awaiting ME; no engagement bait", d: "docs/20 §Activity" },
  "ACT-2": { t: "Activity list", c: "Item types: borrow-request, extension-approval, return-confirm, completion-check-in", d: "docs/20 §Activity" },
  "YOU-1": { t: "Profile + keys section", c: "Copy reflects signup path (Quick: device-held keys; Advanced: verse)", d: "docs/20 §Onboarding" },
  "YOU-2": { t: "Visibility dial", c: "Symmetric default; exceptions labeled; off = appear only as private count", d: "docs/20 §Consent" },
  "YOU-3": { t: "What you offer + Borrowed", c: "Owner-side resource management entry", d: "docs/20 §Resources" },
  "YOU-4": { t: "Settings", c: "Keys, upgrade-to-advanced placeholder, source — lives under You", d: "docs/20 §Onboarding" },
  "PLC-1": { t: "Raise a flag (amends)", c: "PLACEHOLDER — restorative process, not punitive strikes; needs community input", d: "docs/70 §Amends" },
  "PLC-2": { t: "Tag chips", c: "PLACEHOLDER — personal labels forming groups for future blanket permissions", d: "docs/70 §Tags" },
  "PLC-3": { t: "Blanket permissions by tag", c: "PLACEHOLDER — per-tag permission atoms manager", d: "docs/70 §Tags" },
};

/** @param {boolean} on */
export function setSpec(on) {
  $("phone").setAttribute("data-spec", on ? "on" : "off");
  $("specBtn").setAttribute("aria-pressed", on ? "true" : "false");
}

/** Wire the spec toggle button, #spec hash, and the anchor-tap delegate. */
export function initSpec() {
  $("specBtn").onclick = () => {
    setSpec($("phone").getAttribute("data-spec") !== "on");
  };
  if (location.hash === "#spec") setSpec(true);
  $("phone").addEventListener(
    "click",
    (e) => {
      if ($("phone").getAttribute("data-spec") !== "on") return;
      const target = /** @type {Element} */ (e.target);
      if (target.closest(".sheet") || target.closest(".sheet-veil")) return;
      const a = target.closest("[data-anchor]");
      if (!a) return;
      e.preventDefault();
      e.stopPropagation();
      const id = a.getAttribute("data-anchor") || "";
      const info = ANCHORS[id] || { t: "(unregistered)", c: "Add this ID to the ANCHORS registry + docs/60-anchors.md", d: "—" };
      openSheet(
        '<div class="grab"></div><span class="spec-sheet-id">' + id + "</span>" +
          "<h3>" + info.t + "</h3>" +
          '<div class="path">' + info.c + "</div>" +
          '<div class="meta">Spec: <b>' + info.d + "</b> · registry: docs/60-anchors.md · rule: CONTRIBUTING.md (three-place)</div>"
      );
    },
    true
  );
}
