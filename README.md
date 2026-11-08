# Swaram

Anyone can raise issues in this repository.

Do not copy, reuse, modify, or redistribute any code, assets, or content from this project.
Strict legal action will be taken against unauthorized use.

This repository is protected under a strict license.
See [LICENSE](LICENSE).

## AdSense loading and placement

Ads load only after interaction and the existing country check. Singapore stays
blocked if any country provider reports `SG`; that response now blocks immediately
and cancels remaining lookups. Other visitors still wait for all providers so an
early non-Singapore response cannot bypass the block. The 24-hour cache and
existing stale-cache/allow fallback during total lookup failure are unchanged.
Interaction is a traffic-quality mitigation, not proof that a visitor is human.

Manual ad slots are requested within 200 pixels of the viewport, once per slot.
Hidden progress ads use the same loader when the processing section becomes
visible; they are not refreshed on repeat analysis. Older browsers without
IntersectionObserver use viewport checks on scroll and resize. Unfilled manual
slots collapse, and reserved container space reduces (but cannot eliminate)
layout shifts. The homepage in-feed slot spans both columns on small screens.
Google-created Auto ads retain Google's sizing rather than publisher CSS clipping.

Validate with `node --test scripts/test-adsense-loader.js`. No live ads are
requested by these tests. Auto ads exclusions for players, forms, practice and
download controls must be reviewed in AdSense; they cannot be verified from
repository code. Compare earnings per session, viewability, page RPM and tool
completion before and after deployment; these changes do not guarantee revenue.
