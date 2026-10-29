/**
 * @jest-environment node
 */
import * as fs from 'fs';
import * as path from 'path';

// Static checks of how scripts/reindex-gemini.ts reads the PDF files. The
// bucket content becomes private at the go-live, so a file of that bucket is
// read with the secret key straight from the storage. The script runs its
// main() when it is loaded, so a test cannot import it.

const script = fs
  .readFileSync(
    path.join(process.cwd(), 'scripts', 'reindex-gemini.ts'),
    'utf-8'
  )
  .replace(/\r\n/g, '\n');

const reader = script.slice(
  script.indexOf('async function readPdfBytes'),
  script.indexOf('async function extractPDFText')
);

describe('reindex-gemini.ts: reading a PDF', () => {
  it('decides what a stored address is with the shared strict parser', () => {
    expect(script).toMatch(
      /import \{ parseContentReference \} from '\.\.\/src\/lib\/storage\/contentPath';/
    );
    expect(reader).toMatch(/parseContentReference\(url\)/);
    expect(reader).toMatch(/ref\.kind === 'content'/);
  });

  it('reads the object of the bucket content with the secret key and never follows a redirect', () => {
    expect(reader).toContain('/storage/v1/object/content/${ref.path}');
    expect(reader).toMatch(/redirect: 'error'/);
    expect(reader).toMatch(/Authorization: `Bearer \$\{key\}`/);
  });

  it('keeps the way without a key: the stored address is fetched', () => {
    expect(reader).toMatch(/const response = await fetch\(url\);/);
  });

  it('never writes the key or the address of the request into a message', () => {
    for (const line of reader.split('\n').filter(l => /warn\(|log\(/.test(l))) {
      expect(line).not.toMatch(/\bkey\b/);
      expect(line).not.toMatch(/Bearer/);
    }
  });

  it('extractPDFText takes its bytes from that reader, the call site is unchanged', () => {
    expect(script).toMatch(/const buffer = await readPdfBytes\(url\);/);
    expect(script).toContain('await extractPDFText(doc.storage_url)');
  });
});
