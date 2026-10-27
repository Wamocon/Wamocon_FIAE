/**
 * The header that carries the admin PIN proof from the browser to the gated
 * routes. Its own file without imports, so the browser can use it (the proof
 * itself is signed and checked on the server only, admin-proof.ts).
 */
export const ADMIN_PROOF_HEADER = 'x-admin-pin-proof';
