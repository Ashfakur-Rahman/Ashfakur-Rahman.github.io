const SITE_ORIGIN = "https://ashfakur-rahman.github.io";
const WORKER_ORIGIN = "https://knowledge-library-auth.ashfakurrahman79.workers.dev";
const ADMIN_URL = WORKER_ORIGIN + "/studio/";
const REPO_OWNER = "Ashfakur-Rahman";
const REPO_NAME = "Ashfakur-Rahman.github.io";
const REPO_BRANCH = "feature/knowledge-library-foundation";
const ADMIN_GITHUB_LOGIN = "Ashfakur-Rahman";
const SESSION_TTL = 60 * 60 * 24 * 7;
const STATE_TTL = 600;
const HANDOFF_TTL = 120;

function randomToken(bytes = 32) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return Array.from(data, byte => byte.toString(16).padStart(2, "0")).join("");
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function bearer(request) {
  const value = request.headers.get("Authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7) : null;
}

function encodeBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function decodeBase64(value) {
  const binary = atob(String(value || "").replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function githubRequest(env, path, options = {}) {
  if (!env.GITHUB_TOKEN) throw new Error("Worker secret GITHUB_TOKEN is not configured.");
  const response = await fetch("https://api.github.com" + path, {
    ...options,
    headers: {
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Authorization": "Bearer " + env.GITHUB_TOKEN,
      "User-Agent": "Ashfakur-Knowledge-Studio",
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error("GitHub API " + response.status + ": " + detail);
  }
  return response.status === 204 ? null : response.json();
}

async function readRepoJson(env, path) {
  const query = "?ref=" + encodeURIComponent(REPO_BRANCH);
  const file = await githubRequest(
    env,
    "/repos/" + REPO_OWNER + "/" + REPO_NAME + "/contents/" + path + query
  );
  return JSON.parse(decodeBase64(file.content));
}

async function requireSession(request, env) {
  const token = bearer(request);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const raw = await env.SESSIONS.get("session:" + token);
  if (!raw) return null;
  return { token, user: JSON.parse(raw) };
}


const DRAFT_CATALOG_KEY = "content:draft:catalog";
const PUBLIC_CATALOG_KEY = "content:published:catalog";
const draftChapterKey = slug => "content:draft:chapter:" + slug;
const publicChapterKey = slug => "content:published:chapter:" + slug;

async function getDraftCatalog(env) {
  let raw = await env.SESSIONS.get(DRAFT_CATALOG_KEY);
  if (raw) return JSON.parse(raw);
  // One-time bootstrap from the existing starter catalog. Subsequent edits stay in KV.
  const legacy = await readRepoJson(env, "knowledge/content/catalog.json");
  await env.SESSIONS.put(DRAFT_CATALOG_KEY, JSON.stringify(legacy));
  return legacy;
}

async function getDraftChapter(env, slug) {
  let raw = await env.SESSIONS.get(draftChapterKey(slug));
  if (raw) return JSON.parse(raw);
  const legacy = await readRepoJson(env, "knowledge/content/chapters/" + slug + ".json");
  await env.SESSIONS.put(draftChapterKey(slug), JSON.stringify(legacy));
  return legacy;
}

async function refreshPublishedCatalog(env, draft) {
  const books = [];
  for (const book of draft.books || []) {
    if (book.status !== "published") continue;
    const chapters = (book.chapters || []).filter(ch => ch.status === "published").sort((a,b)=>a.order-b.order);
    if (!chapters.length) continue;
    books.push({ ...book, chapters, chapterCount: chapters.length });
  }
  await env.SESSIONS.put(PUBLIC_CATALOG_KEY, JSON.stringify({ schemaVersion: 1, books }));
}

async function publicApi(url, env) {
  if (url.pathname === "/public/catalog" && url.searchParams.get("v") !== "private") {
    const raw = await env.SESSIONS.get(PUBLIC_CATALOG_KEY);
    return json(raw ? JSON.parse(raw) : { schemaVersion: 1, books: [] });
  }
  if (url.pathname === "/public/chapter") {
    const bookSlug = url.searchParams.get("book") || "";
    const chapterSlug = url.searchParams.get("chapter") || "";
    if (!/^[a-z0-9-]{1,70}$/.test(bookSlug) || !/^[a-z0-9-]{1,70}$/.test(chapterSlug)) return json({error:"Invalid book or chapter slug."},400);
    const rawCatalog = await env.SESSIONS.get(PUBLIC_CATALOG_KEY);
    const catalog = rawCatalog ? JSON.parse(rawCatalog) : {books:[]};
    const book = (catalog.books || []).find(item=>item.slug===bookSlug);
    const entry = book && (book.chapters || []).find(item=>item.slug===chapterSlug);
    if (!book || !entry) return json({error:"This chapter is not published."},404);
    const rawChapter = await env.SESSIONS.get(publicChapterKey(chapterSlug));
    if (!rawChapter) return json({error:"Published chapter content is unavailable."},404);
    return json({book,chapter:JSON.parse(rawChapter)});
  }
  return null;
}

async function handleApi(request, env, url) {
  const session = await requireSession(request, env);
  if (!session) return json({ authenticated: false, error: "Authentication required." }, 401);
  if (url.pathname === "/api/session" && request.method === "GET") return json({ authenticated: true, login: session.user.login, user: session.user });
  if (url.pathname === "/api/me" && request.method === "GET") return json({ authenticated: true, user: session.user });

  if (url.pathname === "/api/catalog" && request.method === "GET") {
    const catalog = await getDraftCatalog(env);
    return json(catalog);
  }

  if ((url.pathname === "/api/chapter" || url.pathname === "/api/preview") && request.method === "GET") {
    const bookSlug = url.searchParams.get("book") || "";
    const chapterSlug = url.searchParams.get("chapter") || "";
    if (!/^[a-z0-9-]{1,70}$/.test(bookSlug) || !/^[a-z0-9-]{1,70}$/.test(chapterSlug)) return json({ error: "Invalid book or chapter slug." }, 400);
    const catalog = await getDraftCatalog(env);
    const book = (catalog.books || []).find(item => item.slug === bookSlug);
    const entry = book && (book.chapters || []).find(item => item.slug === chapterSlug);
    if (!book || !entry) return json({ error: "Book or chapter not found." }, 404);
    const chapter = await getDraftChapter(env, chapterSlug);
    if (chapter.book !== bookSlug) return json({ error: "Chapter does not belong to this book." }, 404);
    return json(url.pathname === "/api/preview" ? { preview: true, book, chapter } : { book, chapter });
  }

  if (url.pathname === "/api/write" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    if (!body || typeof body.content !== "string" || body.content.length > 900000) return json({ error: "Invalid or oversized content." }, 400);
    const path = String(body.path || "");
    let data;
    try { data = JSON.parse(body.content); } catch (_) { return json({error:"Content must be valid JSON."},400); }
    if (path === "knowledge/content/catalog.json") {
      if (!Array.isArray(data.books)) return json({error:"Invalid catalog format."},400);
      await env.SESSIONS.put(DRAFT_CATALOG_KEY, JSON.stringify(data));
      await refreshPublishedCatalog(env, data);
      return json({saved:true, storage:"private-kv"});
    }
    const match = path.match(/^knowledge\/content\/chapters\/([a-z0-9-]{1,70})\.json$/);
    if (!match || data.slug !== match[1] || !/^[a-z0-9-]{1,70}$/.test(data.book || "")) return json({error:"Path or chapter data is not allowed."},400);
    await env.SESSIONS.put(draftChapterKey(match[1]), JSON.stringify(data));
    if (data.status === "published") await env.SESSIONS.put(publicChapterKey(match[1]), JSON.stringify(data));
    else await env.SESSIONS.delete(publicChapterKey(match[1]));
    const catalog = await getDraftCatalog(env);
    await refreshPublishedCatalog(env, catalog);
    return json({saved:true, storage:"private-kv"});
  }
  return json({ error: "Not found." }, 404);
}

async function serveStudio(request, env, url) {
  const routes = {
    "/studio/": ["knowledge/admin/index.html", "text/html; charset=utf-8"],
    "/studio/index.html": ["knowledge/admin/index.html", "text/html; charset=utf-8"],
    "/studio/admin.js": ["knowledge/admin/admin.js", "text/javascript; charset=utf-8"],
    "/studio/admin.css": ["knowledge/admin/admin.css", "text/css; charset=utf-8"],
    "/studio/book.html": ["knowledge/book.html", "text/html; charset=utf-8"],
    "/studio/assets/library.css": ["knowledge/assets/library.css", "text/css; charset=utf-8"],
    "/studio/assets/config.js": ["knowledge/assets/config.js", "text/javascript; charset=utf-8"],
    "/studio/assets/reader.js": ["knowledge/assets/reader.js", "text/javascript; charset=utf-8"],
    "/studio/content/catalog.json": ["knowledge/content/catalog.json", "application/json; charset=utf-8"]
  };
  let entry = routes[url.pathname];
  if (!entry) {
    const chapterMatch = url.pathname.match(/^\/studio\/content\/chapters\/([a-z0-9-]{1,70})\.json$/);
    if (chapterMatch) entry = ["knowledge/content/chapters/" + chapterMatch[1] + ".json", "application/json; charset=utf-8"];
  }
  if (!entry) return null;
  const file = await githubRequest(
    env,
    "/repos/" + REPO_OWNER + "/" + REPO_NAME + "/contents/" + entry[0] + "?ref=" + encodeURIComponent(REPO_BRANCH)
  );
  let body = decodeBase64(file.content);
  if (url.pathname === "/studio/" || url.pathname === "/studio/index.html") {
    body = body
      .replace('href="../"', 'href="https://ashfakur-rahman.github.io/knowledge/"')
      .replace('href="../../"', 'href="https://ashfakur-rahman.github.io/"')
      .replace('href="../assets/library.css"', 'href="/studio/assets/library.css"')
      .replace('href="./admin.css"', 'href="/studio/admin.css"')
      .replace('src="../assets/config.js"', 'src="/studio/assets/config.js"')
      .replace('src="./admin.js"', 'src="/studio/admin.js"');
  }
  if (url.pathname === "/studio/book.html") {
    body = body
      .replace('href="../"', 'href="https://ashfakur-rahman.github.io/"')
      .replace('href="./"', 'href="/studio/"')
      .replace('href="./assets/library.css"', 'href="/studio/assets/library.css"')
      .replace('src="./assets/config.js"', 'src="/studio/assets/config.js"')
      .replace('src="./assets/reader.js"', 'src="/studio/assets/reader.js"');
  }
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": entry[1],
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }


    try {
      if (url.pathname === "/auth/login" && request.method === "GET") {
        if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
          return new Response("GitHub OAuth secrets are not configured.", { status: 500 });
        }
        const state = randomToken();
        const verifyOnly = url.searchParams.get("verify") === "1";
        await env.SESSIONS.put("state:" + state, verifyOnly ? "verify" : "login", { expirationTtl: STATE_TTL });
        const authorize = new URL("https://github.com/login/oauth/authorize");
        authorize.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
        authorize.searchParams.set("redirect_uri", "https://knowledge-library-auth.ashfakurrahman79.workers.dev/auth/callback");
        authorize.searchParams.set("scope", "read:user");
        authorize.searchParams.set("state", state);
        return Response.redirect(authorize.toString(), 302);
      }

      if (url.pathname === "/auth/callback" && request.method === "GET") {
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (!code || !state) return new Response("Missing OAuth code or state.", { status: 400 });

        const stateKey = "state:" + state;
        const savedState = await env.SESSIONS.get(stateKey);
        if (!savedState) return new Response("Invalid or expired OAuth state.", { status: 403 });
        await env.SESSIONS.delete(stateKey);

        const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
          method: "POST",
          headers: { "Accept": "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: env.GITHUB_CLIENT_ID,
            client_secret: env.GITHUB_CLIENT_SECRET,
            code,
            redirect_uri: "https://knowledge-library-auth.ashfakurrahman79.workers.dev/auth/callback"
          })
        });
        const tokenData = await tokenResponse.json();
        if (!tokenResponse.ok || !tokenData.access_token) {
          return new Response("GitHub token exchange failed.", { status: 401 });
        }

        const userResponse = await fetch("https://api.github.com/user", {
          headers: {
            "Authorization": "Bearer " + tokenData.access_token,
            "Accept": "application/vnd.github+json",
            "User-Agent": "Ashfakur-Knowledge-Studio"
          }
        });
        if (!userResponse.ok) return new Response("Could not verify GitHub account.", { status: 401 });
        const githubUser = await userResponse.json();

        if (String(githubUser.login || "").toLowerCase() !== ADMIN_GITHUB_LOGIN.toLowerCase()) {
          return new Response("This GitHub account is not authorized to access Knowledge Studio.", { status: 403 });
        }

        const user = {
          id: githubUser.id,
          login: githubUser.login,
          name: githubUser.name,
          avatar_url: githubUser.avatar_url
        };

        if (savedState === "verify") {
          return new Response(
            "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>OAuth verification</title><body style=\"font:16px system-ui;max-width:620px;margin:12vh auto;padding:24px;line-height:1.6\"><h1>GitHub OAuth verified</h1><p>Authentication succeeded and the authorized account was confirmed.</p><p><strong>GitHub account:</strong> @" + githubUser.login + "</p><p>Cloudflare Worker callback and KV state validation are working. No session token or OAuth secret is displayed.</p><p>You can close this tab.</p></body></html>",
            { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } }
          );
        }

        const handoff = randomToken();
        await env.SESSIONS.put("handoff:" + handoff, JSON.stringify(user), { expirationTtl: HANDOFF_TTL });
        return Response.redirect(ADMIN_URL + "#auth_code=" + handoff, 302);
      }

      if (url.pathname === "/auth/exchange" && request.method === "POST") {
        const body = await request.json().catch(() => null);
        const code = body?.code;
        if (typeof code !== "string" || !/^[a-f0-9]{64}$/.test(code)) {
          return json({ error: "Missing or invalid authorization code." }, 400);
        }
        const key = "handoff:" + code;
        const rawUser = await env.SESSIONS.get(key);
        if (!rawUser) return json({ error: "Authorization code is invalid, expired, or already used." }, 401);
        await env.SESSIONS.delete(key);

        const token = randomToken();
        await env.SESSIONS.put("session:" + token, rawUser, { expirationTtl: SESSION_TTL });
        return json({ authenticated: true, token, user: JSON.parse(rawUser) });
      }

      if (url.pathname === "/auth/logout" && request.method === "POST") {
        const token = bearer(request);
        if (token && /^[a-f0-9]{64}$/.test(token)) await env.SESSIONS.delete("session:" + token);
        return json({ authenticated: false, message: "Logged out." });
      }

      if (url.pathname.startsWith("/public/")) { const response = await publicApi(url, env); if (response) return response; }
      if (url.pathname.startsWith("/api/")) return await handleApi(request, env, url);
      if (url.pathname === "/studio/" || url.pathname.startsWith("/studio/")) {
        const studioResponse = await serveStudio(request, env, url);
        if (studioResponse) return studioResponse;
      }
      if (url.pathname === "/") return new Response("Knowledge Library authentication service", {
        headers: { "Content-Type": "text/plain; charset=utf-8" }
      });
      return new Response("Not Found", { status: 404 });
    } catch (error) {
      return json({ error: error.message || "Unexpected Worker error." }, 500);
    }
  }
};
