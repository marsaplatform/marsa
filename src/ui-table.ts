import type { Lang } from "./i18n.js";
import { csrfField, esc, icon } from "./ui.js";

/**
 * Data tables (0.15.0): one component for every dashboard list. Each row opens its detail
 * page (the first cell holds a real link, so it works with the keyboard and without
 * script; with script the whole row is clickable). An action column has icon buttons and a
 * labelled "more" menu. The toolbar searches, filters, and pages client-side; columns sort.
 * On phones the table turns into cards (see `table.data.stack` in the CSS).
 */
export const DT = {
  en: {
    search: "Search",
    searchPh: "Search…",
    all: "All",
    prev: "Previous",
    next: "Next",
    page: (a: number, b: number) => `Page ${a} of ${b}`,
    rows: (n: number) => (n === 1 ? "1 row" : `${n} rows`),
    shown: (a: number, b: number) => `${a} of ${b}`,
    noMatch: "Nothing matches these filters.",
    clear: "Clear filters",
    more: (label: string) => `More actions: ${label}`,
    open: "Open",
    openNew: "Open in a new tab",
    copy: "Copy URL",
    copied: "Copied",
    actions: "Actions",
    pages: "Pages",
  },
  ar: {
    search: "بحث",
    searchPh: "ابحث…",
    all: "الكل",
    prev: "السابق",
    next: "التالي",
    page: (a: number, b: number) => `صفحة ${a} من ${b}`,
    rows: (n: number) => (n === 1 ? "صف واحد" : `${n} صفوف`),
    shown: (a: number, b: number) => `${a} من ${b}`,
    noMatch: "لا شيء يطابق هذه المرشحات.",
    clear: "امسح المرشحات",
    more: (label: string) => `إجراءات أخرى: ${label}`,
    open: "افتح",
    openNew: "افتح في لسان جديد",
    copy: "انسخ الرابط",
    copied: "تم النسخ",
    actions: "الإجراءات",
    pages: "الصفحات",
  },
};

export interface DtCol {
  label: string;
  sort?: "text" | "num" | "date";
  /** Hidden visually in the header (e.g. the actions column). */
  srOnly?: boolean;
  cls?: string;
}

export interface DtCell {
  html: string;
  /** Sort value (defaults to the cell text). */
  v?: string | number;
  cls?: string;
}

export type DtAction =
  | {
      kind: "link";
      label: string;
      href: string;
      icon?: string;
      external?: boolean;
      primary?: boolean;
    }
  | { kind: "copy"; label: string; value: string; primary?: boolean }
  | {
      kind: "post";
      label: string;
      action: string;
      icon?: string;
      confirm?: string;
      danger?: boolean;
      hidden?: Record<string, string>;
      primary?: boolean;
    };

export interface DtRow {
  /** Accessible name of the row (its title). */
  label: string;
  /** Detail page; the row opens it. */
  href?: string;
  /** First cell (row header) content; defaults to a link with the label. */
  head?: string;
  headV?: string;
  cells: DtCell[];
  actions?: DtAction[];
  /** Values for the toolbar filters: { status: "active", team: "t_1" }. */
  filters?: Record<string, string>;
}

export interface DtFilter {
  key: string;
  label: string;
  options: [string, string][];
  selected?: string;
}

export interface DtOpts {
  lang: Lang;
  id: string;
  caption: string;
  /** Header of the first column (the row title). */
  headLabel: string;
  headSort?: boolean;
  cols: DtCol[];
  rows: DtRow[];
  csrf?: string;
  empty: string;
  filters?: DtFilter[];
  pageSize?: number;
  /** Show the search box (default: more than 5 rows). */
  search?: boolean;
  cls?: string;
}

let menuSeq = 0;

function actionHtml(
  lang: Lang,
  a: DtAction,
  csrf: string,
  rowLabel: string,
  inMenu: boolean,
): string {
  const l = DT[lang];
  const aria = inMenu
    ? ""
    : ` aria-label="${esc(`${a.label}: ${rowLabel}`)}" title="${esc(a.label)}"`;
  const cls = inMenu ? "menu-item" : "icon-btn";
  const body = (ic: string) => (inMenu ? `${icon(ic)}<span>${esc(a.label)}</span>` : icon(ic));
  if (a.kind === "link")
    return `<a class="${cls}" href="${esc(a.href)}"${a.external ? ' target="_blank" rel="noopener"' : ""}${aria}${inMenu ? ' role="menuitem"' : ""}>${body(a.icon ?? (a.external ? "ext" : "open"))}</a>`;
  if (a.kind === "copy")
    return `<button type="button" class="${cls} js-only" data-copy-text="${esc(a.value)}" data-copied="${esc(l.copied)}"${aria}${inMenu ? ' role="menuitem"' : ""}>${body("copy")}</button>`;
  const hidden = Object.entries(a.hidden ?? {})
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join("");
  return `<form method="post" action="${esc(a.action)}" class="menu-form"${a.confirm ? ` data-confirm="${esc(a.confirm)}"` : ""}>${csrfField(csrf)}${hidden}<button type="submit" class="${cls}${a.danger ? " danger" : ""}"${aria}${inMenu ? ' role="menuitem"' : ""}>${body(a.icon ?? (a.danger ? "trash" : "open"))}</button></form>`;
}

/** The action cell: primary icon buttons, then a labelled "more" menu. */
export function actionCell(
  lang: Lang,
  actions: DtAction[],
  csrf: string,
  rowLabel: string,
): string {
  if (!actions.length) return `<td class="cell-actions"></td>`;
  const primary = actions.filter((a) => a.primary);
  const rest = actions.filter((a) => !a.primary);
  const id = `m${++menuSeq}`;
  const menu = rest.length
    ? `<details class="kebab"><summary class="icon-btn" aria-label="${esc(DT[lang].more(rowLabel))}" title="${esc(DT[lang].actions)}">${icon("more")}</summary><div class="kebab-menu" role="menu" id="${id}" aria-label="${esc(DT[lang].more(rowLabel))}">${rest.map((a) => actionHtml(lang, a, csrf, rowLabel, true)).join("")}</div></details>`
    : "";
  return `<td class="cell-actions"><div class="row-acts">${primary.map((a) => actionHtml(lang, a, csrf, rowLabel, false)).join("")}${menu}</div></td>`;
}

export function dataTable(o: DtOpts): string {
  const l = DT[o.lang];
  const csrf = o.csrf ?? "";
  if (!o.rows.length) return `<div class="empty-state small"><p>${esc(o.empty)}</p></div>`;
  const hasActions = o.rows.some((r) => r.actions?.length);
  const search = o.search ?? o.rows.length > 5;
  const filters = (o.filters ?? []).filter((f) => f.options.length > 1);
  const tools =
    search || filters.length
      ? `<div class="dt-tools js-only-block" data-dt-tools="${esc(o.id)}">${
          search
            ? `<label class="search-field"><span class="sr-only">${esc(l.search)}</span><input type="search" data-dt-q placeholder="${esc(l.searchPh)}" autocomplete="off" aria-controls="${esc(o.id)}"></label>`
            : ""
        }${filters
          .map(
            (f) =>
              `<label class="dt-filter">${icon("filter")}<span class="sr-only">${esc(f.label)}</span><select data-dt-f="${esc(f.key)}" aria-label="${esc(f.label)}" aria-controls="${esc(o.id)}"><option value="">${esc(`${f.label}: ${l.all}`)}</option>${f.options
                .map(
                  ([v, lab]) =>
                    `<option value="${esc(v)}"${f.selected === v ? " selected" : ""}>${esc(lab)}</option>`,
                )
                .join("")}</select></label>`,
          )
          .join(
            "",
          )}<span class="meta dt-count" data-dt-count aria-live="polite">${esc(l.rows(o.rows.length))}</span></div>`
      : "";
  const head = `<thead><tr><th scope="col"${o.headSort === false ? "" : ' data-sort="text"'}>${esc(o.headLabel)}</th>${o.cols
    .map(
      (c) =>
        `<th scope="col"${c.sort ? ` data-sort="${c.sort}"` : ""}${c.cls ? ` class="${c.cls}"` : ""}>${c.srOnly ? `<span class="sr-only">${esc(c.label)}</span>` : esc(c.label)}</th>`,
    )
    .join(
      "",
    )}${hasActions ? `<th scope="col" class="col-actions"><span class="sr-only">${esc(l.actions)}</span></th>` : ""}</tr></thead>`;
  const body = o.rows
    .map((r) => {
      const f = Object.entries(r.filters ?? {})
        .map(([k, v]) => ` data-f-${esc(k)}="${esc(v)}"`)
        .join("");
      const first =
        r.head ??
        (r.href
          ? `<a class="row-link" href="${esc(r.href)}"><bdi>${esc(r.label)}</bdi></a>`
          : `<bdi>${esc(r.label)}</bdi>`);
      const cells = r.cells
        .map(
          (c, i) =>
            `<td data-label="${esc(o.cols[i]?.label ?? "")}"${c.v !== undefined ? ` data-v="${esc(String(c.v))}"` : ""}${c.cls ? ` class="${c.cls}"` : ""}>${c.html}</td>`,
        )
        .join("");
      return `<tr${r.href ? ` data-href="${esc(r.href)}"` : ""}${f}><th scope="row" data-v="${esc((r.headV ?? r.label).toLowerCase())}">${first}</th>${cells}${hasActions ? actionCell(o.lang, r.actions ?? [], csrf, r.label) : ""}</tr>`;
    })
    .join("");
  const pager = `<nav class="dt-pager" data-dt-pager="${esc(o.id)}" aria-label="${esc(l.pages)}" hidden><button type="button" class="button small ghost" data-dt-prev>${esc(l.prev)}</button><span class="meta" data-dt-page aria-live="polite"></span><button type="button" class="button small ghost" data-dt-next>${esc(l.next)}</button></nav>`;
  return `${tools}<div class="table-wrap"><table class="data stack dt${o.cls ? ` ${o.cls}` : ""}" id="${esc(o.id)}" data-dt data-page-size="${o.pageSize ?? 25}" data-l-page="${esc(l.page(0, 0).replace(/\d+/g, "#"))}">
<caption class="sr-only">${esc(o.caption)}</caption>${head}<tbody>${body}</tbody></table></div><div class="dt-none" data-dt-none="${esc(o.id)}" hidden><p class="meta">${esc(l.noMatch)}</p></div>${pager}`;
}

/** Tabs for a detail page: plain links, the current one marked. */
export function tabsNav(
  label: string,
  tabs: { key: string; label: string; href: string; count?: number | string }[],
  current: string,
): string {
  return `<nav class="tabs" aria-label="${esc(label)}"><ul>${tabs
    .map(
      (t) =>
        `<li><a href="${esc(t.href)}"${t.key === current ? ' aria-current="page"' : ""}>${esc(t.label)}${t.count !== undefined && t.count !== "" ? ` <span class="tab-count">${esc(String(t.count))}</span>` : ""}</a></li>`,
    )
    .join("")}</ul></nav>`;
}

/** A status badge with a fixed set of tones. */
export function badge(
  text: string,
  tone: "on" | "off" | "warn" | "err" | "muted" | "info" = "muted",
): string {
  return `<span class="badge ${tone}">${esc(text)}</span>`;
}

/** Relative time element (the page script turns it into "3 days ago"). */
export function relTime(iso: string | null | undefined, lang: Lang): string {
  if (!iso) return `<span class="meta">—</span>`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return `<span class="meta">—</span>`;
  const text = new Intl.DateTimeFormat(lang === "ar" ? "ar-EG" : "en-GB", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(d);
  return `<time datetime="${esc(d.toISOString())}" data-rel>${esc(text)}</time>`;
}
