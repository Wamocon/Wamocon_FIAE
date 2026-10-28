/**
 * @jest-environment node
 */
import { readFileSync } from 'fs';
import path from 'path';

// The ingest script is a dry run unless --apply is given: nothing that touches
// the database, the environment file or an embedding model may run before that
// switch (static check of the source, the script itself is not executed here).

const source = readFileSync(
  path.join(process.cwd(), 'scripts', 'hai-learning-techniques.ts'),
  'utf8'
);
const ingestSource = readFileSync(
  path.join(
    process.cwd(),
    'src',
    'lib',
    'hai',
    'learningTechniques',
    'ingest.ts'
  ),
  'utf8'
);

describe('scripts/hai-learning-techniques.ts', () => {
  it('is a dry run by default and reads --apply from the arguments', () => {
    expect(source).toContain("process.argv.includes('--apply')");
    expect(source).toMatch(/if \(!apply\) \{[\s\S]*return;/);
  });

  it('loads the environment and the real dependencies only after the switch', () => {
    const gate = source.indexOf('if (!apply)');
    expect(gate).toBeGreaterThan(0);
    for (const needle of ['dotenv', 'createIngestDeps()', '.env.local']) {
      expect(
        source.indexOf(needle, source.indexOf('async function main'))
      ).toBeGreaterThan(gate);
    }
  });

  it('imports no database or embedding module at the top', () => {
    const imports = source
      .split('\n')
      .filter(line => /^import /.test(line) || /^\} from /.test(line))
      .join('\n');
    expect(imports).not.toMatch(/embeddings|haiDb|providers|dotenv/);
  });

  it('keeps the embeddings module behind a dynamic import in the ingest path', () => {
    expect(ingestSource).toContain("await import('../embeddings')");
    expect(ingestSource).not.toMatch(/^import [^t].*from '\.\.\/embeddings'/m);
  });
});
