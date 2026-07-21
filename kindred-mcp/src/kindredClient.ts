import type { KindredConfig } from "./config.js";
import { KindredApiError } from "./errors.js";
import type {
  Contact,
  ContactInput,
  ContactStored,
  KindredErrorBody,
} from "./types.js";

export interface ListContactsOptions {
  q?: string;
  withinDays?: number;
}

/**
 * Thin typed wrapper around the Kindred agent HTTP API. Always goes over
 * HTTP (never touches the SQLite file directly) so validation in the app's
 * lib/contacts.ts is respected and there's no WAL lock contention with the
 * running Next.js process.
 */
export class KindredClient {
  constructor(private readonly config: KindredConfig) {}

  private url(path: string): string {
    return `${this.config.baseUrl}${path}`;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T | null> {
    let res: Response;
    try {
      res = await fetch(this.url(path), {
        method,
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      // Network-level failure (DNS, refused, TLS, etc).
      throw err instanceof Error ? err : new Error(String(err));
    }

    if (res.status === 204) {
      return null;
    }

    let parsed: unknown;
    const text = await res.text();
    try {
      parsed = text.length > 0 ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }

    if (!res.ok) {
      const errBody =
        parsed && typeof parsed === "object" && "error" in parsed
          ? (parsed as KindredErrorBody).error
          : `HTTP ${res.status}`;
      throw new KindredApiError(errBody, res.status);
    }

    return parsed as T;
  }

  async listContacts(opts: ListContactsOptions = {}): Promise<Contact[]> {
    const params = new URLSearchParams();
    if (opts.q !== undefined && opts.q !== "") params.set("q", opts.q);
    if (opts.withinDays !== undefined) {
      params.set("within_days", String(opts.withinDays));
    }
    const qs = params.toString();
    const path = `/api/agent/contacts${qs ? `?${qs}` : ""}`;
    const result = await this.request<Contact[]>("GET", path);
    return result ?? [];
  }

  async getContact(id: number): Promise<Contact | null> {
    try {
      return await this.request<Contact>("GET", `/api/agent/contacts/${id}`);
    } catch (err) {
      if (err instanceof KindredApiError && err.status === 404) return null;
      throw err;
    }
  }

  async createContact(input: ContactInput): Promise<Contact> {
    const created = await this.request<ContactStored>(
      "POST",
      "/api/agent/contacts",
      input,
    );
    if (!created) {
      throw new KindredApiError("Empty response from create", null);
    }
    // POST responses don't include days_until; fetch the fresh record so the
    // MCP caller always sees a consistent shape (GET-style Contact).
    const fresh = await this.getContact(created.id);
    return fresh ?? { ...created, days_until: -1 };
  }

  async replaceContact(id: number, input: ContactInput): Promise<Contact | null> {
    const updated = await this.request<ContactStored>(
      "PUT",
      `/api/agent/contacts/${id}`,
      input,
    ).catch((err: unknown) => {
      if (err instanceof KindredApiError && err.status === 404) return null;
      throw err;
    });
    if (!updated) return null;
    const fresh = await this.getContact(id);
    return fresh ?? { ...updated, days_until: -1 };
  }

  /** Returns true if a row was deleted, false if it didn't exist. */
  async deleteContact(id: number): Promise<boolean> {
    try {
      await this.request<null>("DELETE", `/api/agent/contacts/${id}`);
      return true;
    } catch (err) {
      if (err instanceof KindredApiError && err.status === 404) return false;
      throw err;
    }
  }
}
