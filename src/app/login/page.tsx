import LoginForm from '@/components/auth/LoginForm';
import { normalizeCatalogCode } from '@/lib/catalog/client';

// ?catalog=CODE comes from the selection page /ausbildung. Only a value that
// has the shape of an occupation code is passed on, anything else is ignored.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ catalog?: string | string[] }>;
}) {
  const { catalog } = await searchParams;
  return <LoginForm catalogCode={normalizeCatalogCode(catalog)} />;
}
