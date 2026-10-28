// Cleans the metadata of a PDF that a converter made from a Word file. The converter copies the
// document properties of the Word file (title, author, subject, keywords) into the PDF and writes
// its own name as producer, and the file can carry an XMP packet with the same data. The PDF goes to
// trainees, so the author and everything else that the Word file knew about its history is removed:
// the information dictionary gets the given title and empty values, the XMP packet is dropped.
//
// pdf-lib is already a dependency (it is loaded on first use, so the scripts that do not need it
// start without it).

export interface CleanedPdf {
  bytes: Uint8Array;
  pageCount: number;
}

export async function cleanPdfMetadata(
  bytes: Uint8Array,
  title: string,
  date: Date = new Date()
): Promise<CleanedPdf> {
  const lib = await import('pdf-lib');
  // updateMetadata false: the library does not write its own producer and dates
  const doc = await lib.PDFDocument.load(bytes, { updateMetadata: false });
  doc.setTitle(title);
  doc.setAuthor('');
  doc.setSubject('');
  doc.setKeywords([]);
  doc.setProducer('');
  doc.setCreator('');
  doc.setCreationDate(date);
  doc.setModificationDate(date);
  // The packet is dropped from the catalog AND from the file: an object that nothing points to is
  // still written by pdf-lib, so the stream must be removed from the context too.
  const metadata = doc.catalog.get(lib.PDFName.of('Metadata'));
  doc.catalog.delete(lib.PDFName.of('Metadata'));
  if (metadata instanceof lib.PDFRef) doc.context.delete(metadata);
  return {
    bytes: await doc.save({ useObjectStreams: false }),
    pageCount: doc.getPageCount(),
  };
}
