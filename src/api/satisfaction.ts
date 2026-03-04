/**
 * Zendesk Satisfaction Ratings API.
 * https://developer.zendesk.com/api-reference/ticketing/ticket-management/satisfaction_ratings/
 *
 * Built by Progressive Robot Ltd
 */

import type { ZendeskSatisfactionRating } from "../types.js";
import { buildBaseUrl, zdFetchRetry } from "./base.js";

type Creds = { subdomain: string; agentEmail: string; apiToken: string };
type Err = { ok: false; status: number; error: string };

export async function getSatisfactionRating(
  c: Creds,
  ratingId: string | number,
): Promise<{ ok: true; rating: ZendeskSatisfactionRating } | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/satisfaction_ratings/${ratingId}.json`;
  const r = await zdFetchRetry<{ satisfaction_rating: ZendeskSatisfactionRating }>(
    url,
    c.agentEmail,
    c.apiToken,
  );
  return r.ok ? { ok: true, rating: r.data.satisfaction_rating } : r;
}

export async function listSatisfactionRatings(
  c: Creds,
  opts: {
    score?: "offered" | "unoffered" | "good" | "bad" | "good_with_comment" | "bad_with_comment";
    startTime?: string;
    endTime?: string;
    page?: number;
    perPage?: number;
  } = {},
): Promise<{
  ok: true;
  ratings: ZendeskSatisfactionRating[];
  count: number;
  nextPage: string | null;
} | Err> {
  const p = new URLSearchParams();
  if (opts.score) p.set("score", opts.score);
  if (opts.startTime) p.set("start_time", opts.startTime);
  if (opts.endTime) p.set("end_time", opts.endTime);
  if (opts.page) p.set("page", String(opts.page));
  if (opts.perPage) p.set("per_page", String(Math.min(opts.perPage, 100)));
  const url = `${buildBaseUrl(c.subdomain)}/satisfaction_ratings.json?${p}`;
  const r = await zdFetchRetry<{
    satisfaction_ratings: ZendeskSatisfactionRating[];
    count: number;
    next_page: string | null;
  }>(url, c.agentEmail, c.apiToken);
  return r.ok
    ? {
        ok: true,
        ratings: r.data.satisfaction_ratings,
        count: r.data.count,
        nextPage: r.data.next_page,
      }
    : r;
}
