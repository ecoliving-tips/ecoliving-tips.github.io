# Swaram URL Retention Policy (No-Build Workflow)

## Objective
Maximize AdSense revenue by prioritizing pages that:
- Receive search demand (impressions, clicks)
- Show ranking potential (position improving)
- Align with high-intent product journeys (Chord Finder and core navigation pages)

Reduce crawl/index waste from low-value generated pages so Google spends crawl budget on money pages.

## Scope
This policy is for no-build operations only.
- Do not run build.js for this workflow.
- Work from existing sitemap and data files.

## Decision Buckets
1. KEEP_STRATEGIC
- Core feature and business pages
- Keep indexed regardless of short-term traffic
- Examples: homepage, chord finder, core discovery pages

2. KEEP_HIGH_VALUE
- Pages with meaningful performance
- Signals:
  - Clicks >= 3 in selected window, or
  - Impressions >= 50 and average position <= 35

3. KEEP_MONITOR
- Pages with early signs of traction
- Signals:
  - Impressions >= 5 but below high-value thresholds

4. NOINDEX_CANDIDATE
- Low-value pages not proving search demand
- Typical signals:
  - Generated page
  - Zero/near-zero impressions
  - Not indexed or weak coverage signals
  - No strategic value

5. PRUNE_CANDIDATE
- Very low-quality generated pages likely to dilute site quality
- Typical signals:
  - Generated page
  - Zero impressions
  - Not indexed
  - Low-quality slug pattern (excessive hyphens, random-like IDs, very long slugs)

6. REVIEW_UNKNOWN
- Insufficient data (missing metrics/index state)
- Hold action until more data is available

## Guardrails
- Never noindex/prune these directly:
  - Homepage
  - Chord Finder and key conversion pages
  - Policy/legal pages
- Always review PRUNE_CANDIDATE manually before removal.
- Use conservative noindex first, then prune after 30-60 days if still no value.

## Recommended Operational Cadence
1. Weekly
- Run classifier with latest GSC export.
- Apply noindex to approved NOINDEX_CANDIDATE pages in controlled batches.

2. Bi-weekly
- Re-check noindexed pages for any demand changes.

3. Monthly
- Prune only pages that stayed low-value after prior noindex cycle.

## Recovery Readiness
If ranking or ad revenue drops after changes:
1. Revert the most recent noindex/prune batch first.
2. Re-submit retained key pages using existing IndexNow/GSC tooling.
3. Validate cache and fetch behavior (service worker emergency mode if needed).
4. Re-check top impression queries before any second rollout.

## Data Sources
- sitemap.xml and child sitemaps
- index-status.json
- index-excluded.json
- pending-index-check.json
- Optional GSC URL export CSV

## Success Metrics
- Higher share of impressions on strategic and high-value pages
- Better crawl focus on key pages
- Improved AdSense RPM on retained indexed inventory
- Reduced index bloat from low-value generated pages
