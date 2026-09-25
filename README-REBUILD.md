# Fleury Family Archive — clean rebuild

This is a clean replacement for the previous web app.

## Files
- `index.html` — complete application
- `firebase-config.js` — Firebase web configuration
- `firebase-sync.js` — Firebase Authentication + Firestore
- `firestore.rules` — viewer/editor/admin security rules
- `manifest.webmanifest`, `sw.js`, icons — optional PWA support

## Important
Do not open `index.html` directly from Downloads if you want Google sign-in.
A local `file://` preview is supported only as a non-cloud preview. Use the GitHub Pages HTTPS address for authentication and Firestore.

## First Firebase setup
1. Firebase Authentication must have Google enabled.
2. Firebase Authentication > Settings > Authorized domains must include:
   `alanfleury.github.io`
3. Create the first admin user document:
   `users/<Firebase UID>`
   with:
   `role: "admin"`
   You can also include `email` and `displayName`.
4. Deploy `firestore.rules`.
5. Use the app's Cloud tab to import the existing JSON family backup.

No family data is included in this code package.
