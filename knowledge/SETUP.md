# Knowledge Library — implementation foundation

This repository is a plain HTML/CSS/JavaScript GitHub Pages portfolio. The Knowledge Library is added as an isolated section under `/knowledge/`; the existing portfolio page and its visual system remain in place.

## Current architecture

- Public library: `knowledge/index.html`
- Book/chapter reader: `knowledge/book.html`
- Custom author dashboard: `knowledge/admin/`
- Content catalog: `knowledge/content/catalog.json`
- Chapter content: `knowledge/content/chapters/<slug>.json`
- Secure write API: Cloudflare Worker source in `knowledge/worker/`

Content is data-driven. Creating a book or chapter in the dashboard updates JSON content records; the public pages render published records from the catalog. The starter Numerical Methods entry is deliberately a **draft placeholder**, not a completed book.

## Security model

GitHub Pages cannot securely authenticate an author or store a write token. The custom dashboard therefore delegates authentication and repository writes to a Cloudflare Worker:

1. GitHub OAuth identifies the author.
2. The Worker allowlists the configured GitHub username.
3. A server-side KV session stores the login session.
4. A fine-grained GitHub token is stored only as a Worker secret and writes only to this repository.
5. The browser never receives the GitHub write token.

Draft content is excluded from the public library navigation, but this first version stores JSON files in a public repository. **Drafts are therefore not confidential** and must not contain private or sensitive material.

## One-time deployment setup

1. Create a Cloudflare Worker from `knowledge/worker/index.js`.
2. Create a KV namespace named `SESSIONS`; put its ID in `wrangler.toml`.
3. Create a GitHub OAuth App. Set its callback URL to the Worker URL plus `/auth/callback`.
4. Configure Worker secrets: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and `GITHUB_TOKEN`.
5. The fine-grained GitHub token should be limited to this repository with **Contents: Read and write** only.
6. Configure Worker variables from `wrangler.toml`, including the Worker callback URL and the authorized GitHub login.
7. Deploy the Worker.
8. Replace `API_BASE` in `knowledge/admin/admin.js` with the deployed Worker URL.
9. Test GitHub sign-in, saving a draft, previewing it, and publishing a test chapter.

## Author workflow

- **New book** → enter metadata → Save draft.
- **New chapter** → select parent book → write English and Bangla → Save draft.
- Review the preview carefully.
- **Publish** only after checking the content. Published items appear in the public library.
- Keep slugs stable after publication because they form permanent URLs.

## Known MVP boundaries

- The reader currently supports Markdown and KaTeX rendering.
- Image upload/media management, chapter editing from the sidebar, automatic table of contents, full-text search, and a richer WYSIWYG editor are planned follow-up features.
- The dashboard currently creates books and chapters and persists their metadata/content; the public reader is intentionally simple.
- Because GitHub Pages serves a static site, public changes appear after the GitHub Pages deployment completes.
