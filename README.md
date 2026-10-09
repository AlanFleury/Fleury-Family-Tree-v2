# Fleury Family Archive

This repository contains the public application for the private Fleury Family Archive.

## Architecture

- GitHub Pages hosts the application.
- Auth0 provides private email/password sign-in.
- The Cloudflare Worker API provides authenticated access to the private archive.
- Family people and relationship records are kept behind the private API and are not published as a public website data file.
- Firestore is not used by the current application.

## Main application files

- `index.html` — web application
- `archive-api.js` — Auth0 authentication and private API adapter
- `config.js` — public client configuration
- `manifest.webmanifest` — PWA manifest
- `icon-192.svg`, `icon-512.svg` — application icons
- `sw.js` — cache cleanup worker
- `run-windows.bat` — local HTTP server helper

## Privacy

Do not add family-data exports, GEDCOM files, JSON backups, or database snapshots to this public GitHub repository.

The application loads the private family archive only after authenticated access is established.

## Important

`archive-seed.json` is not part of the safe online branch. Do not reintroduce private family-data exports into this public repository.

The old Firebase files are retained only for historical reference and are not used by `index.html`.

## Local testing

Run `run-windows.bat` from the repository directory and open the local HTTP server it starts. Auth0 settings must allow the local callback URL for local sign-in testing.

## Current status

The safe online rebuild keeps `main` untouched while the private archive connection, editing safeguards, responsive layout, and deployment path are verified. The public repository contains application code only; private family data remains behind the authenticated API.



## Recovery and safe merge

The administrator workbook recovery action is a **merge**, not a replacement. It inserts missing people, relationships, and metadata keys while leaving existing D1 records untouched. It does not delete existing data or overwrite edits already made online. The resulting counts must be checked after the merge; a partial failure should be investigated before retrying.

## Duplicate person ID merges

The Admin tab includes a staged duplicate-ID merge tool. Choose Person 1 as the ID to retain and Person 2 as the duplicate. The browser previews the merge and stages it locally; nothing is sent to D1 until the administrator reviews and commits the pending change. Non-empty conflicting core values retain Person 1's value, blank values are filled from Person 2, and notes/source text is combined. Relationships involving either person are redirected to the keeper, duplicate edges and self-links are excluded, and an alias/history row preserves the original duplicate record and affected relationships. The Worker checks both person snapshots and their relationship snapshots before committing. Test with a separate D1 database and dummy records before merging this branch into production; live D1 has not been modified by this PR.
