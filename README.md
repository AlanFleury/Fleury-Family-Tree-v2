# Fleury Family Archive — rebuilt v5

This package is the rebuilt private/shared version of the Fleury Family Archive.

## Included
- Google sign-in using redirect flow for Windows, macOS, iPhone/iPad, Android, and modern desktop/mobile browsers.
- Private Firestore database for people and relationships.
- Role-based access: admin, editor, viewer.
- Relationship Finder between any two people using actual parent/spouse links.
- People editor and relationship editor.
- Wall Chart generator.
- GEDCOM export.
- JSON backup/import.
- PWA manifest and offline-safe service worker.
- No family data is included in this public website package. The app is hard-gated: family records are not loaded or displayed until a signed-in Firebase user has an approved role.

## Important privacy rule
Do NOT upload the old `data.json` to the public GitHub Pages site. GitHub Pages publishes repository files to the internet. Family data belongs in Firestore behind authentication.

## Firebase
The Firebase web configuration in `firebase-config.js` is client configuration, not a service-account secret. Firestore Security Rules protect the actual family records.

## First setup
1. Publish these files to the GitHub Pages repository root.
2. In Firebase Authentication, Google sign-in must be enabled and `alanfleury.github.io` must be an authorized domain.
3. After signing in for the first time, create the signed-in user document in Firestore at `users/<your Firebase UID>` with `role: admin`, plus `email` and `displayName`.
4. Use the app's Admin/Migration area to import the existing private JSON backup.
5. Verify the private archive before removing the old public `data.json`.

The app is designed to run from GitHub Pages and does not require Firebase Hosting.


## Privacy / access model
- GitHub Pages hosts only the application code and public assets.
- Firebase Authentication handles sign-in.
- Firestore Security Rules require authentication plus an approved `viewer`, `editor`, or `admin` role before family records can be read.
- The browser no longer stores a local family-data copy in `localStorage`.
- The app is responsive/PWA-ready for Windows, macOS, iPhone/iPad, and Android.
- Use HTTPS (GitHub Pages) and keep any exported JSON/GEDCOM backups private.

## Required Firebase setup
1. Enable Google under Firebase Authentication → Sign-in method.
2. Add your GitHub Pages hostname to Authentication → Settings → Authorized domains.
3. Create your first `users/<UID>` Firestore document with `role: "admin"`, `email`, and `displayName`.
4. Sign in, then use the admin migration area to import your private JSON backup.
5. Do not commit `data.json`, JSON backups, GEDCOM files, or other family records to the GitHub repository.
