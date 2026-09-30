import { renderEvidence, renderMarkdown, renderPracticeEvidence } from "./markdown.mjs";
import {
  evaluateViva,
  gradeQuiz,
  renderQuiz,
  renderQuizFeedback,
  renderViva,
  renderVivaFeedback,
  saveGeneratedQuiz,
  submitQuizAttempt,
} from "./quiz.mjs";
import { documentSizeMetadata } from "./document-metadata.mjs";
import {
  ApiAuthenticationError,
  createApiClient,
  restoreStoredSession,
  singleFlight,
} from "./api-client.mjs";

const app = document.querySelector("#app");
const title = document.querySelector("#title");
const modeLabel = document.querySelector("#mode-label");
const modeDetail = document.querySelector("#mode-detail");
let currentView = "dashboard";
let activeQuizId = null;
let currentPlanId = null;
let historyOffset = 0;
let editingPlanId = null;
let activePracticePlanId = null;
let health = null;
let authConfig = null;
let session = null;
let authBusy = false;
let authReady = false;
let initFailed = false;
const sessionKey = "studyforge.supabase.session";
let resolveAuthReady;
let authReadyPromise = new Promise((resolve) => {
  resolveAuthReady = resolve;
});

const api = createApiClient({
  waitForAuthReady: () => authReadyPromise,
  getAccessToken: () => session?.access_token,
  onUnauthorized: async () => {
    await signOut(false);
    showAuth("Your session has expired. Sign in again.");
  },
});

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

async function supabaseRequest(path, options = {}) {
  const response = await fetch(`${authConfig.url}/auth/v1/${path}`, {
    ...options,
    headers: {
      apikey: authConfig.anonKey,
      "content-type": "application/json",
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.msg || data.error_description || data.error || "Authentication failed.");
  }
  return data;
}

function saveSession(value) {
  session = value;
  if (value) localStorage.setItem(sessionKey, JSON.stringify(value));
  else localStorage.removeItem(sessionKey);
}

async function signOut(remote = true) {
  if (remote && session?.access_token && authConfig) {
    await supabaseRequest("logout", { method: "POST" }).catch(() => {});
  }
  saveSession(null);
  document.querySelector("#sign-out").hidden = true;
}

function showAuth(message = "") {
  title.textContent = "Welcome to StudyForge.";
  document.querySelector("#sign-out").hidden = true;
  app.innerHTML = `<section class="auth-card card"><div class="auth-heading"><span class="logo">✦</span><div><span class="eyebrow">YOUR STUDY WORKSPACE</span><h2>Study with confidence.</h2><p>Sign in to keep your library, progress, and study plans connected to your account.</p></div></div><form id="auth-form"><label>Email address<input id="auth-email" type="email" autocomplete="email" required placeholder="you@example.com" /></label><label>Password<input id="auth-password" type="password" autocomplete="current-password" minlength="6" required placeholder="At least 6 characters" /></label><div class="form-footer"><span id="auth-status" class="form-message">${escapeHtml(message)}</span><button class="button" id="auth-submit" type="submit">Sign in <span>→</span></button></div></form><button class="text-button auth-toggle" id="auth-toggle" type="button">Need an account? Create one</button></section>`;
  let mode = "signin";
  const form = document.querySelector("#auth-form");
  const submit = document.querySelector("#auth-submit");
  const toggle = document.querySelector("#auth-toggle");
  const status = document.querySelector("#auth-status");
  toggle.onclick = () => {
    mode = mode === "signin" ? "signup" : "signin";
    submit.innerHTML =
      mode === "signin" ? "Sign in <span>→</span>" : "Create account <span>→</span>";
    toggle.textContent =
      mode === "signin" ? "Need an account? Create one" : "Already have an account? Sign in";
    status.textContent = "";
  };
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (authBusy) return;
    authBusy = true;
    submit.disabled = true;
    status.textContent = mode === "signin" ? "Signing in…" : "Creating your account…";
    try {
      const email = document.querySelector("#auth-email").value.trim();
      const password = document.querySelector("#auth-password").value;
      const result =
        mode === "signin"
          ? await supabaseRequest("token?grant_type=password", {
              method: "POST",
              body: JSON.stringify({ email, password }),
            })
          : await supabaseRequest("signup", {
              method: "POST",
              body: JSON.stringify({ email, password }),
            });
      if (!result.access_token) {
        status.textContent = "Account created. Check your email to confirm it, then sign in.";
        return;
      }
      saveSession(result);
      await api("/api/auth/me");
      document.querySelector("#sign-out").hidden = false;
      await render("dashboard");
    } catch (error) {
      status.textContent = error.message;
    } finally {
      authBusy = false;
      submit.disabled = false;
    }
  };
}

function setAuthReady(value) {
  if (!value && authReady) {
    authReadyPromise = new Promise((resolve) => {
      resolveAuthReady = resolve;
    });
  }
  authReady = value;
  if (value) resolveAuthReady?.();
  document.querySelectorAll(".nav, [data-view]").forEach((node) => {
    node.toggleAttribute("aria-disabled", !value);
  });
}

async function restoreSession() {
  const restored = await restoreStoredSession({
    savedSession: localStorage.getItem(sessionKey),
    setSession: saveSession,
    validateSession: () => api("/api/auth/me", { skipAuthReady: true }),
  });
  if (restored) {
    document.querySelector("#sign-out").hidden = false;
  }
  return restored;
}

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
  setAuthReady(false);
  initFailed = false;
  app.innerHTML = loading("Connecting to your study workspace…");
  try {
    setMode(await api("/api/health", { skipAuthReady: true }));
    document.querySelector("#date-label").textContent = new Intl.DateTimeFormat(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    })
      .format(new Date())
      .toUpperCase();
    authConfig = (await api("/api/auth/config", { skipAuthReady: true })).supabase;
    if (health?.supabase && (!authConfig || !(await restoreSession()))) {
      setAuthReady(true);
      showAuth();
      return;
    }
    setAuthReady(true);
    if (session) document.querySelector("#sign-out").hidden = false;
    await render("dashboard");
  } catch (error) {
    initFailed = true;
    modeLabel.textContent = "Connection issue";
    modeDetail.textContent = "StudyForge could not finish starting.";
    app.innerHTML = errorState(error.message);
    bind();
  }
}
function shell(view) {
  currentView = view;
  document
    .querySelectorAll(".nav")
    .forEach((node) => node.classList.toggle("active", node.dataset.view === view));
}
async function render(view = currentView) {
  if (!authReady) return;
  if (health?.supabase && !session) {
    showAuth();
    return;
  }
  shell(view);
  app.innerHTML = loading();
  try {
    if (view === "dashboard") return await dashboard();
    if (view === "assistant") return assistant();
    if (view === "history") return await studyHistory();
    if (view === "library") return library();
    if (view === "practice") return practice();
    if (view === "plans") return await plans();
  } catch (error) {
    if (error instanceof ApiAuthenticationError) return;
    app.innerHTML = errorState(error.message);
    bind();
  }
}
function dashboardAnalytics(progress, documents, plans) {
  const quizAttempts = Number(progress.quizAttempts) || 0;
  const averageQuiz = Number(progress.averageQuizScore) || 0;
  const vivaAttempts = Number(progress.vivaAttempts) || 0;
  const averageViva = Number(progress.averageVivaScore) || 0;
  const activeDays = Number(progress.activeDays) || 0;
  const recent = Array.isArray(progress.recentActivity) ? progress.recentActivity : [];
  const savedPlans = Array.isArray(plans) ? plans : [];
  const activePlan = savedPlans.find((plan) => plan.id === progress.currentPlanId) || null;
  const hasActivity = quizAttempts + vivaAttempts + recent.length > 0;
  if (!hasActivity) {
    return `<section class="card section"><div class="section-heading"><div><span class="eyebrow">YOUR ACTIVITY</span><h2>Nothing recorded yet</h2></div></div><div class="empty"><span class="empty-icon">&#10022;</span><strong>No practice activity yet</strong><p>Generate a practice set and submit your answers. Your scores and averages appear here.</p><button class="button secondary" data-view="practice">Open practice lab</button></div></section>`;
  }
  const nextAction =
    !activePlan && savedPlans.length
      ? {
          label: "Choose a current plan",
          view: "plans",
          copy: "Select a plan so weekly progress and study activity stay tied to the right commitment.",
        }
      : !documents.length
        ? {
            label: "Upload study material",
            view: "library",
            copy: "Add your first document so StudyForge can ground every answer in your material.",
          }
        : quizAttempts + vivaAttempts === 0
          ? {
              label: "Start practice",
              view: "practice",
              copy: "Generate MCQs or a Viva set from your library and record your first attempt.",
            }
          : !activePlan
            ? {
                label: "Create a study plan",
                view: "plans",
                copy: "Turn your momentum into a weekly commitment you can keep.",
              }
            : {
                label: "Continue this plan",
                view: "practice",
                copy: `${activePlan.title}: ${activePlan.plan?.milestone || "Keep moving forward with your next study session."}`,
              };
  const rows = recent
    .slice(0, 6)
    .map(
      (entry) =>
        `<div class="activity-row"><strong>${escapeHtml(entry.summary || entry.type)}</strong><small>${
          entry.score === null || entry.score === undefined
            ? ""
            : `${escapeHtml(String(entry.score))}% &#183; `
        }${escapeHtml(new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(entry.at)))}</small></div>`,
    )
    .join("");
  return `<section class="section"><div class="section-heading"><div><span class="eyebrow">YOUR ACTIVITY</span><h2>Measure what you practice</h2></div><span class="tag">${activeDays} active day${activeDays === 1 ? "" : "s"}</span></div><div class="stat-grid"><section class="card stat-card"><span class="label">MCQ attempts</span><strong>${quizAttempts}</strong><span class="trend">Average ${averageQuiz}%</span></section><section class="card stat-card"><span class="label">Viva attempts</span><strong>${vivaAttempts}</strong><span class="trend">Average ${averageViva}%</span></section><section class="card stat-card"><span class="label">Saved plans</span><strong>${savedPlans.length}</strong><span class="trend">${activePlan ? escapeHtml(activePlan.title) : "No plan selected"}</span></section></div><div class="dashboard-grid"><section class="card"><div class="section-heading"><h2>Recent activity</h2><span class="spark">&#10022;</span></div><div class="activity-list">${rows}</div></section><section class="card"><div class="section-heading"><h2>Next best action</h2><span class="spark">&#10022;</span></div><p class="muted">${escapeHtml(nextAction.copy)}</p><button class="text-button" data-view="${nextAction.view}">${escapeHtml(nextAction.label)}</button></section></div></section>`;
}
async function dashboard() {
  title.textContent = "Good afternoon, learner.";
  const [{ progress, weeklyStudy }, { documents }, { plans }] = await Promise.all([
    api("/api/progress"),
    api("/api/documents"),
    api("/api/plans"),
  ]);
  const completedSessions = Math.max(0, Number(weeklyStudy?.completed) || 0);
  const hasSelectedPlan = Boolean(weeklyStudy?.planId);
  const hasWeeklyTarget = hasSelectedPlan && Number(weeklyStudy?.target) > 0;
  currentPlanId = weeklyStudy?.planId || null;
  const weeklyTarget = hasWeeklyTarget ? Number(weeklyStudy.target) : 0;
  const percent = Math.min(100, Math.max(0, Number(weeklyStudy?.percentage) || 0));
  const weeklyDescription = hasSelectedPlan
    ? `Current plan: ${weeklyStudy.planTitle}.`
    : weeklyStudy?.hasPlan
      ? "Select a plan to see its weekly progress."
      : "Create a Study Plan to track plan-specific weekly progress.";
  app.innerHTML = `<div class="welcome-strip"><div><span class="eyebrow">YOUR MOMENTUM</span><h2>Small sessions. Stronger recall.</h2><p>Turn your own study material into clear explanations, active recall, and a plan you can keep.</p></div><button class="button" data-view="assistant">Ask a question <span>→</span></button></div>
    <div class="stat-grid dashboard-overview"><section class="card stat-card"><span class="label">Study progress</span><strong>${percent}%</strong><span class="trend">${hasWeeklyTarget ? `${completedSessions} of ${weeklyTarget} sessions this week` : "Select a valid weekly target"}</span></section><section class="card stat-card"><span class="label">Library</span><strong>${documents.length}</strong><span class="trend">Source documents ready</span></section></div>
    <div class="dashboard-grid"><section class="card"><div class="section-heading"><div><span class="eyebrow">THIS WEEK</span><h2>Your learning rhythm</h2></div><span class="tag">${hasWeeklyTarget ? `${completedSessions} / ${weeklyTarget} sessions` : hasSelectedPlan ? "Weekly target unavailable" : "No plan selected"}</span></div>${hasWeeklyTarget ? `<div class="progress large"><i style="width:${percent}%"></i></div>` : `<div class="empty"><strong>Plan progress is waiting</strong><p>${hasSelectedPlan ? "Edit this plan to set a valid sessions-per-week target." : "Select a plan to track its sessions for this week."}</p><button class="button secondary" data-view="plans">${hasSelectedPlan ? "Manage plan" : "Choose a plan"}</button></div>`}<p class="muted">${escapeHtml(weeklyDescription)}</p><div class="quick-actions"><button class="button secondary" data-view="library">＋ Add material</button><button class="button secondary" data-view="practice">◎ Practice now</button></div></section><section class="card"><div class="section-heading"><h2>Next best action</h2><span class="spark">✦</span></div><p class="muted">${!hasSelectedPlan ? "Choose a Study Plan to make this week’s next step specific." : documents.length ? "Ask about a difficult concept or generate a focused practice set." : "Add your first document so StudyForge can ground every answer in your material."}</p><button class="text-button" data-view="${!hasSelectedPlan ? "plans" : documents.length ? "assistant" : "library"}">${!hasSelectedPlan ? "Choose a plan →" : documents.length ? "Open assistant →" : "Build your library →"}</button></section></div>`;
  app.insertAdjacentHTML("beforeend", dashboardAnalytics(progress, documents, plans));
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
        .map((doc) => {
          const size = documentSizeMetadata(doc);
          return `<article class="document-row"><span class="document-mark">▱</span><div class="document-info"><strong>${escapeHtml(doc.title)}</strong><small>${escapeHtml(size.value)} · ${escapeHtml(doc.status || "ready")}</small></div><span class="tag">${escapeHtml(doc.status || "READY")}</span><div class="document-actions"><button class="text-button" data-document-view="${escapeHtml(doc.id)}">View</button><button class="text-button danger" data-document-delete="${escapeHtml(doc.id)}">Delete</button></div></article>`;
        })
        .join("")
    : emptyState(
        "Your library is waiting",
        "Upload PDF, DOCX, Markdown, or text notes to unlock grounded answers, practice sets, and progress tracking.",
        "library",
      );
  document.querySelectorAll("[data-document-view]").forEach((button) => {
    button.onclick = () => viewDocument(button.dataset.documentView);
  });
  document.querySelectorAll("[data-document-delete]").forEach((button) => {
    button.onclick = () => deleteDocument(button.dataset.documentDelete);
  });
}
async function viewDocument(id) {
  const panel = document.querySelector("#docs");
  panel.innerHTML = loading("Loading document…");
  try {
    const { document: doc } = await api(`/api/documents/${encodeURIComponent(id)}`);
    const size = documentSizeMetadata(doc);
    panel.innerHTML = `<div class="document-detail"><div class="section-heading"><div><span class="eyebrow">DOCUMENT DETAILS</span><h3>${escapeHtml(doc.title)}</h3></div><button class="button secondary" data-library-back>Back to library</button></div><div class="document-meta"><span><strong>File type</strong>${escapeHtml(doc.type || "Unknown")}</span><span><strong>${size.label}</strong>${escapeHtml(size.value)}</span><span><strong>Status</strong>${escapeHtml(doc.status || "ready")}</span><span><strong>Uploaded</strong>${doc.createdAt ? escapeHtml(new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(doc.createdAt))) : "Unknown"}</span></div><div class="document-content"><strong>Extracted content</strong><pre>${escapeHtml(doc.content || "No extracted content available.")}</pre></div></div>`;
    document.querySelector("[data-library-back]").onclick = loadDocs;
  } catch (error) {
    panel.innerHTML = errorState(error.message);
    bind();
  }
}
async function deleteDocument(id) {
  if (!window.confirm("Delete this document and its indexed study data? This cannot be undone."))
    return;
  try {
    await api(`/api/documents/${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadDocs();
  } catch (error) {
    const status = document.querySelector("#upload-status");
    if (status)
      status.innerHTML = `<span class="failure">${escapeHtml(error.message || "Document could not be deleted.")}</span>`;
    else app.innerHTML = errorState(error.message || "Document could not be deleted.");
  }
}
async function uploadOnce() {
  const file = document.querySelector("#file").files[0];
  const contentField = document.querySelector("#content");
  const status = document.querySelector("#upload-status");
  const button = document.querySelector("#upload");
  button.disabled = true;
  status.textContent = "Reading and indexing…";
  try {
    const payload = {
      title: document.querySelector("#doc-title").value || file?.name || "Study notes",
    };
    if (contentField.value) {
      payload.content = contentField.value;
    } else if (file) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      const chunkSize = 0x8000;
      for (let index = 0; index < bytes.length; index += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
      }
      payload.data = btoa(binary);
      payload.name = file.name;
      payload.type = file.type;
    }
    const result = await api("/api/documents", {
      method: "POST",
      body: JSON.stringify(payload),
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
const upload = singleFlight(uploadOnce);
const assistantSuggestions = [
  "Explain the main concepts in my study material",
  "Give me 5 MCQs on this topic",
  "Explain this topic simply",
  "Prepare viva questions for this topic",
  "Compare two concepts from my material",
];
function assistant() {
  title.textContent = "Ask StudyForge.";
  app.innerHTML = `<div class="page-intro"><div><span class="eyebrow">GROUNDED ASSISTANT</span><h2>Make a difficult idea click</h2><p>Every answer is checked against your uploaded material. Unsupported questions get an honest answer.</p></div><span class="agent-pill">◉ ${health?.foundry ? "Foundry" : "Local agents"}</span></div><section class="card assistant-card"><div class="chat" id="chat"><div class="chat-message assistant"><span class="message-avatar">✦</span><div><strong>StudyForge</strong><p>Hi! Ask me to explain a concept, compare ideas, or clarify a definition from your library.</p></div></div></div><div class="composer"><textarea id="question" aria-label="Your question" placeholder="What would you like to understand?"></textarea><button class="button" id="ask">Ask <span>↗</span></button></div></section>`;
  document
    .querySelector(".composer")
    .insertAdjacentHTML(
      "beforebegin",
      `<div class="suggestions" id="suggestions">${assistantSuggestions
        .map(
          (suggestion) =>
            `<button class="chip" type="button" data-suggestion="${escapeHtml(suggestion)}">${escapeHtml(suggestion)}</button>`,
        )
        .join("")}</div>`,
    );
  document.querySelectorAll("[data-suggestion]").forEach(
    (chip) =>
      (chip.onclick = () => {
        document.querySelector("#question").value = chip.dataset.suggestion;
        ask();
      }),
  );
  document.querySelector("#ask").onclick = ask;
  document.querySelector("#question").onkeydown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      ask();
    }
  };
}
async function ask(retryQuestion = null, retryRequestId = null) {
  const input = document.querySelector("#question");
  const question = (retryQuestion || input.value).trim();
  if (!question) return;
  const requestId =
    retryRequestId ||
    globalThis.crypto?.randomUUID?.() ||
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const chat = document.querySelector("#chat");
  const button = document.querySelector("#ask");
  chat.insertAdjacentHTML(
    "beforeend",
    `<div class="chat-message user" data-user-question="${escapeHtml(question)}"><div><strong>You</strong><p>${escapeHtml(question)}</p></div></div>`,
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
      headers: { "x-request-id": requestId },
      body: JSON.stringify({ question }),
    });
    chat.querySelector(".pending").outerHTML = answerMessage(result);
  } catch (error) {
    chat.querySelector(".pending").outerHTML =
      `<div class="chat-message assistant"><span class="message-avatar">!</span><div class="failure">${escapeHtml(error.message)}${error.status === 503 || error.kind === "network" || error.kind === "provider" ? `<button class="text-button" data-retry-question="${escapeHtml(question)}" data-request-id="${escapeHtml(requestId)}">Try this question again</button>` : ""}</div></div>`;
    chat.querySelectorAll("[data-retry-question]").forEach((retry) => {
      retry.onclick = () => {
        const questionToRetry = retry.dataset.retryQuestion;
        retry.remove();
        chat.querySelectorAll(".chat-message.user").forEach((message) => {
          if (message.dataset.userQuestion === questionToRetry) message.remove();
        });
        void ask(questionToRetry, retry.dataset.requestId);
      };
    });
  } finally {
    button.disabled = false;
  }
}
const historyPageSize = 10;
function historyEntry(record, plans) {
  const plan = plans.find((item) => item.id === record.studyPlanId);
  const date = new Date(record.createdAt);
  const created = Number.isNaN(date.getTime()) ? "Date unavailable" : date.toLocaleString();
  const sources = Array.isArray(record.sources) ? record.sources : [];
  return `<article class="card history-entry"><div class="history-entry-heading"><div><span class="eyebrow">QUESTION</span><h3>${escapeHtml(record.question)}</h3></div><span class="tag">${record.grounded ? "✓ Grounded" : "Evidence not found"}</span></div><div class="history-meta"><span>${escapeHtml(plan?.title || (record.studyPlanId ? "Saved plan" : "No plan selected"))}</span><span>${escapeHtml(created)}</span><span>${escapeHtml(record.provider || "local")} provider</span></div><details><summary>Revisit saved answer${sources.length ? ` · ${sources.length} source${sources.length === 1 ? "" : "s"}` : ""}</summary><div class="answer-content">${renderMarkdown(record.answer)}</div>${renderEvidence(sources)}</details></article>`;
}
async function studyHistory() {
  title.textContent = "Study History.";
  app.innerHTML = loading("Loading your Study History…");
  const [{ history: entries, hasMore }, { plans }] = await Promise.all([
    api(`/api/history?limit=${historyPageSize}&offset=0`),
    api("/api/plans"),
  ]);
  historyOffset = entries.length;
  const planList = Array.isArray(plans) ? plans : [];
  app.innerHTML = `<div class="page-intro"><div><span class="eyebrow">YOUR STUDY TRAIL</span><h2>Study History</h2><p>Revisit your Ask StudyForge questions, answers, and supporting evidence.</p></div><button class="button secondary" data-view="assistant">Ask StudyForge <span>↗</span></button></div>${entries.length ? `<section class="history-list" id="history-list">${entries.map((entry) => historyEntry(entry, planList)).join("")}</section>${hasMore ? `<div class="form-footer"><span class="form-message" id="history-status"></span><button class="button secondary" id="history-more">Load more</button></div>` : ""}` : `<section class="card empty"><strong>No Study History yet</strong><p>Your successful Ask StudyForge responses will appear here.</p><button class="button secondary" data-view="assistant">Ask your first question</button></section>`}`;
  const more = document.querySelector("#history-more");
  if (more) {
    more.onclick = async () => {
      more.disabled = true;
      more.textContent = "Loading…";
      const status = document.querySelector("#history-status");
      status.textContent = "";
      try {
        const page = await api(`/api/history?limit=${historyPageSize}&offset=${historyOffset}`);
        document
          .querySelector("#history-list")
          .insertAdjacentHTML(
            "beforeend",
            page.history.map((entry) => historyEntry(entry, planList)).join(""),
          );
        historyOffset += page.history.length;
        if (!page.hasMore) more.remove();
        else {
          more.disabled = false;
          more.textContent = "Load more";
        }
      } catch (error) {
        status.textContent = `Could not load more history: ${error.message}`;
        more.disabled = false;
        more.textContent = "Try again";
      }
    };
  }
  bind();
}
function answerMessage(result) {
  return `<div class="chat-message assistant"><span class="message-avatar">✦</span><div><strong>${escapeHtml(result.agent || "StudyForge")}</strong><div class="answer-content">${renderMarkdown(result.answer || "I couldn't find support for that in your library.")}</div><div class="answer-meta"><span class="tag">${result.grounded ? "✓ Grounded answer" : "Evidence not found"}</span><span>${escapeHtml(result.provider || "local")} provider</span></div>${renderEvidence(result.sources)}</div></div>`;
}
async function practice() {
  title.textContent = "Practice lab.";
  const { documents } = await api("/api/documents");
  if (!documents.length) {
    app.innerHTML = `<div class="page-intro"><div><span class="eyebrow">ACTIVE RECALL</span><h2>Turn knowledge into confidence</h2><p>Practice is grounded in your own material, so StudyForge will not invent questions.</p></div></div><section class="card"><div class="empty"><span class="empty-icon">&#10022;</span><strong>Upload study material first</strong><p>Add a document to unlock grounded summaries, explanations, MCQs, and Viva practice.</p><button class="button" data-view="library">Go to My library</button></div></section>`;
    bind();
    return;
  }
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
      const topic = document.querySelector("#topic").value.trim();
      if (!topic) {
        result.innerHTML = errorState(
          "Add a topic or concept so StudyForge can ground your practice in the uploaded material.",
        );
        bind();
        return;
      }
      const response = await api("/api/generate", {
        method: "POST",
        body: JSON.stringify({ kind, topic, ...(currentPlanId ? { planId: currentPlanId } : {}) }),
      });
      activePracticePlanId = currentPlanId;
      const questions = Array.isArray(response.questions) ? response.questions : [];
      if ((kind === "mcq" || kind === "viva") && !questions.length) {
        result.innerHTML = `<div class="notice">${response.grounded ? "The generator returned no questions for that topic. Try a more specific topic." : "No supporting evidence was found in your library for this topic."}</div>`;
        return;
      }
      result.innerHTML = renderGeneration(response, kind);
      if (kind === "mcq") {
        activeQuizId = await saveGeneratedQuiz(api, {
          title: topic ? `MCQ practice: ${topic}` : "MCQ practice",
          questions,
          planId: activePracticePlanId,
        }).catch(() => null);
        bindQuiz(questions);
      }
      if (kind === "viva") bindViva(questions);
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
      ? kind === "viva"
        ? renderViva(result.questions || [])
        : renderQuiz(result.questions || [])
      : `<div class="generated-text">${renderMarkdown(result.summary || "No summary returned.")}</div>`;
  return `<div class="result-heading"><div><span class="eyebrow">${escapeHtml(result.agent || "STUDY AGENT")}</span><h3>${kind === "summary" ? "Your focused summary" : kind === "explanation" ? "A clearer explanation" : "Your practice set"}</h3></div></div>${evidence}${body}${renderPracticeEvidence(result.sources)}`;
}
function bindQuiz(questions) {
  const form = document.querySelector("#quiz-form");
  if (!form) return;
  form.onsubmit = async (event) => {
    event.preventDefault();
    const answers = {};
    questions.forEach((_, index) => {
      const selected = form.querySelector(`input[name="question-${index}"]:checked`);
      if (selected) answers[index] = selected.value;
    });
    const graded = gradeQuiz(questions, answers);
    const feedback = form.querySelector("#quiz-feedback");
    feedback.innerHTML = renderQuizFeedback(graded);
    if (!activeQuizId) {
      feedback.insertAdjacentHTML(
        "beforeend",
        `<div class="notice">Score shown. This practice set could not be saved, so no attempt was recorded.</div>`,
      );
      return;
    }
    const saved = await submitQuizAttempt(api, activeQuizId, answers).catch(() => null);
    feedback.insertAdjacentHTML(
      "beforeend",
      saved
        ? saved.progressPersisted
          ? `<div class="notice success-note">Attempt saved. Your progress and average score were updated.</div>`
          : `<div class="notice">Attempt saved, but Dashboard activity could not be updated. Apply the pending Supabase progress migration and refresh.</div>`
        : `<div class="notice">Your score is shown, but the attempt could not be saved.</div>`,
    );
  };
}
function bindViva(questions) {
  const form = document.querySelector("#viva-form");
  if (!form) return;
  form.onsubmit = async (event) => {
    event.preventDefault();
    const answers = questions.map(
      (_, index) => form.querySelector(`textarea[name="question-${index}"]`)?.value || "",
    );
    const feedback = form.querySelector("#viva-feedback");
    if (!answers.some((answer) => answer.trim())) {
      feedback.innerHTML = `<div class="notice">Write at least one answer before checking.</div>`;
      return;
    }
    const button = form.querySelector(".quiz-submit");
    if (button) button.disabled = true;
    feedback.innerHTML = loading("Evaluating your answers against the reference material.");
    try {
      const { evaluation, progressPersisted } = await evaluateViva(
        api,
        questions,
        answers,
        activePracticePlanId,
      );
      feedback.innerHTML =
        renderVivaFeedback(questions, answers, evaluation) +
        (progressPersisted
          ? `<div class="notice success-note">Progress was updated.</div>`
          : `<div class="notice">Answers were evaluated, but Dashboard activity could not be updated. Apply the pending Supabase progress migration and refresh.</div>`);
    } catch (error) {
      feedback.innerHTML =
        renderVivaFeedback(questions, answers) +
        `<div class="notice">${escapeHtml(error.message || "Your answers could not be evaluated.")}</div>`;
    } finally {
      if (button) button.disabled = false;
    }
  };
}
function validatePlanInput({ title, topic, sessions, milestone }) {
  const titleValue = title.value.trim();
  const topicValue = topic.value.trim();
  const sessionsValue = sessions.value.trim();
  const milestoneValue = milestone.value.trim();
  if (!titleValue) return "Add a plan title.";
  if (titleValue.length > 200) return "Plan title must be 200 characters or fewer.";
  if (!topicValue) return "Add a focus topic for this plan.";
  if (topicValue.length > 200) return "Focus topic must be 200 characters or fewer.";
  const sessionCount = Number(sessionsValue);
  if (!sessionsValue || !Number.isInteger(sessionCount) || sessionCount < 1 || sessionCount > 14)
    return "Sessions per week must be a whole number from 1 to 14.";
  if (milestoneValue.length > 300) return "First milestone must be 300 characters or fewer.";
  return null;
}
async function plans() {
  title.textContent = "Study plans.";
  const [{ plans: saved }, { progress }] = await Promise.all([
    api("/api/plans"),
    api("/api/progress"),
  ]);
  currentPlanId = progress.currentPlanId || null;
  app.innerHTML = `<div class="page-intro"><div><span class="eyebrow">YOUR NEXT CHAPTER</span><h2>Make a plan you can keep</h2><p>Turn an intention into a small, visible commitment. Plans are saved to your StudyForge workspace.</p></div></div><section class="card plan-builder"><div class="form-grid"><label>Plan title<input id="plan-title" placeholder="e.g. Prepare for biology midterm" /></label><label>Focus topic<input id="plan-topic" placeholder="e.g. Cell biology" /></label><label>Sessions per week<input id="plan-sessions" type="number" min="1" max="14" value="3" /></label><label>First milestone<input id="plan-milestone" placeholder="e.g. Review lecture notes" /></label></div><div class="form-footer"><span id="plan-status" class="form-message"></span><button class="button" id="save-plan">Save study plan <span>→</span></button></div></section><section class="card section"><div class="section-heading"><div><span class="eyebrow">SAVED PLANS</span><h2>Your commitments</h2></div><span class="tag">${saved.length} plan${saved.length === 1 ? "" : "s"}</span></div><div class="plan-list">${saved.length ? saved.map((plan) => `<article class="plan-row"><span class="plan-icon">◷</span><div><strong>${escapeHtml(plan.title)}</strong><small>${escapeHtml(plan.plan?.topic || "Study focus")} · ${plan.plan?.sessions || 3} sessions/week</small><p>${escapeHtml(plan.plan?.milestone || "Keep moving forward.")}</p><small>${currentPlanId === plan.id ? "Current plan" : "Progress belongs to this plan"}</small></div><div class="document-actions">${currentPlanId === plan.id ? `<span class="tag">Selected</span>` : `<button class="text-button" data-plan-select="${escapeHtml(plan.id)}">Make current</button>`}<button class="text-button" data-plan-edit="${escapeHtml(plan.id)}">Edit</button><button class="text-button danger" data-plan-delete="${escapeHtml(plan.id)}">Delete</button></div></article>`).join("") : emptyState("No plans yet", "Choose a focus and create a small weekly commitment.", "plans")}</div></section>`;
  editingPlanId = null;
  document.querySelectorAll("[data-plan-select]").forEach((button) => {
    button.onclick = async () => {
      await api("/api/progress", {
        method: "POST",
        body: JSON.stringify({ currentPlanId: button.dataset.planSelect }),
      });
      currentPlanId = button.dataset.planSelect;
      await plans();
    };
  });
  document.querySelectorAll("[data-plan-edit]").forEach((button) => {
    button.onclick = () => {
      const plan = saved.find((item) => item.id === button.dataset.planEdit);
      if (!plan) return;
      editingPlanId = plan.id;
      document.querySelector("#plan-title").value = plan.title;
      document.querySelector("#plan-topic").value = plan.plan?.topic || "";
      document.querySelector("#plan-sessions").value = plan.plan?.sessions || 3;
      document.querySelector("#plan-milestone").value = plan.plan?.milestone || "";
      document.querySelector("#save-plan").textContent = "Update study plan →";
      document.querySelector("#plan-title").focus();
    };
  });
  document.querySelectorAll("[data-plan-delete]").forEach((button) => {
    button.onclick = async () => {
      const plan = saved.find((item) => item.id === button.dataset.planDelete);
      if (
        !plan ||
        !confirm(
          `Delete “${plan.title}”? This plan and its associated progress will no longer be active.`,
        )
      )
        return;
      try {
        await api(`/api/plans/${encodeURIComponent(plan.id)}`, { method: "DELETE" });
        await plans();
      } catch (error) {
        document.querySelector("#plan-status").innerHTML =
          `<span class="failure">${escapeHtml(error.message)}</span>`;
      }
    };
  });
  document.querySelector("#save-plan").onclick = async () => {
    const status = document.querySelector("#plan-status");
    const invalid = validatePlanInput({
      title: document.querySelector("#plan-title"),
      topic: document.querySelector("#plan-topic"),
      sessions: document.querySelector("#plan-sessions"),
      milestone: document.querySelector("#plan-milestone"),
    });
    if (invalid) {
      status.innerHTML = `<span class="failure">${escapeHtml(invalid)}</span>`;
      return;
    }
    try {
      const payload = {
        title: document.querySelector("#plan-title").value || "My study plan",
        plan: {
          topic: document.querySelector("#plan-topic").value,
          sessions: Number(document.querySelector("#plan-sessions").value),
          milestone: document.querySelector("#plan-milestone").value,
        },
      };
      const updated = await api(
        editingPlanId ? `/api/plans/${encodeURIComponent(editingPlanId)}` : "/api/plans",
        {
          method: editingPlanId ? "PUT" : "POST",
          body: JSON.stringify({
            ...payload,
          }),
        },
      );
      if (!editingPlanId && !currentPlanId && updated.plan?.id) {
        await api("/api/progress", {
          method: "POST",
          body: JSON.stringify({ currentPlanId: updated.plan.id }),
        });
      }
      status.innerHTML = `<span class="success">✓ Plan ${editingPlanId ? "updated" : "saved"}.</span>`;
      editingPlanId = null;
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
  document.querySelectorAll("[data-retry]").forEach(
    (node) =>
      (node.onclick = () => {
        if (initFailed) void init();
        else void render(currentView);
      }),
  );
}
document.querySelector("#sign-out").onclick = async () => {
  await signOut();
  showAuth("You have been signed out.");
};
document
  .querySelectorAll(".nav")
  .forEach((node) => (node.onclick = () => render(node.dataset.view)));
init();
