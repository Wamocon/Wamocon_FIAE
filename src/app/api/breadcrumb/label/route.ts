import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { eq } from 'drizzle-orm';
import { lessons, modules, quizzes, subLessons } from '@/db/migrations/schemas/schema';

declare global {
  // eslint-disable-next-line no-var
  var __breadcrumbLabelCache__: Map<string, string> | undefined;
}

const cache = globalThis.__breadcrumbLabelCache__ ?? new Map<string, string>();
if (process.env.NODE_ENV !== 'production') {
  globalThis.__breadcrumbLabelCache__ = cache;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const entity = searchParams.get('entity');
    const id = searchParams.get('id');
    if (!entity || !id) {
      return NextResponse.json({ error: 'Missing entity or id' }, { status: 400 });
    }

    const key = `${entity}:${id}`;
    const cached = cache.get(key);
    if (cached !== undefined) {
      return NextResponse.json({ label: cached });
    }

    if (entity === 'module') {
      const [m] = await db.select({ title: modules.title }).from(modules).where(eq(modules.id, id));
      const label = m?.title ?? null;
      if (label) cache.set(key, label);
      return NextResponse.json({ label });
    }
    if (entity === 'lesson') {
      const [l] = await db.select({ title: lessons.title }).from(lessons).where(eq(lessons.id, id));
      const label = l?.title ?? null;
      if (label) cache.set(key, label);
      return NextResponse.json({ label });
    }
    if (entity === 'quiz') {
      const [q] = await db.select({ title: quizzes.title }).from(quizzes).where(eq(quizzes.id, id));
      const label = q?.title ?? null;
      if (label) cache.set(key, label);
      return NextResponse.json({ label });
    }
    if (entity === 'subLesson') {
      const [s] = await db.select({ title: subLessons.title }).from(subLessons).where(eq(subLessons.id, id));
      const label = s?.title ?? null;
      if (label) cache.set(key, label);
      return NextResponse.json({ label });
    }

    return NextResponse.json({ error: 'Unsupported entity' }, { status: 400 });
  } catch (e) {
    console.error('Breadcrumb label API error', e);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
