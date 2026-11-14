# Knowledge Library — deployment and testing guide

## Architecture
- Public bookshelf: `knowledge/index.html`
- Public reader and authenticated author preview: `knowledge/book.html`
- Custom author dashboard: `knowledge/admin/`
- Shared API configuration: `knowledge/assets/config.js`
- Content catalog: `knowledge/content/catalog.json`
- Chapter JSON: `knowledge/content/chapters/<slug>.json`
- OAuth, private preview and repository writes: `knowledge/worker/index.js`

The starter Numerical Methods entry is a **draft placeholder**, not a completed book.

## Security model and limitations
- GitHub OAuth identifies the author; the Worker allowlists `ADMIN_GITHUB_LOGIN`.
- One-time OAuth state and session identifiers are stored in KV.
- The GitHub write token is a Worker secret and is never exposed to the browser.
- API requests require the exact portfolio Origin.
- OAuth callback redirects to a fixed Knowledge Studio URL. No caller-provided redirect is accepted.
- Private preview and chapter editing retrieve JSON through authenticated Worker routes.
- Markdown output is sanitized with DOMPurify before insertion into the page.
- The repository is public. Draft JSON files are **not confidential**, even when hidden from the public library.
- The Worker and Pages currently have different hostnames. The session cookie uses Secure and SameSite=None; browser third-party-cookie restrictions may still prevent sign-in. Prefer a same-site custom Worker domain for a production deployment.

## Cloudflare and GitHub setup (not yet performed)
1. Create a Cloudflare Worker from `knowledge/worker/index.js`.
2. Create a KV namespace named `SESSIONS` and replace the placeholder ID in `knowledge/worker/wrangler.toml`.
3. Create a GitHub OAuth App; its callback must exactly match the Worker URL plus `/auth/callback`.
4. Add Worker secrets `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and `GITHUB_TOKEN`.
5. Use a fine-grained token restricted to this repository with **Contents: Read and write** only. Never commit it or expose it to browser JavaScript.
6. Configure the Worker variables in `wrangler.toml`, including the callback URL and authorized login.
7. For pre-merge testing, set `GITHUB_BRANCH` to `feature/knowledge-library-foundation`. The dashboard must not write to `main` while this PR remains unmerged.
8. Deploy the Worker only after reviewing secrets, KV binding, OAuth callback, and allowed Origin.
9. Set `window.KNOWLEDGE_API_BASE` in `knowledge/assets/config.js` to the verified Worker origin (no trailing slash).
10. Confirm the deployed Worker only accepts `https://ashfakur-rahman.github.io` for API CORS and Origin checks.

## End-to-end verification
Use a disposable test book and chapter.
1. Authorized GitHub sign-in succeeds; an unauthorized account is rejected.
2. Invalid, expired, and replayed OAuth state fails. Callback always returns to the fixed admin URL.
3. Dashboard session survives reload; logout invalidates it.
4. Create a test book and chapter in English and Bangla. Verify writes land on the feature branch.
5. Select an existing chapter in the sidebar, edit both languages, save, reload, and verify the update.
6. Private preview works when signed in and is denied in a logged-out/private browser.
7. Draft books and chapters remain absent from the public bookshelf and public reader.
8. Publish the test book before its chapter, then verify public visibility after Pages deployment.
9. Test harmless script/HTML payloads in Markdown; no script should execute.
10. Test sign-in in current Chrome, Firefox, and Safari privacy settings; cross-site cookie blocking is a known deployment risk.

## Publishing workflow
Create/edit → Save draft → authenticated private preview → review both languages and math → publish the parent book → publish chapters. Public changes appear after the Pages deployment completes.

## Boundaries
- Image uploads, WYSIWYG editing, automatic TOC, and full-text search are not implemented.
- Drafts in this public repository are unlisted, not private.
- During testing, Worker writes target the feature branch. After PR review and merge, changing `GITHUB_BRANCH` to `main` is a separate configuration step.
