const app = document.querySelector("#app");
const title = document.querySelector("#title");
const modeLabel = document.querySelector("#mode-label");
const modeDetail = document.querySelector("#mode-detail");
let currentView = "dashboard";
let health = null;

const api = async (path, options = {}) => {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.error?.message || data.error || "Something went wrong.";
    throw new Error(message);
  }
  return data;
};

const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
const loading = (label = "Loading your workspace…") =>
  `<div class="loading"><span class="spinner"></span>${label}</div>`;
const errorState = (message) =>
  `<div class="empty error-state"><strong>We hit a snag</strong><p>${escapeHtml(message)}</p><button class="button secondary" data-retry>Try again</button></div>`;
const emptyState = (titleText, text, action = "library") =>
  `<div class="empty"><span class="empty-icon">✦</span><strong>${titleText}</strong><p>${text}</p><button class="button secondary" data-view="${action}">Get started</button></div>`;

function setMode(data) {
  health = data;
  const hosted = data.foundry;
  modeLabel.textContent = hosted ? "Foundry connected" : "Local fallback mode";
  modeDetail.textContent = hosted
    ? "Hosted agent services are configured."
    : "Grounded local agents are active; Foundry is not configured.";
  document.body.classList.toggle("hosted", hosted);
}
async function init() {
  try {
    setMode(await api("/api/health"));
  } catch {
    modeLabel.textContent = "Offline";
    modeDetail.textContent = "Start the StudyForge API to continue.";
  }
  document.querySelector("#date-label").textContent = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  })
    .format(new Date())
    .toUpperCase();
  await render("dashboard");
}
function shell(view) {
  currentView = view;
  document
    .querySelectorAll(".nav")
    .forEach((node) => node.classList.toggle("active", node.dataset.view === view));
}
async function render(view = currentView) {
  shell(view);
  app.innerHTML = loading();
  try {
    if (view === "dashboard") return await dashboard();
    if (view === "assistant") return assistant();
    if (view === "library") return library();
    if (view === "practice") return practice();
    if (view === "plans") return await plans();
  } catch (error) {
    app.innerHTML = errorState(error.message);
    bind();
  }
}
async function dashboard() {
  title.textContent = "Good afternoon, learner.";
  const [{ progress }, { documents }] = await Promise.all([
    api("/api/progress"),
    api("/api/documents"),
  ]);
  const percent = Math.min(100, Math.max(0, Number(progress.completed) || 0));
  app.innerHTML = `<div class="welcome-strip"><div><span class="eyebrow">YOUR MOMENTUM</span><h2>Small sessions. Stronger recall.</h2><p>Turn your own study material into clear explanations, active recall, and a plan you can keep.</p></div><button class="button" data-view="assistant">Ask a question <span>→</span></button></div>
    <div class="stat-grid"><section class="card stat-card"><span class="label">Study progress</span><strong>${percent}%</strong><span class="trend">Keep building your streak</span></section><section class="card stat-card"><span class="label">Study streak</span><strong>${progress.streak || 0}<small> days</small></strong><span class="trend">Consistency compounds</span></section><section class="card stat-card"><span class="label">Library</span><strong>${documents.length}</strong><span class="trend">Source documents ready</span></section></div>
    <div class="dashboard-grid"><section class="card"><div class="section-heading"><div><span class="eyebrow">THIS WEEK</span><h2>Your learning rhythm</h2></div><span class="tag">${percent}% complete</span></div><div class="progress large"><i style="width:${percent}%"></i></div><p class="muted">${escapeHtml(progress.plan || "Choose a topic and make your next session count.")}</p><div class="quick-actions"><button class="button secondary" data-view="library">＋ Add material</button><button class="button secondary" data-view="practice">◎ Practice now</button></div></section><section class="card"><div class="section-heading"><h2>Next best action</h2><span class="spark">✦</span></div><p class="muted">${documents.length ? "Ask about a difficult concept or generate a focused practice set." : "Add your first document so StudyForge can ground every answer in your material."}</p><button class="text-button" data-view="${documents.length ? "assistant" : "library"}">${documents.length ? "Open assistant →" : "Build your library →"}</button></section></div>`;
  bind();
}
async function library() {
  title.textContent = "Your study library.";
  app.innerHTML = `<div class="page-intro"><div><span class="eyebrow">KNOWLEDGE BASE</span><h2>Bring your material with you</h2><p>Upload notes or paste a passage. StudyForge extracts, chunks, and cites your source material.</p></div><span class="tag">RAG READY</span></div><section class="card upload-card"><div class="dropzone"><span class="upload-icon">↑</span><strong>Upload a study document</strong><p>TXT, Markdown, PDF, and DOCX are supported</p><input id="file" type="file" accept=".txt,.md,.markdown,.pdf,.docx" /><label for="file" class="button secondary">Choose file</label><span id="file-name" class="muted">or paste notes below</span></div><div class="form-grid"><label>Document title<input id="doc-title" placeholder="e.g. Biology — Cell respiration" /></label><label>Notes or extracted text<textarea id="content" placeholder="Paste a passage, outline, or your own notes…"></textarea></label></div><div class="form-footer"><span id="upload-status" class="form-message"></span><button class="button" id="upload">Ingest material <span>→</span></button></div></section><section class="card section"><div class="section-heading"><div><span class="eyebrow">YOUR SOURCES</span><h2>Documents</h2></div><span class="tag" id="doc-count">Loading</span></div><div class="document-list" id="docs">${loading("Loading documents…")}</div></section>`;
  document.querySelector("#file").onchange = (event) => {
    const file = event.target.files[0];
    if (file) {
      document.querySelector("#file-name").textContent = file.name;
      document.querySelector("#doc-title").value ||= file.name.replace(/\.[^.]+$/, "");
    }
  };
  document.querySelector("#upload").onclick = upload;
  await loadDocs();
  bind();
}
async function loadDocs() {
  const { documents } = await api("/api/documents");
  document.querySelector("#doc-count").textContent =
    `${documents.length} source${documents.length === 1 ? "" : "s"}`;
  document.querySelector("#docs").innerHTML = documents.length
    ? documents
        .map(
          (doc) =>
            `<article class="document-row"><span class="document-mark">▱</span><div class="document-info"><strong>${escapeHtml(doc.title)}</strong><small>${doc.size || 0} characters · ${escapeHtml(doc.status || "ready")}</small></div><span class="tag">${escapeHtml(doc.status || "READY")}</span></article>`,
        )
        .join("")
    : emptyState(
        "Your library is waiting",
        "Upload notes or a textbook excerpt to start asking grounded questions.",
        "library",
      );
}
async function upload() {
  const file = document.querySelector("#file").files[0];
  const contentField = document.querySelector("#content");
  const status = document.querySelector("#upload-status");
  const button = document.querySelector("#upload");
  button.disabled = true;
  status.textContent = "Reading and indexing…";
  try {
    const content = contentField.value || (file ? await file.text() : "");
    const result = await api("/api/documents", {
      method: "POST",
      body: JSON.stringify({
        title: document.querySelector("#doc-title").value || file?.name || "Study notes",
        name: file?.name,
        type: file?.type,
        content,
      }),
    });
    status.innerHTML = `<span class="success">✓ ${escapeHtml(result.document.title)} is ready for retrieval.</span>`;
    contentField.value = "";
    document.querySelector("#file").value = "";
    document.querySelector("#file-name").textContent = "or paste notes below";
    await loadDocs();
  } catch (error) {
    status.innerHTML = `<span class="failure">${escapeHtml(error.message)}</span>`;
  } finally {
    button.disabled = false;
  }
}
function assistant() {
  title.textContent = "Ask StudyForge.";
  app.innerHTML = `<div class="page-intro"><div><span class="eyebrow">GROUNDED ASSISTANT</span><h2>Make a difficult idea click</h2><p>Every answer is checked against your uploaded material. Unsupported questions get an honest answer.</p></div><span class="agent-pill">◉ ${health?.foundry ? "Foundry" : "Local agents"}</span></div><section class="card assistant-card"><div class="chat" id="chat"><div class="chat-message assistant"><span class="message-avatar">✦</span><div><strong>StudyForge</strong><p>Hi! Ask me to explain a concept, compare ideas, or clarify a definition from your library.</p></div></div></div><div class="composer"><textarea id="question" aria-label="Your question" placeholder="What would you like to understand?"></textarea><button class="button" id="ask">Ask <span>↗</span></button></div></section>`;
  document.querySelector("#ask").onclick = ask;
  document.querySelector("#question").onkeydown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      ask();
    }
  };
}
async function ask() {
  const input = document.querySelector("#question");
  const question = input.value.trim();
  if (!question) return;
  const chat = document.querySelector("#chat");
  const button = document.querySelector("#ask");
  chat.insertAdjacentHTML(
    "beforeend",
    `<div class="chat-message user"><div><strong>You</strong><p>${escapeHtml(question)}</p></div></div>`,
  );
  input.value = "";
  button.disabled = true;
  chat.insertAdjacentHTML(
    "beforeend",
    `<div class="chat-message assistant pending"><span class="message-avatar">✦</span><div>${loading("Searching your sources…")}</div></div>`,
  );
  try {
    const result = await api("/api/assistant", {
      method: "POST",
      body: JSON.stringify({ question }),
    });
    chat.querySelector(".pending").outerHTML = answerMessage(result);
  } catch (error) {
    chat.querySelector(".pending").outerHTML =
      `<div class="chat-message assistant"><span class="message-avatar">!</span><div class="failure">${escapeHtml(error.message)}</div></div>`;
  } finally {
    button.disabled = false;
  }
}
function answerMessage(result) {
  const sources = (result.sources || [])
    .map(
      (source, index) =>
        `<div class="source"><span>[${index + 1}]</span><div><strong>Source ${index + 1}</strong><small>${escapeHtml(source.excerpt)}</small></div></div>`,
    )
    .join("");
  return `<div class="chat-message assistant"><span class="message-avatar">✦</span><div><strong>${escapeHtml(result.agent || "StudyForge")}</strong><p>${escapeHtml(result.answer || "I couldn't find support for that in your library.")}</p><div class="answer-meta"><span class="tag">${result.grounded ? "✓ Grounded answer" : "Evidence not found"}</span><span>${escapeHtml(result.provider || "local")} provider</span></div>${sources ? `<div class="sources"><small class="eyebrow">EVIDENCE</small>${sources}</div>` : ""}</div></div>`;
}
function practice() {
  title.textContent = "Practice lab.";
  app.innerHTML = `<div class="page-intro"><div><span class="eyebrow">ACTIVE RECALL</span><h2>Turn knowledge into confidence</h2><p>Generate study material from your sources, then use it to test what you really know.</p></div></div><section class="card generator"><div class="generator-tabs"><button class="generator-tab active" data-kind="summary">Summary</button><button class="generator-tab" data-kind="explanation">Explanation</button><button class="generator-tab" data-kind="mcq">MCQs</button><button class="generator-tab" data-kind="viva">Viva</button></div><label>Topic or concept<input id="topic" placeholder="e.g. cellular respiration, Renaissance art…" /></label><div class="form-footer"><span class="muted">Grounded in your uploaded library</span><button class="button" id="generate">Generate <span>→</span></button></div><div id="result" class="result-panel"></div></section>`;
  let kind = "summary";
  document.querySelectorAll(".generator-tab").forEach(
    (tab) =>
      (tab.onclick = () => {
        document
          .querySelectorAll(".generator-tab")
          .forEach((item) => item.classList.remove("active"));
        tab.classList.add("active");
        kind = tab.dataset.kind;
      }),
  );
  document.querySelector("#generate").onclick = async () => {
    const result = document.querySelector("#result");
    result.innerHTML = loading("Reviewing your sources…");
    try {
      const response = await api("/api/generate", {
        method: "POST",
        body: JSON.stringify({ kind, topic: document.querySelector("#topic").value }),
      });
      result.innerHTML = renderGeneration(response, kind);
    } catch (error) {
      result.innerHTML = errorState(error.message);
    }
  };
}
function renderGeneration(result, kind) {
  const evidence = result.grounded
    ? `<div class="answer-meta"><span class="tag">✓ Grounded</span><span>${result.sources.length} source reference${result.sources.length === 1 ? "" : "s"}</span></div>`
    : `<div class="notice">No supporting evidence found. Add relevant material and try again.</div>`;
  const body =
    kind === "mcq" || kind === "viva"
      ? `<div class="question-list">${(result.questions || []).map((q, i) => `<div class="question"><span>${String(i + 1).padStart(2, "0")}</span><div><strong>${escapeHtml(q.question)}</strong>${q.options ? `<div class="options">${q.options.map((option) => `<span>${escapeHtml(option)}</span>`).join("")}</div>` : ""}</div></div>`).join("")}</div>`
      : `<p class="generated-text">${escapeHtml(result.summary || "No summary returned.")}</p>`;
  return `<div class="result-heading"><div><span class="eyebrow">${escapeHtml(result.agent || "STUDY AGENT")}</span><h3>${kind === "summary" ? "Your focused summary" : kind === "explanation" ? "A clearer explanation" : "Your practice set"}</h3></div></div>${evidence}${body}<div class="source-line">${(result.sources || []).map((source, i) => `<span>[${i + 1}] ${escapeHtml(source.excerpt)}</span>`).join("")}</div>`;
}
async function plans() {
  title.textContent = "Study plans.";
  const { plans: saved } = await api("/api/plans");
  app.innerHTML = `<div class="page-intro"><div><span class="eyebrow">YOUR NEXT CHAPTER</span><h2>Make a plan you can keep</h2><p>Turn an intention into a small, visible commitment. Plans are saved to your StudyForge workspace.</p></div></div><section class="card plan-builder"><div class="form-grid"><label>Plan title<input id="plan-title" placeholder="e.g. Prepare for biology midterm" /></label><label>Focus topic<input id="plan-topic" placeholder="e.g. Cell biology" /></label><label>Sessions per week<input id="plan-sessions" type="number" min="1" max="14" value="3" /></label><label>First milestone<input id="plan-milestone" placeholder="e.g. Review lecture notes" /></label></div><div class="form-footer"><span id="plan-status" class="form-message"></span><button class="button" id="save-plan">Save study plan <span>→</span></button></div></section><section class="card section"><div class="section-heading"><div><span class="eyebrow">SAVED PLANS</span><h2>Your commitments</h2></div><span class="tag">${saved.length} plan${saved.length === 1 ? "" : "s"}</span></div><div class="plan-list">${saved.length ? saved.map((plan) => `<article class="plan-row"><span class="plan-icon">◷</span><div><strong>${escapeHtml(plan.title)}</strong><small>${escapeHtml(plan.plan?.topic || "Study focus")} · ${plan.plan?.sessions || 3} sessions/week</small><p>${escapeHtml(plan.plan?.milestone || "Keep moving forward.")}</p></div></article>`).join("") : emptyState("No plans yet", "Choose a focus and create a small weekly commitment.", "plans")}</div></section>`;
  document.querySelector("#save-plan").onclick = async () => {
    const status = document.querySelector("#plan-status");
    try {
      await api("/api/plans", {
        method: "POST",
        body: JSON.stringify({
          title: document.querySelector("#plan-title").value || "My study plan",
          plan: {
            topic: document.querySelector("#plan-topic").value,
            sessions: Number(document.querySelector("#plan-sessions").value),
            milestone: document.querySelector("#plan-milestone").value,
          },
        }),
      });
      status.innerHTML = `<span class="success">✓ Plan saved.</span>`;
      await plans();
    } catch (error) {
      status.innerHTML = `<span class="failure">${escapeHtml(error.message)}</span>`;
    }
  };
}
function bind() {
  document.querySelectorAll("[data-view]").forEach(
    (node) =>
      (node.onclick = (event) => {
        event.preventDefault();
        render(node.dataset.view);
      }),
  );
  document
    .querySelectorAll("[data-retry]")
    .forEach((node) => (node.onclick = () => render(currentView)));
}
document
  .querySelectorAll(".nav")
  .forEach((node) => (node.onclick = () => render(node.dataset.view)));
init();
