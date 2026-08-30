# Logic Solar SEO Audit — logic-solar.com

**Date:** 2026-08-30 · **Scope:** technical, on-page, keywords, local · **Pages in sitemap:** 613 (8 static, 605 location)

## Executive summary

The site's biggest problem is not titles or keywords — it's that **~600 of its 613 pages ship as an empty JavaScript shell**. Every city page (and every core service page) serves the homepage's HTML — homepage title, homepage meta description, and a **canonical tag pointing to the homepage** — until JavaScript runs in the visitor's browser. To Google's first-pass crawler, the entire programmatic local-SEO build looks like 600 duplicates of the homepage. This single issue explains the "title inconsistencies" seen in the preliminary index review and caps the value of everything else on the site.

**Reconciled with the 2026-08-24 code-side audit** ("Logic Solar — SEO & GEO Audit (2026-08-24)" in Drive, run against `Compass2026/Logic-Solar` @ cd8f787): the repo already **has** a prerender pipeline (`scripts/prerender.js`) that is supposed to give every static/state/city route real HTML with unique tags and body copy. The live site proves that output is **not being served** for ~600 routes — state hubs come out prerendered, but city pages (including the flagship Austin/KC/Wichita pages), `/solar-landing`, and the un-prerendered routes all fall through to the SPA catch-all. So the headline fix is not "build SSG" — it's **diagnose why the existing prerender output isn't deployed/served** (Vercel build step, output routing, or the catch-all rewrite winning over the generated files), which is far cheaper.

---

## P0 — Critical (do these first)

### 1. Pre-render every route (city pages + service pages)
- **Evidence:** `/locations/texas/austin`, `/locations/missouri/kansas-city`, `/locations/kansas/wichita`, `/locations/illinois/chicago`, and `/adders` all return the homepage's 2.6 KB HTML shell: homepage title, homepage description, `<link rel="canonical" href="https://logic-solar.com">`. Body is `<div id="root"></div>` — zero content. `/about`, `/services/*`, `/financing`, `/faq`, `/contact` have correct per-page head tags but **empty bodies** (~1.8 KB each).
- **Contrast:** state hubs (`/locations/texas`, `/locations/colorado`) are pre-rendered (~11 KB) with real H1s, copy, and unique meta — these are done right.
- **Why it matters:** the raw-HTML canonical on every city page tells Google "this page IS the homepage." A client-side effect later rewrites title/description/canonical, but that only applies after Google's render pass — slow, unreliable at 600-page scale, and contradicted by the initial HTML.
- **Fix:** in `Compass2026/Logic-Solar`, diagnose why the existing `scripts/prerender.js` output isn't served in production (build step, output paths, or the Vercel catch-all rewrite beating the generated files), then extend prerender + sitemap coverage to the routes it never covered (`/services/incentives`, `/services/how-it-works`, `/roofing`, `/privacy`, `/terms` — all confirmed live serving the homepage canonical). Every page should ship full HTML with its own title, description, canonical, H1, and body copy.

### 2. Pick one canonical host (www) and align everything
- **Evidence:** the server 308-redirects `logic-solar.com` → `www.logic-solar.com`, so **www is the real host**. But every pre-rendered canonical, every sitemap URL, the robots.txt sitemap reference, and all `og:url` tags use **non-www**. Meanwhile the client-side JS sets canonicals from `window.location` → **www**. Google is being told three different things.
- **Fix:** standardize on `https://www.logic-solar.com` in canonicals, sitemap.xml, robots.txt, og:url, and schema `url`.

### 3. Return real 404s
- **Evidence:** `/this-page-does-not-exist-xyz` returns **HTTP 200** with the homepage shell (and canonical → homepage). Every typo'd or removed URL is a soft-404 that can get indexed.
- **Fix:** serve a real 404 status for unknown routes (Vercel rewrite config + a proper 404 page).

## P1 — High

### 4. Fix the sitemap
- Colorado **state hub is missing** (100 Colorado city URLs are listed, but not `/locations/colorado`, which exists and is pre-rendered).
- All 613 URLs use the non-www host, so **every sitemap URL redirects** — sitemaps should list final URLs.
- robots.txt points to `https://logic-solar.com/sitemap.xml`, which itself redirects.
- No `<lastmod>` values. `/adders` is absent from the sitemap entirely.

### 5. Thin-content / doorway-page risk on city pages
- 605 location pages = ~100 cities per state with templated copy ("Expert Solar Panel Installation in {City}, {ST}") and no city-specific substance. At this scale Google treats these as doorway pages.
- **Fix:** keep and enrich pages for metros actually served (local utility programs, permitting, incentives, completed installs — the app already carries per-state utility data); cut or `noindex` the long tail. 20 strong city pages beat 600 clones.

### 6. Wrong domain in code: `logicsolar.com` (no hyphen)
- The SEO component's default OG image is `https://logicsolar.com/images/missouri-hero.jpg`, and several schema/OG URLs reference `logicsolar.com/locations/missouri...` — a domain the business doesn't appear to own. Also `og:image` on pre-rendered pages is a relative path (`/og-image.png`); OG images must be absolute URLs.

## P2 — Medium

### 7. Structured data gaps
- LocalBusiness schema (home + contact) has name/phone/address — good — but lacks `geo`, `openingHours`, `areaServed`, `image`, `sameAs` (Facebook/Instagram/GBP links exist on the site but aren't in schema). FAQPage, Service, and BreadcrumbList schema exist **only client-side** — they should ship in initial HTML (solved by P0-1). Consider `@type` refinement (e.g. "Solar energy company" / HomeAndConstructionBusiness).

### 8. Performance
- Hashed asset `/assets/index-*.js` (242 KB brotli) is served with `cache-control: max-age=0, must-revalidate` — hashed assets should be `immutable, max-age=31536000`.
- 943 KB (raw) single JS bundle for a brochure site; Google Fonts loaded render-blocking. Code-split after moving to SSG.

### 9. Meta description lengths
- Texas hub (218 chars) and Colorado hub (253 chars) will truncate in SERPs — target ≤160. Static pages are fine.

## P3 — Ongoing / strategic

### 10. Local SEO
- NAP (Overland Park, KS · (816) 300-5781) is consistent on contact + schema. Verify/optimize the Google Business Profile for the Overland Park HQ, build review velocity, and add GBP + citations for any real satellite service areas. Embed proof (map, installs, reviews) on the metro pages kept in #5.

### 11. Content & topical authority
- No blog or resource content exists. Recommend a small library targeting money-adjacent queries: per-state incentive guides (data already in the app), "solar cost in {metro}" pages, battery-backup buying guide, and an /adders explainer with a proper title (the current weak `/adders` title is the shell-HTML issue from P0-1).

---

## Status of the Aug 24 audit's five quick wins (live-verified 2026-08-30)

| # | Quick win | Status |
|---|---|---|
| 1 | Add `public/robots.txt` | ✅ **Done** — live now, but its `Sitemap:` line points at the non-www URL, which redirects (fold into P0-2) |
| 2 | Fix `SEO.tsx` default og:image domain (`logicsolar.com` typo) | ❌ **Outstanding** — typo domain confirmed in the production bundle (= P1-6) |
| 3 | `noindex` on `/solar-landing` | ❌ **Outstanding** — live page serves the homepage shell with no robots meta; the ad landing page is indexable |
| 4 | Add `<SEO>` to `Home.tsx` (stale meta on client-side nav back to `/`) | ⚠️ **Likely outstanding** — needs a repo check; not verifiable from raw HTML alone |
| 5 | Absolute og:image + Twitter Card tags | ❌ **Outstanding** — zero `twitter:*` tags on any page tested; og:image still relative |

The Aug 24 audit's deeper items (image weight — 13 MB heroes, Service schema stranded in orphaned files, Organization/WebSite schema, E-E-A-T and content gaps, the 597-city-page decision) all remain open and are consistent with this audit's P1–P3; see that doc for the file-level detail.

---

## Suggested sequencing

1. **Week 1:** the three outstanding quick wins (og:image typo, `/solar-landing` noindex, Twitter Cards) + P0-2 host alignment + P0-3 real 404s + P1-4 sitemap/robots fixes (small, config-level changes in `Compass2026/Logic-Solar`).
2. **Weeks 2–3:** P0-1 pre-render all routes (the big unlock), P2-7 schema in HTML, P2-9 description trims.
3. **Week 4+:** P1-5 city-page consolidation/enrichment, P2-8 perf, P3 local + content program.

*Audit method: live crawl of sitemap, robots.txt, redirect chains, raw HTML of all page templates, and the production JS bundle; state hubs, city pages, service pages, and error handling each sampled directly.*
