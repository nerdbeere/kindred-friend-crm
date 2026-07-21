import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KindredClient } from "../src/kindredClient.js";
import { KindredApiError } from "../src/errors.js";
import type { KindredConfig } from "../src/config.js";

const config: KindredConfig = {
  baseUrl: "https://kindred.example.com",
  token: "test-token",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("KindredClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends Authorization bearer header and JSON content-type", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    const client = new KindredClient(config);
    await client.listContacts();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://kindred.example.com/api/agent/contacts");
    expect(init.method).toBe("GET");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-token");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("passes q and within_days as query params", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    const client = new KindredClient(config);
    await client.listContacts({ q: "alice", withinDays: 30 });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(
      "https://kindred.example.com/api/agent/contacts?q=alice&within_days=30",
    );
  });

  it("omits empty q from query params", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    const client = new KindredClient(config);
    await client.listContacts({ q: "" });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("https://kindred.example.com/api/agent/contacts");
  });

  it("returns contact from getContact", async () => {
    const contact = {
      id: 7,
      first_name: "Ada",
      last_name: "Lovelace",
      birth_month: 12,
      birth_day: 10,
      birth_year: 1815,
      notes: "first programmer",
      days_until: 142,
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(contact));
    const client = new KindredClient(config);
    const result = await client.getContact(7);
    expect(result).toEqual(contact);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://kindred.example.com/api/agent/contacts/7");
    expect(init.method).toBe("GET");
  });

  it("returns null on 404 for getContact", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "Contact not found" }, 404),
    );
    const client = new KindredClient(config);
    const result = await client.getContact(999);
    expect(result).toBeNull();
  });

  it("propagates non-404 errors from getContact", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "Unauthorized" }, 401));
    const client = new KindredClient(config);
    await expect(client.getContact(1)).rejects.toMatchObject({
      name: "KindredApiError",
      status: 401,
    });
  });

  it("creates a contact then refetches with days_until", async () => {
    const stored = {
      id: 42,
      first_name: "Grace",
      last_name: "Hopper",
      birth_month: 12,
      birth_day: 9,
      birth_year: 1906,
      notes: "",
    };
    const withDays = { ...stored, days_until: 140 };
    fetchMock
      .mockResolvedValueOnce(jsonResponse(stored, 201))
      .mockResolvedValueOnce(jsonResponse(withDays, 200));
    const client = new KindredClient(config);
    const result = await client.createContact({
      first_name: "Grace",
      last_name: "Hopper",
      birth_month: 12,
      birth_day: 9,
      birth_year: 1906,
    });
    expect(result).toEqual(withDays);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [postUrl, postInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(postUrl).toBe("https://kindred.example.com/api/agent/contacts");
    expect(postInit.method).toBe("POST");
    expect(JSON.parse(postInit.body as string)).toMatchObject({
      first_name: "Grace",
      birth_month: 12,
      birth_day: 9,
    });
  });

  it("surfaces 400 validation error text", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { error: "Birth month must be an integer between 1 and 12" },
        400,
      ),
    );
    const client = new KindredClient(config);
    await expect(
      client.createContact({
        first_name: "X",
        birth_month: 13,
        birth_day: 1,
      }),
    ).rejects.toMatchObject({
      name: "KindredApiError",
      status: 400,
      message: "Birth month must be an integer between 1 and 12",
    });
  });

  it("PUT replaces contact and refetches with days_until", async () => {
    const stored = {
      id: 3,
      first_name: "Alan",
      last_name: "Turing",
      birth_month: 6,
      birth_day: 23,
      birth_year: 1912,
      notes: "updated",
    };
    const withDays = { ...stored, days_until: 200 };
    fetchMock
      .mockResolvedValueOnce(jsonResponse(stored, 200))
      .mockResolvedValueOnce(jsonResponse(withDays, 200));
    const client = new KindredClient(config);
    const result = await client.replaceContact(3, {
      first_name: "Alan",
      last_name: "Turing",
      birth_month: 6,
      birth_day: 23,
      birth_year: 1912,
      notes: "updated",
    });
    expect(result).toEqual(withDays);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://kindred.example.com/api/agent/contacts/3");
    expect(init.method).toBe("PUT");
  });

  it("returns null from replaceContact on 404", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "Contact not found" }, 404),
    );
    const client = new KindredClient(config);
    const result = await client.replaceContact(99, {
      first_name: "X",
      birth_month: 1,
      birth_day: 1,
    });
    expect(result).toBeNull();
  });

  it("returns true on successful delete (204)", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = new KindredClient(config);
    const result = await client.deleteContact(5);
    expect(result).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://kindred.example.com/api/agent/contacts/5");
    expect(init.method).toBe("DELETE");
  });

  it("returns false on delete of non-existent contact", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "Contact not found" }, 404),
    );
    const client = new KindredClient(config);
    expect(await client.deleteContact(99)).toBe(false);
  });

  it("rethrows non-404 errors from deleteContact", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "Unauthorized" }, 401),
    );
    const client = new KindredClient(config);
    await expect(client.deleteContact(1)).rejects.toBeInstanceOf(
      KindredApiError,
    );
  });

  it("bubbles network errors", async () => {
    fetchMock.mockRejectedValueOnce(new Error("getaddrinfo ENOTFOUND"));
    const client = new KindredClient(config);
    await expect(client.listContacts()).rejects.toThrow("ENOTFOUND");
  });
});
