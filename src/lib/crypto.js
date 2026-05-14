/**
 * ============================================================
 *  AES-256-CBC Encryption Utilities
 * ============================================================
 *  Shared crypto module used by both broker and CLI.
 *  All sensitive data is encrypted before transit/storage.
 * ============================================================
 */

import crypto from 'node:crypto';

const DEFAULT_HEX_KEY = 'b374a26d71590483815c467a99623e1b7db95f269c2889279a32c4530fc4159f';

/**
 * Get the encryption key as a Buffer.
 * Reads from env var SECRET_KEY, falls back to the default dev key.
 */
export function getKey() {
  const hex = process.env.SECRET_KEY || DEFAULT_HEX_KEY;
  return Buffer.from(hex, 'hex');
}

/**
 * Encrypt a plaintext string with AES-256-CBC.
 * @param {string} plaintext
 * @returns {{ iv: string, ciphertext: string }}
 */
export function encrypt(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let enc = cipher.update(plaintext, 'utf8', 'base64');
  enc += cipher.final('base64');
  return {
    iv: iv.toString('hex'),
    ciphertext: enc,
  };
}

/**
 * Decrypt a ciphertext with AES-256-CBC.
 * @param {string} ivHex  — 32-char hex IV
 * @param {string} cipherBase64
 * @returns {string}
 */
export function decrypt(ivHex, cipherBase64) {
  const key = getKey();
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let dec = decipher.update(cipherBase64, 'base64', 'utf8');
  dec += decipher.final('utf8');
  return dec;
}
