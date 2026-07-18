// Store — the one persistence seam (I5). Everything above this interface
// (lifecycle, matcher, steward, REST/WS) talks only to `Store`; nothing above
// it knows whether the backing engine is better-sqlite3 or node:sqlite (D6).
import type { Item, TrustEdge } from "@resource-web/protocol";
import type {
  AskRecord,
  AuditRecord,
  DmMessageRecord,
  IncomingRecord,
  ListingRecord,
  LoanRecord,
  PendingCaptureRecord,
  ReceivedListingRecord,
  RelayLinkRecord,
  RoomMessageRecord,
  RoomRecord,
  StewardLogRecord,
} from "./types.js";

export interface Store {
  // items
  putItem(item: Item): void;
  getItems(): Item[];
  getItem(id: string): Item | undefined;

  // item embedding cache (matcher chain stage 1)
  getItemEmbedding(itemId: string, model: string): number[] | undefined;
  putItemEmbedding(itemId: string, model: string, vector: number[]): void;

  // trust edges
  putTrustEdge(edge: TrustEdge): void;
  getTrustEdges(): TrustEdge[];
  getTrustEdge(peer: string): TrustEdge | undefined;
  removeTrustEdge(peer: string): void;

  // asks (asker-side lifecycle)
  putAsk(ask: AskRecord): void;
  getAsk(requestId: string): AskRecord | undefined;
  getAsks(): AskRecord[];

  // incoming (owner-side lifecycle + consent cards)
  putIncoming(record: IncomingRecord): void;
  getIncoming(cardId: string): IncomingRecord | undefined;
  getIncomingByRequestAndPeer(requestId: string, requesterPeer: string): IncomingRecord | undefined;
  getIncomings(): IncomingRecord[];

  // relay links (I8 two-hop consent chain bookkeeping)
  putRelayLink(link: RelayLinkRecord): void;
  getRelayLinkByDownstream(downstreamRequestId: string): RelayLinkRecord | undefined;

  // rooms + messages
  putRoom(room: RoomRecord): void;
  getRoom(roomId: string): RoomRecord | undefined;
  getRooms(): RoomRecord[];
  addRoomMessage(msg: RoomMessageRecord): void;
  getRoomMessages(roomId: string): RoomMessageRecord[];

  // steward chat log
  addStewardLog(entry: StewardLogRecord): void;
  getStewardLog(): StewardLogRecord[];

  // pending capture proposals (confirm-before-save)
  putPendingCapture(record: PendingCaptureRecord): void;
  getLatestPendingCapture(): PendingCaptureRecord | undefined;
  clearPendingCapture(proposalId: string): void;

  // audit log (I6)
  addAudit(entry: AuditRecord): void;
  getAudit(): AuditRecord[];

  // D14: listings I own ("listings_mine")
  putListing(record: ListingRecord): void;
  getListing(listingId: string): ListingRecord | undefined;
  getListings(): ListingRecord[];

  // D14: listings received from others, direct or forwarded ("listings_received")
  putReceivedListing(record: ReceivedListingRecord): void;
  getReceivedListing(listingId: string): ReceivedListingRecord | undefined;
  getReceivedListings(): ReceivedListingRecord[];

  // D14: loans (borrow lifecycle)
  putLoan(record: LoanRecord): void;
  getLoan(loanId: string): LoanRecord | undefined;
  getLoans(): LoanRecord[];

  // D14: DM threads
  addDmMessage(msg: DmMessageRecord): void;
  getDmMessages(peer: string): DmMessageRecord[];
  getDmPeers(): string[];

  close(): void;
}
