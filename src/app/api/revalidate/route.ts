import { revalidatePath } from "next/cache";
import { GAME_TAG_SLUGS, TAG_SLUGS } from "@/lib/tags";

// On-demand revalidation, called by the durable ingestion worker after a run
// publishes new items (see supabase/functions/poll — triggerRevalidate). The
// worker lives outside this app now, so it can't call revalidatePath() directly;
// it POSTs here instead. Bearer-protected with the same shared secret the worker
// carries. A missed call is harmless — pages still refresh on the ISR timer.
export async function POST(request: Request) {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret) {
    // Fail loud on misconfiguration rather than accepting `Bearer undefined`.
    return new Response("Server misconfiguration", { status: 500 });
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  revalidatePath("/");
  revalidatePath("/news");
  revalidatePath("/games");
  for (const slug of TAG_SLUGS) revalidatePath(`/news/${slug}`);
  for (const slug of GAME_TAG_SLUGS) revalidatePath(`/games/${slug}`);
  return Response.json({
    revalidated: true,
    paths: 3 + TAG_SLUGS.length + GAME_TAG_SLUGS.length,
  });
}
