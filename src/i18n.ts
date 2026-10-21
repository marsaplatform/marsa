import { PRODUCT_NAME } from "./brand.js";

export type Lang = "en" | "ar";

export interface LimitValues {
  maxFileMb: number;
  maxSiteMb: number;
  maxFiles: number;
  defaultTtl: string;
  maxTtl: string;
  uploadsPerHour: number;
}

/** Wrap Latin/number runs in a bidi isolate so they read correctly inside Arabic text. */
const iso = (s: string | number) => `\u2066${s}\u2069`;

export function hoursLabel(lang: Lang, h: number): string {
  if (lang === "ar") {
    if (h === 1) return "ساعة واحدة";
    if (h === 2) return "ساعتان";
    if (h < 24) return h <= 10 ? `${h} ساعات` : `${h} ساعة`;
    const d = h / 24;
    if (d === 1) return "يوم واحد";
    if (d === 2) return "يومان";
    return Number.isInteger(d) && d <= 10 ? `${d} أيام` : `${h} ساعة`;
  }
  if (h < 24) return h === 1 ? "1 hour" : `${h} hours`;
  const d = h / 24;
  if (!Number.isInteger(d)) return `${h} hours`;
  return d === 1 ? "1 day" : `${d} days`;
}

export function bytesLabel(lang: Lang, n: number): string {
  const unit = lang === "ar" ? ["بايت", "ك.ب", "م.ب"] : ["B", "KB", "MB"];
  if (n < 1024) return `${n} ${unit[0]}`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} ${unit[1]}`;
  return `${(n / 1024 / 1024).toFixed(1)} ${unit[2]}`;
}

export interface Strings {
  dir: "ltr" | "rtl";
  product: string;
  switchLabel: string;
  skip: string;
  nav: {
    label: string;
    home: string;
    publish: string;
    docs: string;
    signIn: string;
    dashboard: string;
    adminConsole: string;
    platform: string;
  };
  hero: { eyebrow: string; title: string; sub: string; ctaTry: string; ctaTeam: string };
  strip: string[];
  landing: {
    statsLabel: string;
    statTeams: string;
    statPages: string;
    statTtl: string;
    howEyebrow: string;
    featured: string;
    open: string;
    by: string;
    preview: (title: string) => string;
    allPages: string;
  };
  why: { title: string; items: [string, string][] };
  how: { title: string; steps: [string, string][] };
  uses: { title: string; sub: string; items: [string, string][]; more: string };
  teamsBand: { title: string; sub: string; cta: string; docs: string };
  agents: { title: string; sub: string; llms: string; openapi: string; guide: string };
  try: {
    title: string;
    sub: string;
    drop: string;
    pickFiles: string;
    pickDir: string;
    expires: string;
    ready: string;
    copy: string;
    tokenNote: string;
    mine: string;
    none: string;
    teamHint: string;
  };
  limits: {
    title: string;
    sub: string;
    privacyTitle: string;
    privacy: string[];
    limitItems: (l: LimitValues) => string[];
  };
  selfhost: { title: string; sub: string; cta: string };
  directory: {
    title: string;
    sub: string;
    empty: string;
    expires: string;
    pages: (n: number) => string;
  };
  footer: { about: string; note: string; product: string; resources: string; platform: string };
  docs: { title: string; sub: string; englishOnly: string; back: string };
  notFound: string;
  notFoundSub: string;
  gone: string;
  goneSub: string;
  home: string;
  tooMany: string;
  badRequest: string;
  common: {
    copy: string;
    copied: string;
    del: string;
    save: string;
    cancel: string;
    signOut: string;
    on: string;
    off: string;
    guest: string;
    size: string;
    expires: string;
    created: string;
    actions: string;
    link: string;
    title: string;
    open: string;
    files: (n: number) => string;
    confirm: string;
  };
  login: {
    title: string;
    sub: string;
    keyLabel: string;
    keyHelp: string;
    submit: string;
    invalid: string;
    limited: string;
    csrf: string;
    noKey: string;
    adminLink: string;
    signedOut: string;
    expired: string;
  };
  members: {
    nav: string;
    title: string;
    sub: string;
    memberTitle: string;
    keyTitle: string;
    keySub: string;
    username: string;
    usernameHelp: string;
    displayName: string;
    password: string;
    passwordHelp: string;
    confirm: string;
    signInMember: string;
    invalidMember: string;
    signedInAs: (name: string, role: string) => string;
    viaKey: string;
    roles: Record<"owner" | "editor" | "viewer", string>;
    roleHelp: Record<"owner" | "editor" | "viewer", string>;
    listTitle: string;
    nameCol: string;
    none: string;
    joined: string;
    lastSeen: string;
    never: string;
    role: string;
    save: string;
    remove: string;
    confirmRemove: string;
    removed: string;
    roleSaved: string;
    notSelf: string;
    notAllowed: string;
    invitesTitle: string;
    invitesNone: string;
    inviteSub: string;
    invite: string;
    inviteExpiry: string;
    inviteCreated: string;
    inviteNote: string;
    inviteLink: string;
    inviteRevoked: string;
    tooManyInvites: string;
    tooManyMembers: string;
    expires: string;
    by: string;
    revoke: string;
    hours: (n: number) => string;
    accountTitle: string;
    current: string;
    newPassword: string;
    changePassword: string;
    passwordChanged: string;
    wrongPassword: string;
    signOutAll: string;
    signOutAllHelp: string;
    signedOutAll: string;
    keyAccount: string;
    joinTitle: (team: string) => string;
    joinSub: (role: string) => string;
    join: string;
    joined2: string;
    inviteInvalid: string;
    inviteInvalidSub: string;
    taken: string;
    badUsername: string;
    badName: string;
    short: string;
    long: string;
    same: string;
    mismatch: string;
    auditTitle: string;
    auditSiteTitle: string;
    auditNone: string;
    when: string;
    who: string;
    what: string;
    actions: Record<string, string>;
    actorKinds: Record<"member" | "key" | "admin" | "api" | "mcp", string>;
    /** Stored non-member actor labels ("team key", "edit token", "admin") in this language. */
    actorLabels: Record<string, string>;
    count: (n: number) => string;
  };
  visits: {
    title: string;
    column: string;
    views: string;
    visitors: string;
    today: string;
    last7: string;
    last30: string;
    short: (d7: string, d30: string) => string;
    chart: (total: string) => string;
    day: (day: string, views: string, visitors: string) => string;
    privacy: string;
    off: string;
    adminTotal: (n: string) => string;
  };
  team: {
    eyebrow: string;
    sites: string;
    backend: string;
    backendOn: string;
    backendOff: string;
    backendNotConfigured: string;
    directoryOn: string;
    directoryOff: string;
    sitesCount: (n: number) => string;
    empty: string;
    emptySub: string;
    publishTitle: string;
    publishSub: string;
    publish: string;
    listed: string;
    hidden: string;
    show: string;
    hide: string;
    replace: string;
    replaceHelp: string;
    extend: string;
    extendTo: string;
    manage: string;
    back: string;
    confirmDelete: string;
    published: string;
    replaced: string;
    extended: string;
    deleted: string;
    listingSaved: string;
    notYours: string;
    capped: string;
    madePermanent: string;
    permanentNotAllowed: string;
    permanent: string;
    permanentOption: string;
    makePermanent: string;
    permanentNote: string;
    permanentOn: string;
    quotaUse: (sites: string, bytes: string) => string;
    filesTitle: string;
    kvTitle: string;
    kvEmpty: string;
    backendFilesTitle: string;
    backendFilesEmpty: string;
    backendBrowserOff: string;
    key: string;
    value: string;
    moreKeys: (n: number) => string;
    keyDeleted: string;
    fileDeleted: string;
    agentsTitle: string;
    agentsSub: string;
    uploading: string;
    failed: string;
    openSite: string;
    settingsTitle: string;
    kvCount: (n: number) => string;
    backendFilesCount: (n: number) => string;
    valueTruncated: string;
    signedInAs: string;
    pickZip: string;
  };
  mcp: {
    title: string;
    sub: string;
    endpoint: string;
    tokens: string;
    none: string;
    name: string;
    namePlaceholder: string;
    scope: string;
    ro: string;
    rw: string;
    rwNote: string;
    create: string;
    created: string;
    createdNote: string;
    revoke: string;
    revoked: string;
    confirmRevoke: string;
    tooMany: string;
    snippets: string;
    snippetNote: string;
    tools: string;
  };
  admin: {
    eyebrow: string;
    title: string;
    sub: string;
    loginTitle: string;
    loginSub: string;
    tokenLabel: string;
    disabled: string;
    tabsLabel: string;
    teamsTab: string;
    sitesTab: string;
    teams: string;
    create: string;
    name: string;
    backend: string;
    directory: string;
    liveSites: string;
    key: string;
    rotate: string;
    none: string;
    newKey: string;
    newKeyNote: string;
    confirmRotate: string;
    confirmDelete: string;
    alsoDeleteSites: string;
    created: string;
    saved: string;
    rotated: string;
    deleted: string;
    siteDeleted: string;
    howTitle: string;
    how: string[];
    sitesTitle: string;
    sitesSub: string;
    filter: string;
    all: string;
    guests: string;
    apply: string;
    owner: string;
    noSites: string;
    total: (n: number, size: string) => string;
    teamsCount: (n: number) => string;
    liveTotal: (n: number) => string;
    guestsCount: (n: number) => string;
    serverBackendOn: string;
    serverBackendOff: string;
    turnOn: string;
    turnOff: string;
    createSub: string;
    keyHelp: string;
    docsLink: string;
    revoked: string;
    permanent: string;
    permanentFilter: string;
    revoke: string;
    makePermanent: string;
    quota: string;
    quotaSites: string;
    quotaMb: string;
    quotaHelp: string;
    permanentCount: (n: number) => string;
  };
}

const en: Strings = {
  dir: "ltr",
  product: PRODUCT_NAME.en,
  switchLabel: "عربي",
  skip: "Skip to content",
  nav: {
    label: "Main",
    home: "Home",
    publish: "Publish",
    docs: "Guide",
    signIn: "Team sign-in",
    dashboard: "Team dashboard",
    adminConsole: "Admin console",
    platform: "Marsa platform",
  },
  hero: {
    eyebrow: "Open source · Arabic first · Links that expire",
    title: "A link for work worth sharing.",
    sub: "Publish an HTML report, a static site or a prototype and get a public link in seconds. Built for civil-society, digital-rights and free-expression teams, and for the AI agents that work with them.",
    ctaTry: "Publish now",
    ctaTeam: "Team sign-in",
  },
  strip: ["No account for guests", "Teams with their own dashboard", "API and agents", "MIT"],
  landing: {
    statsLabel: "On this instance right now",
    statTeams: "teams publishing",
    statPages: "live pages",
    statTtl: "longest link life",
    howEyebrow: "Three steps",
    featured: "Featured",
    open: "Open the page",
    by: "By",
    preview: (title) => `Preview of ${title}`,
    allPages: "All team pages",
  },
  why: {
    title: "Small on purpose",
    items: [
      [
        "No account needed",
        "Anyone you share with opens the link in a browser. No sign-up, no app, no tracking.",
      ],
      [
        "Made for agents too",
        "One HTTP call turns a folder or ZIP into a link. Agents get JSON back, plus /llms.txt and an OpenAPI spec.",
      ],
      [
        "Nothing lingers",
        "Every link expires, from one hour to a week. When it ends the files are deleted from the server.",
      ],
    ],
  },
  how: {
    title: "How it works",
    steps: [
      ["Drop", "Drag in files, a folder or a .zip, or send them to the API."],
      ["Share", "You get a public link. Teams manage their sites from a dashboard."],
      [
        "It expires",
        "When the time is up the site is removed. Extend, update or delete it earlier.",
      ],
    ],
  },
  uses: {
    title: "What teams use it for",
    sub: "Anything that is static HTML, CSS, JavaScript and assets.",
    items: [
      [
        "A report for partners",
        "Share a research brief or monitoring report as a readable page instead of a heavy attachment.",
      ],
      [
        "A campaign or event page",
        "Agenda, map and contacts for a workshop or a campaign moment, gone the week after.",
      ],
      [
        "A prototype for review",
        "Send a clickable demo to colleagues without setting up hosting or accounts.",
      ],
      [
        "An agent shares its output",
        "Your AI agent builds a dashboard, zips it and posts back a link instead of a wall of text.",
      ],
    ],
    more: "See the examples",
  },
  teamsBand: {
    title: "Working as a team?",
    sub: "Your admin gives the team a key. Sign in with it to publish, update, extend and remove your sites, and, if enabled, to see the data and files your pages store.",
    cta: "Team sign-in",
    docs: "How teams work",
  },
  agents: {
    title: "For AI agents",
    sub: "Give your agent this snippet or point it at /llms.txt. It zips the output, posts it and returns the link.",
    llms: "llms.txt",
    openapi: "OpenAPI spec",
    guide: "Agent guide",
  },
  try: {
    title: "Publish a page",
    sub: "Everything you publish is public to anyone with the link. Don't upload secrets or personal data.",
    drop: "Drop files, a folder or a .zip here",
    pickFiles: "Choose files",
    pickDir: "Choose a folder",
    expires: "Expires after",
    ready: "Your link is ready",
    copy: "Copy link",
    tokenNote:
      "Edit token. It is saved in this browser; keep a copy if you want to manage the site from elsewhere.",
    mine: "Published from this browser",
    none: "Nothing yet.",
    teamHint: "Part of a team? Sign in to publish to your team's dashboard.",
  },
  limits: {
    title: "Limits and privacy",
    sub: "Kept small so it stays fast and hard to abuse.",
    privacyTitle: "Privacy",
    privacy: [
      "Anyone with the link can view the site.",
      "No tracking cookies and no third-party analytics. Page views are counted on this server as daily totals only. Teams get one sign-in cookie, nothing else.",
      "Your IP is used only in memory, for rate limits and an hourly visitor count. It is not stored.",
      "Published pages run in a browser sandbox and can't reach this app or your session.",
      "Expired and deleted sites are removed from the server.",
    ],
    limitItems: (l) => [
      `Up to ${l.maxFiles} files, ${l.maxFileMb} MB per file, ${l.maxSiteMb} MB per site`,
      `Links last ${l.defaultTtl} by default and at most ${l.maxTtl}`,
      `${l.uploadsPerHour} uploads per hour per IP`,
      "Static files only: server scripts and executables are rejected",
    ],
  },
  selfhost: {
    title: "Run your own",
    sub: "One container, one data folder, no database. MIT licensed.",
    cta: "Self-hosting guide",
  },
  directory: {
    title: "Published by teams",
    sub: "Live pages that teams on this instance chose to share. Each link expires on its own.",
    empty: "No team pages are live right now.",
    expires: "Expires",
    pages: (n) => (n === 1 ? "1 page" : `${n} pages`),
  },
  footer: {
    about:
      "Marsa Spaces is part of Marsa: open knowledge and tools for civil-society, digital-rights and free-expression teams.",
    note: "Open source (MIT). Published content is public to anyone with the link.",
    product: "Spaces",
    resources: "For developers",
    platform: "Marsa platform",
  },
  docs: {
    title: "Guide",
    sub: "Everything you need to use Marsa Spaces from a browser, a script, an AI agent or CI, and to host your own.",
    englishOnly: "",
    back: "All guides",
  },
  notFound: "This page doesn't exist.",
  notFoundSub: "The link may be mistyped, or the site was removed.",
  gone: "This link has expired.",
  goneSub: "Its files were deleted when its time ran out.",
  home: "Back to the home page",
  tooMany: "Too many attempts. Wait a few minutes and try again.",
  badRequest: "This form has expired. Reload the page and try again.",
  common: {
    copy: "Copy",
    copied: "Copied",
    del: "Delete",
    save: "Save",
    cancel: "Cancel",
    signOut: "Sign out",
    on: "On",
    off: "Off",
    guest: "Guest",
    size: "Size",
    expires: "Expires",
    created: "Created",
    actions: "Actions",
    link: "Link",
    title: "Title",
    open: "Open",
    files: (n) => (n === 1 ? "1 file" : `${n} files`),
    confirm: "Are you sure?",
  },
  login: {
    title: "Team sign-in",
    sub: "Sign in with your member account, or with the team key your admin gave you. You stay signed in on this browser for a week, or until you sign out.",
    keyLabel: "Team key",
    keyHelp: "Starts with marsa_team_. The key is never shown again after it is created.",
    submit: "Sign in",
    invalid: "That key doesn't match any team. Check it, or ask your admin for a new one.",
    limited: "Too many sign-in attempts from your network. Try again in a few minutes.",
    csrf: "This form has expired. Please try again.",
    noKey: "No key? Teams are created by the admin of this instance.",
    adminLink: "Admin sign-in",
    signedOut: "You are signed out.",
    expired: "Your session ended. Please sign in again.",
  },
  members: {
    nav: "Members",
    title: "Members",
    sub: "Invite people with a one-time link, give each a role and see who did what.",
    memberTitle: "Member sign-in",
    keyTitle: "Or use the team key",
    keySub: "The team key works as an owner. Agents and scripts keep using it for the API.",
    username: "Username",
    usernameHelp: "3–32 characters: a–z, 0–9, dot, dash or underscore. Used to sign in.",
    displayName: "Your name",
    password: "Password",
    passwordHelp: "At least 10 characters. Stored only as a scrypt hash.",
    confirm: "Repeat password",
    signInMember: "Sign in",
    invalidMember: "Wrong username or password.",
    signedInAs: (name, role) => `Signed in as ${name} · ${role}`,
    viaKey: "team key",
    roles: { owner: "Owner", editor: "Editor", viewer: "Viewer" },
    roleHelp: {
      owner: "Everything, including members and invites",
      editor: "Publish, replace, extend and delete sites",
      viewer: "Read-only",
    },
    listTitle: "People",
    nameCol: "Name",
    none: "No members yet. Invite someone below.",
    joined: "Joined",
    lastSeen: "Last sign-in",
    never: "never",
    role: "Role",
    save: "Save",
    remove: "Remove",
    confirmRemove: "Remove this member? They are signed out at once.",
    removed: "Member removed.",
    roleSaved: "Role saved.",
    notSelf: "You can't change or remove your own membership here.",
    notAllowed: "Your role doesn't allow that.",
    invitesTitle: "Pending invites",
    invitesNone: "No pending invites.",
    inviteSub: "An invite link works once and expires. Send it yourself (no email is sent).",
    invite: "Create invite link",
    inviteExpiry: "Expires after",
    inviteCreated: "Invite link created.",
    inviteNote: "Copy it now: it is shown only once. Whoever opens it first joins with this role.",
    inviteLink: "Invite link",
    inviteRevoked: "Invite revoked.",
    tooManyInvites: "Too many pending invites. Revoke some first.",
    tooManyMembers: "This team has reached its member limit.",
    expires: "Expires",
    by: "Created by",
    revoke: "Revoke",
    hours: (n) => (n % 24 === 0 ? `${n / 24} day${n === 24 ? "" : "s"}` : `${n} hours`),
    accountTitle: "Your account",
    current: "Current password",
    newPassword: "New password",
    changePassword: "Change password",
    passwordChanged: "Password changed. Your other sessions were signed out.",
    wrongPassword: "The current password is wrong.",
    signOutAll: "Sign out everywhere else",
    signOutAllHelp: "Ends every other session of your account.",
    signedOutAll: "Your other sessions were signed out.",
    keyAccount:
      "You signed in with the team key, which acts as an owner. Ask an owner for an invite (or invite yourself) to get a personal account.",
    joinTitle: (team) => `Join ${team}`,
    joinSub: (role) =>
      `You were invited as ${role}. Choose a username and password to create your account.`,
    join: "Create account and sign in",
    joined2: "Welcome! Your account is ready.",
    inviteInvalid: "This invite link doesn't work",
    inviteInvalidSub: "It was already used, revoked or has expired. Ask for a new one.",
    taken: "That username is taken. Choose another.",
    badUsername: "Use 3–32 characters: a–z, 0–9, dot, dash or underscore.",
    badName: "Enter your name (up to 80 characters).",
    short: "The password must be at least 10 characters.",
    long: "The password is too long.",
    same: "The password must not contain the username.",
    mismatch: "The passwords don't match.",
    auditTitle: "Activity",
    auditSiteTitle: "Activity on this site",
    auditNone: "Nothing recorded yet.",
    when: "When",
    who: "Who",
    what: "What",
    actions: {
      publish: "Published",
      replace: "Replaced the files",
      extend: "Changed the expiry",
      permanent: "Made permanent",
      delete: "Deleted",
      "listing-on": "Listed on the home page",
      "listing-off": "Hidden from the home page",
      "mcp-token": "Created an MCP token",
      "mcp-revoke": "Revoked an MCP token",
      "kv-delete": "Deleted a KV key",
      "file-delete": "Deleted an uploaded file",
      "sign-in": "Signed in",
      invite: "Created an invite",
      "invite-revoke": "Revoked an invite",
      "member-join": "Joined the team",
      "member-remove": "Removed a member",
      "member-role": "Changed a role",
      password: "Changed their password",
      "worker-deploy": "Deployed a Worker",
      "worker-redeploy": "Redeployed a Worker",
      "worker-delete": "Deleted a Worker",
      "worker-disable": "Disabled a Worker",
      "worker-enable": "Re-enabled a Worker",
      "workers-on": "Turned Workers on",
      "workers-off": "Turned Workers off",
      "cf-token-set": "Set the Cloudflare token",
      "cf-settings": "Changed the Cloudflare settings",
      "cf-token-clear": "Removed the Cloudflare token",
      "worker-rollback": "Rolled back a Worker",
      "agent-key-create": "Created an agent key",
      "user-key-create": "Created a Worker API key",
      "user-key-revoke": "Revoked a Worker API key",
      "worker-secret-set": "Set a Worker secret",
      "worker-secret-rotate": "Rotated a Worker secret",
      "worker-secret-delete": "Deleted a Worker secret",
      "worker-var-set": "Set a Worker var",
      "worker-var-delete": "Deleted a Worker var",
      "worker-logs-on": "Turned Workers Logs on",
      "worker-logs-off": "Turned Workers Logs off",
      "worker-health-on": "Turned health checks on",
      "worker-health-off": "Turned health checks off",
      "user-keys-settings": "Changed a Worker's API key settings",
      "recipe-save": "Saved a recipe",
      "recipe-delete": "Deleted a recipe",
      "agent-key-revoke": "Revoked an agent key",
      "agent-invite": "Created an agent invite link",
      "agent-invite-claim": "Claimed an agent invite",
      "team-key-rotate": "Rotated the team key",
      "webhook-set": "Set the webhook",
      "webhook-clear": "Removed the webhook",
      "edit-token-rotate": "Issued a new edit token",
      "permanent-off": "Removed permanent",
    },
    actorKinds: { member: "member", key: "team key", admin: "admin", api: "API", mcp: "MCP" },
    actorLabels: { "team key": "team key", "edit token": "edit token", admin: "admin" },
    count: (n) => `${n} member${n === 1 ? "" : "s"}`,
  },
  visits: {
    title: "Visits",
    column: "Visits",
    views: "Page views",
    visitors: "Visitors (approx.)",
    today: "Today",
    last7: "Last 7 days",
    last30: "Last 30 days",
    short: (d7, d30) => `7 d: ${d7} · 30 d: ${d30}`,
    chart: (total) => `Page views per day over the last 30 days, ${total} in total`,
    day: (day, views, visitors) => `${day}: ${views} views, ${visitors} visitors`,
    privacy:
      "Counted on this server only: no cookies, no IP addresses stored, no third parties. Bots and link previews are skipped. Days are UTC; visitors are counted once per hour.",
    off: "Visit counting is turned off on this instance.",
    adminTotal: (n) => `${n} page views in the last 30 days`,
  },
  team: {
    eyebrow: "Team dashboard",
    sites: "Live sites",
    backend: "Data and files",
    backendOn: "Enabled for this team",
    backendOff: "Not enabled for this team",
    backendNotConfigured: "Enabled, but this server has no backend configured yet",
    directoryOn: "Your sites appear on the home page",
    directoryOff: "Your sites are not listed on the home page",
    sitesCount: (n) => (n === 1 ? "1 live site" : `${n} live sites`),
    empty: "No live sites yet.",
    emptySub: "Publish your first page below. It will show up here with its link and expiry.",
    publishTitle: "Publish a new site",
    publishSub: "Drop files, a folder or a single .zip. index.html is the start page.",
    publish: "Publish",
    listed: "Listed",
    hidden: "Hidden",
    show: "Show on home page",
    hide: "Hide from home page",
    replace: "Replace files",
    replaceHelp: "Upload a new version. The link stays the same.",
    extend: "Extend",
    extendTo: "Expire after",
    manage: "Manage",
    back: "All sites",
    confirmDelete: "Delete this site now? The link stops working and its data is removed.",
    published: "Published. Your link is live.",
    replaced: "Files replaced. Same link, new content.",
    extended: "Expiry updated.",
    deleted: "Site deleted.",
    listingSaved: "Saved.",
    notYours: "This site doesn't exist or doesn't belong to your team.",
    capped: "A link can live at most the maximum time from when it was first published.",
    madePermanent: "The site is now permanent. It will not expire.",
    permanentNotAllowed: "This team is not allowed to publish permanent sites.",
    permanent: "Permanent",
    permanentOption: "Permanent (no expiry)",
    makePermanent: "Make permanent",
    permanentNote:
      "This site is permanent: it never expires and is never swept. To make it a timed link again, pick a time and press Extend.",
    permanentOn: "Permanent sites allowed",
    quotaUse: (sites: string, bytes: string) => `Quota: ${sites} · ${bytes}`,
    filesTitle: "Published files",
    kvTitle: "Stored values (KV)",
    kvEmpty: "No values stored.",
    backendFilesTitle: "Uploaded files (backend)",
    backendFilesEmpty: "No files uploaded.",
    backendBrowserOff: "Data and files are not available for this site.",
    key: "Key",
    value: "Value",
    moreKeys: (n) => `${n} more keys not shown.`,
    keyDeleted: "Value deleted.",
    fileDeleted: "File deleted.",
    agentsTitle: "Publish from an agent or script",
    agentsSub:
      "Use your team key in the X-Team-Key header. Never paste the key into a public page or repository.",
    uploading: "Publishing…",
    failed: "Publishing failed",
    openSite: "Open site",
    settingsTitle: "Link, expiry and visibility",
    kvCount: (n) => (n === 1 ? "1 key" : `${n} keys`),
    backendFilesCount: (n) => (n === 1 ? "1 uploaded file" : `${n} uploaded files`),
    valueTruncated: "Long value, shortened here.",
    signedInAs: "Signed in as",
    pickZip: "Choose files or a .zip",
  },
  mcp: {
    title: "MCP access",
    sub: "Let an AI agent (Claude, Cursor, VS Code…) read and work on this space over MCP. Each token is for this space only; revoke it any time.",
    endpoint: "MCP endpoint",
    tokens: "Tokens",
    none: "No MCP tokens yet.",
    name: "Name",
    namePlaceholder: "e.g. Claude on my laptop",
    scope: "Scope",
    ro: "Read-only",
    rw: "Read-write",
    rwNote: "Read-write can replace the published files and change KV data and uploaded files.",
    create: "Create token",
    created: "MCP token created.",
    createdNote: "Copy it now: it is shown only once. Put it in your MCP client config below.",
    revoke: "Revoke",
    revoked: "Token revoked.",
    confirmRevoke: "Revoke this token? Clients using it stop working at once.",
    tooMany: "A space can have at most 10 MCP tokens. Revoke one first.",
    snippets: "Connect a client",
    snippetNote: "Replace marsa_mcp_… with your token. Streamable HTTP; no install needed.",
    tools: "Tools",
  },
  admin: {
    eyebrow: "Admin",
    title: "Teams",
    sub: "Create teams, give each a key, and decide which teams may use data and files and which appear on the home page.",
    loginTitle: "Admin sign-in",
    loginSub: "Paste the admin token of this instance. Admin sessions last 12 hours.",
    tokenLabel: "Admin token",
    disabled: "Admin is disabled on this instance (ADMIN_TOKEN is not set).",
    tabsLabel: "Admin sections",
    teamsTab: "Teams",
    sitesTab: "All sites",
    teams: "Teams",
    create: "Create team",
    name: "Team name",
    backend: "Data and files",
    directory: "On home page",
    liveSites: "Live sites",
    key: "Key",
    rotate: "New key",
    none: "No teams yet. Create the first one below.",
    newKey: "Team key, shown only once",
    newKeyNote:
      "Copy it now and give it to the team. They sign in with it at /login, and agents send it as X-Team-Key. Marsa stores only a hash.",
    confirmRotate: "Make a new key? The old key and its sessions stop working right away.",
    confirmDelete: "Delete this team? Its members are signed out.",
    alsoDeleteSites: "Also delete its sites",
    created: "Team created.",
    saved: "Saved.",
    rotated: "New key created. The old key no longer works.",
    deleted: "Team deleted.",
    siteDeleted: "Site deleted.",
    howTitle: "How teams work",
    how: [
      "A team member signs in at /login with the team key and manages the team's sites from the dashboard.",
      "Agents send the same key in the X-Team-Key header.",
      "Uploads without a key are guest uploads: no backend, never listed.",
      "Turning data and files off blocks that team's sites from KV and files at once.",
    ],
    sitesTitle: "All live sites",
    sitesSub: "Every site on this instance, from teams and guests.",
    filter: "Owner",
    all: "Everyone",
    guests: "Guests only",
    apply: "Filter",
    owner: "Owner",
    noSites: "No sites match.",
    total: (n, size) => `${n} site${n === 1 ? "" : "s"} · ${size}`,
    teamsCount: (n) => (n === 1 ? "1 team" : `${n} teams`),
    liveTotal: (n) => (n === 1 ? "1 live team site" : `${n} live team sites`),
    guestsCount: (n) => (n === 1 ? "1 guest site" : `${n} guest sites`),
    serverBackendOn: "Data and files backend configured on this server",
    serverBackendOff: "No data and files backend on this server yet",
    turnOn: "Turn on",
    turnOff: "Turn off",
    createSub:
      "The team key is shown once after creating. Give it to the team; they sign in with it.",
    keyHelp: "Only the first characters of each key are shown.",
    docsLink: "Read the teams guide",
    revoked: "Permanence revoked. The site now has the maximum lifetime from now.",
    permanent: "Permanent",
    permanentFilter: "Permanent sites",
    revoke: "Revoke permanent",
    makePermanent: "Make permanent",
    quota: "Quota",
    quotaSites: "Max sites",
    quotaMb: "Max MB",
    quotaHelp: "Leave empty for the default.",
    permanentCount: (n: number) => (n === 1 ? "1 permanent site" : `${n} permanent sites`),
  },
};

const ar: Strings = {
  dir: "rtl",
  product: PRODUCT_NAME.ar,
  switchLabel: "English",
  skip: "تخطَّ إلى المحتوى",
  nav: {
    label: "القائمة الرئيسية",
    home: "الرئيسية",
    publish: "انشر",
    docs: "الدليل",
    signIn: "دخول الفرق",
    dashboard: "لوحة الفريق",
    adminConsole: "لوحة المسؤول",
    platform: "منصة مرسى",
  },
  hero: {
    eyebrow: "مفتوح المصدر · العربية أولًا · روابط تنتهي تلقائيًا",
    title: "رابط للعمل الذي يستحق المشاركة.",
    sub: "انشر تقرير HTML أو موقعًا ثابتًا أو نموذجًا أوليًا، واحصل على رابط عام خلال ثوانٍ. صُمّمت لفرق المجتمع المدني والحقوق الرقمية وحرية التعبير، وللوكلاء الآليين الذين يعملون معها.",
    ctaTry: "انشر الآن",
    ctaTeam: "دخول الفرق",
  },
  strip: ["بلا حساب للزوار", "لوحة خاصة لكل فريق", "واجهة برمجية ووكلاء آليون", "رخصة MIT"],
  landing: {
    statsLabel: "على هذه النسخة الآن",
    statTeams: "فرق تنشر",
    statPages: "صفحات حيّة",
    statTtl: "أقصى عمر للرابط",
    howEyebrow: "ثلاث خطوات",
    featured: "مختارة",
    open: "افتح الصفحة",
    by: "من",
    preview: (title) => `معاينة ${title}`,
    allPages: "كل صفحات الفرق",
  },
  why: {
    title: "صغيرة عن قصد",
    items: [
      ["بلا حساب", "من تشارك معه الرابط يفتحه في المتصفح مباشرة. لا تسجيل، ولا تطبيق، ولا تتبّع."],
      [
        "مصمّمة للوكلاء الآليين أيضًا",
        `طلب HTTP واحد يحوّل مجلدًا أو ملف ZIP إلى رابط. يحصل الوكيل على النتيجة بصيغة JSON، ومعها ${iso("/llms.txt")} ومواصفات OpenAPI.`,
      ],
      ["لا شيء يبقى", "لكل رابط مدة، من ساعة إلى أسبوع. حين تنتهي تُحذف الملفات من الخادم."],
    ],
  },
  how: {
    title: "كيف تعمل",
    steps: [
      ["ارفع", "اسحب ملفات أو مجلدًا أو ملف zip، أو أرسلها عبر الواجهة البرمجية."],
      ["شارك", "تحصل على رابط عام. والفرق تدير مواقعها من لوحتها الخاصة."],
      ["ينتهي", "حين تنتهي المدة يُحذف الموقع. ويمكنك تمديده أو تحديثه أو حذفه قبل ذلك."],
    ],
  },
  uses: {
    title: "كيف تستخدمها الفرق",
    sub: "أي محتوى ثابت: HTML وCSS وJavaScript وملفات.",
    items: [
      ["تقرير للشركاء", "شارك موجز بحث أو تقرير رصد صفحةً مقروءة بدل مرفق ثقيل."],
      [
        "صفحة حملة أو فعالية",
        "البرنامج والخريطة وبيانات التواصل لورشة أو لحظة حملة، تختفي بعد أسبوع.",
      ],
      ["نموذج أولي للمراجعة", "أرسل نموذجًا تفاعليًا لزملائك دون إعداد استضافة أو حسابات."],
      [
        "وكيل آلي يشارك نتيجته",
        "يبني الوكيل لوحة بيانات، ويضغطها، ثم يعيد إليك رابطًا بدل نص طويل.",
      ],
    ],
    more: "شاهد الأمثلة",
  },
  teamsBand: {
    title: "تعملون كفريق؟",
    sub: "يمنح المسؤول فريقك مفتاحًا. ادخل به لتنشر مواقعك وتحدّثها وتمدّدها وتحذفها، وإن كان مفعّلًا، لتطّلع على البيانات والملفات التي تحفظها صفحاتك.",
    cta: "دخول الفرق",
    docs: "كيف تعمل الفرق",
  },
  agents: {
    title: "للوكلاء الآليين",
    sub: `أعطِ الوكيل هذا المقتطف أو وجّهه إلى ${iso("/llms.txt")}. سيضغط الناتج، ويرسله، ثم يعيد الرابط.`,
    llms: "llms.txt",
    openapi: "مواصفات OpenAPI",
    guide: "دليل الوكلاء",
  },
  try: {
    title: "انشر صفحة",
    sub: "كل ما تنشره متاح لأي شخص لديه الرابط. لا ترفع أسرارًا أو بيانات شخصية.",
    drop: "أفلت هنا ملفات أو مجلدًا أو ملف zip",
    pickFiles: "اختر ملفات",
    pickDir: "اختر مجلدًا",
    expires: "ينتهي بعد",
    ready: "رابطك جاهز",
    copy: "انسخ الرابط",
    tokenNote:
      "مفتاح التعديل. محفوظ في هذا المتصفح؛ احتفظ بنسخة منه إن أردت إدارة الموقع من مكان آخر.",
    mine: "ما نشرته من هذا المتصفح",
    none: "لا شيء بعد.",
    teamHint: "تعمل ضمن فريق؟ ادخل لتنشر في لوحة فريقك.",
  },
  limits: {
    title: "الحدود والخصوصية",
    sub: "حدود صغيرة لتبقى الخدمة سريعة وصعبة الإساءة.",
    privacyTitle: "الخصوصية",
    privacy: [
      "أي شخص لديه الرابط يستطيع رؤية الموقع.",
      "لا ملفات تتبّع ولا تحليلات من طرف ثالث. تُعدّ مشاهدات الصفحات على هذا الخادم كمجاميع يومية فقط. للفرق ملف دخول واحد فقط.",
      "يُستخدم عنوان IP في الذاكرة فقط، لحدود الاستخدام ولعدّ الزوار كل ساعة، ولا يُخزَّن.",
      "تعمل الصفحات المنشورة داخل بيئة معزولة في المتصفح، ولا تصل إلى التطبيق أو إلى جلستك.",
      "تُحذف المواقع المنتهية والمحذوفة من الخادم.",
    ],
    limitItems: (l) => [
      `حتى ${iso(l.maxFiles)} ملف، و${iso(`${l.maxFileMb} MB`)} للملف، و${iso(`${l.maxSiteMb} MB`)} للموقع`,
      `يبقى الرابط ${l.defaultTtl} افتراضيًا، وبحدٍّ أقصى ${l.maxTtl}`,
      `${iso(l.uploadsPerHour)} عملية رفع في الساعة لكل عنوان IP`,
      "ملفات ثابتة فقط: تُرفض سكربتات الخادم والملفات التنفيذية",
    ],
  },
  selfhost: {
    title: "شغّل نسختك",
    sub: "حاوية واحدة، ومجلد بيانات واحد، دون قاعدة بيانات. برخصة MIT.",
    cta: "دليل الاستضافة الذاتية",
  },
  directory: {
    title: "منشورات الفرق",
    sub: "صفحات حيّة اختارت الفرق على هذه النسخة مشاركتها. ينتهي كل رابط تلقائيًا.",
    empty: "لا توجد صفحات فرق منشورة الآن.",
    expires: "ينتهي",
    pages: (n) => (n === 1 ? "صفحة واحدة" : n === 2 ? "صفحتان" : `${n} صفحات`),
  },
  footer: {
    about:
      "مساحات مرسى جزء من مرسى: معرفة وأدوات مفتوحة لفرق المجتمع المدني والحقوق الرقمية وحرية التعبير.",
    note: "مفتوحة المصدر (MIT). المحتوى المنشور متاح لأي شخص لديه الرابط.",
    product: "المساحات",
    resources: "للمطوّرين",
    platform: "منصة مرسى",
  },
  docs: {
    title: "الدليل",
    sub: "كل ما تحتاجه لاستخدام مساحات مرسى من المتصفح أو من سكربت أو وكيل آلي أو CI، ولاستضافة نسختك.",
    englishOnly: "(بالإنجليزية)",
    back: "كل الأدلة",
  },
  notFound: "هذه الصفحة غير موجودة.",
  notFoundSub: "ربما كُتب الرابط خطأً، أو حُذف الموقع.",
  gone: "انتهت صلاحية هذا الرابط.",
  goneSub: "حُذفت ملفاته حين انتهت مدته.",
  home: "العودة إلى الرئيسية",
  tooMany: "محاولات كثيرة. انتظر بضع دقائق ثم أعد المحاولة.",
  badRequest: "انتهت صلاحية هذا النموذج. أعد تحميل الصفحة وحاول مرة أخرى.",
  common: {
    copy: "نسخ",
    copied: "تم النسخ",
    del: "حذف",
    save: "حفظ",
    cancel: "إلغاء",
    signOut: "خروج",
    on: "مفعّل",
    off: "متوقف",
    guest: "زائر",
    size: "الحجم",
    expires: "ينتهي",
    created: "أُنشئ",
    actions: "إجراءات",
    link: "الرابط",
    title: "العنوان",
    open: "فتح",
    files: (n) => (n === 1 ? "ملف واحد" : n === 2 ? "ملفان" : `${iso(n)} ملفات`),
    confirm: "هل أنت متأكد؟",
  },
  login: {
    title: "دخول الفرق",
    sub: "ادخل بحساب العضو الخاص بك، أو بمفتاح الفريق الذي أعطاك إياه المسؤول. تبقى مسجّلًا في هذا المتصفح أسبوعًا، أو حتى تخرج.",
    keyLabel: "مفتاح الفريق",
    keyHelp: "يبدأ بـ marsa_team_. لا يُعرض المفتاح مرة أخرى بعد إنشائه.",
    submit: "دخول",
    invalid: "هذا المفتاح لا يطابق أي فريق. تحقّق منه، أو اطلب مفتاحًا جديدًا من المسؤول.",
    limited: "محاولات دخول كثيرة من شبكتك. أعد المحاولة بعد بضع دقائق.",
    csrf: "انتهت صلاحية هذا النموذج. حاول مرة أخرى.",
    noKey: "ليس لديك مفتاح؟ ينشئ مسؤول هذه النسخة الفرق ومفاتيحها.",
    adminLink: "دخول المسؤول",
    signedOut: "خرجت من حسابك.",
    expired: "انتهت جلستك. ادخل مرة أخرى.",
  },
  members: {
    nav: "الأعضاء",
    title: "الأعضاء",
    sub: "ادعُ الأشخاص برابط يُستخدم مرة واحدة، وأعطِ كلًّا منهم دورًا، واعرف من فعل ماذا.",
    memberTitle: "دخول الأعضاء",
    keyTitle: "أو استخدم مفتاح الفريق",
    keySub: "مفتاح الفريق يعمل بصلاحيات المالك، وتستمر الوكلاء والبرامج في استخدامه للـ API.",
    username: "اسم المستخدم",
    usernameHelp: "من 3 إلى 32 حرفًا: a–z و0–9 والنقطة والشرطة والشرطة السفلية. تستخدمه للدخول.",
    displayName: "اسمك",
    password: "كلمة المرور",
    passwordHelp: "10 أحرف على الأقل. تُحفظ كـ hash بخوارزمية scrypt فقط.",
    confirm: "أعد كتابة كلمة المرور",
    signInMember: "ادخل",
    invalidMember: "اسم المستخدم أو كلمة المرور غير صحيحة.",
    signedInAs: (name, role) => `أنت داخل باسم ${name} · ${role}`,
    viaKey: "مفتاح الفريق",
    roles: { owner: "مالك", editor: "محرّر", viewer: "مشاهد" },
    roleHelp: {
      owner: "كل شيء، ومنه إدارة الأعضاء والدعوات",
      editor: "نشر المواقع واستبدالها وتمديدها وحذفها",
      viewer: "قراءة فقط",
    },
    listTitle: "الأشخاص",
    nameCol: "الاسم",
    none: "لا يوجد أعضاء بعد. ادعُ أحدًا بالأسفل.",
    joined: "انضم",
    lastSeen: "آخر دخول",
    never: "أبدًا",
    role: "الدور",
    save: "احفظ",
    remove: "أزِل",
    confirmRemove: "إزالة هذا العضو؟ سيخرج من حسابه فورًا.",
    removed: "تمت إزالة العضو.",
    roleSaved: "تم حفظ الدور.",
    notSelf: "لا يمكنك تغيير عضويتك أو إزالتها من هنا.",
    notAllowed: "دورك لا يسمح بذلك.",
    invitesTitle: "دعوات معلّقة",
    invitesNone: "لا توجد دعوات معلّقة.",
    inviteSub: "رابط الدعوة يعمل مرة واحدة وينتهي. أرسله بنفسك، فلا يُرسل أي بريد.",
    invite: "أنشئ رابط دعوة",
    inviteExpiry: "ينتهي بعد",
    inviteCreated: "تم إنشاء رابط الدعوة.",
    inviteNote: "انسخه الآن، فلن يظهر مرة أخرى. أول من يفتحه ينضم بهذا الدور.",
    inviteLink: "رابط الدعوة",
    inviteRevoked: "تم إلغاء الدعوة.",
    tooManyInvites: "الدعوات المعلّقة كثيرة. ألغِ بعضها أولًا.",
    tooManyMembers: "وصل هذا الفريق إلى الحد الأقصى للأعضاء.",
    expires: "ينتهي",
    by: "أنشأها",
    revoke: "ألغِ",
    hours: (n) => (n % 24 === 0 ? (n === 24 ? "يوم واحد" : `${n / 24} أيام`) : `${n} ساعة`),
    accountTitle: "حسابك",
    current: "كلمة المرور الحالية",
    newPassword: "كلمة المرور الجديدة",
    changePassword: "غيّر كلمة المرور",
    passwordChanged: "تم تغيير كلمة المرور، وأُنهيت جلساتك الأخرى.",
    wrongPassword: "كلمة المرور الحالية غير صحيحة.",
    signOutAll: "اخرج من كل الأجهزة الأخرى",
    signOutAllHelp: "يُنهي كل جلسات حسابك الأخرى.",
    signedOutAll: "أُنهيت جلساتك الأخرى.",
    keyAccount:
      "دخلت بمفتاح الفريق، وهو يعمل بصلاحيات المالك. اطلب دعوة من أحد الملاك، أو ادعُ نفسك، لتحصل على حساب شخصي.",
    joinTitle: (team) => `انضم إلى ${team}`,
    joinSub: (role) => `وصلتك دعوة بدور ${role}. اختر اسم مستخدم وكلمة مرور لإنشاء حسابك.`,
    join: "أنشئ الحساب وادخل",
    joined2: "أهلًا بك! حسابك جاهز.",
    inviteInvalid: "رابط الدعوة هذا لا يعمل",
    inviteInvalidSub: "إما أنه استُخدم من قبل، أو أُلغي، أو انتهت مدته. اطلب رابطًا جديدًا.",
    taken: "اسم المستخدم هذا مأخوذ. اختر اسمًا آخر.",
    badUsername: "استخدم من 3 إلى 32 حرفًا: a–z و0–9 والنقطة والشرطة والشرطة السفلية.",
    badName: "اكتب اسمك (حتى 80 حرفًا).",
    short: "يجب ألا تقل كلمة المرور عن 10 أحرف.",
    long: "كلمة المرور طويلة جدًا.",
    same: "يجب ألا تحتوي كلمة المرور على اسم المستخدم.",
    mismatch: "كلمتا المرور غير متطابقتين.",
    auditTitle: "النشاط",
    auditSiteTitle: "النشاط على هذا الموقع",
    auditNone: "لم يُسجَّل شيء بعد.",
    when: "متى",
    who: "من",
    what: "ماذا",
    actions: {
      publish: "نشر الموقع",
      replace: "استبدل الملفات",
      extend: "غيّر مدة الانتهاء",
      permanent: "جعله دائمًا",
      delete: "حذف الموقع",
      "listing-on": "أظهره في الصفحة الرئيسية",
      "listing-off": "أخفاه من الصفحة الرئيسية",
      "mcp-token": "أنشأ رمز MCP",
      "mcp-revoke": "ألغى رمز MCP",
      "kv-delete": "حذف مفتاح KV",
      "file-delete": "حذف ملفًا مرفوعًا",
      "sign-in": "دخل",
      invite: "أنشأ دعوة",
      "invite-revoke": "ألغى دعوة",
      "member-join": "انضم إلى الفريق",
      "member-remove": "أزال عضوًا",
      "member-role": "غيّر دورًا",
      password: "غيّر كلمة مروره",
      "worker-deploy": "نشر وركر",
      "worker-redeploy": "أعاد نشر وركر",
      "worker-delete": "حذف وركر",
      "worker-disable": "أوقف وركر",
      "worker-enable": "أعاد تشغيل وركر",
      "workers-on": "فعّل الوركرز",
      "workers-off": "أوقف الوركرز",
      "cf-token-set": "حفظ مفتاح كلاودفلير",
      "cf-settings": "غيّر إعدادات كلاودفلير",
      "cf-token-clear": "حذف مفتاح كلاودفلير",
      "worker-rollback": "أرجع وركر لإصدار سابق",
      "agent-key-create": "أنشأ مفتاح وكيل",
      "user-key-create": "أنشأ مفتاح API لوركر",
      "user-key-revoke": "ألغى مفتاح API لوركر",
      "worker-secret-set": "أضاف سرًّا للوركر",
      "worker-secret-rotate": "غيّر سرًّا للوركر",
      "worker-secret-delete": "حذف سرًّا من الوركر",
      "worker-var-set": "ضبط متغيرًا للوركر",
      "worker-var-delete": "حذف متغيرًا من الوركر",
      "worker-logs-on": "شغّل سجلات الوركر",
      "worker-logs-off": "أوقف سجلات الوركر",
      "worker-health-on": "شغّل فحص الصحة",
      "worker-health-off": "أوقف فحص الصحة",
      "user-keys-settings": "غيّر إعدادات مفاتيح API لوركر",
      "recipe-save": "حفظ وصفة",
      "recipe-delete": "حذف وصفة",
      "agent-key-revoke": "ألغى مفتاح وكيل",
      "agent-invite": "أنشأ رابط دعوة وكيل",
      "agent-invite-claim": "استلم دعوة وكيل",
      "team-key-rotate": "غيّر مفتاح الفريق",
      "webhook-set": "ضبط الـ Webhook",
      "webhook-clear": "أزال الـ Webhook",
      "edit-token-rotate": "أصدر رمز تعديل جديدًا",
      "permanent-off": "ألغى الديمومة",
    },
    actorKinds: { member: "عضو", key: "مفتاح الفريق", admin: "المسؤول", api: "API", mcp: "MCP" },
    actorLabels: { "team key": "مفتاح الفريق", "edit token": "مفتاح التعديل", admin: "المسؤول" },
    count: (n) => (n === 1 ? "عضو واحد" : `${n} أعضاء`),
  },
  visits: {
    title: "الزيارات",
    column: "الزيارات",
    views: "مشاهدات الصفحات",
    visitors: "الزوار (تقريبًا)",
    today: "اليوم",
    last7: "آخر 7 أيام",
    last30: "آخر 30 يومًا",
    short: (d7, d30) => `٧ أيام: ${d7} · ٣٠ يومًا: ${d30}`,
    chart: (total) => `مشاهدات الصفحات يوميًا خلال آخر 30 يومًا، والمجموع ${total}`,
    day: (day, views, visitors) => `${day}: ${views} مشاهدة، ${visitors} زائر`,
    privacy:
      "العدّ يتم على هذا الخادم فقط: بلا كوكيز، ولا تُحفظ عناوين IP، ولا يشارك فيه أي طرف ثالث. لا تُحسب برامج الزحف ولا معاينات الروابط. الأيام بتوقيت UTC، ويُحسب الزائر مرة واحدة كل ساعة.",
    off: "عدّ الزيارات متوقف على هذه النسخة.",
    adminTotal: (n) => `${n} مشاهدة خلال آخر 30 يومًا`,
  },
  team: {
    eyebrow: "لوحة الفريق",
    sites: "المواقع الحيّة",
    backend: "البيانات والملفات",
    backendOn: "مفعّلة لهذا الفريق",
    backendOff: "غير مفعّلة لهذا الفريق",
    backendNotConfigured: "مفعّلة، لكن لم تُضبط الخدمة الخلفية على هذا الخادم بعد",
    directoryOn: "تظهر مواقعكم في الصفحة الرئيسية",
    directoryOff: "لا تظهر مواقعكم في الصفحة الرئيسية",
    sitesCount: (n) => (n === 1 ? "موقع حيّ واحد" : n === 2 ? "موقعان حيّان" : `${n} مواقع حيّة`),
    empty: "لا توجد مواقع حيّة بعد.",
    emptySub: "انشر صفحتك الأولى من الأسفل، وستظهر هنا مع رابطها وموعد انتهائها.",
    publishTitle: "انشر موقعًا جديدًا",
    publishSub: "أفلت ملفات أو مجلدًا أو ملف zip واحدًا. الصفحة الأولى هي index.html.",
    publish: "انشر",
    listed: "ظاهر",
    hidden: "مخفي",
    show: "أظهره في الرئيسية",
    hide: "أخفِه من الرئيسية",
    replace: "استبدل الملفات",
    replaceHelp: "ارفع نسخة جديدة. يبقى الرابط كما هو.",
    extend: "مدّد",
    extendTo: "ينتهي بعد",
    manage: "إدارة",
    back: "كل المواقع",
    confirmDelete: "حذف هذا الموقع الآن؟ سيتوقف الرابط وتُحذف بياناته.",
    published: "نُشر الموقع. رابطك يعمل الآن.",
    replaced: "استُبدلت الملفات. الرابط نفسه بمحتوى جديد.",
    extended: "حُدّث موعد الانتهاء.",
    deleted: "حُذف الموقع.",
    listingSaved: "حُفظ.",
    notYours: "هذا الموقع غير موجود أو لا يتبع فريقك.",
    capped: "لا يتجاوز عمر الرابط الحدّ الأقصى محسوبًا من أول نشر.",
    madePermanent: "أصبح الموقع دائمًا، ولن ينتهي.",
    permanentNotAllowed: "هذا الفريق غير مسموح له بالمواقع الدائمة.",
    permanent: "دائم",
    permanentOption: "دائم (بلا انتهاء)",
    makePermanent: "اجعله دائمًا",
    permanentNote:
      "الموقع دائم: لا ينتهي ولا يُحذف تلقائيًا. لإرجاعه لرابط مؤقت اختر مدة واضغط «مدّد».",
    permanentOn: "مسموح بالمواقع الدائمة",
    quotaUse: (sites: string, bytes: string) => `الحصة: ${sites} · ${bytes}`,
    filesTitle: "الملفات المنشورة",
    kvTitle: "القيم المخزّنة (KV)",
    kvEmpty: "لا توجد قيم مخزّنة.",
    backendFilesTitle: "الملفات المرفوعة (الخدمة الخلفية)",
    backendFilesEmpty: "لا توجد ملفات مرفوعة.",
    backendBrowserOff: "البيانات والملفات غير متاحة لهذا الموقع.",
    key: "المفتاح",
    value: "القيمة",
    moreKeys: (n) => `${n} مفاتيح أخرى غير معروضة.`,
    keyDeleted: "حُذفت القيمة.",
    fileDeleted: "حُذف الملف.",
    agentsTitle: "النشر من وكيل آلي أو سكربت",
    agentsSub: "استخدم مفتاح الفريق في الترويسة X-Team-Key. لا تضع المفتاح في صفحة عامة أو مستودع.",
    uploading: "جارٍ النشر…",
    failed: "تعذّر النشر",
    openSite: "افتح الموقع",
    settingsTitle: "الرابط والمدة والظهور",
    kvCount: (n) =>
      n === 1
        ? "مفتاح واحد"
        : n === 2
          ? "مفتاحان"
          : n <= 10
            ? `${iso(n)} مفاتيح`
            : `${iso(n)} مفتاحًا`,
    backendFilesCount: (n) =>
      n === 1
        ? "ملف مرفوع واحد"
        : n === 2
          ? "ملفان مرفوعان"
          : n <= 10
            ? `${iso(n)} ملفات مرفوعة`
            : `${iso(n)} ملفًا مرفوعًا`,
    valueTruncated: "قيمة طويلة، مختصرة هنا.",
    signedInAs: "دخلت باسم",
    pickZip: "اختر ملفات أو ملف zip",
  },
  mcp: {
    title: "وصول MCP",
    sub: "اسمح لوكيل ذكي (Claude أو Cursor أو VS Code…) أن يقرأ هذه المساحة ويعمل عليها عبر MCP. كل رمز خاص بهذه المساحة وحدها، ويمكنك إلغاؤه في أي وقت.",
    endpoint: "عنوان MCP",
    tokens: "الرموز",
    none: "لا توجد رموز MCP بعد.",
    name: "الاسم",
    namePlaceholder: "مثلًا: Claude على جهازي",
    scope: "الصلاحية",
    ro: "قراءة فقط",
    rw: "قراءة وكتابة",
    rwNote: "صلاحية الكتابة تسمح باستبدال الملفات المنشورة وتعديل بيانات KV والملفات المرفوعة.",
    create: "أنشئ رمزًا",
    created: "تم إنشاء رمز MCP.",
    createdNote: "انسخه الآن، فلن يظهر مرة أخرى. ضعه في إعدادات عميل MCP بالأسفل.",
    revoke: "ألغِ",
    revoked: "تم إلغاء الرمز.",
    confirmRevoke: "إلغاء هذا الرمز؟ أي عميل يستخدمه سيتوقف فورًا.",
    tooMany: "لكل مساحة 10 رموز MCP بحد أقصى. ألغِ رمزًا أولًا.",
    snippets: "اربط عميلًا",
    snippetNote: "استبدل marsa_mcp_… برمزك. النقل Streamable HTTP، ولا يحتاج تثبيت أي شيء.",
    tools: "الأدوات",
  },
  admin: {
    eyebrow: "الإدارة",
    title: "الفرق",
    sub: "أنشئ الفرق، وامنح كل فريق مفتاحًا، وحدّد أي الفرق تستخدم البيانات والملفات وأيها يظهر في الصفحة الرئيسية.",
    loginTitle: "دخول المسؤول",
    loginSub: "الصق رمز المسؤول لهذه النسخة. تبقى جلسة المسؤول 12 ساعة.",
    tokenLabel: "رمز المسؤول",
    disabled: "الإدارة غير مفعّلة على هذه النسخة (لم يُضبط ADMIN_TOKEN).",
    tabsLabel: "أقسام الإدارة",
    teamsTab: "الفرق",
    sitesTab: "كل المواقع",
    teams: "الفرق",
    create: "إنشاء فريق",
    name: "اسم الفريق",
    backend: "البيانات والملفات",
    directory: "في الرئيسية",
    liveSites: "مواقع حيّة",
    key: "المفتاح",
    rotate: "مفتاح جديد",
    none: "لا توجد فرق بعد. أنشئ أول فريق من الأسفل.",
    newKey: "مفتاح الفريق، يُعرض مرة واحدة فقط",
    newKeyNote:
      "انسخه الآن وسلّمه للفريق. يدخل به الفريق من /login، ويرسله الوكلاء في الترويسة X-Team-Key. لا تحفظ مرسى إلا بصمته.",
    confirmRotate: "إنشاء مفتاح جديد؟ سيتوقف المفتاح القديم وجلساته فورًا.",
    confirmDelete: "حذف هذا الفريق؟ سيخرج أعضاؤه من حساباتهم.",
    alsoDeleteSites: "احذف مواقعه أيضًا",
    created: "أُنشئ الفريق.",
    saved: "حُفظ.",
    rotated: "أُنشئ مفتاح جديد. المفتاح القديم لم يعد يعمل.",
    deleted: "حُذف الفريق.",
    siteDeleted: "حُذف الموقع.",
    howTitle: "كيف تعمل الفرق",
    how: [
      "يدخل عضو الفريق من /login بمفتاح الفريق، ويدير مواقع الفريق من اللوحة.",
      "يرسل الوكلاء المفتاح نفسه في الترويسة X-Team-Key.",
      "الرفع دون مفتاح رفعُ زائر: بلا خدمة خلفية، ولا يظهر في الرئيسية.",
      "إيقاف البيانات والملفات يمنع مواقع الفريق من KV والملفات فورًا.",
    ],
    sitesTitle: "كل المواقع الحيّة",
    sitesSub: "كل المواقع على هذه النسخة، من الفرق والزوار.",
    filter: "المالك",
    all: "الجميع",
    guests: "الزوار فقط",
    apply: "تصفية",
    owner: "المالك",
    noSites: "لا توجد مواقع مطابقة.",
    total: (n, size) => `${iso(n)} موقع · ${iso(size)}`,
    teamsCount: (n) => (n === 1 ? "فريق واحد" : n === 2 ? "فريقان" : `${iso(n)} فرق`),
    liveTotal: (n) =>
      n === 1 ? "موقع فريق حيّ واحد" : n === 2 ? "موقعا فرق حيّان" : `${iso(n)} مواقع فرق حيّة`,
    guestsCount: (n) =>
      n === 1 ? "موقع زائر واحد" : n === 2 ? "موقعا زوار" : `${iso(n)} مواقع زوار`,
    serverBackendOn: "الخدمة الخلفية للبيانات والملفات مضبوطة على هذا الخادم",
    serverBackendOff: "لم تُضبط الخدمة الخلفية للبيانات والملفات على هذا الخادم بعد",
    turnOn: "تفعيل",
    turnOff: "إيقاف",
    createSub: "يُعرض مفتاح الفريق مرة واحدة بعد الإنشاء. سلّمه للفريق ليدخل به.",
    keyHelp: "تظهر الأحرف الأولى فقط من كل مفتاح.",
    docsLink: "اقرأ دليل الفرق",
    revoked: "تم إلغاء الدوام. للموقع الآن المدة القصوى من الآن.",
    permanent: "دائم",
    permanentFilter: "المواقع الدائمة",
    revoke: "ألغِ الدوام",
    makePermanent: "اجعله دائمًا",
    quota: "الحصة",
    quotaSites: "حد المواقع",
    quotaMb: "حد المساحة (م.ب)",
    quotaHelp: "اتركه فارغًا لاستخدام الافتراضي.",
    permanentCount: (n: number) => (n === 1 ? "موقع دائم واحد" : `${n} مواقع دائمة`),
  },
};

export const STRINGS: Record<Lang, Strings> = { en, ar };
