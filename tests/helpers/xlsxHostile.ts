// Invented hostile and wrong .xlsx files for the tests of the Excel upload (package UP2).
// Everything is built here from a small valid workbook; nothing comes from a real file.
import JSZip from 'jszip';

import { makeXlsx } from './xlsxFixture';
import { sampleRows } from '../unit/content-import/learning-fields/fixtures';

/** The sample mapping table as a valid workbook with one sheet "Zuordnung". */
export async function validMapping(): Promise<Buffer> {
  return makeXlsx([
    {
      name: 'Zuordnung',
      rows: sampleRows().map(r => ({ row: r.row, cells: r.cells })),
    },
  ]);
}

/** The workbook after a change of its zip (add or replace entries, or edit a text). */
export async function changed(
  source: Buffer,
  change: (zip: JSZip) => void | Promise<void>,
  compression: 'DEFLATE' | 'STORE' = 'DEFLATE'
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(source);
  await change(zip);
  return zip.generateAsync({ type: 'nodebuffer', compression });
}

export const withEntry = (source: Buffer, name: string, content: string) =>
  changed(source, zip => {
    zip.file(name, content);
  });

export async function editText(
  source: Buffer,
  name: string,
  edit: (text: string) => string
): Promise<Buffer> {
  return changed(source, async zip => {
    const file = zip.file(name);
    if (!file) throw new Error(`${name} is missing in the fixture`);
    zip.file(name, edit(await file.async('string')));
  });
}

/** Sets the encryption bit of every entry in the central directory. */
export function markEncrypted(bytes: Buffer): Buffer {
  const copy = Buffer.from(bytes);
  for (let at = 0; at + 46 <= copy.length; at += 1) {
    if (copy.readUInt32LE(at) === 0x02014b50) {
      copy.writeUInt16LE(copy.readUInt16LE(at + 8) | 1, at + 8);
    }
  }
  return copy;
}

/**
 * A workbook with one entry of `megabytes` of zeros under the name of a sheet part. It
 * packs to a few kilobytes: the ratio and the declared size are what gives it away.
 */
export async function zeroBomb(
  source: Buffer,
  megabytes: number,
  name = 'xl/worksheets/bomb.xml'
): Promise<Buffer> {
  return changed(source, zip => {
    zip.file(name, Buffer.alloc(megabytes * 1024 * 1024, 0x20));
  });
}

/** Writes a smaller number into the "uncompressed size" of every entry of the directory. */
export function lieAboutSize(bytes: Buffer, size: number): Buffer {
  const copy = Buffer.from(bytes);
  for (let at = 0; at + 46 <= copy.length; at += 1) {
    if (copy.readUInt32LE(at) === 0x02014b50) {
      copy.writeUInt32LE(size, at + 24);
    }
  }
  return copy;
}

export const sheetPart = 'xl/worksheets/sheet1.xml';
