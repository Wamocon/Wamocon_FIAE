# Repository Guidelines

## Project Structure & Module Organization

This is a Next.js 15 TypeScript learning platform. Application routes and API
handlers live in `src/app`, shared UI in `src/components`, reusable business
logic in `src/lib`, React contexts in `src/contexts`, and database access plus
migrations in `src/db`. Tests are organized under `tests/unit` and
`tests/integration/api`, with shared mocks in `tests/helpers`. Static assets and
import templates belong in `public`; operational scripts belong in `scripts`;
Supabase local configuration is in `supabase`; longer design or rollout notes go
in `docs`.

## Build, Test, and Development Commands

- `npm run dev`: start the local Next.js development server.
- `npm run build`: create a production build and catch build-time issues.
- `npm run start`: run the built app.
- `npm run lint` / `npm run lint:fix`: check or auto-fix Next.js ESLint issues.
- `npm run type-check`: run `tsc --noEmit`.
- `npm test`: run Jest tests once.
- `npm run test:coverage`: run Jest with coverage thresholds.
- `npm run supabase:start`: start the local Supabase stack.
- `npm run migrate:generate` and `npm run migrate:push-local`: create and apply
  Drizzle schema changes locally.

## Coding Style & Naming Conventions

Use TypeScript, React functional components, and the `@/` alias for imports from
`src`. Prettier enforces 2-space indentation, semicolons, single quotes,
80-column wrapping, and Tailwind class ordering. ESLint extends
`next/core-web-vitals` and `next/typescript`; do not bypass lint errors without a
clear reason. Name components in PascalCase, hooks as `useSomething`, route files
as `page.tsx` or `route.ts`, and tests as `*.test.ts` or `*.test.tsx`.

## Testing Guidelines

Jest uses `ts-jest`, `jsdom`, and `jest.setup.ts`. Put UI and utility coverage in
`tests/unit`, and API route behavior in `tests/integration/api`. Reuse
`tests/helpers/mockDb.ts` and `tests/helpers/mockNext.ts` for stable mocks.
Coverage is collected for selected critical modules and currently requires 100%
global line and function coverage for that configured set, so update tests when
touching those paths.

## Commit & Pull Request Guidelines

Recent history uses short, conventional-style subjects such as `feat: ...`,
`refactor: ...`, and `bug fix: ...`. Keep commit messages imperative and scoped
to one change. Pull requests should include a brief summary, linked issue or
task, test results, screenshots for UI changes, and notes for migrations,
environment variables, deployment scripts, or Supabase changes.

## Security & Configuration Tips

Keep secrets in `.env.local` and never commit them. Review changes to
`drizzle.config.ts`, `supabase/config.toml`, deployment scripts, and data import
scripts carefully because they can affect hosted data or production behavior.
