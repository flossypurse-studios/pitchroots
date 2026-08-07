import { ImageResponse } from "next/og";
import { TAGS, tagBySlug } from "@/lib/tags";

// A root-level opengraph-image.tsx only applies to `/` — it is a per-segment file
// convention, not a site-wide default. Without this file the hub pages shipped no
// og:image at all, so every share rendered as a bare link against the
// summary_large_image card declared in the root layout.
export const alt = "PitchRoots — Canadian soccer news, one feed";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export function generateStaticParams() {
  return TAGS.map((t) => ({ tag: t.slug }));
}

export default async function Image({
  params,
}: {
  params: Promise<{ tag: string }>;
}) {
  const { tag } = await params;
  const def = tagBySlug(tag);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#123b1e",
          backgroundImage:
            "linear-gradient(90deg, rgba(255,255,255,0.06) 0 50%, rgba(255,255,255,0) 50% 100%)",
          backgroundSize: "200px 100%",
          color: "white",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "6px solid rgba(255,255,255,0.9)",
            borderRadius: 24,
            padding: "28px 64px",
            background: "rgba(18,59,30,0.85)",
          }}
        >
          <div style={{ fontSize: 84, fontWeight: 900, letterSpacing: -3 }}>
            {def?.label ?? "PitchRoots"}
          </div>
        </div>
        <div style={{ marginTop: 32, fontSize: 36, color: "#e6eedd" }}>
          {def?.blurb ?? "Canadian soccer news, one feed"}
        </div>
        <div style={{ marginTop: 14, fontSize: 26, color: "#9fe0b0" }}>
          PitchRoots — Canadian soccer news, one feed
        </div>
      </div>
    ),
    { ...size },
  );
}
