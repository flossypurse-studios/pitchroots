import Image from "next/image";
import { sourceLogoPath } from "@/lib/source-logos";

// The source's own mark, beside its own name — never the source's article
// images (SPEC §3). `alt=""` because the adjacent name is already the label;
// a sighted-only decoration shouldn't be announced twice to a screen reader.
export function SourceLogo({ name, size = 18 }: { name: string; size?: number }) {
  const src = sourceLogoPath(name);
  if (src) {
    return (
      <Image
        src={src}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        className="shrink-0 rounded-full border border-line bg-card object-contain"
      />
    );
  }
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full border border-line bg-line font-bold text-muted"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.55) }}
    >
      {initial}
    </span>
  );
}
