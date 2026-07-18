import { businessProfile } from "./business.js";
import { ecstaticProfile } from "./ecstatic.js";
import { familyProfile } from "./family.js";
import { housingProfile } from "./housing.js";
import type { AppProfile } from "./types.js";

export type { AppProfile, MobileSkin, SuggestionGroup } from "./types.js";

/** All shipped app profiles, ecstatic first (it is also the fallback). */
export const ALL_PROFILES: AppProfile[] = [ecstaticProfile, housingProfile, familyProfile, businessProfile];

const PROFILES_BY_ID: Record<AppProfile["id"], AppProfile> = {
  ecstatic: ecstaticProfile,
  housing: housingProfile,
  family: familyProfile,
  business: businessProfile,
};

/** Looks up a profile by id (case-sensitive, exact match against the
 * `AppProfile["id"]` union). Any unknown or missing id falls back to
 * `ecstatic`. */
export function getProfile(id: string): AppProfile {
  return PROFILES_BY_ID[id as AppProfile["id"]] ?? ecstaticProfile;
}
