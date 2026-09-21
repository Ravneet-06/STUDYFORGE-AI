const app = document.querySelector("#app");
const title = document.querySelector("#title");
let docs = [];
const api = async (path, options = {}) => {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
};
function shell(view) {
  document
    .querySelectorAll(".nav")
    .forEach((n) => n.classList.toggle("active", n.dataset.view === view));
}
async function render(view = "dashboard") {
  shell(view);
  if (view === "dashboard") return dashboard();
  if (view === "assistant") return assistant();
  if (view === "library") return library();
  return quiz();
}
async function dashboard() {
  const [p, d] = await Promise.all([api("/api/progress"), api("/api/documents")]);
  docs = d.documents;
  title.textContent = "Good afternoon, learner.";
  app.innerHTML = `<div class="grid"><section class="card hero"><p class="eyebrow">YOUR MOMENTUM</p><h2>Build a study habit that compounds.</h2><p>Upload your material, ask grounded questions, and turn passive reading into active recall.</p><button class="button" data-go="assistant">Open study assistant →</button></section><section class="card"><span class="label">Study streak</span><div class="metric">${p.progress.streak || 0} days</div><p>Keep your rhythm going.</p></section><section class="card"><span class="label">Material ready</span><div class="metric">${docs.length}</div><p>Documents in your library.</p></section><section class="card"><div class="row"><h2>Weekly progress</h2><span class="tag">${p.progress.completed || 0}%</span></div><div class="progress"><i style="width:${p.progress.completed || 0}%"></i></div><p>${p.progress.plan}</p></section><section class="card"><h2>Quick actions</h2><div class="list"><button class="button secondary" data-go="library">＋ Add study material</button><button class="button secondary" data-go="quiz">✦ Practice questions</button></div></section></div>`;
  bind();
}
function library() {
  title.textContent = "Your study library.";
  app.innerHTML = `<section class="card"><div class="row"><div><p class="eyebrow">KNOWLEDGE BASE</p><h2>Upload study material</h2><p>Local mode supports TXT, Markdown, and text extracted from PDF-like content. Sources are stored locally.</p></div><span class="tag">RAG READY</span></div><input id="file" type="file" accept=".txt,.md,.markdown,.pdf"><textarea id="content" placeholder="Or paste notes here..."></textarea><input id="doc-title" placeholder="Document title"><button class="button" id="upload">Ingest material</button><div id="upload-status"></div></section><section class="card section"><h2>My documents</h2><div class="list" id="docs"><p class="muted">Loading...</p></div></section>`;
  loadDocs();
  document.querySelector("#upload").onclick = upload;
}
async function loadDocs() {
  const d = await api("/api/documents");
  docs = d.documents;
  document.querySelector("#docs").innerHTML = docs.length
    ? docs
        .map(
          (x) =>
            `<div class="doc"><span><strong>${escapeHtml(x.title)}</strong><br><small class="muted">${x.size} chars · ${x.status}</small></span><span class="tag">READY</span></div>`,
        )
        .join("")
    : '<p class="muted">No documents yet. Add your first study material above.</p>';
}
async function upload() {
  const file = document.querySelector("#file").files[0],
    content = document.querySelector("#content").value || (file ? await file.text() : ""),
    title = document.querySelector("#doc-title").value || file?.name || "Study notes";
  const status = document.querySelector("#upload-status");
  try {
    const d = await api("/api/documents", {
      method: "POST",
      body: JSON.stringify({ title, name: file?.name, type: file?.type, content }),
    });
    status.innerHTML = `<p class="notice">Ingested ${escapeHtml(d.document.title)}. Retrieval sources are ready.</p>`;
    loadDocs();
  } catch (e) {
    status.innerHTML = `<p class="notice">${escapeHtml(e.message)}</p>`;
  }
}
function assistant() {
  title.textContent = "Ask your study material.";
  app.innerHTML = `<section class="card"><p class="eyebrow">GROUNDED ASSISTANT</p><h2>Ask a question</h2><p>Answers are grounded in your uploaded documents. Unsupported questions receive a clear fallback.</p><div class="chat" id="chat"><div class="bubble">Hi! Upload material, then ask me to explain a concept, compare ideas, or clarify a definition.</div></div><textarea id="question" placeholder="What would you like to understand?"></textarea><button class="button" id="ask">Ask StudyForge</button></section>`;
  document.querySelector("#ask").onclick = async () => {
    const q = document.querySelector("#question"),
      chat = document.querySelector("#chat");
    if (!q.value.trim()) return;
    chat.innerHTML += `<div class="bubble me">${escapeHtml(q.value)}</div>`;
    try {
      const r = await api("/api/assistant", {
        method: "POST",
        body: JSON.stringify({ question: q.value }),
      });
      chat.innerHTML += `<div class="bubble">${escapeHtml(r.answer)}${r.grounded ? `<br><small class="muted">Sources: ${r.sources.length} chunk(s) · ${r.agent}</small>` : `<br><small class="muted">${r.agent} · evidence not found</small>`}</div>`;
    } catch (e) {
      chat.innerHTML += `<div class="notice">${escapeHtml(e.message)}</div>`;
    }
    q.value = "";
  };
}
function quiz() {
  title.textContent = "Practice lab.";
  app.innerHTML = `<section class="card"><p class="eyebrow">ACTIVE RECALL</p><h2>Generate practice material</h2><p>Create grounded summaries, MCQs, or viva prompts from your study library.</p><select id="kind"><option value="summary">Summary</option><option value="mcq">MCQs</option><option value="viva">Viva questions</option></select><input id="topic" placeholder="Topic or concept from your material"><button class="button" id="generate">Generate</button><div id="result" class="section"></div></section>`;
  document.querySelector("#generate").onclick = async () => {
    const result = document.querySelector("#result");
    try {
      const r = await api("/api/generate", {
        method: "POST",
        body: JSON.stringify({
          kind: document.querySelector("#kind").value,
          topic: document.querySelector("#topic").value,
        }),
      });
      result.innerHTML = `<div class="notice">${r.grounded ? "Grounded in your material." : "No supporting evidence found; upload relevant material first."}</div><pre class="bubble">${escapeHtml(JSON.stringify(r.summary || r.questions, null, 2))}</pre>`;
    } catch (e) {
      result.innerHTML = `<div class="notice">${escapeHtml(e.message)}</div>`;
    }
  };
}
function bind() {
  document.querySelectorAll("[data-go]").forEach((x) => (x.onclick = () => render(x.dataset.go)));
}
function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}
document.querySelectorAll(".nav").forEach((n) => (n.onclick = () => render(n.dataset.view)));
render();
