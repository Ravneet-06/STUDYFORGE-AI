import { createHash } from "node:crypto";
import { classifyAgentLabels } from "./issue-routing.mjs";

const payloadKeys = [
  "repository",
  "issueNumber",
  "issueTitle",
  "issueBody",
  "responsibleAgentLabel",
  "mappedAgentRole",
  "issueUrl",
  "eventAction",
  "timestamp",
];
const allowedActions = new Set(["opened", "reopened", "labeled"]);
const maximumTitleLength = 256;
const maximumBodyLength = 65_536;
const maximumLabelLength = 100;

function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}

function normalizedTimestamp(value) {
  invariant(typeof value === "string", "timestamp must be a string.");
  const time = Date.parse(value);
  invariant(Number.isFinite(time), "timestamp must be a valid date.");
  return new Date(time).toISOString();
}

function labelName(label) {
  return typeof label === "string" ? label : label?.name;
}

export function classifyExecutionLabels(labels) {
  const names = (Array.isArray(labels) ? labels : []).map(labelName);
  const malformed = [
    ...new Set(
      names.filter(
        (name) =>
          typeof name === "string" &&
          /^agent(?::|$)/i.test(name) &&
          classifyAgentLabels([name]).status !== "routed",
      ),
    ),
  ];
  if (malformed.length) return { status: "malformed", labels: malformed };
  return classifyAgentLabels(labels);
}

export function normalizeExecutionPayload(input) {
  invariant(
    input && typeof input === "object" && !Array.isArray(input),
    "payload must be an object.",
  );
  invariant(
    Object.keys(input).length === payloadKeys.length && payloadKeys.every((key) => key in input),
    "payload must contain only the approved fields.",
  );

  const repository = input.repository;
  invariant(
    typeof repository === "string" && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository),
    "repository must be an owner/name pair.",
  );
  invariant(
    Number.isSafeInteger(input.issueNumber) && input.issueNumber > 0,
    "issueNumber must be a positive safe integer.",
  );
  invariant(typeof input.issueTitle === "string", "issueTitle must be a string.");
  const issueTitle = input.issueTitle.normalize("NFC").trim();
  invariant(
    issueTitle.length > 0 && issueTitle.length <= maximumTitleLength,
    "issueTitle is invalid.",
  );
  invariant(typeof input.issueBody === "string", "issueBody must be a string.");
  const issueBody = input.issueBody.normalize("NFC").replace(/\r\n?/g, "\n");
  invariant(issueBody.length <= maximumBodyLength, "issueBody is too long.");

  invariant(typeof input.responsibleAgentLabel === "string", "responsibleAgentLabel is invalid.");
  invariant(
    input.responsibleAgentLabel.length <= maximumLabelLength,
    "responsibleAgentLabel is too long.",
  );
  const assignment = classifyAgentLabels([input.responsibleAgentLabel]);
  invariant(
    assignment.status === "routed" && assignment.role === input.mappedAgentRole,
    "responsibleAgentLabel and mappedAgentRole must identify one recognized agent.",
  );

  invariant(typeof input.issueUrl === "string", "issueUrl must be a string.");
  let issueUrl;
  try {
    issueUrl = new URL(input.issueUrl);
  } catch {
    throw new TypeError("issueUrl must be a valid GitHub Issue URL.");
  }
  const expectedPath = `/${repository}/issues/${input.issueNumber}`;
  invariant(
    issueUrl.protocol === "https:" &&
      issueUrl.hostname === "github.com" &&
      !issueUrl.username &&
      !issueUrl.password &&
      !issueUrl.search &&
      !issueUrl.hash &&
      issueUrl.pathname.toLowerCase() === expectedPath.toLowerCase(),
    "issueUrl must refer to this Issue in the GitHub repository.",
  );

  invariant(allowedActions.has(input.eventAction), "eventAction is not allowed.");
  const timestamp = normalizedTimestamp(input.timestamp);

  return {
    repository,
    issueNumber: input.issueNumber,
    issueTitle,
    issueBody,
    responsibleAgentLabel: input.responsibleAgentLabel,
    mappedAgentRole: assignment.role,
    issueUrl: issueUrl.href,
    eventAction: input.eventAction,
    timestamp,
  };
}

function eventDigest({ repository, issueNumber, eventAction, timestamp, triggerLabel = "" }) {
  invariant(
    typeof repository === "string" && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository),
    "repository must be an owner/name pair.",
  );
  invariant(Number.isSafeInteger(issueNumber) && issueNumber > 0, "issueNumber is invalid.");
  invariant(allowedActions.has(eventAction), "eventAction is not allowed.");
  invariant(
    typeof triggerLabel === "string" && triggerLabel.length <= maximumLabelLength,
    "triggerLabel is invalid.",
  );
  const identity = JSON.stringify([
    repository,
    issueNumber,
    eventAction,
    normalizedTimestamp(timestamp),
    triggerLabel.normalize("NFC"),
  ]);
  return createHash("sha256").update(identity).digest("hex").slice(0, 32);
}

export function createExecutionJobId(payload, triggerLabel = "") {
  const normalized = normalizeExecutionPayload(payload);
  const digest = eventDigest({
    repository: normalized.repository,
    issueNumber: normalized.issueNumber,
    eventAction: normalized.eventAction,
    timestamp: normalized.timestamp,
    triggerLabel,
  });
  return `sf-issue-${digest}`;
}

export function createExecutionArtifactName(jobId) {
  invariant(
    typeof jobId === "string" && /^sf-issue-[a-f0-9]{32}$/.test(jobId),
    "jobId is invalid.",
  );
  return `studyforge-issue-job-${jobId}`;
}

export function createExecutionEventMarker(event) {
  const digest = eventDigest(event);
  return `<!-- studyforge-execution-boundary:${digest} -->`;
}

export function createExecutionManifest(payload, triggerLabel = "") {
  const normalized = normalizeExecutionPayload(payload);
  return {
    schemaVersion: 1,
    jobId: createExecutionJobId(normalized, triggerLabel),
    status: "ready_for_agent_execution",
    payload: normalized,
  };
}

export function prepareExecutionBoundary({
  repository,
  issue,
  eventAction,
  timestamp,
  triggerLabel = "",
}) {
  const event = {
    repository,
    issueNumber: issue?.number,
    eventAction,
    timestamp,
    triggerLabel,
  };
  const eventMarker = createExecutionEventMarker(event);
  const assignment = classifyExecutionLabels(issue?.labels);
  if (assignment.status !== "routed") {
    return {
      assignment,
      eventMarker,
      jobId: null,
      manifest: null,
      status: `not_created_${assignment.status}_agent_label`,
    };
  }

  try {
    const payload = normalizeExecutionPayload({
      repository,
      issueNumber: issue.number,
      issueTitle: issue.title,
      issueBody: issue.body ?? "",
      responsibleAgentLabel: assignment.label,
      mappedAgentRole: assignment.role,
      issueUrl: issue.html_url,
      eventAction,
      timestamp,
    });
    const manifest = createExecutionManifest(payload, triggerLabel);
    return {
      assignment,
      eventMarker,
      jobId: manifest.jobId,
      manifest,
      status: manifest.status,
    };
  } catch {
    return {
      assignment,
      eventMarker,
      jobId: null,
      manifest: null,
      status: "not_created_invalid_payload",
    };
  }
}

export function formatExecutionBoundaryComment(boundary) {
  const assignment = boundary.assignment;
  const responsibleAgent =
    assignment.status === "routed"
      ? `**${assignment.role}** (\`${assignment.label}\`)`
      : assignment.status === "multiple"
        ? `ambiguous (${assignment.labels.length} recognized labels)`
        : assignment.status === "malformed"
          ? "malformed responsible-agent label"
          : "none";
  return [
    boundary.eventMarker,
    "### Issue execution boundary",
    `- Responsible agent: ${responsibleAgent}`,
    `- Job ID: \`${boundary.jobId || "not-created"}\``,
    `- Status: \`${boundary.status}\``,
    "- No external agent was invoked.",
    "- Repository modification is not enabled in this stage.",
  ].join("\n\n");
}

export function hasExecutionBoundaryComment(comments, marker) {
  return (
    Array.isArray(comments) &&
    comments.some(
      (comment) =>
        comment?.user?.type === "Bot" &&
        typeof comment.body === "string" &&
        comment.body.includes(marker),
    )
  );
}

export function hasExecutionArtifact(artifacts, expectedName) {
  invariant(Array.isArray(artifacts), "artifacts must be an array.");
  invariant(
    typeof expectedName === "string" && expectedName.length > 0,
    "artifact name is invalid.",
  );
  return artifacts.some(
    (artifact) => artifact?.name === expectedName && artifact?.expired !== true,
  );
}
