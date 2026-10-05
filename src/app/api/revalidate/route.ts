import { revalidatePath } from "next/cache";
import { GAME_TAG_SLUGS, TAG_SLUGS } from "@/lib/tags";

// On-demand revalidation, called by the durable ingestion worker after a run
// publishes new items (see supabase/functions/poll — triggerRevalidate). The
// worker lives outside this app now, so it can't call revalidatePath() directly;
// it POSTs here instead. Bearer-protected with the same shared secret the worker
// carries. A missed call is harmless — pages still refresh on the ISR timer.
//
// Every response is JSON. Failures are `{ error: "<code>" }` with the right
// status and never carry a stack or framework HTML; the detail goes to the log.
function fail(status: number, error: string, message?: string): Response {
  return Response.json(message ? { error, message } : { error }, { status });
}

export async function POST(request: Request) {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret) {
    // Fail loud on misconfiguration rather than accepting `Bearer undefined`.
    console.error("[revalidate] revalidate.misconfigured: REVALIDATE_SECRET is not set");
    return fail(500, "revalidate.misconfigured");
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return fail(401, "revalidate.unauthorized");
  }
  try {
    revalidatePath("/");
    revalidatePath("/news");
    revalidatePath("/games");
    for (const slug of TAG_SLUGS) revalidatePath(`/news/${slug}`);
    for (const slug of GAME_TAG_SLUGS) revalidatePath(`/games/${slug}`);
  } catch (err) {
    // Log the class and message only, never the raw object.
    const e = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error(`[revalidate] revalidate.failed: ${e}`);
    return fail(500, "revalidate.failed", "Pages will refresh on their normal timer.");
  }
  return Response.json({
    revalidated: true,
    paths: 3 + TAG_SLUGS.length + GAME_TAG_SLUGS.length,
  });
}
