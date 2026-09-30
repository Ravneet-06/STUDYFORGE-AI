const citationMarker = /【\d+:\d+†[^】]*】/g;

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character],
  );
}

function inlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(.+?)__/g, "<strong>$1</strong>");
}

function normalizeEscapedMarkdown(value) {
  return String(value ?? "").replace(/\\(?=(?:#{1,6}\s|\*{1,2}|_{1,2}|[-+*]\s|\d+[.)]\s))/g, "");
}

export function renderMarkdown(value) {
  const lines = normalizeEscapedMarkdown(value).replace(citationMarker, "").split(/\r?\n/);
  const blocks = [];
  let paragraph = [];
  let list = null;

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push(`<p>${paragraph.map(inlineMarkdown).join("<br />")}</p>`);
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push(
        `<${list.type}>${list.items.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</${list.type}>`,
      );
      list = null;
    }
  };

  for (const line of lines) {
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    const unordered = line.match(/^\s*[-+*]\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      blocks.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
    } else if (ordered || unordered) {
      flushParagraph();
      const type = ordered ? "ol" : "ul";
      if (!list || list.type !== type) {
        flushList();
        list = { type, items: [] };
      }
      list.items.push((ordered || unordered)[1]);
    } else if (!line.trim()) {
      flushParagraph();
      flushList();
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  return blocks.join("");
}

export function renderEvidence(sources) {
  if (!sources?.length) return "";
  const cards = sources
    .map(
      (source, index) =>
        `<div class="source"><div><strong>Source ${index + 1}</strong><small>${escapeHtml(source.excerpt)}</small></div></div>`,
    )
    .join("");
  return `<div class="sources"><small class="eyebrow">EVIDENCE</small>${cards}</div>`;
}

export function renderPracticeEvidence(sources) {
  return renderEvidence(sources);
}
