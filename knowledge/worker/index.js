const ORIGIN = "https://ashfakur-rahman.github.io";
const ADMIN_URL = ORIGIN + "/knowledge/admin/";
const cors = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Credentials": "true",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Vary": "Origin"
};
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
});
function originAllowed(req) {
  return req.headers.get("Origin") === ORIGIN;
}
function cookie(req, name) {
  return (req.headers.get("Cookie") || "").split(";").map(x => x.trim()).find(x => x.startsWith(name + "="))?.slice(name.length + 1);
}
function random() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map(x => x.toString(16).padStart(2, "0")).join("");
}
async function gh(env, path, init = {}) {
  const response = await fetch("https://api.github.com" + path, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      Authorization: "Bearer " + env.GITHUB_TOKEN,
      "User-Agent": "Ashfakur-Knowledge-Studio",
      ...(init.headers || {})
    }
  });
  if (!response.ok) throw Error("GitHub API " + response.status + ": " + (await response.text()).slice(0, 400));
  return response.status === 204 ? null : response.json();
}
function decodeGitHubFile(content) {
  const binary = atob(String(content || "").replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
async function readRepoJson(env, path) {
  const file = await gh(env, "/repos/" + env.GITHUB_OWNER + "/" + env.GITHUB_REPO + "/contents/" + path + "?ref=" + encodeURIComponent(env.GITHUB_BRANCH));
  return JSON.parse(decodeGitHubFile(file.content));
}
function sessionCookie(sid, maxAge) {
  return "knowledge_session=" + sid + "; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=" + maxAge;
}
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") {
      if (!originAllowed(req)) return new Response(null, { status: 403 });
      return new Response(null, { headers: cors });
    }
    try {
      if (url.pathname === "/auth/login" && req.method === "GET") {
        const state = random();
        await env.SESSIONS.put("oauth-state:" + state, JSON.stringify({ created: Date.now() }), { expirationTtl: 600 });
        const authorize = "https://github.com/login/oauth/authorize?client_id=" +
          encodeURIComponent(env.GITHUB_CLIENT_ID) + "&redirect_uri=" +
          encodeURIComponent(env.OAUTH_CALLBACK_URL) + "&scope=read:user&state=" + state;
        return Response.redirect(authorize, 302);
      }
      if (url.pathname === "/auth/callback" && req.method === "GET") {
        const state = url.searchParams.get("state");
        const saved = state && await env.SESSIONS.get("oauth-state:" + state);
        if (!saved) return new Response("Invalid or expired OAuth state.", { status: 400 });
        await env.SESSIONS.delete("oauth-state:" + state);
        const code = url.searchParams.get("code");
        if (!code) return new Response("GitHub did not return an authorization code.", { status: 400 });
        const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: env.GITHUB_CLIENT_ID,
            client_secret: env.GITHUB_CLIENT_SECRET,
            code,
            redirect_uri: env.OAUTH_CALLBACK_URL
          })
        });
        const tokenData = await tokenResponse.json();
        if (!tokenResponse.ok || !tokenData.access_token) return new Response("GitHub sign-in failed.", { status: 401 });
        const userResponse = await fetch("https://api.github.com/user", {
          headers: {
            Authorization: "Bearer " + tokenData.access_token,
            Accept: "application/vnd.github+json",
            "User-Agent": "Ashfakur-Knowledge-Studio"
          }
        });
        if (!userResponse.ok) return new Response("Unable to verify the GitHub account.", { status: 401 });
        const user = await userResponse.json();
        if (user.login?.toLowerCase() !== String(env.ADMIN_GITHUB_LOGIN || "").toLowerCase()) {
          return new Response("This GitHub account is not authorized.", { status: 403 });
        }
        const sid = random();
        await env.SESSIONS.put("session:" + sid, JSON.stringify({ login: user.login, created: Date.now() }), { expirationTtl: 60 * 60 * 24 * 7 });
        return new Response(null, {
          status: 302,
          headers: {
            Location: ADMIN_URL,
            "Set-Cookie": sessionCookie(sid, 60 * 60 * 24 * 7),
            "Cache-Control": "no-store"
          }
        });
      }
      if (url.pathname.startsWith("/api/") || url.pathname === "/auth/logout") {
        if (!originAllowed(req)) return json({ error: "Origin not allowed." }, 403);
      }
      if (url.pathname === "/auth/logout" && req.method === "POST") {
        const sid = cookie(req, "knowledge_session");
        if (sid) await env.SESSIONS.delete("session:" + sid);
        return new Response(null, {
          status: 204,
          headers: { ...cors, "Set-Cookie": sessionCookie("", 0), "Cache-Control": "no-store" }
        });
      }
      if (url.pathname.startsWith("/api/")) {
        const sid = cookie(req, "knowledge_session");
        const session = sid && await env.SESSIONS.get("session:" + sid);
        if (!session) return json({ authenticated: false, error: "Authentication required." }, 401);
        if (url.pathname === "/api/session" && req.method === "GET") {
          return json({ authenticated: true, login: JSON.parse(session).login });
        }
        if (url.pathname === "/api/chapter" && req.method === "GET") {
          const bookSlug = url.searchParams.get("book") || "";
          const chapterSlug = url.searchParams.get("chapter") || "";
          if (!/^[a-z0-9-]{1,70}$/.test(bookSlug) || !/^[a-z0-9-]{1,70}$/.test(chapterSlug)) {
            return json({ error: "Invalid book or chapter slug." }, 400);
          }
          const catalog = await readRepoJson(env, "knowledge/content/catalog.json");
          const book = (catalog.books || []).find(item => item.slug === bookSlug);
          const chapterEntry = book && (book.chapters || []).find(item => item.slug === chapterSlug);
          if (!book || !chapterEntry) return json({ error: "Book or chapter not found." }, 404);
          const chapter = await readRepoJson(env, "knowledge/content/chapters/" + chapterSlug + ".json");
          if (chapter.book !== bookSlug) return json({ error: "Chapter does not belong to this book." }, 404);
          return json({ book, chapter });
        }
        if (url.pathname === "/api/preview" && req.method === "GET") {
          const bookSlug = url.searchParams.get("book") || "";
          const chapterSlug = url.searchParams.get("chapter") || "";
          if (!/^[a-z0-9-]{1,70}$/.test(bookSlug) || !/^[a-z0-9-]{1,70}$/.test(chapterSlug)) {
            return json({ error: "Invalid book or chapter slug." }, 400);
          }
          const catalog = await readRepoJson(env, "knowledge/content/catalog.json");
          const book = (catalog.books || []).find(item => item.slug === bookSlug);
          const chapterEntry = book && (book.chapters || []).find(item => item.slug === chapterSlug);
          if (!book || !chapterEntry) return json({ error: "Book or chapter not found." }, 404);
          const chapter = await readRepoJson(env, "knowledge/content/chapters/" + chapterSlug + ".json");
          if (chapter.book !== bookSlug) return json({ error: "Chapter does not belong to this book." }, 404);
          return json({ preview: true, book, chapter });
        }
        if (url.pathname === "/api/write" && req.method === "POST") {
          const body = await req.json();
          const path = String(body.path || "");
          if (!/^knowledge\/content\/(catalog\.json|chapters\/[a-z0-9-]{1,70}\.json)$/.test(path)) {
            return json({ error: "Path not allowed." }, 400);
          }
          if (typeof body.content !== "string" || body.content.length > 900000) return json({ error: "Invalid content." }, 400);
          const base = "/repos/" + env.GITHUB_OWNER + "/" + env.GITHUB_REPO + "/contents/" + path;
          let sha;
          try {
            const existing = await gh(env, base + "?ref=" + encodeURIComponent(env.GITHUB_BRANCH));
            sha = existing.sha;
          } catch (error) {
            if (!String(error).includes("GitHub API 404")) throw error;
          }
          const result = await gh(env, base, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              message: String(body.message || "Knowledge Studio: update " + path).slice(0, 120),
              content: btoa(unescape(encodeURIComponent(body.content))),
              branch: env.GITHUB_BRANCH,
              ...(sha ? { sha } : {})
            })
          });
          return json({ saved: true, commit: result.commit?.sha, path, branch: env.GITHUB_BRANCH });
        }
      }
      return json({ error: "Not found." }, 404);
    } catch (error) {
      return json({ error: error.message || "Unexpected error." }, 500);
    }
  }
};
