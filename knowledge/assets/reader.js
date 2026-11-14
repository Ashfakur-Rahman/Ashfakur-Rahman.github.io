const params = new URLSearchParams(location.search);
const bookSlug = params.get("book");
const chapterSlug = params.get("chapter");
const isPreview = params.get("preview") === "1";
const status = document.querySelector("#reader-status");
const reader = document.querySelector("#reader");
let lang = "en";
let chapterData, catalog, book;
const base = "./content/";
function esc(value = "") {
  return String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}
function safeMarkdown(markdown) {
  const html = window.marked ? marked.parse(markdown || "") : esc(markdown || "").replace(/\n/g, "<br>");
  return window.DOMPurify ? DOMPurify.sanitize(html) : esc(markdown || "").replace(/\n/g, "<br>");
}
function render() {
  document.querySelector("#chapter-title").textContent = chapterData.title?.[lang] || chapterData.title?.en || "";
  const raw = chapterData.content?.[lang] || chapterData.content?.en || "_This chapter is not available in this language yet._";
  const content = document.querySelector("#chapter-content");
  content.innerHTML = safeMarkdown(raw);
  if (window.renderMathInElement) renderMathInElement(content, {
    delimiters: [{ left: "$$", right: "$$", display: true }, { left: "\\(", right: "\\)", display: false }],
    throwOnError: false
  });
  document.querySelectorAll("[data-lang]").forEach(button => button.classList.toggle("selected", button.dataset.lang === lang));
}
document.querySelectorAll("[data-lang]").forEach(button => button.addEventListener("click", () => { lang = button.dataset.lang; render(); }));
async function loadPreview() {
  const apiBase = window.KNOWLEDGE_API_BASE || "";
  if (!apiBase || apiBase.includes("YOUR-KNOWLEDGE-WORKER")) throw Error("Private preview is not configured.");
  const response = await fetch(apiBase + "/api/preview?book=" + encodeURIComponent(bookSlug) + "&chapter=" + encodeURIComponent(chapterSlug), {
    credentials: "omit",
    headers: {
      Accept: "application/json",
      Authorization: "Bearer " + (sessionStorage.getItem("knowledge_studio_session") || "")
    },
    cache: "no-store"
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || "You are not authorized to preview this draft.");
  book = data.book;
  chapterData = data.chapter;
  document.querySelector("#book-title").textContent = book.title?.en || book.slug;
  document.querySelector("#chapter-label").textContent = "PRIVATE PREVIEW · " + String(chapterData.order || 1).padStart(2, "0");
  document.querySelector("#chapter-nav").innerHTML = '<p class="hint">Authenticated author preview. This content is not published in the public library.</p>';
  document.querySelector("#previous").hidden = true;
  document.querySelector("#next").hidden = true;
}
async function loadPublished() {
  catalog = await fetch(base + "catalog.json").then(response => {
    if (!response.ok) throw Error("Catalog unavailable.");
    return response.json();
  });
  book = (catalog.books || []).find(item => item.slug === bookSlug && item.status === "published");
  if (!book) throw Error("This book is not available.");
  const chapters = (book.chapters || []).filter(item => item.status === "published").sort((a, b) => a.order - b.order);
  const current = chapters.find(item => item.slug === chapterSlug);
  if (!current) throw Error("This chapter is not available.");
  chapterData = await fetch(base + "chapters/" + encodeURIComponent(chapterSlug) + ".json").then(response => {
    if (!response.ok) throw Error("Chapter unavailable.");
    return response.json();
  });
  document.querySelector("#book-title").textContent = book.title?.en || book.slug;
  document.querySelector("#chapter-label").textContent = "CHAPTER " + String(current.order).padStart(2, "0") + " · " + (book.subject || "");
  document.querySelector("#chapter-nav").innerHTML = chapters.map(chapter =>
    '<a class="' + (chapter.slug === chapterSlug ? "active" : "") + '" href="./book.html?book=' + encodeURIComponent(bookSlug) + "&chapter=" + encodeURIComponent(chapter.slug) + '">' +
    String(chapter.order).padStart(2, "0") + " · " + esc(chapter.title?.en || chapter.slug) + "</a>"
  ).join("");
  const index = chapters.findIndex(item => item.slug === chapterSlug);
  if (index > 0) {
    const previous = document.querySelector("#previous");
    previous.hidden = false;
    previous.href = "?book=" + encodeURIComponent(bookSlug) + "&chapter=" + encodeURIComponent(chapters[index - 1].slug);
  }
  if (index < chapters.length - 1) {
    const next = document.querySelector("#next");
    next.hidden = false;
    next.href = "?book=" + encodeURIComponent(bookSlug) + "&chapter=" + encodeURIComponent(chapters[index + 1].slug);
  }
}
async function init() {
  try {
    if (!bookSlug || !chapterSlug) throw Error("Choose a book and chapter.");
    if (isPreview) await loadPreview();
    else await loadPublished();
    if (isPreview) {
      const notice = document.createElement("p");
      notice.className = "preview-notice";
      notice.textContent = "Private author preview — not publicly published";
      document.querySelector(".reader-main").prepend(notice);
    }
    document.title = (chapterData.title?.en || "Reading") + " | Knowledge Library";
    reader.hidden = false;
    status.hidden = true;
    render();
  } catch (error) {
    status.textContent = error.message;
  }
}
init();
