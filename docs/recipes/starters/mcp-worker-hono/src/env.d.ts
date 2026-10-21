// Minimal Workers types used by the tests and src (no @cloudflare/workers-types needed).
declare global {
  interface ExecutionContext {
    waitUntil(promise: Promise<unknown>): void;
    passThroughOnException(): void;
    props: any;
  }
}
export {};
