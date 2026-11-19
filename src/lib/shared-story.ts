import { cache } from "react";
import { pinnedItem } from "@/lib/db";
import { parseShareId } from "@/lib/share";

// The story a shared link (`?s=<id>`, #561) pins, or null for an invalid or
// unknown id — the caller then renders the plain page. React cache dedupes
// the metadata and page lookups within one render.
export const sharedStory = cache(async (raw: string) => {
  const id = parseShareId(raw);
  return id === null ? null : pinnedItem(id);
});
