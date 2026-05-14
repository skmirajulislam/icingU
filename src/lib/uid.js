/**
 * ============================================================
 *  Session UID Generator
 * ============================================================
 *  Generates cryptographically random 8-character UIDs.
 *  NOT based on hardware/MAC — purely random per-session,
 *  so the "door" closes permanently when the session ends.
 * ============================================================
 */

import { customAlphabet } from 'nanoid';

// Use lowercase alphanumeric only — easy to share verbally
const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
const generate = customAlphabet(alphabet, 8);

/**
 * Generate a random 8-character session UID.
 * @returns {string}
 */
export function generateUID() {
  return generate();
}
