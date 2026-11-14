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
function safeMarkdown(markdown) {
  const source = normalizeMarkdown(markdown);
  const html = window.marked ? marked.parse(source) : basicMarkdown(source);
  return window.DOMPurify ? DOMPurify.sanitize(html) : basicMarkdown(source);
}
function render() {
  const chapterTitle = chapterData.title?.[lang] || chapterData.title?.en || "";
  document.querySelector("#chapter-title").textContent = chapterTitle;
  let raw = chapterData.content?.[lang] || chapterData.content?.en || "_This chapter is not available in this language yet._";
  raw = normalizeMarkdown(raw);
  // Avoid repeating the chapter title when authors include it as the first Markdown H1.
  const firstHeading = raw.match(/^\s*#\s+(.+?)\s*(?:\n|$)/);
  if (firstHeading && firstHeading[1].trim().toLocaleLowerCase() === String(chapterTitle).trim().toLocaleLowerCase()) {
    raw = raw.replace(/^\s*#\s+.+?(?:\n|$)/, "");
  }
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
