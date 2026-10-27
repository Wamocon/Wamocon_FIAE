// Filter, sort and paging of the review list (docs/ki-upload-konzept.md 7.2) and the
// reading of the query string of the route. Pure functions over the rows of a run,
// so the same logic is tried in the unit tests and used by the route.

import {
  BAND_FILTERS,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  SORTS,
  STATUS_FILTERS,
  STOCK_FILTERS,
  type ReviewFacets,
  type ReviewFilter,
  type ReviewPage,
  type ReviewRowDto,
  type SortKey,
  type StatusFilter,
  type StockFilter,
} from '@/lib/content-upload/review/types';
import type { ProposalBand } from '@/lib/content-upload/classify/types';
import {
  DECIDABLE,
  isLeftOut,
  isProblem,
} from '@/lib/content-upload/review/states';

const MAX_QUERY_CHARS = 100;
const CODE_PATTERN = /^[A-Za-z0-9._-]{1,32}$/;

/** Order of the bands for the sort: what needs a look comes first. */
const BAND_ORDER: Record<ProposalBand | 'none', number> = {
  conflict: 0,
  low: 1,
  medium: 2,
  high: 3,
  none: 4,
};

function bandOf(row: ReviewRowDto): ProposalBand | 'none' {
  return row.proposal?.band ?? 'none';
}

/** Whether a row passes the status filter. */
export function matchesStatus(
  row: ReviewRowDto,
  status: StatusFilter
): boolean {
  switch (status) {
    case 'all':
      return true;
    case 'open':
      return row.decision === null && DECIDABLE.includes(row.status);
    case 'accepted':
      return row.decision?.action === 'accept';
    case 'rejected':
      return row.decision?.action === 'reject';
    case 'deferred':
      return row.decision?.action === 'defer';
    case 'problems':
      return isProblem(row.status);
    case 'skipped':
      return isLeftOut(row.status);
  }
}

/** The status of the supply a filter sees: a stale or missing comparison counts as none. */
export function stockKeyOf(row: ReviewRowDto): StockFilter {
  return row.stock && !row.stock.stale ? row.stock.status : 'none';
}

/** `none` only concerns files that can be compared (a failed file has no status of the supply). */
function matchesStock(row: ReviewRowDto, stock: StockFilter): boolean {
  if (stock === 'none' && !DECIDABLE.includes(row.status)) return false;
  return stockKeyOf(row) === stock;
}

function matchesQuery(row: ReviewRowDto, query: string): boolean {
  const needle = query.toLowerCase();
  return (
    row.fileName.toLowerCase().includes(needle) ||
    row.relPath.toLowerCase().includes(needle)
  );
}

/** The rows that pass every part of the filter (the page and sort are not applied). */
export function filterRows(
  rows: readonly ReviewRowDto[],
  filter: ReviewFilter
): ReviewRowDto[] {
  const query = filter.query?.trim() ?? '';
  return rows.filter(row => {
    if (
      filter.band &&
      (row.proposal?.band !== filter.band || isLeftOut(row.status))
    ) {
      return false;
    }
    if (filter.docType && row.effective.docType !== filter.docType)
      return false;
    if (filter.component && row.effective.componentCode !== filter.component)
      return false;
    if (filter.status && !matchesStatus(row, filter.status)) return false;
    if (filter.stock && !matchesStock(row, filter.stock)) return false;
    if (filter.duplicates && row.duplicate === null) return false;
    if (query && !matchesQuery(row, query)) return false;
    return true;
  });
}

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function sortRows(
  rows: readonly ReviewRowDto[],
  sort: SortKey = 'path'
): ReviewRowDto[] {
  const copy = [...rows];
  const tie = (a: ReviewRowDto, b: ReviewRowDto) =>
    byText(a.relPath, b.relPath) || byText(a.id, b.id);
  copy.sort((a, b) => {
    switch (sort) {
      case 'name':
        return (
          byText(a.fileName.toLowerCase(), b.fileName.toLowerCase()) ||
          tie(a, b)
        );
      case 'band':
        return BAND_ORDER[bandOf(a)] - BAND_ORDER[bandOf(b)] || tie(a, b);
      case 'status':
        return byText(a.status, b.status) || tie(a, b);
      default:
        return tie(a, b);
    }
  });
  return copy;
}

/** Filter, sort and cut one page. A page past the end is the last page. */
export function pageRows(
  rows: readonly ReviewRowDto[],
  filter: ReviewFilter
): ReviewPage {
  const matching = sortRows(filterRows(rows, filter), filter.sort);
  const pageSize = clampInt(
    filter.pageSize,
    1,
    MAX_PAGE_SIZE,
    DEFAULT_PAGE_SIZE
  );
  const pages = Math.max(1, Math.ceil(matching.length / pageSize));
  const page = Math.min(
    pages,
    clampInt(filter.page, 1, Number.MAX_SAFE_INTEGER, 1)
  );
  return {
    rows: matching.slice((page - 1) * pageSize, page * pageSize),
    matching: matching.length,
    page,
    pageSize,
    pages,
  };
}

/** The values of the filters that exist in the run (for the selects). */
export function facetsOf(rows: readonly ReviewRowDto[]): ReviewFacets {
  const components = new Set<string>();
  const docTypes = new Set<string>();
  for (const row of rows) {
    if (row.effective.componentCode)
      components.add(row.effective.componentCode);
    if (row.effective.docType) docTypes.add(row.effective.docType);
  }
  const componentNumber = (code: string) => {
    const m = /^K(\d+)(?:\.(\d+))?$/.exec(code);
    return m ? Number(m[1]) * 100 + Number(m[2] ?? 0) : Number.MAX_SAFE_INTEGER;
  };
  return {
    components: [...components].sort(
      (a, b) => componentNumber(a) - componentNumber(b) || byText(a, b)
    ),
    docTypes: [...docTypes].sort(),
  };
}

function clampInt(
  value: unknown,
  min: number,
  max: number,
  fallback: number
): number {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * The filter of a query string. A value that is not one of the known ones is
 * ignored (it filters nothing), never passed on: the codes are matched against a
 * strict pattern, the text is cut.
 */
export function parseFilter(params: URLSearchParams): ReviewFilter {
  const filter: ReviewFilter = {};
  const band = params.get('band');
  if (band && (BAND_FILTERS as readonly string[]).includes(band)) {
    filter.band = band as ProposalBand;
  }
  const docType = params.get('type');
  if (docType && CODE_PATTERN.test(docType)) filter.docType = docType;
  const component = params.get('component');
  if (component && CODE_PATTERN.test(component)) filter.component = component;
  const status = params.get('status');
  if (status && (STATUS_FILTERS as readonly string[]).includes(status)) {
    filter.status = status as StatusFilter;
  }
  const stock = params.get('stock');
  if (stock && (STOCK_FILTERS as readonly string[]).includes(stock)) {
    filter.stock = stock as StockFilter;
  }
  if (params.get('duplicates') === '1') filter.duplicates = true;
  const query = params.get('q');
  if (query) {
    // eslint-disable-next-line no-control-regex
    const cleaned = query.replace(/[\u0000-\u001f\u007f]/g, '').trim();
    if (cleaned) filter.query = cleaned.slice(0, MAX_QUERY_CHARS);
  }
  const sort = params.get('sort');
  if (sort && (SORTS as readonly string[]).includes(sort)) {
    filter.sort = sort as SortKey;
  }
  const page = params.get('page');
  if (page !== null)
    filter.page = clampInt(page, 1, Number.MAX_SAFE_INTEGER, 1);
  const pageSize = params.get('pageSize');
  if (pageSize !== null) {
    filter.pageSize = clampInt(pageSize, 1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE);
  }
  return filter;
}

/** The query string for a filter (the page of the browser builds its calls with it). */
export function filterToParams(filter: ReviewFilter): URLSearchParams {
  const params = new URLSearchParams();
  if (filter.band) params.set('band', filter.band);
  if (filter.docType) params.set('type', filter.docType);
  if (filter.component) params.set('component', filter.component);
  if (filter.status && filter.status !== 'all')
    params.set('status', filter.status);
  if (filter.stock) params.set('stock', filter.stock);
  if (filter.duplicates) params.set('duplicates', '1');
  if (filter.query?.trim()) params.set('q', filter.query.trim());
  if (filter.sort && filter.sort !== 'path') params.set('sort', filter.sort);
  if (filter.page && filter.page > 1) params.set('page', String(filter.page));
  if (filter.pageSize && filter.pageSize !== DEFAULT_PAGE_SIZE)
    params.set('pageSize', String(filter.pageSize));
  return params;
}
