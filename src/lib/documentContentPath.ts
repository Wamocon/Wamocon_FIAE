/**
 * The routes that deliver a learning document to the viewer of a trainee.
 *
 * A trainee page holds no address of a file, only the identifier of the
 * document. The viewer (SecurePdfViewer) asks the route of that identifier with
 * the session of the app. The routes decide who may read (see
 * docs/dokumentschutz.md).
 */

/** A document of a row in content_documents (theory, scenario, use case task). */
export const traineeDocumentPath = (documentId: string): string =>
  `/api/trainee/documents/${encodeURIComponent(documentId)}/content`;

/** The single scenario PDF that an enabler carries itself (no document row). */
export const traineeScenarioPath = (enablerId: string): string =>
  `/api/trainee/enablers/${encodeURIComponent(enablerId)}/scenario/content`;
