import { APP_NAME } from "./brand.js";

export type Lang = "en" | "ar";

export interface Strings {
  dir: "ltr" | "rtl";
  switchLabel: string;
  skip: string;
  nav: { home: string; try: string; docs: string; api: string };
  hero: { eyebrow: string; title: string; sub: string; ctaTry: string; ctaDocs: string };
  why: { title: string; items: [string, string][] };
  how: { title: string; steps: [string, string][] };
  uses: { title: string; sub: string; items: [string, string][]; more: string };
  agents: { title: string; sub: string; llms: string; openapi: string };
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
  admin: {
    title: string;
    sub: string;
    tokenLabel: string;
    connect: string;
    signOut: string;
    teams: string;
    create: string;
    name: string;
    backend: string;
    directory: string;
    liveSites: string;
    key: string;
    actions: string;
    rotate: string;
    del: string;
    none: string;
    newKey: string;
    newKeyNote: string;
    howTitle: string;
    how: string[];
  };
  footer: string;
  docs: { title: string; sub: string; englishOnly: string; back: string };
  notFound: string;
  gone: string;
  home: string;
}

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
  if (lang === "ar") return h < 24 ? `${h} ساعة` : h === 24 ? "يوم" : `${h / 24} أيام`;
  if (h < 24) return h === 1 ? "1 hour" : `${h} hours`;
  return h === 24 ? "1 day" : `${h / 24} days`;
}

const en: Strings = {
  dir: "ltr",
  switchLabel: "عربي",
  skip: "Skip to content",
  nav: { home: "Home", try: "Try it", docs: "Guide", api: "API" },
  hero: {
    eyebrow: "Open source · No account · Expiring links",
    title: "A harbor for your work. Land it, share it, let it go.",
    sub: `${APP_NAME} (Arabic for "harbor") is where you, or your AI agent, drop a static site, an HTML report or a prototype and get a shareable link in seconds. No sign-up. Links clean themselves up.`,
    ctaTry: "Drop files now",
    ctaDocs: "Read the guide",
  },
  why: {
    title: `Why ${APP_NAME}?`,
    items: [
      [
        "No account, no friction",
        "Nobody has to sign up, verify an email or pick a plan to see your work. Drop, copy the link, send it.",
      ],
      [
        "Made for AI agents",
        "One HTTP call turns a folder or ZIP into a URL. Agents get a link and a token back as JSON, plus /llms.txt and an OpenAPI spec.",
      ],
      [
        "Nothing lingers",
        "Every link has an expiry, from one hour to a week. When it ends, the files are deleted from disk. You can delete earlier with your token.",
      ],
    ],
  },
  how: {
    title: "How it works",
    steps: [
      ["Drop", "Drag in files, a folder or a .zip, or POST them to the API."],
      ["Share", "You get a public link and a private edit token. Send the link to anyone."],
      [
        "It expires",
        "When time is up the site is removed. Update, extend or delete it with the token.",
      ],
    ],
  },
  uses: {
    title: "What people use it for",
    sub: "Anything that is static HTML, CSS, JS and assets.",
    items: [
      [
        "An agent shares an HTML report",
        "Your AI agent builds a report or dashboard, zips it and posts back a link instead of a wall of text.",
      ],
      [
        "A prototype for a client",
        "Send a clickable demo for review without setting up hosting or giving them an account.",
      ],
      [
        "A temporary event page",
        "Schedule, map and RSVP info for a meetup that is gone the week after.",
      ],
      [
        "A class assignment",
        "Students publish their HTML/CSS homework and hand in a link; the teacher reviews it in a browser.",
      ],
      [
        "A preview from CI",
        "Every pull request gets a preview link of its static build, posted as a comment.",
      ],
    ],
    more: "See the examples",
  },
  agents: {
    title: "For AI agents",
    sub: "Give your agent this snippet or point it at /llms.txt. It zips the output, posts it and returns the link.",
    llms: "llms.txt",
    openapi: "OpenAPI spec",
  },
  try: {
    title: "Try it now",
    sub: "Everything you upload is public to anyone with the link.",
    drop: "Drop files, a folder, or a .zip here",
    pickFiles: "Choose files",
    pickDir: "Choose folder",
    expires: "Expires after",
    ready: "Your link is ready",
    copy: "Copy link",
    tokenNote:
      "Edit/delete token. It's saved in this browser; keep a copy if you want to manage the site elsewhere.",
    mine: "Your drops in this browser",
    none: "Nothing yet.",
  },
  limits: {
    title: "Limits & privacy",
    sub: "Small on purpose, so it stays fast and hard to abuse.",
    privacyTitle: "Privacy",
    privacy: [
      "Anyone with the link can view the site. Don't upload secrets or personal data.",
      "No accounts, no tracking cookies, no analytics.",
      "Your IP is used only in memory for rate limits. It is not stored.",
      "Uploaded pages run in a browser sandbox and can't reach this app or your token.",
      "Expired and deleted sites are removed from disk.",
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
    empty: "No team pages are live right now. Check back soon.",
    expires: "Expires",
    pages: (n) => (n === 1 ? "1 page" : `${n} pages`),
  },
  admin: {
    title: "Admin: teams",
    sub: "Create teams, give each one a team key, and decide which teams may use the data/files backend and which appear in the public directory.",
    tokenLabel: "Admin token",
    connect: "Open",
    signOut: "Sign out",
    teams: "Teams",
    create: "Create team",
    name: "Team name",
    backend: "Backend access",
    directory: "Show in public directory",
    liveSites: "Live sites",
    key: "Key",
    actions: "Actions",
    rotate: "New key",
    del: "Delete",
    none: "No teams yet.",
    newKey: "Team key (shown only once)",
    newKeyNote:
      "Copy it now and give it to the team. Uploads sent with this key belong to the team. Marsa stores only a hash.",
    howTitle: "How teams upload",
    how: [
      "Send the team key with the upload: header X-Team-Key: <key> (or Authorization: Bearer <key>).",
      "Uploads without a key stay guest uploads: no backend, never listed.",
      "Turning backend access off blocks that team's sites from KV/files immediately (403 BACKEND_NOT_ALLOWED).",
      "Deleting a team leaves its sites up as ordinary links until they expire, unless you also delete them.",
    ],
  },
  footer: `${APP_NAME} is open source (MIT). Uploaded content is public to anyone with the link.`,
  docs: {
    title: "Guide",
    sub: `Everything you need to use ${APP_NAME} from a browser, a script, an AI agent or CI, and to host your own.`,
    englishOnly: "",
    back: "All guides",
  },
  notFound: "This link doesn't exist.",
  gone: "This link has expired and its files were deleted.",
  home: "Go to the home page",
};

const ar: Strings = {
  dir: "rtl",
  switchLabel: "English",
  skip: "انتقل للمحتوى",
  nav: { home: "الرئيسية", try: "جرّب", docs: "الدليل", api: "API" },
  hero: {
    eyebrow: "مفتوح المصدر · من غير حساب · روابط بتنتهي لوحدها",
    title: "مرسى لشغلك. ارسيه، شاركه، وسيبه يمشي.",
    sub: `${iso(APP_NAME)} (يعني مَرسى) هو المكان اللي انت أو الـ AI agent بتاعك ترفعوا فيه موقع ثابت أو تقرير HTML أو نموذج أولي، وتاخدوا رابط تشاركوه في ثواني. من غير تسجيل، والروابط بتتمسح لوحدها.`,
    ctaTry: "ارفع ملفاتك دلوقتي",
    ctaDocs: "اقرأ الدليل",
  },
  why: {
    title: `ليه ${iso(APP_NAME)}؟`,
    items: [
      [
        "من غير حساب ولا تعقيد",
        "محدش محتاج يسجّل أو يأكد إيميل أو يختار باقة علشان يشوف شغلك. ارفع، انسخ الرابط، وابعته.",
      ],
      [
        "معمول للـ AI agents",
        `طلب HTTP واحد بيحوّل فولدر أو ملف ZIP لرابط. الـ agent بياخد الرابط ومفتاح التعديل في JSON، ومعاهم ${iso("/llms.txt")} ومواصفات OpenAPI.`,
      ],
      [
        "مفيش حاجة بتفضل",
        "كل رابط له مدة، من ساعة لأسبوع. لما تخلص، الملفات بتتمسح من على السيرفر. وتقدر تمسحه قبلها بالمفتاح.",
      ],
    ],
  },
  how: {
    title: "بيشتغل إزاي",
    steps: [
      ["ارفع", "اسحب ملفات أو فولدر أو ملف zip، أو ابعتهم للـ API."],
      ["شارك", "هتاخد رابط عام ومفتاح تعديل خاص بيك. ابعت الرابط لأي حد."],
      ["بينتهي", "لما المدة تخلص الموقع بيتمسح. وتقدر تحدّثه أو تمدّه أو تمسحه بالمفتاح."],
    ],
  },
  uses: {
    title: "الناس بتستخدمه في إيه",
    sub: "أي حاجة عبارة عن HTML وCSS وJS وملفات ثابتة.",
    items: [
      [
        "agent بيشارك تقرير HTML",
        "الـ AI agent بيعمل تقرير أو داشبورد، يضغطه ويرجعلك رابط بدل كلام كتير.",
      ],
      ["نموذج أولي لعميل", "ابعت ديمو تقدر تدوس فيه للمراجعة، من غير استضافة ولا حساب للعميل."],
      ["صفحة مؤقتة لإيفنت", "الجدول والمكان والتسجيل لميت أب، والصفحة تختفي بعدها بأسبوع."],
      ["واجب لفصل دراسي", "الطلبة ينشروا واجب HTML/CSS ويسلّموا رابط، والمدرّس يراجعه في المتصفح."],
      ["معاينة من الـ CI", "كل Pull Request بياخد رابط معاينة للنسخة المبنية، ويتحط كتعليق."],
    ],
    more: "شوف الأمثلة",
  },
  agents: {
    title: "للـ AI agents",
    sub: `ادّي الـ agent بتاعك الكود ده أو وجّهه لـ ${iso("/llms.txt")}. هيضغط الناتج، يرفعه، ويرجعلك الرابط.`,
    llms: "llms.txt",
    openapi: "مواصفات OpenAPI",
  },
  try: {
    title: "جرّب دلوقتي",
    sub: "أي حاجة بترفعها بتبقى متاحة لأي حد معاه الرابط.",
    drop: "اسحب الملفات أو الفولدر أو ملف zip هنا",
    pickFiles: "اختار ملفات",
    pickDir: "اختار فولدر",
    expires: "ينتهي بعد",
    ready: "الرابط جاهز",
    copy: "انسخ الرابط",
    tokenNote:
      "مفتاح التعديل والمسح. محفوظ في المتصفح ده، احتفظ بنسخة لو هتدير الموقع من مكان تاني.",
    mine: "اللي رفعته من المتصفح ده",
    none: "لسه مفيش.",
  },
  limits: {
    title: "الحدود والخصوصية",
    sub: "صغير بقصد، علشان يفضل سريع وصعب يتساء استخدامه.",
    privacyTitle: "الخصوصية",
    privacy: [
      "أي حد معاه الرابط يقدر يشوف الموقع. ماترفعش أسرار أو بيانات شخصية.",
      "مفيش حسابات، ولا cookies للتتبع، ولا تحليلات.",
      "الـ IP بتاعك بيستخدم في الذاكرة بس لحدود الاستخدام، ومش بيتسجّل.",
      "الصفحات المرفوعة بتشتغل جوه sandbox في المتصفح، ومتقدرش توصل للتطبيق ولا لمفتاحك.",
      "المواقع اللي انتهت أو اتمسحت بتتشال من على السيرفر.",
    ],
    limitItems: (l) => [
      `لحد ${iso(l.maxFiles)} ملف، و${iso(`${l.maxFileMb} MB`)} للملف، و${iso(`${l.maxSiteMb} MB`)} للموقع`,
      `الرابط بيعيش ${l.defaultTtl} افتراضيًا، وبحد أقصى ${l.maxTtl}`,
      `${iso(l.uploadsPerHour)} رفعة في الساعة لكل IP`,
      "ملفات ثابتة بس: سكريبتات السيرفر والبرامج التنفيذية مرفوضة",
    ],
  },
  selfhost: {
    title: "شغّل نسختك",
    sub: "container واحد، وفولدر بيانات واحد، ومن غير قاعدة بيانات. ترخيص MIT.",
    cta: "دليل الاستضافة الذاتية",
  },
  directory: {
    title: "منشورات الفرق",
    sub: "صفحات شغالة دلوقتي اختارت الفرق على النسخة دي إنها تشاركها. كل رابط بينتهي لوحده.",
    empty: "مفيش صفحات فرق شغالة دلوقتي. ارجع تاني قريب.",
    expires: "ينتهي",
    pages: (n) =>
      n === 1 ? "صفحة واحدة" : n === 2 ? "صفحتين" : n <= 10 ? `${iso(n)} صفحات` : `${iso(n)} صفحة`,
  },
  admin: {
    title: "الإدارة: الفرق",
    sub: "اعمل فرق، وادّي كل فريق مفتاح خاص بيه، وحدد مين يقدر يستخدم الباك إند (البيانات والملفات) ومين يظهر في الدليل العام.",
    tokenLabel: "مفتاح الأدمن",
    connect: "ادخل",
    signOut: "اخرج",
    teams: "الفرق",
    create: "اعمل فريق",
    name: "اسم الفريق",
    backend: "وصول للباك إند",
    directory: "يظهر في الدليل العام",
    liveSites: "مواقع شغالة",
    key: "المفتاح",
    actions: "إجراءات",
    rotate: "مفتاح جديد",
    del: "امسح",
    none: "مفيش فرق لسه.",
    newKey: "مفتاح الفريق (بيظهر مرة واحدة بس)",
    newKeyNote: `انسخه دلوقتي وادّيه للفريق. أي رفع بالمفتاح ده بيتحسب على الفريق. ${iso(APP_NAME)} بيحفظ الـ hash بتاعه بس.`,
    howTitle: "الفرق بترفع إزاي",
    how: [
      `ابعت مفتاح الفريق مع الرفع في الهيدر ${iso("X-Team-Key: <key>")} (أو ${iso("Authorization: Bearer <key>")}).`,
      "الرفع من غير مفتاح بيفضل رفع ضيف: من غير باك إند، ومش بيظهر في الدليل.",
      `لما تقفل الباك إند لفريق، مواقعه بتتمنع من الـ KV والملفات على طول (${iso("403 BACKEND_NOT_ALLOWED")}).`,
      "لو مسحت فريق، مواقعه بتفضل شغالة كروابط عادية لحد ما تنتهي، إلا لو مسحتها هي كمان.",
    ],
  },
  footer: `${iso(APP_NAME)} مفتوح المصدر (MIT). أي حد معاه الرابط يقدر يشوف المحتوى المرفوع.`,
  docs: {
    title: "الدليل",
    sub: `كل اللي محتاجه علشان تستخدم ${iso(APP_NAME)} من المتصفح أو سكريبت أو AI agent أو الـ CI، وتشغّل نسختك.`,
    englishOnly: "(بالإنجليزي)",
    back: "كل الأدلة",
  },
  notFound: "الرابط ده مش موجود.",
  gone: "الرابط ده انتهت صلاحيته وملفاته اتمسحت.",
  home: "روح للصفحة الرئيسية",
};

export const STRINGS: Record<Lang, Strings> = { en, ar };
