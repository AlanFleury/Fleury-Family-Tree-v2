# Fleury Family Archive — clean rebuild

This rebuild uses the current production architecture:

GitHub Pages → Auth0 → private Cloudflare Worker API → private archive database.

## Current files

- `index.html`
- `archive-api.js`
- `config.js`
- `manifest.webmanifest`
- `icon-192.svg`
- `icon-512.svg`
- `sw.js`
- `run-windows.bat`

## Security

The public repository contains application code and public client identifiers only. The family archive is loaded through the authenticated private API.

The application does not use Firestore.

## Database safety

The current application does not import `archive-seed.json` automatically and does not modify the private archive merely by loading the site.

Never replace the private archive database with an unverified seed file.

## Authentication

Auth0 email/password authentication is used. The Auth0 application must allow the GitHub Pages callback URL and the private API must accept the configured audience.

## Testing order

1. Verify the page loads.
2. Verify Auth0 sign-in.
3. Verify the private API returns the existing archive.
4. Confirm people and relationships are present.
5. Only then add or restore additional genealogy features.
