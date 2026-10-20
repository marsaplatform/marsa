import { AsyncLocalStorage } from "node:async_hooks";

/** Who is signed in for the current request, so the shared page header can show the right link. */
export type NavAccount = "team" | "admin" | null;

const store = new AsyncLocalStorage<{ account: NavAccount }>();

export const withNavAccount = <T>(account: NavAccount, fn: () => T): T =>
  store.run({ account }, fn);

/** The signed-in account for this request, or null (signed out, or outside a request). */
export const currentNavAccount = (): NavAccount => store.getStore()?.account ?? null;
