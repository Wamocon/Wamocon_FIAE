// Builds small invented .xlsx files for the tests of the learning field import.
// Nothing here is taken from a real source file.
import JSZip from 'jszip';

export interface FixtureRow {
  /** Sheet row number, as the file stores it. */
  row: number;
  /** Cells by column letter. A string is stored as shared string. */
  cells: Record<string, string | number | { inline: string } | null>;
}

const escapeXml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Escapes a control character the way a spreadsheet does (_x0002_). */
const escapeControl = (text: string) =>
  text.replace(
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,
    ch => `_x${ch.charCodeAt(0).toString(16).padStart(4, '0')}_`
  );

export interface FixtureSheet {
  name: string;
  rows: FixtureRow[];
}

export interface FixtureOptions {
  /** Shared strings written as rich text with a phonetic run. */
  richText?: boolean;
  /** Write the sheets with an absolute relationship target. */
  absoluteTargets?: boolean;
  /** Leave out xl/sharedStrings.xml (a file with inline strings only). */
  noSharedStrings?: boolean;
}

export async function makeXlsx(
  sheets: FixtureSheet[],
  options: FixtureOptions = {}
): Promise<Buffer> {
  const shared: string[] = [];
  const indexOf = (text: string) => {
    const at = shared.indexOf(text);
    if (at >= 0) return at;
    shared.push(text);
    return shared.length - 1;
  };
  const zip = new JSZip();
  const sheetXml = sheets.map(sheet => {
    const rows = sheet.rows
      .map(({ row, cells }) => {
        const body = Object.entries(cells)
          .map(([column, value]) => {
            const ref = `${column}${row}`;
            if (value === null) return `<c r="${ref}" s="3"/>`;
            if (typeof value === 'number') {
              return `<c r="${ref}"><v>${value}</v></c>`;
            }
            if (typeof value === 'object') {
              return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(
                escapeControl(value.inline)
              )}</t></is></c>`;
            }
            return `<c r="${ref}" t="s"><v>${indexOf(value)}</v></c>`;
          })
          .join('');
        return `<row r="${row}">${body}</row>`;
      })
      .join('');
    return `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1"/><sheetData>${rows}</sheetData></worksheet>`;
  });
  sheetXml.forEach((xml, i) =>
    zip.file(`xl/worksheets/sheet${i + 1}.xml`, xml)
  );
  zip.file(
    'xl/workbook.xml',
    `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
      .map(
        (sheet, i) =>
          `<sheet name="${escapeXml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`
      )
      .join('')}</sheets></workbook>`
  );
  zip.file(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
      .map(
        (_sheet, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${
            options.absoluteTargets ? '/xl/' : ''
          }worksheets/sheet${i + 1}.xml"/>`
      )
      .join('')}</Relationships>`
  );
  if (!options.noSharedStrings) {
    const items = shared
      .map(text => {
        const escaped = escapeXml(escapeControl(text));
        return options.richText
          ? `<si><r><t xml:space="preserve">${escaped.slice(0, 2)}</t></r><r><t xml:space="preserve">${escaped.slice(2)}</t></r><rPh sb="0" eb="1"><t>PHONETIK</t></rPh></si>`
          : `<si><t xml:space="preserve">${escaped}</t></si>`;
      })
      .join('');
    zip.file(
      'xl/sharedStrings.xml',
      `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">${items}</sst>`
    );
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}
