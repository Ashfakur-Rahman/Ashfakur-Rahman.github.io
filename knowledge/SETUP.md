# Knowledge Library — feature-branch implementation

## Product model
- Public readers browse and read without an account or login.
- Only the allowlisted GitHub author can access Knowledge Studio.
- Public endpoints return only published catalog entries and published chapter content.
- Draft catalog and chapter content are stored in Cloudflare KV under `content:draft:` keys.
- Published copies are stored separately under `content:published:` keys.
- The existing `SESSIONS` KV namespace is reused; session, OAuth-state, handoff, draft, and published keys use separate prefixes.
- Admin preview and editing require the author bearer session.
- The visual editor supports direct rich-text editing, headings, lists, quotes, code blocks, LaTeX delimiters, tables, image insertion, simple process diagrams, and note callouts.

## URLs
- Public library (after Pages deployment): `https://ashfakur-rahman.github.io/knowledge/`
- Author Studio: `https://knowledge-library-auth.ashfakurrahman79.workers.dev/studio/`
- Worker API: `https://knowledge-library-auth.ashfakurrahman79.workers.dev`

## Security and storage notes
- Draft writes no longer target GitHub repository files. They go to KV through authenticated Worker API routes.
- Public routes expose only the published KV catalog and chapter copies.
- The GitHub repository remains the source for static application code only. The old starter draft JSON files were deleted from the current feature-branch tree.
- Important history caveat: deleting those files from the latest branch commit does not erase their earlier Git commit history. The removed files contained only the sample Numerical Methods placeholder, not confidential personal content. A full Git-history rewrite would be required to remove historical copies.
- The same KV namespace currently stores content and sessions. Key prefixes are isolated, but a dedicated CONTENT namespace or R2 bucket would be a cleaner future separation.
- Images are currently embedded as data URLs in chapter HTML, limited to 350 KB per image. A dedicated R2 bucket is preferable for a large media library.
- Rich HTML is sanitized with DOMPurify before editor display and public reading. Keep sanitization enabled.
- Browser bearer sessions are stored in `sessionStorage`, and requests use `credentials: "omit"`.
- OAuth secrets and the GitHub write token remain Worker secrets; never place them in client-side files.

## Existing Cloudflare configuration
- Worker: `knowledge-library-auth`
- KV binding: `SESSIONS`
- OAuth callback: `https://knowledge-library-auth.ashfakurrahman79.workers.dev/auth/callback`
- Existing Worker secrets: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_TOKEN`
- Feature branch configured in Worker: `feature/knowledge-library-foundation`

## Deployment and verification
A commit to this GitHub feature branch does not deploy the updated Worker. The updated Worker source must be deployed separately before the new API routes and KV storage behavior can be tested. Do not merge the GitHub Pages feature branch or deploy the public site without explicit approval.

After the Worker is deployed, verify:
1. Public `/public/catalog` returns no draft books.
2. Public `/public/chapter` returns 404 for draft or unknown chapters.
3. Unauthenticated requests to `/api/catalog`, `/api/chapter`, `/api/preview`, and `/api/write` are rejected.
4. Only the authorized GitHub account can sign in to Studio.
5. Create a disposable book and chapter, save drafts, reload, and confirm the data persists in KV (not GitHub repository files).
6. Preview works only with the author session.
7. Publish a test book and chapter; verify they appear on the public catalog and reader. Unpublish and verify they disappear.
8. Test both languages, toolbar formatting, equations, image upload, tables, code, diagrams, and callouts.
9. Test Chrome/Edge desktop and a mobile browser.

## Publishing workflow
Create/edit → Save draft → Preview privately → Review both languages → Publish the book → Publish individual chapters. Public Pages deployment remains a separate, explicitly approved action.
