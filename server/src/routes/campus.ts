/**
 * `campus` router — mounted at `/api/campus` by foundation with `requireAuth + requireOnboarded` (SPEC §5.9).
 * Every handler: `validate()` → (`requireCanPost()` on creates / edits) → service. The `event` adapter, the `event` +
 * `course` card resolvers, the reminder hook and the events rule pack register at import time (R4: registries only).
 */
import { Router } from 'express';
import { z } from 'zod';
import { LIMITS } from '@shared/core';
import type {
  CampusHub, Course, CourseJoinResponse, CreateCourseRequest, EventCard, EventDetail, EventFilter, RsvpState, UpdateEventRequest,
  UpsertEventRequest,
} from '@shared/campus';
import {
  COURSE_CODE_INPUT_MAX, COURSE_TITLE_MAX, EVENT_ADDRESS_MAX, EVENT_CATEGORIES, EVENT_FILTERS, EVENT_LOCATION_MAX, EVENT_MAX_CAPACITY,
} from '@shared/campus';
import { asyncHandler, noStore, pageQuery, typed, validate } from '../lib/http';
import { requireCanPost } from '../lib/rateLimit';
import { createCourse, joinCourse, leaveCourse, listMyCourses, loadCampusCourse, searchCourses, serializeCourse } from '../services/campus/courses';
import {
  cancelEvent, createEvent, listAttendees, listEvents, listUserEvents, loadVisibleEvent, serializeEventDetail, setRsvp, updateEvent,
} from '../services/campus/events';
import { getHub } from '../services/campus/hub';
import { registerCampus } from '../services/campus/registry';

registerCampus();

const router = Router();

const idParam = z.object({ id: z.string().min(1).max(64) });
const userIdParam = z.object({ userId: z.string().min(1).max(64) });

const eventBody = z.object({
  title: z.string().trim().min(3).max(LIMITS.eventTitle),
  description: z.string().max(LIMITS.eventDescription).optional(),
  category: z.enum(EVENT_CATEGORIES),
  startsAt: z.number().int().positive(),
  endsAt: z.number().int().positive(),
  locationName: z.string().trim().min(2).max(EVENT_LOCATION_MAX),
  address: z.string().trim().max(EVENT_ADDRESS_MAX).nullable().optional(),
  addressPrivate: z.boolean().optional(),
  coverUrl: z.string().min(1).max(512),
  freeFood: z.boolean(),
  capacity: z.number().int().min(1).max(EVENT_MAX_CAPACITY).nullable().optional(),
});

const eventsQuery = pageQuery.extend({
  filter: z.enum(EVENT_FILTERS as [EventFilter, ...EventFilter[]]).optional(),
  hostId: z.string().min(1).max(64).optional(),
});

const rsvpBody = z.object({ state: z.enum(['going', 'interested']).nullable() });
const attendeesQuery = pageQuery.extend({ state: z.enum(['going', 'interested']).default('going') });
const coursesQuery = pageQuery.extend({ q: z.string().max(80).default('') });
const courseBody = z.object({
  code: z.string().trim().min(2).max(COURSE_CODE_INPUT_MAX),
  title: z.string().trim().min(2).max(COURSE_TITLE_MAX),
});

/* ───────────────────────────── hub ───────────────────────────── */

router.get(
  '/hub',
  asyncHandler((req, res) => {
    noStore(res);
    const out: CampusHub = getHub(req.user!);
    res.json(out);
  }),
);

/* ───────────────────────────── events ───────────────────────────── */

router.get(
  '/events',
  validate({ query: eventsQuery }),
  asyncHandler((req, res) => {
    noStore(res);
    const { query } = typed<unknown, { cursor?: string; limit: number; filter?: EventFilter; hostId?: string }>(req);
    res.json(listEvents(req.user!, query));
  }),
);

router.post(
  '/events',
  validate({ body: eventBody }),
  requireCanPost(),
  asyncHandler((req, res) => {
    noStore(res);
    const { body } = typed<UpsertEventRequest>(req);
    const { event, moderation } = createEvent(req.user!, body);
    res.status(201).json({ ...event, moderation });
  }),
);

router.get(
  '/events/:id',
  validate({ params: idParam }),
  asyncHandler((req, res) => {
    noStore(res);
    const { params } = typed<unknown, unknown, { id: string }>(req);
    const out: EventDetail = serializeEventDetail(loadVisibleEvent(req.user!, params.id), req.user!);
    res.json(out);
  }),
);

router.patch(
  '/events/:id',
  validate({ params: idParam, body: eventBody.partial() }),
  requireCanPost(),
  asyncHandler((req, res) => {
    noStore(res);
    const { params, body } = typed<UpdateEventRequest, unknown, { id: string }>(req);
    const { event, moderation } = updateEvent(req.user!, params.id, body);
    res.json({ ...event, moderation });
  }),
);

router.post(
  '/events/:id/cancel',
  validate({ params: idParam }),
  asyncHandler((req, res) => {
    noStore(res);
    const { params } = typed<unknown, unknown, { id: string }>(req);
    const out: EventDetail = cancelEvent(req.user!, params.id);
    res.json(out);
  }),
);

router.put(
  '/events/:id/rsvp',
  validate({ params: idParam, body: rsvpBody }),
  asyncHandler((req, res) => {
    noStore(res);
    const { params, body } = typed<{ state: RsvpState | null }, unknown, { id: string }>(req);
    const out: EventCard = setRsvp(req.user!, params.id, body.state);
    res.json(out);
  }),
);

router.get(
  '/events/:id/attendees',
  validate({ params: idParam, query: attendeesQuery }),
  asyncHandler((req, res) => {
    noStore(res);
    const { params, query } = typed<unknown, { cursor?: string; limit: number; state: RsvpState }, { id: string }>(req);
    res.json(listAttendees(req.user!, params.id, query.state, query));
  }),
);

router.get(
  '/users/:userId/events',
  validate({ params: userIdParam, query: pageQuery }),
  asyncHandler((req, res) => {
    noStore(res);
    const { params, query } = typed<unknown, { cursor?: string; limit: number }, { userId: string }>(req);
    res.json(listUserEvents(req.user!, params.userId, query));
  }),
);

/* ───────────────────────────── courses ───────────────────────────── */

router.get(
  '/courses',
  validate({ query: coursesQuery }),
  asyncHandler((req, res) => {
    noStore(res);
    const { query } = typed<unknown, { cursor?: string; limit: number; q: string }>(req);
    res.json(searchCourses(req.user!, query.q, query));
  }),
);

router.get(
  '/courses/mine',
  asyncHandler((req, res) => {
    noStore(res);
    const items: Course[] = listMyCourses(req.user!);
    res.json({ items, nextCursor: null });
  }),
);

router.post(
  '/courses',
  validate({ body: courseBody }),
  requireCanPost(),
  asyncHandler((req, res) => {
    noStore(res);
    const { body } = typed<CreateCourseRequest>(req);
    const out: Course = createCourse(req.user!, body);
    res.status(201).json(out);
  }),
);

router.get(
  '/courses/:id',
  validate({ params: idParam }),
  asyncHandler((req, res) => {
    noStore(res);
    const { params } = typed<unknown, unknown, { id: string }>(req);
    const out: Course = serializeCourse(loadCampusCourse(req.user!, params.id), req.user!.id);
    res.json(out);
  }),
);

router.post(
  '/courses/:id/join',
  validate({ params: idParam }),
  asyncHandler((req, res) => {
    noStore(res);
    const { params } = typed<unknown, unknown, { id: string }>(req);
    const out: CourseJoinResponse = joinCourse(req.user!, params.id);
    res.json(out);
  }),
);

router.post(
  '/courses/:id/leave',
  validate({ params: idParam }),
  asyncHandler((req, res) => {
    const { params } = typed<unknown, unknown, { id: string }>(req);
    leaveCourse(req.user!, params.id);
    res.status(204).end();
  }),
);

export default router;
