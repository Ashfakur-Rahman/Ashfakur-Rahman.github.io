const API_BASE = window.KNOWLEDGE_API_BASE || "";
const CATALOG = API_BASE + "/api/catalog";
const SESSION_KEY = "knowledge_studio_session";
const readToken = () => sessionStorage.getItem(SESSION_KEY) || "";
let catalog = { schemaVersion: 1, books: [] };
let mode = "book";
let selectedBook = null;
let selectedChapter = null;
let editorLang = "en";
let chapterDraft = { en: "", bn: "" };
const $ = id => document.getElementById(id);
const slug = value => value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70);
const esc = value => String(value || "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
function message(value) { $("editor-message").textContent = value; }
function setMode(next) {
  mode = next;
  $("book-fields").hidden = next !== "book";
  $("chapter-fields").hidden = next !== "chapter";
  $("editor-heading").textContent = next === "book" ? (selectedBook ? "Edit book" : "Create a book") : (selectedChapter ? "Edit chapter" : "Write a chapter");
  $("editor-mode").textContent = next === "book" ? "BOOK METADATA" : "CHAPTER EDITOR";
}
async function api(path, options = {}) {
  if (!API_BASE || API_BASE.includes("YOUR-KNOWLEDGE-WORKER")) throw Error("Knowledge API is not configured.");
  const response = await fetch(API_BASE + path, {
    ...options,
    credentials: "omit",
    headers: { "Content-Type": "application/json", ...(readToken() ? { Authorization: "Bearer " + readToken() } : {}), ...(options.headers || {}) }
  });
  if (!response.ok) {
    let detail = "";
    try { detail = (await response.json()).error || ""; } catch (_) { detail = await response.text(); }
    throw Error(detail || "Request failed (" + response.status + ").");
  }
  return response.status === 204 ? null : response.json();
}
async function loadCatalog() {
  catalog = await api("/api/catalog");
  renderBooks();
  $("chapter-book").innerHTML = catalog.books.map(book => '<option value="' + esc(book.slug) + '">' + esc(book.title.en) + "</option>").join("");
}
function renderBooks() {
  $("admin-books").innerHTML = catalog.books.map(book => {
    const chapters = (book.chapters || []).slice().sort((a, b) => a.order - b.order);
    return '<div class="admin-book-group"><button class="book-choice" data-edit-book="' + esc(book.slug) + '">' +
      esc(book.title.en) + ' <small>· ' + esc(book.status) + "</small></button>" +
      '<div class="admin-chapter-list">' + chapters.map(chapter =>
        '<button class="chapter-choice" data-edit-chapter="' + esc(chapter.slug) + '" data-parent-book="' + esc(book.slug) + '">' +
        '<span>' + String(chapter.order).padStart(2, "0") + " · " + esc(chapter.title.en) + '</span><small>' + esc(chapter.status) + "</small></button>"
      ).join("") + "</div></div>";
  }).join("") || '<p class="hint">No books yet. Create your first book.</p>';
  document.querySelectorAll("[data-edit-book]").forEach(button => button.addEventListener("click", () => editBook(button.dataset.editBook)));
  document.querySelectorAll("[data-edit-chapter]").forEach(button => button.addEventListener("click", () => editChapter(button.dataset.parentBook, button.dataset.editChapter)));
}
function editBook(bookSlug) {
  const book = catalog.books.find(item => item.slug === bookSlug);
  if (!book) return;
  selectedBook = book.slug;
  selectedChapter = null;
  setMode("book");
  $("book-title-en").value = book.title?.en || "";
  $("book-title-bn").value = book.title?.bn || "";
  $("book-subject").value = book.subject || "";
  $("book-desc-en").value = book.description?.en || "";
  $("book-desc-bn").value = book.description?.bn || "";
  $("book-level").value = book.level || "Undergraduate";
  $("book-tags").value = (book.tags || []).join(", ");
  $("save-state").textContent = book.status || "draft";
  message("Editing book metadata.");
}
function newBook() {
  selectedBook = null;
  selectedChapter = null;
  setMode("book");
  ["book-title-en", "book-title-bn", "book-subject", "book-desc-en", "book-desc-bn", "book-tags"].forEach(id => $(id).value = "");
  $("book-level").value = "Undergraduate";
  $("save-state").textContent = "Not saved";
  message("Enter book details, then save as draft.");
}
function newChapter() {
  if (!catalog.books.length) { message("Create a book first."); return; }
  selectedChapter = null;
  setMode("chapter");
  chapterDraft = { en: "", bn: "" };
  editorLang = "en";
  $("chapter-book").disabled = false;
  $("chapter-book").value = selectedBook || catalog.books[0].slug;
  $("chapter-title-en").value = "";
  $("chapter-title-bn").value = "";
  const parent = catalog.books.find(book => book.slug === $("chapter-book").value);
  $("chapter-order").value = String(Math.max(0, ...(parent?.chapters || []).map(chapter => Number(chapter.order) || 0)) + 1);
  syncLangTabs();
  $("save-state").textContent = "Not saved";
  message("Write the chapter in English and Bangla. Switch language tabs to edit each version.");
}
async function editChapter(bookSlug, chapterSlug) {
  try {
    const result = await api("/api/chapter?book=" + encodeURIComponent(bookSlug) + "&chapter=" + encodeURIComponent(chapterSlug));
    const chapter = result.chapter;
    if (chapter.book !== bookSlug) throw Error("The selected chapter does not belong to this book.");
    selectedBook = bookSlug;
    selectedChapter = chapterSlug;
    setMode("chapter");
    chapterDraft = { en: chapter.content?.en || "", bn: chapter.content?.bn || "" };
    editorLang = "en";
    $("chapter-book").value = bookSlug;
    $("chapter-book").disabled = true;
    $("chapter-title-en").value = chapter.title?.en || "";
    $("chapter-title-bn").value = chapter.title?.bn || "";
    $("chapter-order").value = chapter.order || 1;
    syncLangTabs();
    $("save-state").textContent = chapter.status || "draft";
    message("Editing chapter: " + (chapter.title?.en || chapterSlug));
    updatePreview();
  } catch (error) { message(error.message); }
}
function syncLangTabs() {
  document.querySelectorAll("[data-editor-lang]").forEach(button => button.classList.toggle("selected", button.dataset.editorLang === editorLang));
  $("chapter-body").value = chapterDraft[editorLang] || "";
}
function normalizeMarkdown(value = "") {
  let source = String(value);
  // Legacy chapter JSON stores newline markers as literal backslash-n characters.
  if (!source.includes("\n") && /\\r?n/.test(source)) {
    source = source.replace(/\\r?n/g, "\n");
  }
  // Normalize double-escaped inline KaTeX delimiters.
  source = source.replace(/\\\\([()])/g, "\\$1");
  return source;
}
function markdownInline(value) {
  let html = esc(value);
  const tick = String.fromCharCode(96);
  html = html.replace(new RegExp(tick + "([^" + tick + "]+)" + tick, "g"), "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  html = html.replace(/_([^_]+)_/g, "<em>$1</em>");
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return html;
}
function basicMarkdown(source) {
  const lines = normalizeMarkdown(source).replace(/\r/g, "").split("\n");
  const out = [];
  let paragraph = [], list = "", quote = [], code = [];
  const flushParagraph = () => { if (paragraph.length) { out.push("<p>" + paragraph.map(markdownInline).join("<br>") + "</p>"); paragraph = []; } };
  const flushList = () => { if (list) { out.push("</" + list + ">"); list = ""; } };
  const flushQuote = () => { if (quote.length) { out.push("<blockquote>" + basicMarkdown(quote.join("\n")) + "</blockquote>"); quote = []; } };
  const flushCode = () => { if (code.length) { out.push("<pre><code>" + esc(code.join("\n")) + "</code></pre>"); code = []; } };
  let inCode = false;
  for (const line of lines) {
    if (line.trim().startsWith("~~~")) {
      flushParagraph(); flushList(); flushQuote();
      if (inCode) { flushCode(); inCode = false; } else inCode = true;
      continue;
    }
    if (line.trim().startsWith(String.fromCharCode(96).repeat(3))) {
      flushParagraph(); flushList(); flushQuote();
      if (inCode) { flushCode(); inCode = false; } else inCode = true;
      continue;
    }
    if (inCode) { code.push(line); continue; }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (heading) { flushParagraph(); flushList(); flushQuote(); const level = heading[1].length; out.push("<h" + level + ">" + markdownInline(heading[2]) + "</h" + level + ">"); }
    else if (bullet || numbered) {
      flushParagraph(); flushQuote();
      const next = bullet ? "ul" : "ol";
      if (list !== next) { flushList(); list = next; out.push("<" + list + ">"); }
      out.push("<li>" + markdownInline((bullet || numbered)[1]) + "</li>");
    } else if (/^\s*>/.test(line)) { flushParagraph(); flushList(); quote.push(line.replace(/^\s*>\s?/, "")); }
    else if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) { flushParagraph(); flushList(); flushQuote(); out.push("<hr>"); }
    else if (!line.trim()) { flushParagraph(); flushList(); flushQuote(); }
    else { flushList(); flushQuote(); paragraph.push(line); }
  }
  if (inCode) flushCode();
  flushParagraph(); flushList(); flushQuote();
  return out.join("\n");
}
function updatePreview() {
  chapterDraft[editorLang] = $("chapter-body").value;
  const target = $("preview");
  const markdown = normalizeMarkdown(chapterDraft[editorLang] || "_Nothing to preview yet._");
  const html = window.marked ? marked.parse(markdown) : basicMarkdown(markdown);
  target.innerHTML = window.DOMPurify ? DOMPurify.sanitize(html) : basicMarkdown(markdown);
  if (window.renderMathInElement) renderMathInElement(target, {
    delimiters: [{ left: "$", right: "$", display: true }, { left: "$", right: "$", display: false }, { left: "\\[", right: "\\]", display: true }],
    throwOnError: false
  });
}
async function writeFile(path, content) {
  return api("/api/write", { method: "POST", body: JSON.stringify({ path, content, message: "Knowledge Studio: update " + path }) });
}
async function saveBook(status) {
  const titleEn = $("book-title-en").value.trim();
  if (!titleEn) throw Error("English book title is required.");
  const bookSlug = selectedBook || slug(titleEn);
  if (!bookSlug) throw Error("A valid English title is required to create the book slug.");
  const old = catalog.books.find(book => book.slug === bookSlug);
  if (!selectedBook && old) throw Error("A book with this slug already exists. Select it from the bookshelf to edit it.");
  const item = {
    ...(old || {}), slug: bookSlug, status,
    subject: $("book-subject").value.trim(), level: $("book-level").value,
    title: { en: titleEn, bn: $("book-title-bn").value.trim() },
    description: { en: $("book-desc-en").value.trim(), bn: $("book-desc-bn").value.trim() },
    tags: $("book-tags").value.split(",").map(tag => tag.trim()).filter(Boolean),
    chapterCount: old?.chapterCount || 0, chapters: old?.chapters || []
  };
  const next = { ...catalog, books: old ? catalog.books.map(book => book.slug === bookSlug ? item : book) : [...catalog.books, item] };
  await writeFile("knowledge/content/catalog.json", JSON.stringify(next, null, 2));
  catalog = next;
  selectedBook = bookSlug;
  renderBooks();
  $("save-state").textContent = status;
  message(status === "published" ? "Book published." : "Book draft saved.");
}
async function saveChapter(status) {
  chapterDraft[editorLang] = $("chapter-body").value;
  const bookSlug = $("chapter-book").value;
  const book = catalog.books.find(item => item.slug === bookSlug);
  const titleEn = $("chapter-title-en").value.trim();
  if (!titleEn) throw Error("English chapter title is required.");
  if (!book) throw Error("Select a valid parent book.");
  if (status === "published" && book.status !== "published") throw Error("Publish the parent book first, then publish this chapter.");
  const chapterSlug = selectedChapter || slug(titleEn);
  if (!chapterSlug) throw Error("A valid English title is required to create the chapter slug.");
  const duplicateChapter = catalog.books.some(item => item.slug !== bookSlug && (item.chapters || []).some(chapter => chapter.slug === chapterSlug));
  if (duplicateChapter) throw Error("Chapter slugs must be unique across the library. Choose a different English title.");
  const order = Number($("chapter-order").value) || 1;
  const data = { schemaVersion: 1, slug: chapterSlug, book: bookSlug, status, order, title: { en: titleEn, bn: $("chapter-title-bn").value.trim() }, content: chapterDraft };
  await writeFile("knowledge/content/chapters/" + chapterSlug + ".json", JSON.stringify(data, null, 2));
  const entry = { slug: chapterSlug, order, status, title: data.title };
  const chapters = (book.chapters || []).filter(chapter => chapter.slug !== chapterSlug).concat(entry).sort((a, b) => a.order - b.order);
  const next = { ...catalog, books: catalog.books.map(item => item.slug === bookSlug ? { ...item, chapters, chapterCount: chapters.length } : item) };
  await writeFile("knowledge/content/catalog.json", JSON.stringify(next, null, 2));
  catalog = next;
  selectedChapter = chapterSlug;
  selectedBook = bookSlug;
  renderBooks();
  $("save-state").textContent = status;
  message(status === "published" ? "Chapter published." : "Chapter draft saved.");
}
$("login").onclick = () => {
  if (!API_BASE || API_BASE.includes("YOUR-KNOWLEDGE-WORKER")) { $("login-message").textContent = "Set KNOWLEDGE_API_BASE after deploying the Worker."; return; }
  location.href = API_BASE + "/auth/login";
};
$("new-book").onclick = newBook;
$("new-chapter").onclick = newChapter;
$("refresh-preview").onclick = updatePreview;
$("chapter-body").addEventListener("input", () => { chapterDraft[editorLang] = $("chapter-body").value; });
document.querySelectorAll("[data-editor-lang]").forEach(button => button.addEventListener("click", () => {
  chapterDraft[editorLang] = $("chapter-body").value;
  editorLang = button.dataset.editorLang;
  syncLangTabs();
}));
$("save-draft").onclick = async () => { try { mode === "book" ? await saveBook("draft") : await saveChapter("draft"); } catch (error) { message(error.message); } };
$("publish").onclick = async () => {
  if (!confirm("Publish this reviewed content to the public Knowledge Library?")) return;
  try { mode === "book" ? await saveBook("published") : await saveChapter("published"); }
  catch (error) { message(error.message); }
};
$("preview-public").onclick = () => {
  if (mode !== "chapter" || !selectedBook || !selectedChapter) { message("Save the chapter first, then open its private preview."); return; }
  // Keep the preview in this tab so its sessionStorage bearer token remains available.
  // The browser does not reliably copy sessionStorage to a noopener tab.
  location.assign("/studio/book.html?book=" + encodeURIComponent(selectedBook) + "&chapter=" + encodeURIComponent(selectedChapter) + "&preview=1");
};
$("logout").onclick = async () => { try { await api("/auth/logout", { method: "POST" }); } catch (error) { message(error.message); } finally { sessionStorage.removeItem(SESSION_KEY); location.reload(); } };
(async () => {
  try {
    const hash = new URLSearchParams(location.hash.slice(1));
    const authCode = hash.get("auth_code");
    if (authCode) {
      history.replaceState(null, "", location.pathname + location.search);
      const exchange = await fetch(API_BASE + "/auth/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "omit",
        body: JSON.stringify({ code: authCode })
      });
      const exchanged = await exchange.json();
      if (!exchange.ok || !exchanged.token) throw Error(exchanged.error || "Could not complete sign-in.");
      sessionStorage.setItem(SESSION_KEY, exchanged.token);
    }
    const session = await api("/api/session");
    if (!session.authenticated) throw Error("Please sign in.");
    $("login-panel").hidden = true;
    $("studio").hidden = false;
    $("identity").textContent = "Signed in as @" + session.login;
    await loadCatalog();
  } catch (error) { $("login-message").textContent = error.message; }
})();
