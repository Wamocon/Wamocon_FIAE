/**
 * Shapes of the catalog administration API (src/app/api/admin/**) and the
 * mapping of its English error codes to German texts for the admin screens.
 * The API answers { error, code, count? }, the screens show
 * admin.catalogs.error.<code>.
 */

export type CatalogSummary = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  isActive: boolean;
  durationYears: number;
  electivePickCount: number;
  traineeCount: number;
  organizationCount: number;
};

export type OrganizationCatalogEntry = {
  trainingCatalogId: string;
  code: string;
  title: string;
  isActive: boolean;
  isEnabled: boolean;
  traineeCount: number;
};

export type TraineeEnrollmentResponse = {
  enrollment: {
    id: string;
    trainingCatalogId: string;
    code: string;
    title: string;
    startDate: string | null;
    durationYears: number;
  } | null;
  effectiveCatalogId: string;
  isImplicit: boolean;
  changed?: boolean;
  replaced?: number;
};

/** The code of the default occupation, which is never switched off. */
export const DEFAULT_CATALOG_CODE = 'FIAE';

type Translate = (
  key: string,
  data?: Record<string, string | number>
) => string;

/**
 * German message for a failed catalog API call. Known codes get their own
 * text (with the count where the API sends one), everything else the
 * fallback key.
 */
export async function catalogErrorMessage(
  response: Response,
  t: Translate,
  fallbackKey: string
): Promise<string> {
  let data: { code?: unknown; count?: unknown } | null = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (typeof data?.code === 'string') {
    const key = `admin.catalogs.error.${data.code}`;
    const text = t(key, { count: Number(data.count ?? 0) });
    // t() returns the key itself for a code without a translation
    if (text !== key) return text;
  }
  return t(fallbackKey);
}
