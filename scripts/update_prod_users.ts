import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

type TargetUser = {
  email: string;
  password: string;
  role: 'TRAINER' | 'TRAINEE';
};

const targets: TargetUser[] = [
  { email: 'trainer1@gmail.com', password: '123123123', role: 'TRAINER' },
  { email: 'trainer2@gmail.com', password: '123123123', role: 'TRAINER' },
  { email: 'trainee1@gmail.com', password: '123123123', role: 'TRAINEE' },
  { email: 'trainee2@gmail.com', password: '123123123', role: 'TRAINEE' },
  { email: 'trainee3@gmail.com', password: '123123123', role: 'TRAINEE' },
];

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'
  );
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const normalizeEmail = (email: string | null | undefined) =>
  String(email || '')
    .trim()
    .toLowerCase();

const sortByLastSignIn = (
  a: { last_sign_in_at: string | null },
  b: { last_sign_in_at: string | null }
) => {
  const aTime = a.last_sign_in_at ? new Date(a.last_sign_in_at).getTime() : 0;
  const bTime = b.last_sign_in_at ? new Date(b.last_sign_in_at).getTime() : 0;
  return bTime - aTime;
};

async function listAllUsers() {
  const users: any[] = [];
  let page = 1;
  const perPage = 1000;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < perPage) break;
    page += 1;
  }

  return users;
}

async function updateProfiles(
  userId: string,
  email: string,
  role: TargetUser['role']
) {
  const { error } = await supabase
    .from('profiles')
    .update({ email, role })
    .eq('id', userId);

  if (error) throw error;
}

async function run() {
  const users = await listAllUsers();
  if (users.length < targets.length) {
    throw new Error(
      `Not enough users (${users.length}) to remap to ${targets.length} targets.`
    );
  }

  const sorted = [...users].sort(sortByLastSignIn);
  const keepUsers = sorted.slice(0, targets.length);
  const keepIds = new Set(keepUsers.map(user => user.id));

  const targetEmails = new Set(
    targets.map(target => normalizeEmail(target.email))
  );
  const conflictingUsers = users.filter(
    user =>
      targetEmails.has(normalizeEmail(user.email)) && !keepIds.has(user.id)
  );

  for (const user of conflictingUsers) {
    const { error } = await supabase.auth.admin.deleteUser(user.id);
    if (error) throw error;
    console.log(`Deleted conflicting user ${user.id} (${user.email})`);
  }

  const keepUsersByEmail = new Map<string, any>();
  for (const user of keepUsers) {
    const emailKey = normalizeEmail(user.email);
    if (emailKey) keepUsersByEmail.set(emailKey, user);
  }

  const assignedTargets = new Map<string, TargetUser>();
  const remainingTargets: TargetUser[] = [];

  for (const target of targets) {
    const matchedUser = keepUsersByEmail.get(normalizeEmail(target.email));
    if (matchedUser) {
      assignedTargets.set(matchedUser.id, target);
    } else {
      remainingTargets.push(target);
    }
  }

  const remainingUsers = keepUsers.filter(
    user => !assignedTargets.has(user.id)
  );
  for (let i = 0; i < remainingTargets.length; i += 1) {
    const user = remainingUsers[i];
    if (!user) throw new Error('Not enough users to assign targets.');
    assignedTargets.set(user.id, remainingTargets[i]);
  }

  for (const user of keepUsers) {
    const target = assignedTargets.get(user.id);
    if (!target) throw new Error(`Missing target for user ${user.id}`);

    const { error } = await supabase.auth.admin.updateUserById(user.id, {
      email: target.email,
      password: target.password,
      email_confirm: true,
    });

    if (error) {
      console.error(
        `Failed to update user ${user.id} -> ${target.email}:`,
        error
      );
      throw error;
    }

    await updateProfiles(user.id, target.email, target.role);

    console.log(`Updated user ${user.id} -> ${target.email} (${target.role})`);
  }

  const deleteUsers = users.filter(user => !keepIds.has(user.id));
  const deleteFailures: Array<{ id: string; email: string | null }> = [];

  for (const user of deleteUsers) {
    const { error } = await supabase.auth.admin.deleteUser(user.id);
    if (error) {
      console.error(`Failed to delete user ${user.id} (${user.email}):`, error);
      deleteFailures.push({ id: user.id, email: user.email || null });
      continue;
    }
    console.log(`Deleted user ${user.id}`);
  }

  console.log(
    `Done. Kept ${keepUsers.length} users, deleted ${deleteUsers.length - deleteFailures.length}.`
  );

  if (deleteFailures.length > 0) {
    console.error('Users not deleted:', deleteFailures);
    process.exit(1);
  }
}

run().catch(error => {
  console.error('Failed to update users:', error);
  process.exit(1);
});
