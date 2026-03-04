/**
 * Zendesk Ticket Attachments API – upload files, get attachment metadata.
 * https://developer.zendesk.com/api-reference/ticketing/tickets/ticket_attachments/
 *
 * Built by Progressive Robot Ltd
 */

import type { ZendeskAttachment } from "../types.js";
import { buildBaseUrl, zdFetchRetry } from "./base.js";
import { buildAuthHeader } from "./base.js";

type Creds = { subdomain: string; agentEmail: string; apiToken: string };
type Err = { ok: false; status: number; error: string };

export interface UploadResult {
  token: string;
  attachment: ZendeskAttachment;
}

/**
 * Upload a file and return an upload token.
 * Pass the token in a comment's `uploads` array to attach the file.
 */
export async function uploadFile(
  c: Creds,
  fileData: Uint8Array | Buffer,
  fileName: string,
  mimeType = "application/octet-stream",
): Promise<{ ok: true; upload: UploadResult } | Err> {
  const p = new URLSearchParams({ filename: fileName });
  const url = `${buildBaseUrl(c.subdomain)}/uploads.json?${p}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": mimeType,
        Authorization: buildAuthHeader(c.agentEmail, c.apiToken),
      },
      body: fileData,
    });
  } catch (err) {
    return { ok: false, status: 0, error: String(err) };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { ok: false, status: res.status, error: body || `Upload failed: HTTP ${res.status}` };
  }

  const data = (await res.json()) as {
    upload: {
      token: string;
      attachment: {
        id: number;
        file_name: string;
        content_url: string;
        content_type: string;
        size: number;
        thumbnails?: Array<{ id: number; file_name: string; content_url: string }>;
      };
    };
  };

  return {
    ok: true,
    upload: {
      token: data.upload.token,
      attachment: {
        id: data.upload.attachment.id,
        file_name: data.upload.attachment.file_name,
        content_url: data.upload.attachment.content_url,
        content_type: data.upload.attachment.content_type,
        size: data.upload.attachment.size,
        thumbnails: data.upload.attachment.thumbnails,
      },
    },
  };
}

/** Delete an upload by token (before it is attached to a comment). */
export async function deleteUpload(c: Creds, token: string): Promise<{ ok: true } | Err> {
  const url = `${buildBaseUrl(c.subdomain)}/uploads/${token}.json`;
  const r = await zdFetchRetry<null>(url, c.agentEmail, c.apiToken, { method: "DELETE" });
  return r.ok ? { ok: true } : r;
}
