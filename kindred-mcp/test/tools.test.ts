import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { KindredApiError } from "../src/errors.js";
import type { KindredClient } from "../src/kindredClient.js";
import type { KindredConfig } from "../src/config.js";
import type { Contact, ContactInput } from "../src/types.js";
import { registerListContacts } from "../src/tools/listContacts.js";
import { registerGetContact } from "../src/tools/getContact.js";
import { registerCreateContact } from "../src/tools/createContact.js";
import { registerUpdateContact } from "../src/tools/updateContact.js";
import { registerDeleteContact } from "../src/tools/deleteContact.js";

const config: KindredConfig = {
  baseUrl: "https://kindred.example.com",
  token: "test-token",
};

type ToolHandler = (
  args: Record<string, unknown>,
) => Promise<{ content?: Array<{ text?: string }>; isError?: boolean }>;

/** Capture registered tool handlers keyed by name. */
function makeFakeServer(): {
  server: McpServer;
  handlers: Map<string, ToolHandler>;
} {
  const handlers = new Map<string, ToolHandler>();
  const server = {
    registerTool: vi.fn(
      (name: string, _cfg: unknown, cb: ToolHandler) => {
        handlers.set(name, cb);
        return {} as never;
      },
    ),
  } as unknown as McpServer;
  return { server, handlers };
}

function makeFakeClient(
  overrides: Partial<KindredClient> = {},
): KindredClient {
  return {
    listContacts: vi.fn(async () => []),
    getContact: vi.fn(async () => null),
    createContact: vi.fn(async (input: ContactInput) => ({
      id: 1,
      first_name: input.first_name,
      last_name: input.last_name ?? "",
      birth_month: input.birth_month,
      birth_day: input.birth_day,
      birth_year: input.birth_year ?? null,
      notes: input.notes ?? "",
      days_until: 10,
    })),
    replaceContact: vi.fn(async () => null),
    deleteContact: vi.fn(async () => true),
    ...overrides,
  } as unknown as KindredClient;
}

const ada: Contact = {
  id: 7,
  first_name: "Ada",
  last_name: "Lovelace",
  birth_month: 12,
  birth_day: 10,
  birth_year: 1815,
  notes: "first programmer",
  days_until: 142,
};

describe("list_contacts tool", () => {
  let server: McpServer;
  let handlers: Map<string, ToolHandler>;

  beforeEach(() => {
    ({ server, handlers } = makeFakeServer());
  });

  it("returns contacts as JSON", async () => {
    const client = makeFakeClient({
      listContacts: vi.fn(async () => [ada]),
    });
    registerListContacts(server, client, config);
    const result = await handlers.get("list_contacts")!({});
    expect(result.isError).toBeUndefined();
    expect(result.content?.[0]?.text).toContain('"Ada"');
    expect(client.listContacts).toHaveBeenCalledWith({
      q: undefined,
      withinDays: undefined,
    });
  });

  it("passes q and within_days through", async () => {
    const client = makeFakeClient();
    registerListContacts(server, client, config);
    await handlers.get("list_contacts")!({ q: "ada", within_days: 30 });
    expect(client.listContacts).toHaveBeenCalledWith({
      q: "ada",
      withinDays: 30,
    });
  });

  it("returns isError with mapped message on network failure", async () => {
    const client = makeFakeClient({
      listContacts: vi.fn(async () => {
        throw new Error("connect ECONNREFUSED");
      }),
    });
    registerListContacts(server, client, config);
    const result = await handlers.get("list_contacts")!({});
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain(
      "Could not reach Kindred at https://kindred.example.com",
    );
  });

  it("returns 401 guidance on unauthorized", async () => {
    const client = makeFakeClient({
      listContacts: vi.fn(async () => {
        throw new KindredApiError("Unauthorized", 401);
      }),
    });
    registerListContacts(server, client, config);
    const result = await handlers.get("list_contacts")!({});
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toContain("Unauthorized");
    expect(result.content?.[0]?.text).toContain("KINDRED_TOKEN");
  });
});

describe("get_contact tool", () => {
  let server: McpServer;
  let handlers: Map<string, ToolHandler>;

  beforeEach(() => {
    ({ server, handlers } = makeFakeServer());
  });

  it("returns contact JSON when found", async () => {
    const client = makeFakeClient({
      getContact: vi.fn(async () => ada),
    });
    registerGetContact(server, client, config);
    const result = await handlers.get("get_contact")!({ id: 7 });
    expect(result.isError).toBeUndefined();
    expect(result.content?.[0]?.text).toContain('"Lovelace"');
  });

  it("returns 'not found' error when missing", async () => {
    const client = makeFakeClient({ getContact: vi.fn(async () => null) });
    registerGetContact(server, client, config);
    const result = await handlers.get("get_contact")!({ id: 99 });
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toBe("Contact 99 not found.");
  });
});

describe("create_contact tool", () => {
  let server: McpServer;
  let handlers: Map<string, ToolHandler>;

  beforeEach(() => {
    ({ server, handlers } = makeFakeServer());
  });

  it("calls createContact and returns new record", async () => {
    const createContact = vi.fn(async (input: ContactInput) => ({
      id: 42,
      first_name: input.first_name,
      last_name: input.last_name ?? "",
      birth_month: input.birth_month,
      birth_day: input.birth_day,
      birth_year: input.birth_year ?? null,
      notes: input.notes ?? "",
      days_until: 365,
    }));
    const client = makeFakeClient({ createContact });
    registerCreateContact(server, client, config);
    const result = await handlers.get("create_contact")!({
      first_name: "Grace",
      birth_month: 12,
      birth_day: 9,
    });
    expect(createContact).toHaveBeenCalledWith({
      first_name: "Grace",
      birth_month: 12,
      birth_day: 9,
    });
    expect(result.content?.[0]?.text).toContain('"Grace"');
  });

  it("propagates 400 validation text", async () => {
    const client = makeFakeClient({
      createContact: vi.fn(async () => {
        throw new KindredApiError("Birth month must be an integer between 1 and 12", 400);
      }),
    });
    registerCreateContact(server, client, config);
    const result = await handlers.get("create_contact")!({
      first_name: "X",
      birth_month: 13,
      birth_day: 1,
    });
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toBe(
      "Birth month must be an integer between 1 and 12",
    );
  });
});

describe("update_contact tool", () => {
  let server: McpServer;
  let handlers: Map<string, ToolHandler>;

  beforeEach(() => {
    ({ server, handlers } = makeFakeServer());
  });

  it("merges only the supplied fields and PUTs the full record", async () => {
    const replaceContact = vi.fn(async (_id: number, input: ContactInput) => ({
      id: 7,
      first_name: input.first_name,
      last_name: input.last_name ?? "",
      birth_month: input.birth_month,
      birth_day: input.birth_day,
      birth_year: input.birth_year ?? null,
      notes: input.notes ?? "",
      days_until: 100,
    }));
    const client = makeFakeClient({
      getContact: vi.fn(async () => ada),
      replaceContact,
    });
    registerUpdateContact(server, client, config);
    const result = await handlers.get("update_contact")!({
      id: 7,
      notes: "new notes",
    });
    expect(client.getContact).toHaveBeenCalledWith(7);
    expect(replaceContact).toHaveBeenCalledWith(7, {
      first_name: "Ada",
      last_name: "Lovelace",
      birth_month: 12,
      birth_day: 10,
      birth_year: 1815,
      notes: "new notes",
    });
    expect(result.content?.[0]?.text).toContain('"new notes"');
  });

  it("treats birth_year: null as explicit clear (not 'leave unchanged')", async () => {
    const replaceContact = vi.fn(async (_id: number, input: ContactInput) => ({
      id: 7,
      first_name: input.first_name,
      last_name: input.last_name ?? "",
      birth_month: input.birth_month,
      birth_day: input.birth_day,
      birth_year: input.birth_year ?? null,
      notes: input.notes ?? "",
      days_until: 100,
    }));
    const client = makeFakeClient({
      getContact: vi.fn(async () => ada),
      replaceContact,
    });
    registerUpdateContact(server, client, config);
    await handlers.get("update_contact")!({ id: 7, birth_year: null });
    expect(replaceContact).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ birth_year: null }),
    );
  });

  it("does not PUT when contact does not exist", async () => {
    const replaceContact = vi.fn();
    const client = makeFakeClient({
      getContact: vi.fn(async () => null),
      replaceContact,
    });
    registerUpdateContact(server, client, config);
    const result = await handlers.get("update_contact")!({
      id: 99,
      notes: "x",
    });
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toBe("Contact 99 not found.");
    expect(replaceContact).not.toHaveBeenCalled();
  });
});

describe("delete_contact tool", () => {
  let server: McpServer;
  let handlers: Map<string, ToolHandler>;

  beforeEach(() => {
    ({ server, handlers } = makeFakeServer());
  });

  it("returns confirmation preview without confirm and does NOT delete", async () => {
    const deleteContact = vi.fn();
    const client = makeFakeClient({
      getContact: vi.fn(async () => ada),
      deleteContact,
    });
    registerDeleteContact(server, client, config);
    const result = await handlers.get("delete_contact")!({ id: 7 });
    expect(result.isError).toBeUndefined();
    expect(result.content?.[0]?.text).toContain("Confirmation required");
    expect(result.content?.[0]?.text).toContain("Ada Lovelace");
    expect(result.content?.[0]?.text).toContain("confirm: true");
    expect(deleteContact).not.toHaveBeenCalled();
  });

  it("confirm: false behaves like no confirm", async () => {
    const deleteContact = vi.fn();
    const client = makeFakeClient({
      getContact: vi.fn(async () => ada),
      deleteContact,
    });
    registerDeleteContact(server, client, config);
    await handlers.get("delete_contact")!({ id: 7, confirm: false });
    expect(deleteContact).not.toHaveBeenCalled();
  });

  it("confirm: true actually deletes", async () => {
    const deleteContact = vi.fn(async () => true);
    const client = makeFakeClient({ deleteContact });
    registerDeleteContact(server, client, config);
    const result = await handlers.get("delete_contact")!({
      id: 7,
      confirm: true,
    });
    expect(deleteContact).toHaveBeenCalledWith(7);
    expect(result.content?.[0]?.text).toContain('"deleted"');
  });

  it("dry run on missing contact returns not-found error", async () => {
    const client = makeFakeClient({
      getContact: vi.fn(async () => null),
    });
    registerDeleteContact(server, client, config);
    const result = await handlers.get("delete_contact")!({ id: 99 });
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toBe("Contact 99 not found.");
  });

  it("confirm on missing contact returns not-found error", async () => {
    const client = makeFakeClient({
      deleteContact: vi.fn(async () => false),
    });
    registerDeleteContact(server, client, config);
    const result = await handlers.get("delete_contact")!({
      id: 99,
      confirm: true,
    });
    expect(result.isError).toBe(true);
    expect(result.content?.[0]?.text).toBe("Contact 99 not found.");
  });
});
