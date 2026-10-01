/**
 * Course chats (SPEC §5.9): the directory over the campus' `courses` rows, joined with the core `conversations` /
 * `conversation_members` tables (SELECT only — every write goes through lib/conversations.ts). Codes are normalised
 * with foundation `normalizeCourseCode` so Market's "Textbooks for {code}" deep links match. No import-time DB (R4).
 */
import type { EpochMs, Id, Paginated } from '@shared/core';
import type { Course, CourseConflictDetails, CreateCourseRequest } from '@shared/campus';
import { COURSE_CHAT_WELCOME } from '@shared/campus';
import { db, inClause, newId, prep, tx } from '../../db/index';
import { trackEvent } from '../../lib/analytics';
import { now } from '../../lib/clock';
import { addMember, createCourseConversation, getMembership, removeMember, sendSystemMessage } from '../../lib/conversations';
import { normalizeCourseCode } from '../../lib/courseCode';
import { ApiError, decodeCursor, encodeCursor } from '../../lib/http';
import { blockedTarget, commitModeration, modCtx, moderateWrite } from '../../lib/moderation/index';
import { enforceRateLimit } from '../../lib/rateLimit';
import type { AuthedUser } from '../../lib/users';

/* ───────────────────────────── rows ───────────────────────────── */

export interface CourseRow {
  id: Id;
  university_id: Id;
  code: string;
  title: string;
  term: string;
  conversation_id: Id;
  created_by: Id | null;
  created_at: EpochMs;
}

export const COURSE_NOT_FOUND = "That course chat isn't available";

export function getCourseRow(id: Id): CourseRow | null {
  return (prep('SELECT * FROM courses WHERE id = ?').get(id) as CourseRow | undefined) ?? null;
}

/** "Fall 2026" (Aug–Dec) · "Spring 2027" (Jan–May) · "Summer 2026" (Jun–Jul). Server clock. */
export function currentTerm(at: EpochMs = now()): string {
  const d = new Date(at);
  const m = d.getMonth();
  const y = d.getFullYear();
  if (m <= 4) return `Spring ${y}`;
  if (m <= 6) return `Summer ${y}`;
  return `Fall ${y}`;
}

function firstNameOf(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] || displayName;
}

/* ───────────────────────────── serializers ───────────────────────────── */

export function serializeCourses(rows: CourseRow[], viewerId: Id): Course[] {
  if (rows.length === 0) return [];
  const convIds = rows.map((r) => r.conversation_id);
  const counts = new Map<Id, number>();
  const lastActive = new Map<Id, EpochMs | null>();
  const mine = new Map<Id, { state: string; unread: number }>();
  for (let i = 0; i < convIds.length; i += 400) {
    const inc = inClause(convIds.slice(i, i + 400));
    for (const r of db.prepare(`SELECT conversation_id, COUNT(*) AS n FROM conversation_members WHERE state = 'active' AND conversation_id IN ${inc.sql} GROUP BY conversation_id`).all(...inc.params) as { conversation_id: Id; n: number }[]) {
      counts.set(r.conversation_id, r.n);
    }
    for (const r of db.prepare(`SELECT id, last_message_at FROM conversations WHERE id IN ${inc.sql}`).all(...inc.params) as { id: Id; last_message_at: EpochMs | null }[]) {
      lastActive.set(r.id, r.last_message_at);
    }
    for (const r of db.prepare(`SELECT conversation_id, state, unread_count FROM conversation_members WHERE user_id = ? AND conversation_id IN ${inc.sql}`).all(viewerId, ...inc.params) as { conversation_id: Id; state: string; unread_count: number }[]) {
      mine.set(r.conversation_id, { state: r.state, unread: r.unread_count });
    }
  }
  return rows.map((row) => {
    const m = mine.get(row.conversation_id);
    const joined = m?.state === 'active';
    return {
      id: row.id,
      code: row.code,
      title: row.title,
      term: row.term,
      memberCount: counts.get(row.conversation_id) ?? 0,
      lastActiveAt: lastActive.get(row.conversation_id) ?? null,
      joined,
      conversationId: joined ? row.conversation_id : null,
      unread: joined ? (m?.unread ?? 0) : 0,
    };
  });
}

export function serializeCourse(row: CourseRow, viewerId: Id): Course {
  return serializeCourses([row], viewerId)[0]!;
}

/* ───────────────────────────── reads ───────────────────────────── */

/** Campus-only. `q` matches a normalised code prefix ("cs3" → "CS 3…") or a title substring. Offset cursor. */
export function searchCourses(viewer: AuthedUser, q: string, page: { cursor?: string; limit: number }): Paginated<Course> {
  const cur = decodeCursor(page.cursor);
  const offset = cur && typeof cur.k === 'number' && cur.k >= 0 ? Math.floor(cur.k) : 0;
  const trimmed = q.trim();
  const params: (string | number)[] = [viewer.universityId];
  let where = 'university_id = ?';
  if (trimmed) {
    // `%`, `_` and the escape char itself are literal in every branch (`?q=%` must not list the whole campus).
    const esc = (s: string): string => s.replace(/[%_\\]/g, (c) => `\\${c}`);
    const upper = esc(trimmed.toUpperCase().replace(/\s+/g, ' '));
    const collapsed = upper.replace(/\s+/g, '');
    const like = `%${esc(trimmed)}%`;
    where += " AND (UPPER(code) LIKE ? ESCAPE '\\' OR REPLACE(code, ' ', '') LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' COLLATE NOCASE)";
    params.push(`${upper}%`, `${collapsed}%`, like);
  }
  params.push(page.limit + 1, offset);
  const rows = db.prepare(`SELECT * FROM courses WHERE ${where} ORDER BY code ASC, created_at DESC LIMIT ? OFFSET ?`).all(...params) as CourseRow[];
  return {
    items: serializeCourses(rows.slice(0, page.limit), viewer.id),
    nextCursor: rows.length > page.limit ? encodeCursor({ k: offset + page.limit, id: 'offset' }) : null,
  };
}

/** Every course chat the viewer is an active member of, most recently active first. Never paged. */
export function listMyCourses(viewer: AuthedUser): Course[] {
  const rows = db
    .prepare(
      `SELECT c.* FROM courses c
         JOIN conversation_members m ON m.conversation_id = c.conversation_id AND m.user_id = ? AND m.state = 'active'
         JOIN conversations v ON v.id = c.conversation_id
        WHERE c.university_id = ?
        ORDER BY COALESCE(v.last_message_at, c.created_at) DESC, c.code ASC`,
    )
    .all(viewer.id, viewer.universityId) as CourseRow[];
  return serializeCourses(rows, viewer.id);
}

/** 404 for another campus' course (the link reveals only code + campus; joining needs that campus' email). */
export function loadCampusCourse(viewer: AuthedUser, id: Id): CourseRow {
  const row = getCourseRow(id);
  if (!row || row.university_id !== viewer.universityId) throw ApiError.notFound(COURSE_NOT_FOUND);
  return row;
}

export function findCourse(universityId: Id, code: string, term: string): CourseRow | null {
  return (prep('SELECT * FROM courses WHERE university_id = ? AND code = ? AND term = ?').get(universityId, code, term) as CourseRow | undefined) ?? null;
}

/* ───────────────────────────── writes ───────────────────────────── */

export function createCourse(user: AuthedUser, body: CreateCourseRequest): Course {
  const code = normalizeCourseCode(body.code);
  if (!code) throw new ApiError(400, 'validation_failed', "That doesn't look like a course code. Try something like CS 314.");
  const title = body.title.trim();
  const term = currentTerm();
  const existing = findCourse(user.universityId, code, term);
  if (existing) {
    const details: CourseConflictDetails = { course: serializeCourse(existing, user.id) };
    throw new ApiError(409, 'conflict', `${code} already has a chat with ${details.course.memberCount} classmates. Join it instead?`, details);
  }
  enforceRateLimit(user, 'course_create');
  const mod = moderateWrite([{ text: title, field: 'name' }], modCtx(user, 'group_name'), blockedTarget(user, 'conversation'));
  const at = now();
  const id = newId();
  const conversationId = tx(() => {
    const convId = createCourseConversation({ universityId: user.universityId, courseId: id, code, title, term, createdBy: user.id });
    prep('INSERT INTO courses (id, university_id, code, title, term, conversation_id, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)').run(
      id, user.universityId, code, title, term, convId, user.id, at,
    );
    // Self-join: no `addedBy` → never a `message.group_added` notification.
    addMember(convId, user.id, { role: 'owner' });
    sendSystemMessage(convId, COURSE_CHAT_WELCOME);
    commitModeration(mod, { ...blockedTarget(user, 'conversation'), entityId: convId });
    return convId;
  });
  trackEvent('course_create', { userId: user.id, universityId: user.universityId }, { code });
  return serializeCourse({ id, university_id: user.universityId, code, title, term, conversation_id: conversationId, created_by: user.id, created_at: at }, user.id);
}

/** Idempotent: an active member simply gets the conversation id back; nobody is notified on a self-join. */
export function joinCourse(user: AuthedUser, id: Id): { conversationId: Id } {
  const row = loadCampusCourse(user, id);
  const membership = getMembership(row.conversation_id, user.id);
  if (membership?.state === 'active') return { conversationId: row.conversation_id };
  addMember(row.conversation_id, user.id, {});
  sendSystemMessage(row.conversation_id, `${firstNameOf(user.displayName)} joined`);
  trackEvent('course_join', { userId: user.id, universityId: user.universityId }, { code: row.code });
  return { conversationId: row.conversation_id };
}

export function leaveCourse(user: AuthedUser, id: Id): void {
  const row = loadCampusCourse(user, id);
  removeMember(row.conversation_id, user.id);
}
