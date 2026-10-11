# Fleury Family Tree — Release Safety Checklist

Use this checklist for meaningful application releases. A green JavaScript syntax check is necessary, but it does not prove that Auth0, the Cloudflare Worker, D1, offline behavior, or the live archive works correctly.

## 1. Protect family data

- [ ] Confirm a fresh backup can be downloaded and opened as valid JSON.
- [ ] Confirm backup metadata includes export time and people/relationship counts.
- [ ] Test restore only with a disposable test backup or a separate test environment.
- [ ] Confirm malformed files and duplicate person IDs are rejected.
- [ ] Confirm restore previews counts, warns about broken relationship endpoints, asks for confirmation, and saves a backup of the current browser copy first.
- [ ] Confirm a failed local save does not leave the UI displaying the attempted restored archive.
- [ ] Never restore, bulk-import, merge, or delete against production just to test a feature.

## 2. Sign-in and permissions

- [ ] Sign in and sign out using the normal Auth0 flow.
- [ ] Confirm expired/failed sign-in displays a useful message and does not leave editing controls active.
- [ ] Confirm Viewer cannot edit, delete, merge or restore archive records.
- [ ] Confirm Editor can perform only the permitted editing actions.
- [ ] Confirm Admin-only controls and destructive actions remain administrator-restricted.
- [ ] Verify no Auth0 secret, Gmail secret, refresh token, or private archive export is committed to this repository.

## 3. People and relationship editing

- [ ] Search and open an existing person.
- [ ] Save a harmless change in a test environment and verify it persists after refresh.
- [ ] Add/edit/remove a parent or child in a test environment; verify the correct person IDs and relationship directions.
- [ ] Add/edit spouse or partner details in a test environment; verify status/date/place display in profile, print and charts.
- [ ] Confirm spouse status changes do not alter parentage or bloodline links.
- [ ] Test whitespace, punctuation, unknown dates, partial dates and blank optional fields.
- [ ] Verify failed saves show an error and do not claim success.

## 4. Duplicate-person merge

- [ ] Create disposable duplicate test records in a separate test database.
- [ ] Preview the merge and inspect fields, all relationship links, self-links and duplicate relationships.
- [ ] Confirm the kept ID is explicit and the dropped ID is shown before commit.
- [ ] Verify relationships are redirected correctly and no unrelated records are changed.
- [ ] Verify a backup/recovery path before production merges.
- [ ] Never automatically merge records based only on similar names.

## 5. Genealogy integrity and research

- [ ] Check Data Quality for duplicate-name candidates, missing sources, impossible date order, broken IDs, self-links and parentage cycles.
- [ ] Treat these as review warnings, not proof of error; do not auto-correct uncertain historical facts.
- [ ] Confirm each warning links to the relevant person or relationship where available.
- [ ] Test source search and confirm source strings remain unchanged.
- [ ] Verify alternate/maiden-name search only where such fields exist in records.
- [ ] Confirm report and timeline dates handle unknown/approximate dates conservatively.

## 6. Reports, charts and exports

- [ ] Generate representative ancestor, descendant, family-group, relationship, source and data-quality reports.
- [ ] Compare sample report results with known test records.
- [ ] Test print layout and CSV/HTML/GEDCOM export.
- [ ] Confirm exported branch data matches the selected person and branch.
- [ ] Confirm relationship status labels do not change the calculated bloodline.
- [ ] Check large charts and long names for clipping/overlap.

## 7. Browser, mobile and offline

- [ ] Test desktop Chrome/Edge and a mobile-sized viewport.
- [ ] Check search remains prominent and keyboard accessible.
- [ ] Test keyboard navigation, focus states, Escape behavior and readable contrast.
- [ ] Test offline launch and clearly distinguish offline/local edits from online archive changes.
- [ ] Confirm stale cached assets do not break sign-in or load incompatible scripts.
- [ ] Do not replace a valid local archive with an empty or invalid server response.

## 8. Deployment and release

- [ ] Review the PR diff; ensure only intended application/documentation files changed.
- [ ] Confirm automated JavaScript syntax and static safety checks pass.
- [ ] Merge only after relevant checks pass.
- [ ] Verify GitHub Pages deployment completed successfully.
- [ ] Verify Worker deployment separately only when Worker code changed.
- [ ] Smoke-test live sign-in, a read-only profile, search, reports, and backup download.
- [ ] Perform live edit/merge/restore tests only with explicit approval and a safe test setup.
- [ ] Record the deployed commit and any tests not completed.

## Non-negotiable safeguards

- Never commit private family data, JSON backups, GEDCOM files or database snapshots to this public repository.
- Do not modify archive-api.js, config.js, archive-seed.json or sw.js as part of unrelated UI work.
- Do not change Auth0 or Cloudflare secrets/configuration without a demonstrated need.
- Never silently merge people or repair uncertain genealogy.
- If a check cannot be performed, record it as unverified instead of claiming success.
