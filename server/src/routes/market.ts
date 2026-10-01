/**
 * `market` slice router — mounted at `/api/market` by foundation with `requireAuth + requireOnboarded` (SPEC §5.8).
 * Campus-only. Registers the `market_listing` adapter, `listing` card resolver and lifecycle hook at import time (R4).
 */
import { Router } from 'express';
import { z } from 'zod';
import type { MarketSummary } from '@shared/core';
import { LIMITS } from '@shared/core';
import type { ListingFilters, MarkSoldRequest, MyListingsState, OfferRequest, UpsertListingRequest } from '@shared/market';
import { LISTING_CATEGORY_IDS, LISTING_CONDITIONS, LISTING_TYPES } from '@shared/market';
import { authed } from '../middleware/auth';
import { asyncHandler, noStore, pageQuery, typed, validate } from '../lib/http';
import { requireCanPost } from '../lib/rateLimit';
import {
  createListing, deleteListing, getVisibleListing, listListings, listMine, listSaved, makeOffer, markClosed, marketSummary, recordView,
  relist, saveListing, toListing, unsaveListing, updateListing,
} from '../services/market/listings';
import { registerMarketRegistries } from '../services/market/registry';

registerMarketRegistries();

const router = Router();

/* ───────────────────────────── schemas ───────────────────────────── */

const mediaImage = z.object({
  url: z.string().min(1).max(512),
  width: z.number().int().nonnegative().nullable().optional().default(null),
  height: z.number().int().nonnegative().nullable().optional().default(null),
  alt: z.string().max(200).optional(),
});

const listingType = z.enum(LISTING_TYPES);
const listingCategory = z.enum(LISTING_CATEGORY_IDS as unknown as [string, ...string[]]);
const listingCondition = z.enum(LISTING_CONDITIONS);

const upsertBody = z.object({
  type: listingType,
  category: listingCategory,
  title: z.string().trim().min(1, 'Give it a title.').max(LIMITS.listingTitle),
  description: z.string().max(LIMITS.listingDescription).optional(),
  price: z.number().int().min(0).max(1_000_000).nullable().optional(),
  tradeFor: z.string().max(LIMITS.listingTradeFor).nullable().optional(),
  condition: listingCondition.nullable().optional(),
  courseCode: z.string().max(20).nullable().optional(),
  meetupSpot: z.string().max(80).nullable().optional(),
  locationText: z.string().max(120).nullable().optional(),
  occurredOn: z.string().max(10).nullable().optional(),
  photos: z.array(mediaImage).max(LIMITS.listingPhotos).default([]),
});

const patchBody = upsertBody.partial();

const idParams = z.object({ id: z.string().min(1).max(64) });

const filtersQuery = pageQuery.extend({
  q: z.string().max(80).optional(),
  category: listingCategory.optional(),
  type: listingType.optional(),
  min: z.coerce.number().int().min(0).optional(),
  max: z.coerce.number().int().min(0).optional(),
  condition: listingCondition.optional(),
  within: z.enum(['24h', '7d', '30d']).optional(),
  course: z.string().max(20).optional(),
  sort: z.enum(['newest', 'price_asc', 'price_desc']).optional(),
});

const mineQuery = pageQuery.extend({ state: z.enum(['active', 'closed']).default('active') });

const soldBody = z.object({ state: z.enum(['sold', 'returned']) });
const offerBody = z.object({ amount: z.number().int().positive().max(1_000_000) });

type PageQ = { cursor?: string; limit: number };

/* ───────────────────────────── browse / summary ───────────────────────────── */

router.get(
  '/listings',
  validate({ query: filtersQuery }),
  asyncHandler((req, res) => {
    noStore(res);
    const { query } = typed<unknown, ListingFilters & PageQ>(req);
    const { cursor, limit, ...filters } = query;
    res.json(listListings(authed(req), filters, { cursor, limit }));
  }),
);

router.get(
  '/summary',
  asyncHandler((req, res) => {
    noStore(res);
    const out: MarketSummary = marketSummary(authed(req));
    res.json(out);
  }),
);

router.get(
  '/saved',
  validate({ query: pageQuery }),
  asyncHandler((req, res) => {
    noStore(res);
    const { query } = typed<unknown, PageQ>(req);
    res.json(listSaved(authed(req), query));
  }),
);

router.get(
  '/mine',
  validate({ query: mineQuery }),
  asyncHandler((req, res) => {
    noStore(res);
    const { query } = typed<unknown, PageQ & { state: MyListingsState }>(req);
    res.json(listMine(authed(req), query.state, { cursor: query.cursor, limit: query.limit }));
  }),
);

/* ───────────────────────────── create / detail / edit / delete ───────────────────────────── */

router.post(
  '/listings',
  validate({ body: upsertBody }),
  requireCanPost(),
  asyncHandler((req, res) => {
    noStore(res);
    const { body } = typed<UpsertListingRequest>(req);
    res.status(201).json(createListing(authed(req), body));
  }),
);

router.get(
  '/listings/:id',
  validate({ params: idParams }),
  asyncHandler((req, res) => {
    noStore(res);
    const viewer = authed(req);
    const row = getVisibleListing(req.params.id, viewer);
    recordView(row, viewer);
    res.json(toListing(row, viewer));
  }),
);

router.patch(
  '/listings/:id',
  validate({ params: idParams, body: patchBody }),
  requireCanPost(),
  asyncHandler((req, res) => {
    noStore(res);
    const { body } = typed<Partial<UpsertListingRequest>>(req);
    res.json(updateListing(authed(req), req.params.id, body));
  }),
);

router.delete(
  '/listings/:id',
  validate({ params: idParams }),
  asyncHandler((req, res) => {
    noStore(res);
    deleteListing(authed(req), req.params.id);
    res.status(204).end();
  }),
);

/* ───────────────────────────── sold / relist ───────────────────────────── */

router.post(
  '/listings/:id/sold',
  validate({ params: idParams, body: soldBody }),
  asyncHandler((req, res) => {
    noStore(res);
    const { body } = typed<MarkSoldRequest>(req);
    res.json(markClosed(authed(req), req.params.id, body.state));
  }),
);

router.post(
  '/listings/:id/relist',
  validate({ params: idParams }),
  requireCanPost(),
  asyncHandler((req, res) => {
    noStore(res);
    res.json(relist(authed(req), req.params.id));
  }),
);

/* ───────────────────────────── save ───────────────────────────── */

router.put(
  '/listings/:id/save',
  validate({ params: idParams }),
  asyncHandler((req, res) => {
    noStore(res);
    res.json(saveListing(authed(req), req.params.id));
  }),
);

router.delete(
  '/listings/:id/save',
  validate({ params: idParams }),
  asyncHandler((req, res) => {
    noStore(res);
    res.json(unsaveListing(authed(req), req.params.id));
  }),
);

/* ───────────────────────────── offers ───────────────────────────── */

router.post(
  '/listings/:id/offers',
  validate({ params: idParams, body: offerBody }),
  asyncHandler((req, res) => {
    noStore(res);
    const { body } = typed<OfferRequest>(req);
    res.status(201).json(makeOffer(authed(req), req.params.id, body.amount));
  }),
);

export default router;
