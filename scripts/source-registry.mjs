// Snapshot of the `sources` table (name, home_url, active, retired, ua_override),
// committed so the logo fetcher and anyone auditing it can run without a database
// connection. Source of truth is still `db/schema.sql`'s insert/update statements
// — re-sync this file by hand (or from a read-only query) if the registry
// changes. Pulled 2026-10-22.
//
// `ua_override` is copied from the same column the ingestion pipeline uses: some
// of these CDNs refuse a non-browser User-Agent outright (CBC answered the plain
// fetcher with a dropped connection, not even a 4xx, until given this UA).
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export const SOURCES = [
  { id: 2, name: "Sportsnet Soccer", home_url: "https://www.sportsnet.ca/soccer/", active: true, retired: false, ua_override: null },
  { id: 3, name: "Northern Tribune", home_url: "https://northerntribune.ca", active: true, retired: false, ua_override: BROWSER_UA },
  { id: 4, name: "League1 Ontario", home_url: "https://league1ontario.com", active: true, retired: false, ua_override: null },
  { id: 5, name: "CBC Soccer", home_url: "https://www.cbc.ca/sports/soccer", active: true, retired: false, ua_override: BROWSER_UA },
  { id: 16, name: "Alberta Soccer", home_url: "https://www.albertasoccer.com", active: true, retired: false, ua_override: null },
  { id: 17, name: "Soccer Nova Scotia", home_url: "https://soccerns.ca", active: true, retired: false, ua_override: null },
  { id: 18, name: "Daily Hive Offside", home_url: "https://dailyhive.com/channel/offside", active: true, retired: false, ua_override: null },
  { id: 19, name: "Canada Soccer", home_url: "https://news.canadasoccer.com", active: true, retired: false, ua_override: null },
  { id: 35, name: "TrueNorthFoot", home_url: "https://truenorthfoot.ca", active: true, retired: false, ua_override: null },
  { id: 36, name: "The Third Sub", home_url: "https://thethirdsub.ca", active: true, retired: false, ua_override: null },
  { id: 37, name: "AFTN", home_url: "https://www.aftn.ca", active: true, retired: false, ua_override: null },
  { id: 38, name: "Waking The Red", home_url: "https://wakingthered.com", active: true, retired: false, ua_override: null },
  { id: 39, name: "Edmonton Journal Soccer", home_url: "https://edmontonjournal.com/category/sports/soccer/", active: true, retired: false, ua_override: null },
  { id: 40, name: "Calgary Herald Soccer", home_url: "https://calgaryherald.com/category/sports/soccer/", active: true, retired: false, ua_override: null },
  { id: 41, name: "The Province Soccer", home_url: "https://theprovince.com/category/sports/soccer/", active: true, retired: false, ua_override: null },
  { id: 42, name: "Toronto Sun Soccer", home_url: "https://torontosun.com/category/sports/soccer/", active: false, retired: true, ua_override: BROWSER_UA },
  { id: 43, name: "Windsor Star Soccer", home_url: "https://windsorstar.com/category/sports/soccer/", active: false, retired: true, ua_override: BROWSER_UA },
  { id: 44, name: "Sudbury Star Soccer", home_url: "https://thesudburystar.com/category/sports/soccer/", active: false, retired: true, ua_override: BROWSER_UA },
  { id: 45, name: "Sault Star Soccer", home_url: "https://saultstar.com/category/sports/soccer/", active: false, retired: true, ua_override: BROWSER_UA },
  { id: 46, name: "Kingston Whig-Standard Soccer", home_url: "https://thewhig.com/category/sports/soccer/", active: false, retired: true, ua_override: BROWSER_UA },
  { id: 47, name: "Globe and Mail Soccer", home_url: "https://www.theglobeandmail.com/sports/soccer/", active: true, retired: false, ua_override: null },
  { id: 48, name: "Winnipeg Free Press Soccer", home_url: "https://www.winnipegfreepress.com/sports/soccer/", active: false, retired: true, ua_override: null },
  { id: 49, name: "Toronto Star Soccer", home_url: "https://www.thestar.com/sports/soccer/", active: false, retired: true, ua_override: null },
  // Added 2026-10-26 by db/migrations/2026-10-26-canpl-forge-connector.sql, which is
  // NOT applied yet: id is null until it is, then copy in the id the insert assigned.
  // Read through the `forge` connector (JSON API), not RSS.
  { id: null, name: "CanPL", home_url: "https://www.cplsoccer.com", active: true, retired: false, ua_override: null },
];
