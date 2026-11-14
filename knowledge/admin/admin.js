const API_BASE = window.KNOWLEDGE_API_BASE || "";
const CATALOG = "../content/catalog.json";
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
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  if (!response.ok) {
    let detail = "";
    try { detail = (await response.json()).error || ""; } catch (_) { detail = await response.text(); }
    throw Error(detail || "Request failed (" + response.status + ").");
  }
  return response.status === 204 ? null : response.json();
}
async function loadCatalog() {
  const response = await fetch(CATALOG + "?v=" + Date.now(), { cache: "no-store" });
  if (!response.ok) throw Error("Could not load the content catalog.");
  catalog = await response.json();
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
    const response = await fetch("../content/chapters/" + encodeURIComponent(chapterSlug) + ".json?v=" + Date.now(), { cache: "no-store" });
    if (!response.ok) throw Error("Could not load this chapter file.");
    const chapter = await response.json();
    if (chapter.book !== bookSlug) throw Error("The selected chapter does not belong to this book.");
    selectedBook = bookSlug;
    selectedChapter = chapterSlug;
    setMode("chapter");
    chapterDraft = { en: chapter.content?.en || "", bn: chapter.content?.bn || "" };
    editorLang = "en";
    $("chapter-book").value = bookSlug;
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
function updatePreview() {
  chapterDraft[editorLang] = $("chapter-body").value;
  const target = $("preview");
  const markdown = chapterDraft[editorLang] || "_Nothing to preview yet._";
  const html = window.marked ? marked.parse(markdown) : esc(markdown).replace(/\n/g, "<br>");
  target.innerHTML = window.DOMPurify ? DOMPurify.sanitize(html) : esc(markdown).replace(/\n/g, "<br>");
  if (window.renderMathInElement) renderMathInElement(target, {
    delimiters: [{ left: "$$", right: "$$", display: true }, { left: "\\(", right: "\\)", display: false }],
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
  window.open("../book.html?book=" + encodeURIComponent(selectedBook) + "&chapter=" + encodeURIComponent(selectedChapter) + "&preview=1", "_blank", "noopener");
};
$("logout").onclick = async () => { try { await api("/auth/logout", { method: "POST" }); } catch (error) { message(error.message); } finally { location.reload(); } };
(async () => {
  try {
    const session = await api("/api/session");
    if (!session.authenticated) throw Error("Please sign in.");
    $("login-panel").hidden = true;
    $("studio").hidden = false;
    $("identity").textContent = "Signed in as @" + session.login;
    await loadCatalog();
  } catch (error) { $("login-message").textContent = error.message; }
})();
