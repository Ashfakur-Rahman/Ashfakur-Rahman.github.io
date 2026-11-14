# Knowledge Library — deployment and technical verification

## Architecture
- Public bookshelf: `knowledge/index.html`
- Public reader and authenticated author preview: `knowledge/book.html`
- Author dashboard: `knowledge/admin/` (served by the Cloudflare Worker at `/studio/`)
- Shared Worker URL: `knowledge/assets/config.js`
- Content catalog and chapter JSON: `knowledge/content/`
- OAuth, session validation, private preview, and GitHub writes: `knowledge/worker/index.js`

The Numerical Methods entry is starter placeholder content. It is not a finished lesson.

## Current deployment model
- Cloudflare Worker: `knowledge-library-auth`
- Worker URL: `https://knowledge-library-auth.ashfakurrahman79.workers.dev`
- KV binding: `SESSIONS`
- GitHub OAuth callback: `https://knowledge-library-auth.ashfakurrahman79.workers.dev/auth/callback`
- GitHub write target during pre-merge testing: `feature/knowledge-library-foundation`
- Public GitHub Pages deployment is separate. Do not merge or publish this feature branch as part of technical testing.

## Security model and limitations
- OAuth callback validates a single-use, expiring state value and allowlists the administrator GitHub login.
- The OAuth handoff code is short-lived and single-use. The Worker stores session identifiers in KV with a seven-day TTL.
- The browser stores the bearer session in `sessionStorage`; API calls do not use cookies or credentialed CORS.
- The Worker serves the Studio on its own origin. API CORS currently uses wildcard origin with explicit bearer authorization and `credentials: "omit"`; do not change this to cookie-based authentication without revisiting the CORS policy.
- Private preview and chapter editing use authenticated Worker API routes.
- The GitHub write token stays in the Worker secret and is never sent to browser JavaScript.
- Markdown is sanitized with DOMPurify before insertion.
- The GitHub repository is public. Draft JSON files are therefore readable by anyone who knows or discovers their repository paths; draft status only hides them from the public bookshelf and reader. Do not store confidential material here.

## Cloudflare configuration
1. Worker service name must remain `knowledge-library-auth` when deploying with Wrangler.
2. Bind the existing KV namespace as `SESSIONS`.
3. Configure Worker secrets: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and `GITHUB_TOKEN`.
4. The OAuth app callback URL must exactly match the callback URL above.
5. Keep the GitHub token restricted to this repository with Contents read/write and Metadata read-only.
6. Keep the Worker code's `REPO_BRANCH` fixed to `feature/knowledge-library-foundation` during pre-merge testing.
7. Keep `knowledge/assets/config.js` pointed at the Worker URL above.
8. After changing Worker code, deploy the Worker separately. A GitHub commit does not prove that the Cloudflare Worker has been redeployed.

## End-to-end verification checklist
These checks must be performed against the deployed Worker and the feature-branch preview:
1. Authorized GitHub sign-in succeeds; a different GitHub account is rejected.
2. Invalid, expired, and replayed OAuth state/handoff codes are rejected.
3. Dashboard session survives reload; logout invalidates the session.
4. Create a disposable book and chapter in English and Bangla; confirm both JSON writes land on the feature branch.
5. Edit an existing chapter in both languages, save, reload, and confirm the edits persist.
6. Open private preview while signed in; confirm it renders. Open the same URL in a logged-out browser and confirm access is denied.
7. Confirm draft books and chapters are absent from the public bookshelf and public reader.
8. Test Markdown tables, fenced code, inline/display math, and safe HTML/script payloads.
9. Confirm publish controls are only used after review. Publishing changes GitHub content status; public Pages visibility still depends on the Pages deployment.
10. Test on current desktop Chrome/Edge and mobile browsers.

## Publishing workflow
Create or edit → Save draft → open authenticated preview → review both languages, code, tables, and math → publish parent book → publish chapters → deploy the public Pages branch only when explicitly intended.

## Not implemented
- Image/file uploads
- WYSIWYG editor
- Automatic table of contents
- Full-text search
- Confidential draft storage
