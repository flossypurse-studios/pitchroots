import { ImageResponse } from "next/og";

export const alt = "PitchRoots — Canadian soccer news, one feed";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
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
            padding: "40px 72px",
            background: "rgba(18,59,30,0.85)",
          }}
        >
          <div style={{ fontSize: 110, fontWeight: 900, letterSpacing: -3 }}>
            Pitch
          </div>
          <div
            style={{
              fontSize: 110,
              fontWeight: 900,
              letterSpacing: -3,
              color: "#9fe0b0",
            }}
          >
            Roots
          </div>
        </div>
        <div style={{ marginTop: 36, fontSize: 40, color: "#e6eedd" }}>
          Canadian soccer news, one feed
        </div>
      </div>
    ),
    { ...size },
  );
}
