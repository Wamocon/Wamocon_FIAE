import { NextRequest, NextResponse } from 'next/server';
import db from '@/db';
import { and, eq } from 'drizzle-orm';
import {
  lessons,
  modules,
  quizzes,
  subLessons,
} from '@/db/migrations/schemas/schema';
import { isErrorResponse, requireUser } from '@/lib/auth/session';
import {
  allowedCatalogCondition,
  requireCatalogScope,
} from '@/lib/catalog/scope';

declare global {
  // eslint-disable-next-line no-var
  var __breadcrumbLabelCache__: Map<string, string> | undefined;
}

// Only the titles of modules, lessons and sub lessons are cached: they are
// shared learning content without organization or occupation. A quiz title
// depends on the occupation of the caller and is never served from the cache.
const cache = globalThis.__breadcrumbLabelCache__ ?? new Map<string, string>();
if (process.env.NODE_ENV !== 'production') {
  globalThis.__breadcrumbLabelCache__ = cache;
}

// Signed-in users only. The titles of modules, lessons and sub lessons are
// shared content (no organization or occupation column), a quiz title is
// limited to the occupations the caller may use.
export async function GET(req: NextRequest) {
  const session = await requireUser(req);
  if (isErrorResponse(session)) return session;

  try {
    const { searchParams } = new URL(req.url);
    const entity = searchParams.get('entity');
    const id = searchParams.get('id');
    if (!entity || !id) {
      return NextResponse.json(
        { error: 'Missing entity or id' },
        { status: 400 }
      );
    }

    if (entity === 'quiz') {
      const scope = await requireCatalogScope(session, req);
      if (scope instanceof Response) return scope;
      const [q] = await db
        .select({ title: quizzes.title })
        .from(quizzes)
        .where(
          and(
            eq(quizzes.id, id),
            allowedCatalogCondition(quizzes.trainingCatalogId, scope)
          )
        );
      return NextResponse.json({ label: q?.title ?? null });
    }

    const key = `${entity}:${id}`;
    const cached = cache.get(key);
    if (cached !== undefined) {
      return NextResponse.json({ label: cached });
    }

    if (entity === 'module') {
      const [m] = await db
        .select({ title: modules.title })
        .from(modules)
        .where(eq(modules.id, id));
      const label = m?.title ?? null;
      if (label) cache.set(key, label);
      return NextResponse.json({ label });
    }
    if (entity === 'lesson') {
      const [l] = await db
        .select({ title: lessons.title })
        .from(lessons)
        .where(eq(lessons.id, id));
      const label = l?.title ?? null;
      if (label) cache.set(key, label);
      return NextResponse.json({ label });
    }
    if (entity === 'subLesson') {
      const [s] = await db
        .select({ title: subLessons.title })
        .from(subLessons)
        .where(eq(subLessons.id, id));
      const label = s?.title ?? null;
      if (label) cache.set(key, label);
      return NextResponse.json({ label });
    }

    return NextResponse.json({ error: 'Unsupported entity' }, { status: 400 });
  } catch (e) {
    console.error('Breadcrumb label API error', e);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
