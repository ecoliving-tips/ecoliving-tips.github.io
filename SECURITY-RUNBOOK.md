# Swaram Security Runbook

## Scope
This runbook covers security incidents for the static frontend on GitHub Pages and related automation.

## Incident Types
1. Defacement or malicious script/content injection.
2. Bot abuse waves affecting request or analysis flows.
3. Bad deploy causing broken pages, stale malicious cache, or SEO disruption.
4. CI/workflow compromise suspicion.

## Immediate Response Checklist (First 15 Minutes)
1. Freeze deploys: temporarily disable manual merges and workflow dispatch.
2. Confirm blast radius: check homepage, chord-finder, request page, and latest generated chord pages.
3. Identify last known good commit SHA.
4. If active abuse: reduce exposed write surfaces backend-side immediately (rate limits, stricter checks).
5. Notify stakeholders with timestamp and status.

## Frontend Recovery Procedure
1. Revert to known-good commit on `main`.
2. If service-worker cache may hold bad assets:
   - Edit [sw.js](sw.js) and set `EMERGENCY_DISABLE_CACHE = true`.
   - Commit and deploy hotfix.
3. After hotfix deploy, verify:
   - [index.html](index.html)
   - [chord-finder.html](chord-finder.html)
   - [request.html](request.html)
4. Once stable, set `EMERGENCY_DISABLE_CACHE = false` and bump `CACHE_NAME` for clean cache repopulation.

## Workflow Recovery Procedure
1. Disable the workflow in GitHub Actions if compromise is suspected.
2. Rotate all relevant secrets (Google indexing key and backend/service tokens used elsewhere).
3. Review latest workflow runs and commit actor history.
4. Re-enable workflow only after review and credential rotation.

## Abuse Mitigation Without User Friction
1. Keep honeypot + submit timing + throttle enabled on request page.
2. Tighten backend abuse scoring rules for suspicious patterns.
3. Block repeat abusive IP/device signatures backend-side.

## Emergency AdSense Mode
If a suspicious traffic wave returns, use the GitHub repository variable `ADSENSE_EMERGENCY_MODE`:

1. Open **Settings -> Secrets and variables -> Actions -> Variables**.
2. Set `ADSENSE_EMERGENCY_MODE` to `on`.
3. Run the **Daily Build & Index** workflow manually and wait for the Pages deployment.
4. Emergency mode loads AdSense only after a primary interaction, 100px of scrolling, and 3 seconds of visible dwell time. The `?ads=force` debug override is disabled.
5. After traffic normalizes, set the variable to `off` (or delete it) and run the workflow again to restore normal revenue mode.

Any value other than `on` uses normal mode, so an unset variable is safe by default.

## Verification After Recovery
1. Open critical pages and confirm script execution is expected.
2. Confirm no unauthorized `<script>` or external origin changes in key pages.
3. Check GSC coverage for major drops after incident and submit affected URLs.
4. Monitor AdSense policy center and invalid traffic alerts.

## Preventive Maintenance
1. Monthly: review CSP and script origin allowlist.
2. Monthly: run rollback drill and SW emergency toggle drill.
3. Weekly: inspect workflow run summary for unusual diffs/churn.
4. Per deploy: verify no unexpected new third-party script origins.
