# Release acceptance checklist — Fleury Family Tree

This checklist is required before merging the consolidated upgrade or deploying it to the live site. A code review or passing syntax check alone is not proof that the live service works.

## 1. Private archive and recovery — release blocker
- [ ] Sign in as an authorised user and confirm the private D1 archive loads the expected records.
- [ ] Compare people, relationships and metadata counts against a trusted, dated backup; investigate discrepancies rather than assuming a target count is correct.
- [ ] Simulate a failed, empty and truncated archive response; confirm the saved offline archive is not replaced.
- [ ] Restore a workbook into a separate test database; confirm existing values are not overwritten and repeated imports do not create duplicate relationships.
- [ ] Confirm no family-data export, backup, token or secret is committed to this public repository.

## 2. Accounts and email — release blocker
- [ ] Test sign-in, sign-out, expired session handling and password recovery.
- [ ] Verify Gmail OAuth connection from Admin without displaying credentials or tokens.
- [ ] Submit a test access request and verify the email arrives at the configured administrator address with the requester details.
- [ ] Verify Gmail diagnostic failures are actionable and do not leak secrets.
- [ ] Test approve and reject, including confirmation the requester cannot gain access before approval.

## 3. Editing and duplicate merge — release blocker
- [ ] Use dummy people in a separate test D1 database to test merge preview, stage, undo and commit.
- [ ] Verify keeper values win conflicts, blank keeper fields can be filled, and notes/source details are retained.
- [ ] Verify all supported relationships are redirected, duplicate links/self-links are removed, and the alias history is written.
- [ ] Simulate concurrent edits and confirm stale changes are rejected with a clear conflict instead of overwriting newer data.
- [ ] Test create, edit and delete with parent/child and non-parent relationship types, JSON-extra fields and sources.
- [ ] Do not merge real IDs i10/i30 until the test results and current records have been reviewed by the administrator.

## 4. Genealogy, charts and reports
- [ ] Check person profiles, parents, children, spouses, half-siblings, multiple marriages and relationship-path calculations.
- [ ] Check ancestor/descendant charts and wall charts for correct individual boxes, connector lines and generation labels.
- [ ] Confirm direct-bloodline red highlighting is visible in on-screen charts and exports.
- [ ] Generate and inspect reports for individuals, families, relationships, places, sources and missing/uncertain data.
- [ ] Verify source references and uncertainty/evidence status remain attached to the correct person and claim.
- [ ] Confirm chart export is legible at intended print sizes and that export styling matches the on-screen chart.

## 5. Navigation, design and mobile
- [ ] Test the always-visible search shortcut on iPhone and desktop; verify it focuses the global search field and results open the correct profile.
- [ ] Test People Directory Next/Previous, boundary states, search reset, filters, sorting and result counts.
- [ ] Check all tabs, buttons and report actions; do not hide advanced features while simplifying public navigation.
- [ ] Check parchment colours, text contrast, crest header/watermark, and red bloodline against light and dark chart areas.
- [ ] Check narrow-screen layout, zoom, keyboard focus, accessible button names and error messages.

## 6. Offline and performance
- [ ] Save a complete archive, go offline, close/reopen the app and confirm records remain available.
- [ ] Confirm offline mode does not pretend that edits have synced to the server.
- [ ] Test searches, large charts and reports with realistic archive volume on an iPhone and desktop.
- [ ] Confirm backup downloads can be reopened and validated before they are relied on.

## 7. Release procedure
- [ ] Automated syntax and static safety checks pass.
- [ ] All release-blocker items above pass in a separate test environment.
- [ ] Review the final diff and confirm no unrelated files or private data were included.
- [ ] Deploy the Worker and Pages application in the documented order, then repeat live smoke tests.
- [ ] Record the deployed commit and the results of the post-deployment checks.
- [ ] Keep a known-good backup and rollback plan available.

**Release rule:** Do not describe the project as 10/10 or fully fixed until the release blockers are tested and the deployed version passes the live smoke tests.
