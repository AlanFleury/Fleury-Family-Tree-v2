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

`archive-seed.json` is retained in the repository only as an existing archive artifact. The current application does not load it automatically.

The old Firebase files are retained only for historical reference and are not used by `index.html`.

## Local testing

Run `run-windows.bat` from the repository directory and open the local HTTP server it starts. Auth0 settings must allow the local callback URL for local sign-in testing.

## Current status

This is the clean rebuild foundation. Additional genealogy features should be added only after the secure archive connection has been verified.

