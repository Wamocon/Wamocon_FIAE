import LoginForm from '@/components/auth/LoginForm';
import { normalizeCatalogCode } from '@/lib/catalog/client';
import { normalizeLoginReason } from '@/lib/auth/access-state';
import { normalizeConfirmNotice } from '@/lib/auth/email-confirmation';

// ?catalog=CODE comes from the selection page /ausbildung. Only a value that
// has the shape of an occupation code is passed on, anything else is ignored.
// ?reason=NAME says why the person was sent back here (not signed in, account
// deactivated). Only the known names are passed on, anything else is ignored.
// ?confirm=NAME is the result of the link of the confirmation e-mail
// (/auth/callback), handled the same way.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    catalog?: string | string[];
    reason?: string | string[];
    confirm?: string | string[];
  }>;
}) {
  const { catalog, reason, confirm } = await searchParams;
  return (
    <LoginForm
      catalogCode={normalizeCatalogCode(catalog)}
      reason={normalizeLoginReason(reason)}
      confirmNotice={normalizeConfirmNotice(confirm)}
    />
  );
}
