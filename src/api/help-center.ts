/**
 * Zendesk Help Center API – articles, sections, categories, translations.
 * https://developer.zendesk.com/api-reference/help_center/help_center_api/introduction/
 */

import type { ZendeskArticle, ZendeskSection, ZendeskCategory } from "../types.js";
import { buildHelpCenterUrl, zdFetchRetry, zdFetch, zdFetchCached, invalidateCacheFor } from "./base.js";

type Creds = { subdomain: string; agentEmail: string; apiToken: string };
type Err = { ok: false; status: number; error: string };

// ---------------------------------------------------------------------------
// Articles
// ---------------------------------------------------------------------------

export async function getArticle(
  c: Creds,
  articleId: string | number,
  locale = "en-us",
): Promise<{ ok: true; article: ZendeskArticle } | Err> {
  const url = `${buildHelpCenterUrl(c.subdomain, locale)}/articles/${articleId}.json`;
  const r = await zdFetchCached<{ article: ZendeskArticle }>(url, c.agentEmail, c.apiToken);
  return r.ok ? { ok: true, article: r.data.article } : r;
}

export async function listArticles(
  c: Creds,
  opts: { locale?: string; sectionId?: string | number; page?: number; perPage?: number } = {},
): Promise<{ ok: true; articles: ZendeskArticle[]; count: number; nextPage: string | null } | Err> {
  const locale = opts.locale ?? "en-us";
  const base = opts.sectionId
    ? `${buildHelpCenterUrl(c.subdomain, locale)}/sections/${opts.sectionId}/articles.json`
    : `${buildHelpCenterUrl(c.subdomain, locale)}/articles.json`;
  const p = new URLSearchParams();
  if (opts.page) p.set("page", String(opts.page));
  if (opts.perPage) p.set("per_page", String(Math.min(opts.perPage, 100)));
  const url = `${base}?${p}`;
  const r = await zdFetchCached<{ articles: ZendeskArticle[]; count: number; next_page: string | null }>(
    url,
    c.agentEmail,
    c.apiToken,
  );
  return r.ok
    ? { ok: true, articles: r.data.articles, count: r.data.count, nextPage: r.data.next_page }
    : r;
}

export async function searchArticles(
  c: Creds,
  query: string,
  opts: { locale?: string; page?: number; perPage?: number } = {},
): Promise<{ ok: true; articles: ZendeskArticle[]; count: number } | Err> {
  const p = new URLSearchParams({ query });
  if (opts.locale) p.set("locale", opts.locale);
  if (opts.page) p.set("page", String(opts.page));
  if (opts.perPage) p.set("per_page", String(Math.min(opts.perPage, 100)));
  const url = `https://${c.subdomain}.zendesk.com/api/v2/help_center/articles/search.json?${p}`;
  const r = await zdFetchCached<{ results: ZendeskArticle[]; count: number }>(
    url,
    c.agentEmail,
    c.apiToken,
  );
  return r.ok ? { ok: true, articles: r.data.results, count: r.data.count } : r;
}

export async function createArticle(
  c: Creds,
  sectionId: string | number,
  fields: { title: string; body: string; locale?: string; draft?: boolean; promoted?: boolean; label_names?: string[] },
): Promise<{ ok: true; article: ZendeskArticle } | Err> {
  const locale = fields.locale ?? "en-us";
  const url = `${buildHelpCenterUrl(c.subdomain, locale)}/sections/${sectionId}/articles.json`;
  const r = await zdFetchRetry<{ article: ZendeskArticle }>(url, c.agentEmail, c.apiToken, {
    method: "POST",
    body: JSON.stringify({ article: fields }),
  });
  return r.ok ? { ok: true, article: r.data.article } : r;
}

export async function updateArticle(
  c: Creds,
  articleId: string | number,
  updates: { title?: string; body?: string; draft?: boolean; promoted?: boolean; label_names?: string[] },
  locale = "en-us",
): Promise<{ ok: true; article: ZendeskArticle } | Err> {
  const url = `${buildHelpCenterUrl(c.subdomain, locale)}/articles/${articleId}.json`;
  const r = await zdFetchRetry<{ article: ZendeskArticle }>(url, c.agentEmail, c.apiToken, {
    method: "PUT",
    body: JSON.stringify({ article: updates }),
  });
  if (r.ok) invalidateCacheFor(`/articles/${articleId}`);
  return r.ok ? { ok: true, article: r.data.article } : r;
}

export async function deleteArticle(
  c: Creds,
  articleId: string | number,
  locale = "en-us",
): Promise<{ ok: true } | Err> {
  const url = `${buildHelpCenterUrl(c.subdomain, locale)}/articles/${articleId}.json`;
  const r = await zdFetch<null>(url, c.agentEmail, c.apiToken, { method: "DELETE" });
  return r.ok ? { ok: true } : r;
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

export async function listSections(
  c: Creds,
  opts: { categoryId?: string | number; locale?: string } = {},
): Promise<{ ok: true; sections: ZendeskSection[] } | Err> {
  const locale = opts.locale ?? "en-us";
  const base = opts.categoryId
    ? `${buildHelpCenterUrl(c.subdomain, locale)}/categories/${opts.categoryId}/sections.json`
    : `${buildHelpCenterUrl(c.subdomain, locale)}/sections.json`;
  const r = await zdFetchRetry<{ sections: ZendeskSection[] }>(base, c.agentEmail, c.apiToken);
  return r.ok ? { ok: true, sections: r.data.sections } : r;
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function listCategories(
  c: Creds,
  locale = "en-us",
): Promise<{ ok: true; categories: ZendeskCategory[] } | Err> {
  const url = `${buildHelpCenterUrl(c.subdomain, locale)}/categories.json`;
  const r = await zdFetchRetry<{ categories: ZendeskCategory[] }>(url, c.agentEmail, c.apiToken);
  return r.ok ? { ok: true, categories: r.data.categories } : r;
}
