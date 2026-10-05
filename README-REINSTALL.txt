FLEURY FAMILY ARCHIVE — CURRENT REBUILD

Architecture:
- GitHub Pages frontend
- Auth0 email/password authentication
- Private Cloudflare Worker API
- Private archive database
- No Firestore in the current application

Important:
- Do not import or replace the private archive with archive-seed.json unless it has been independently verified.
- Do not upload family-data exports, GEDCOM files, or JSON backups to the public GitHub repository.
- The current frontend must load the private archive through archive-api.js.
- Test authentication and archive loading before making genealogy-data changes.

The old Firebase files may remain in the repository temporarily for historical reference, but they are not part of the current application.
