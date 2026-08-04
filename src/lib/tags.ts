export type TagDef = {
  slug: string;
  label: string;
  // Compact nav-pill label for long names; hub pages and the footer keep `label`.
  shortLabel?: string;
  blurb: string;
  group: "league" | "national" | "competition" | "cross" | "province";
};

// Canonical tag vocabulary. The classifier may only assign slugs from this list,
// and hub pages are generated from it — keep the two in lockstep.
export const TAGS: TagDef[] = [
  { slug: "canmnt", label: "CanMNT", blurb: "Canada's men's national team", group: "national" },
  { slug: "canwnt", label: "CanWNT", blurb: "Canada's women's national team", group: "national" },
  { slug: "canpl", label: "CPL", blurb: "Canadian Premier League", group: "league" },
  { slug: "nsl", label: "NSL", blurb: "Northern Super League", group: "league" },
  { slug: "mls", label: "MLS", blurb: "Canada's MLS clubs — Toronto FC, Vancouver Whitecaps, CF Montréal", group: "league" },
  { slug: "league1", label: "League1", blurb: "League1 Canada — Ontario, BC, Québec", group: "league" },
  { slug: "world-cup", label: "World Cup", blurb: "Canada and the FIFA World Cup — 2026 co-hosts", group: "competition" },
  { slug: "canadian-championship", label: "Canadian Championship", shortLabel: "Can. Championship", blurb: "The Canadian Championship — the country's domestic cup", group: "competition" },
  { slug: "womens", label: "Women's", blurb: "Women's soccer across Canada", group: "cross" },
  { slug: "youth", label: "Youth", blurb: "Youth and development soccer", group: "cross" },
  { slug: "alberta", label: "Alberta", blurb: "Soccer in Alberta", group: "province" },
  { slug: "british-columbia", label: "British Columbia", blurb: "Soccer in British Columbia", group: "province" },
  { slug: "saskatchewan", label: "Saskatchewan", blurb: "Soccer in Saskatchewan", group: "province" },
  { slug: "manitoba", label: "Manitoba", blurb: "Soccer in Manitoba", group: "province" },
  { slug: "ontario", label: "Ontario", blurb: "Soccer in Ontario", group: "province" },
  { slug: "quebec", label: "Québec", blurb: "Soccer in Québec", group: "province" },
  { slug: "new-brunswick", label: "New Brunswick", blurb: "Soccer in New Brunswick", group: "province" },
  { slug: "nova-scotia", label: "Nova Scotia", blurb: "Soccer in Nova Scotia", group: "province" },
  { slug: "prince-edward-island", label: "PEI", blurb: "Soccer in Prince Edward Island", group: "province" },
  { slug: "newfoundland-labrador", label: "Newfoundland", blurb: "Soccer in Newfoundland and Labrador", group: "province" },
];

export const TAG_SLUGS = TAGS.map((t) => t.slug);
export const tagBySlug = (slug: string) => TAGS.find((t) => t.slug === slug);
// Nav shows the leagues/nationals; provinces are reachable via item tags + sitemap.
export const NAV_TAGS = TAGS.filter((t) => t.group !== "province");
