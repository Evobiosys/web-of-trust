// DecisionLogEntry — invariant I6 (auditability): every agent decision is
// logged locally, human-readable. This package exports only the shape; the
// daemon owns actually writing/reading a log (protocol has no I/O).
import { z } from "zod";
import { IsoDateTimeSchema } from "./schemas.js";

export const DecisionLogEntrySchema = z
  .object({
    ts: IsoDateTimeSchema,
    request_id: z.string().uuid(),
    actor: z.enum(["asker", "owner"]),
    /** free-text action label, e.g. "sent_request" | "status_pass" | "consented" | "declined" | "withdrawn" | "room_created". */
    action: z.string().min(1),
    /** optional human-readable rationale (never wire-transmitted; local audit only). */
    reason: z.string().optional(),
  })
  .strict();
export type DecisionLogEntry = z.infer<typeof DecisionLogEntrySchema>;
