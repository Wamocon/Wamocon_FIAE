// Scan of the raw bytes of a PDF, before any parser sees the file
// (docs/ki-upload-konzept.md, 5.2). Pure: no parser, no file system, no network.
//
// The scan reads the names of the PDF syntax (/JavaScript, /Launch, ...) and
// reports the marks of active content and of encryption as findings. Names may
// be written with hex escapes (/J#61vaScript), so every name is decoded before
// it is compared. The scan is a hint, not a proof: PDF 1.5 can keep objects in
// compressed object streams, which a scan of the bytes cannot see into. That is
// reported as OBJECT_STREAMS. Nothing in a PDF is ever executed or opened, the
// text is read by the reader in its own thread (pdf-worker.ts).

import { finding, type Finding } from './findings';
import { READ_LIMITS } from './limits';

export interface PdfScanResult {
  findings: Finding[];
  /** Pages counted in the plain objects, 0 when they are in object streams. */
  estimatedPages: number;
}

export interface PdfScanOptions {
  maxInputBytes?: number;
}

type Entry = [code: string, severity: Finding['severity'], message: string];

/** Names of the PDF syntax and what they mean. */
const NAMES: Record<string, Entry> = {
  Encrypt: ['ENCRYPTED', 'blocking', 'The PDF is encrypted.'],
  JavaScript: [
    'JAVASCRIPT',
    'warning',
    'The PDF holds JavaScript. It is never run.',
  ],
  JS: ['JAVASCRIPT', 'warning', 'The PDF holds JavaScript. It is never run.'],
  Launch: [
    'LAUNCH',
    'warning',
    'The PDF holds a launch action. It is never run.',
  ],
  URI: [
    'URI_ACTION',
    'warning',
    'The PDF holds an address action. It is never opened.',
  ],
  OpenAction: [
    'OPEN_ACTION',
    'warning',
    'The PDF holds an action that runs on opening.',
  ],
  AA: [
    'OPEN_ACTION',
    'warning',
    'The PDF holds an action that runs on opening.',
  ],
  EmbeddedFile: ['EMBEDDED_FILE', 'warning', 'The PDF holds an embedded file.'],
  SubmitForm: [
    'SUBMIT_FORM',
    'warning',
    'The PDF holds a form that submits data.',
  ],
  GoToR: ['REMOTE_GOTO', 'warning', 'The PDF points into another file.'],
  GoToE: ['REMOTE_GOTO', 'warning', 'The PDF points into another file.'],
  RichMedia: ['RICH_MEDIA', 'warning', 'The PDF holds rich media.'],
  Movie: ['RICH_MEDIA', 'warning', 'The PDF holds rich media.'],
  XFA: ['XFA', 'warning', 'The PDF holds an XFA form.'],
  AcroForm: ['ACRO_FORM', 'info', 'The PDF has a form.'],
  ObjStm: [
    'OBJECT_STREAMS',
    'info',
    'The PDF keeps objects in compressed streams, the scan cannot look into them.',
  ],
};

/** A name: up to 64 characters after the slash, up to the next delimiter. */
const NAME = /\/([^\x00-\x20()<>[\]{}/%]{1,64})/g;
const HEX_ESCAPE = /#([0-9A-Fa-f]{2})/g;

/** Scans the bytes of a PDF. Never throws. */
export function scanPdf(
  bytes: Uint8Array,
  options: PdfScanOptions = {}
): PdfScanResult {
  const maxInputBytes = options.maxInputBytes ?? READ_LIMITS.maxInputBytes;
  if (bytes.length > maxInputBytes) {
    return {
      findings: [
        finding('TOO_LARGE', 'blocking', 'The file is larger than the limit.'),
      ],
      estimatedPages: 0,
    };
  }
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length);
  // The header may stand up to 1024 bytes after the start of the file.
  if (!buffer.subarray(0, 1024 + 5).includes('%PDF-', 0, 'latin1')) {
    return {
      findings: [finding('NOT_A_PDF', 'blocking', 'The file is not a PDF.')],
      estimatedPages: 0,
    };
  }

  const text = buffer.toString('latin1');
  const counts = new Map<string, { entry: Entry; count: number }>();
  let pages = 0;
  let previous = '';
  NAME.lastIndex = 0;
  for (let match = NAME.exec(text); match; match = NAME.exec(text)) {
    const name = match[1].includes('#')
      ? match[1].replace(HEX_ESCAPE, (_all, hex) =>
          String.fromCharCode(parseInt(hex, 16))
        )
      : match[1];
    if (name === 'Page' && previous === 'Type') pages += 1;
    previous = name;
    // hasOwn: a name like "constructor" must not find a member of Object
    if (!Object.prototype.hasOwnProperty.call(NAMES, name)) continue;
    const entry = NAMES[name];
    const known = counts.get(entry[0]);
    if (known) known.count += 1;
    else counts.set(entry[0], { entry, count: 1 });
  }
  const findings = [...counts.values()].map(({ entry, count }) =>
    finding(entry[0], entry[1], entry[2], count)
  );
  return { findings, estimatedPages: pages };
}
