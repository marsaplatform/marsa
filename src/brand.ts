/**
 * The project's display name lives here (and in package.json "name").
 * To rename the project, run `node scripts/rename.mjs "<New Name>"`.
 */
export const APP_NAME = "Marsa";
export const APP_TAGLINE = "Drop a static site, get a link. No account needed.";

/** The product name shown in the app's own pages, per language. */
export const PRODUCT_NAME = { en: "Marsa Spaces", ar: "مساحات مرسى" } as const;

/** The parent platform the app links back to (header/footer). */
export const PLATFORM_URL = "https://marsaplatform.com";

/** Released version (kept in step with package.json). */
export const APP_VERSION = "0.13.1";
