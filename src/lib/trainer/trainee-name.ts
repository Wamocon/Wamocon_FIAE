/**
 * The name of a trainee as a person reads it: "Leon Moretz", never
 * "leon moretz" (made from the part of the e-mail address before the @, which
 * is what the calendar showed). First and last name, then the full name, then
 * the e-mail address (with capitals), then the fallback. Pure, no imports.
 */

type NameFields = {
  firstName?: string | null;
  lastName?: string | null;
  full_name?: string | null;
  fullName?: string | null;
  email?: string | null;
};

function capitalizeWords(text: string): string {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toLocaleUpperCase('de') + word.slice(1))
    .join(' ');
}

export function traineeDisplayName(trainee: NameFields, fallback = ''): string {
  const parts = [trainee.firstName, trainee.lastName]
    .map(part => (part ?? '').trim())
    .filter(Boolean)
    .join(' ');
  if (parts) return parts;
  const full = (trainee.full_name ?? trainee.fullName ?? '').trim();
  if (full) return full;
  const email = (trainee.email ?? '').trim();
  if (email) {
    const local = email.split('@')[0].replace(/[._-]+/g, ' ');
    const name = capitalizeWords(local);
    if (name) return name;
  }
  return fallback;
}
