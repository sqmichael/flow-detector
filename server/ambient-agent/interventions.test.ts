import { sendPushNotification } from "./interventions";

type FetchCall = {
  url: string | URL;
  init?: RequestInit;
};

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`  ✓ ${name}`);
      passed++;
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`  ✗ ${name}: ${message}`);
      failed++;
    });
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function asHeaders(init?: RequestInit): Record<string, string> {
  return (init?.headers ?? {}) as Record<string, string>;
}

async function run(): Promise<void> {
  console.log("\ninterventions tests");

  const originalFetch = globalThis.fetch;
  try {
    await test("adds ntfy sequence id and rating actions when intervention id is provided", async () => {
      const calls: FetchCall[] = [];
      globalThis.fetch = (async (url: string | URL, init?: RequestInit): Promise<Response> => {
        calls.push({ url, init });
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => "",
        } as Response;
      }) as typeof fetch;

      const sent = await sendPushNotification("Check-in", "Hello", "default", "int_123");
      assert(sent, "expected push send to succeed");
      assert(calls.length === 1, "expected one publish attempt");

      const headers = asHeaders(calls[0].init);
      assert(headers["X-Sequence-ID"] === "fb-int_123", "expected ntfy feedback sequence id");
      const actions = headers["Actions"] || "";
      assert(actions.includes("/rate/int_123/good"), "missing Helpful action");
      assert(actions.includes("/rate/int_123/ok"), "missing Okay action");
      assert(actions.includes("/rate/int_123/bad"), "missing Intrusive action");
    });

    await test("sanitizes ntfy feedback sequence id to ntfy-safe format and length", async () => {
      const calls: FetchCall[] = [];
      globalThis.fetch = (async (url: string | URL, init?: RequestInit): Promise<Response> => {
        calls.push({ url, init });
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => "",
        } as Response;
      }) as typeof fetch;

      const rawInterventionId = "INT:Needs Feedback!!_" + "A".repeat(120);
      const sent = await sendPushNotification("Check-in", "Hello", "default", rawInterventionId);
      assert(sent, "expected push send to succeed");
      assert(calls.length === 1, "expected one publish attempt");

      const headers = asHeaders(calls[0].init);
      const feedbackId = headers["X-Sequence-ID"];
      assert(typeof feedbackId === "string", "expected feedback sequence id header");
      assert(feedbackId.startsWith("fb-"), "expected fb- prefix");
      assert(feedbackId.length <= 64, "feedback sequence id exceeds ntfy-safe length");
      assert(/^[a-z0-9_-]+$/.test(feedbackId), "feedback sequence id contains invalid characters");
    });

    await test("omits ntfy feedback sequence id when intervention id is missing", async () => {
      const calls: FetchCall[] = [];
      globalThis.fetch = (async (url: string | URL, init?: RequestInit): Promise<Response> => {
        calls.push({ url, init });
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => "",
        } as Response;
      }) as typeof fetch;

      const sent = await sendPushNotification("Check-in", "Hello");
      assert(sent, "expected push send to succeed");
      assert(calls.length === 1, "expected one publish attempt");

      const headers = asHeaders(calls[0].init);
      assert(headers["X-Sequence-ID"] === undefined, "did not expect feedback sequence id header");
      assert(headers["Actions"] === undefined, "did not expect actions header");
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

run();
