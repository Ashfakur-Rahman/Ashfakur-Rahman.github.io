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

async function handleApi(request, env, url) {
  const session = await requireSession(request, env);
  if (!session) return json({ authenticated: false, error: "Authentication required." }, 401);

  if (url.pathname === "/api/session" && request.method === "GET") {
    return json({ authenticated: true, login: session.user.login, user: session.user });
  }

  if (url.pathname === "/api/me" && request.method === "GET") {
    return json({ authenticated: true, user: session.user });
  }

  if (url.pathname === "/api/chapter" && request.method === "GET") {
    const bookSlug = url.searchParams.get("book") || "";
    const chapterSlug = url.searchParams.get("chapter") || "";
    if (!/^[a-z0-9-]{1,70}$/.test(bookSlug) || !/^[a-z0-9-]{1,70}$/.test(chapterSlug)) {
      return json({ error: "Invalid book or chapter slug." }, 400);
    }
    const catalog = await readRepoJson(env, "knowledge/content/catalog.json");
    const book = (catalog.books || []).find(item => item.slug === bookSlug);
    const entry = book && (book.chapters || []).find(item => item.slug === chapterSlug);
    if (!book || !entry) return json({ error: "Book or chapter not found." }, 404);
    const chapter = await readRepoJson(env, "knowledge/content/chapters/" + chapterSlug + ".json");
    if (chapter.book !== bookSlug) return json({ error: "Chapter does not belong to this book." }, 404);
    return json({ book, chapter });
  }

  if (url.pathname === "/api/preview" && request.method === "GET") {
    const bookSlug = url.searchParams.get("book") || "";
    const chapterSlug = url.searchParams.get("chapter") || "";
    if (!/^[a-z0-9-]{1,70}$/.test(bookSlug) || !/^[a-z0-9-]{1,70}$/.test(chapterSlug)) {
      return json({ error: "Invalid book or chapter slug." }, 400);
    }
    const catalog = await readRepoJson(env, "knowledge/content/catalog.json");
    const book = (catalog.books || []).find(item => item.slug === bookSlug);
    const entry = book && (book.chapters || []).find(item => item.slug === chapterSlug);
    if (!book || !entry) return json({ error: "Book or chapter not found." }, 404);
    const chapter = await readRepoJson(env, "knowledge/content/chapters/" + chapterSlug + ".json");
    if (chapter.book !== bookSlug) return json({ error: "Chapter does not belong to this book." }, 404);
    return json({ preview: true, book, chapter });
  }

  if (url.pathname === "/api/write" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    if (!body) return json({ error: "Invalid JSON body." }, 400);
    const path = String(body.path || "");
    if (!/^knowledge\/content\/(catalog\.json|chapters\/[a-z0-9-]{1,70}\.json)$/.test(path)) {
      return json({ error: "Path not allowed." }, 400);
    }
    if (typeof body.content !== "string" || body.content.length > 900000) {
      return json({ error: "Invalid or oversized content." }, 400);
    }

    const apiPath = "/repos/" + REPO_OWNER + "/" + REPO_NAME + "/contents/" + path;
    let existingSha;
    try {
      const existing = await githubRequest(env, apiPath + "?ref=" + encodeURIComponent(REPO_BRANCH));
      existingSha = existing.sha;
    } catch (error) {
      if (!String(error.message).includes("GitHub API 404")) throw error;
    }

    const result = await githubRequest(env, apiPath, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: String(body.message || "Knowledge Studio: update " + path).slice(0, 120),
        content: encodeBase64(body.content),
        branch: REPO_BRANCH,
        ...(existingSha ? { sha: existingSha } : {})
      })
    });
    return json({ saved: true, path, branch: REPO_BRANCH, commit: result.commit?.sha });
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
