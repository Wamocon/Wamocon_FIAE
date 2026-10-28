import LoginForm from '@/components/auth/LoginForm';
import { normalizeCatalogCode } from '@/lib/catalog/client';
import { normalizeLoginReason } from '@/lib/auth/access-state';

// ?catalog=CODE comes from the selection page /ausbildung. Only a value that
// has the shape of an occupation code is passed on, anything else is ignored.
// ?reason=NAME says why the person was sent back here (not signed in, account
// deactivated). Only the known names are passed on, anything else is ignored.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    catalog?: string | string[];
    reason?: string | string[];
  }>;
}) {
  const { catalog, reason } = await searchParams;
  return (
    <LoginForm
      catalogCode={normalizeCatalogCode(catalog)}
      reason={normalizeLoginReason(reason)}
    />
  );
}
