import { ApiError } from "./contracts.mjs";

const dayMs = 86_400_000;
const weekMs = 7 * dayMs;
const studySessionGapMs = 60 * 60 * 1000;
const meaningfulStudyTypes = new Set(["quiz_attempt", "viva_attempt", "study_generation"]);
const maxRecentActivity = 20;
const maxSummaryLength = 200;

export const DEFAULT_PLAN = "Build a consistent 25-minute daily study habit.";

export const ACTIVITY_TYPES = Object.freeze([
  "quiz_attempt",
  "viva_attempt",
  "study_generation",
  "study_plan",
]);

// Server-owned point values. The client never supplies points; it supplies an activity type and an
// optional score, and the server derives cumulative progress from these bounded weights.
const activityPoints = Object.freeze({
  quiz_attempt: 4,
  viva_attempt: 4,
  study_generation: 2,
  study_plan: 3,
});

const activityHours = Object.freeze({
  quiz_attempt: 0.25,
  viva_attempt: 0.25,
  study_generation: 0.1,
  study_plan: 0.1,
});

const activityLabels = Object.freeze({
  quiz_attempt: "Completed an MCQ practice set",
  viva_attempt: "Completed a Viva practice set",
  study_generation: "Generated grounded study material",
  study_plan: "Saved a study plan",
});

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function cleanSummary(value) {
  if (typeof value !== "string") return "";
  return [...value]
    .map((character) => (character.charCodeAt(0) < 32 ? " " : character))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxSummaryLength);
}

function cleanScore(value) {
  return clamp(Math.round(finiteNumber(value, 0)), 0, 100);
}

export function dateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

export function weekStartKey(value = new Date()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

function inCurrentWeek(timestamp, start) {
  const instant = new Date(timestamp);
  const startAt = new Date(`${start}T00:00:00.000Z`);
  return (
    !Number.isNaN(instant.getTime()) && instant >= startAt && instant < startAt.getTime() + weekMs
  );
}

export function countStudySessions(activities = [], now = new Date()) {
  const start = weekStartKey(now);
  const nowAt = new Date(now).getTime();
  const timestamps = activities
    .filter((entry) => meaningfulStudyTypes.has(entry?.type) && inCurrentWeek(entry?.at, start))
    .map((entry) => new Date(entry.at).getTime())
    .filter((timestamp) => timestamp <= nowAt)
    .sort((left, right) => left - right);
  let sessions = 0;
  let previous = null;
  for (const timestamp of timestamps) {
    if (previous === null || timestamp - previous >= studySessionGapMs) sessions += 1;
    previous = timestamp;
  }
  return sessions;
}

function lastStudyActivityInWeek(activities, now, start) {
  const nowAt = new Date(now).getTime();
  const timestamps = activities
    .filter((entry) => meaningfulStudyTypes.has(entry?.type) && inCurrentWeek(entry?.at, start))
    .map((entry) => new Date(entry.at).getTime())
    .filter((timestamp) => Number.isFinite(timestamp) && timestamp <= nowAt);
  return timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null;
}

/**
 * A session groups meaningful learning events less than 60 minutes apart. Server timestamps are
 * grouped inside Monday-to-Monday UTC weeks; saving a plan itself is not a learning session.
 */
export function weeklyStudySummary(progress = {}, plans = [], now = new Date()) {
  const currentWeek = weekStartKey(now);
  const selectedPlanId = progress.currentPlanId || null;
  const currentPlan = Array.isArray(plans)
    ? plans.find((plan) => plan.id === selectedPlanId) || null
    : null;
  if (!currentPlan) {
    return {
      completed: 0,
      target: 0,
      percentage: 0,
      hasPlan: Array.isArray(plans) && plans.length > 0,
      usesPlanTarget: false,
      planTitle: null,
      planId: null,
      weekStart: currentWeek,
    };
  }
  const planWeek = progress.planWeeklyProgress?.[currentPlan.id];
  const completed =
    planWeek?.weekStart === currentWeek
      ? Math.max(0, Math.round(finiteNumber(planWeek.sessions)))
      : 0;
  const rawTarget = Number(currentPlan?.plan?.sessions);
  const hasPlan = Number.isSafeInteger(rawTarget) && rawTarget >= 1 && rawTarget <= 14;
  const target = hasPlan ? rawTarget : 0;
  return {
    completed,
    target,
    percentage: target ? Math.min(100, Math.round((completed / target) * 100)) : 0,
    hasPlan: Boolean(currentPlan),
    usesPlanTarget: hasPlan,
    planTitle: currentPlan?.title || null,
    planId: currentPlan.id,
    weekStart: currentWeek,
  };
}

export function defaultProgress(userId) {
  return {
    userId,
    completed: 0,
    hours: 0,
    plan: DEFAULT_PLAN,
    points: 0,
    activeDays: 0,
    lastActiveDate: null,
    lastActivityAt: null,
    quizAttempts: 0,
    quizScoreTotal: 0,
    averageQuizScore: 0,
    vivaAttempts: 0,
    vivaScoreTotal: 0,
    averageVivaScore: 0,
    studyPlans: 0,
    generations: 0,
    recentActivity: [],
    currentPlanId: null,
    planWeeklyProgress: {},
    weeklySessions: 0,
    weeklySessionWeekStart: null,
    lastStudyActivityAt: null,
  };
}

export function normalizeProgress(userId, source = {}) {
  const merged = { ...defaultProgress(userId), ...(source || {}), userId };
  delete merged.streak;
  const points = Math.max(0, Math.round(finiteNumber(merged.points)));
  const completedStored = clamp(Math.round(finiteNumber(merged.completed)), 0, 100);
  const quizAttempts = Math.max(0, Math.round(finiteNumber(merged.quizAttempts)));
  const quizScoreTotal = Math.max(0, finiteNumber(merged.quizScoreTotal));
  const vivaAttempts = Math.max(0, Math.round(finiteNumber(merged.vivaAttempts)));
  const vivaScoreTotal = Math.max(0, finiteNumber(merged.vivaScoreTotal));
  return {
    ...merged,
    points,
    completed: completedStored,
    hours: Math.max(0, Number(finiteNumber(merged.hours).toFixed(2))),
    activeDays: Math.max(0, Math.round(finiteNumber(merged.activeDays))),
    quizAttempts,
    quizScoreTotal: Number(quizScoreTotal.toFixed(2)),
    averageQuizScore: quizAttempts ? Math.round(quizScoreTotal / quizAttempts) : 0,
    vivaAttempts,
    vivaScoreTotal: Number(vivaScoreTotal.toFixed(2)),
    averageVivaScore: vivaAttempts ? Math.round(vivaScoreTotal / vivaAttempts) : 0,
    studyPlans: Math.max(0, Math.round(finiteNumber(merged.studyPlans))),
    generations: Math.max(0, Math.round(finiteNumber(merged.generations))),
    weeklySessions: Math.max(0, Math.round(finiteNumber(merged.weeklySessions))),
    weeklySessionWeekStart: merged.weeklySessionWeekStart || null,
    lastStudyActivityAt: merged.lastStudyActivityAt || null,
    recentActivity: Array.isArray(merged.recentActivity)
      ? merged.recentActivity.slice(0, maxRecentActivity)
      : [],
    currentPlanId: typeof merged.currentPlanId === "string" ? merged.currentPlanId : null,
    planWeeklyProgress:
      merged.planWeeklyProgress &&
      typeof merged.planWeeklyProgress === "object" &&
      !Array.isArray(merged.planWeeklyProgress)
        ? merged.planWeeklyProgress
        : {},
  };
}

/**
 * Applies a single server-validated learning activity to a progress record.
 */
export function applyActivity(current, activity = {}, now = new Date()) {
  const type = activity.type;
  if (!ACTIVITY_TYPES.includes(type)) {
    throw new ApiError(
      422,
      "invalid_input",
      `activity.type must be one of: ${ACTIVITY_TYPES.join(", ")}.`,
    );
  }
  const state = normalizeProgress(current?.userId || activity.userId || "", current);
  const hasScore = type === "quiz_attempt" || type === "viva_attempt";
  const score = hasScore ? cleanScore(activity.score) : null;
  // Participation earns a floor so a completed attempt is never worth zero, while accuracy scales
  // the remaining share. This keeps progress cumulative instead of replacing the previous value.
  const weight = hasScore ? 0.25 + 0.75 * ((score ?? 0) / 100) : 1;
  const earnedPoints = activityPoints[type] * weight;

  const today = dateKey(now);
  let activeDays = state.activeDays;
  if (state.lastActiveDate !== today) activeDays = state.activeDays + 1;

  const points = state.points + earnedPoints;
  // Activity-driven completion is server-owned and cumulative: it never regresses below the value
  // already achieved by recorded activities.
  const earnedCompleted = clamp(Math.round(points), 0, 100);
  const entry = {
    type,
    summary: cleanSummary(activity.summary) || activityLabels[type],
    score,
    at: now.toISOString(),
    ...(typeof activity.planId === "string" ? { planId: activity.planId } : {}),
  };
  const patch = {
    points: Number(points.toFixed(2)),
    activeDays,
    lastActiveDate: today,
    lastActivityAt: now.toISOString(),
    hours: Number((state.hours + activityHours[type]).toFixed(2)),
    recentActivity: [entry, ...state.recentActivity].slice(0, maxRecentActivity),
  };
  if (meaningfulStudyTypes.has(type)) {
    const weekStart = weekStartKey(now);
    const storedWeekIsCurrent = state.weeklySessionWeekStart === weekStart;
    const inferredSessions = storedWeekIsCurrent
      ? state.weeklySessions
      : countStudySessions(state.recentActivity, now);
    const previousStudyAt = storedWeekIsCurrent
      ? state.lastStudyActivityAt
      : lastStudyActivityInWeek(state.recentActivity, now, weekStart);
    const previousStudyMs = previousStudyAt ? new Date(previousStudyAt).getTime() : Number.NaN;
    const startsSession =
      !Number.isFinite(previousStudyMs) || now.getTime() - previousStudyMs >= studySessionGapMs;
    patch.weeklySessions = inferredSessions + Number(startsSession);
    patch.weeklySessionWeekStart = weekStart;
    patch.lastStudyActivityAt = now.toISOString();
    if (typeof activity.planId === "string") {
      const previousPlanWeek = state.planWeeklyProgress[activity.planId];
      const currentPlanWeek =
        previousPlanWeek?.weekStart === weekStart
          ? previousPlanWeek
          : { weekStart, sessions: 0, lastStudyActivityAt: null };
      const previousPlanActivity = currentPlanWeek.lastStudyActivityAt
        ? new Date(currentPlanWeek.lastStudyActivityAt).getTime()
        : Number.NaN;
      const planStartsSession =
        !Number.isFinite(previousPlanActivity) ||
        now.getTime() - previousPlanActivity >= studySessionGapMs;
      patch.planWeeklyProgress = {
        ...state.planWeeklyProgress,
        [activity.planId]: {
          weekStart,
          sessions: currentPlanWeek.sessions + Number(planStartsSession),
          lastStudyActivityAt: now.toISOString(),
        },
      };
    }
  }
  if (type === "quiz_attempt") {
    patch.quizAttempts = state.quizAttempts + 1;
    patch.quizScoreTotal = Number((state.quizScoreTotal + (score ?? 0)).toFixed(2));
  }
  if (type === "viva_attempt") {
    patch.vivaAttempts = state.vivaAttempts + 1;
    patch.vivaScoreTotal = Number((state.vivaScoreTotal + (score ?? 0)).toFixed(2));
  }
  if (type === "study_generation") patch.generations = state.generations + 1;
  if (type === "study_plan") patch.studyPlans = state.studyPlans + 1;

  const progress = normalizeProgress(state.userId, {
    ...state,
    ...patch,
    completed: Math.max(state.completed, earnedCompleted),
  });
  // Persist the derived completion value as well, so a database that only has the base progress
  // columns still stores a meaningful cumulative percentage.
  return { patch: { ...patch, completed: progress.completed }, progress };
}
