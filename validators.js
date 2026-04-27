// ─── INPUT VALIDATION & ERROR UTILITIES ────────────────────────────────────
// Centralizes all sanitization, validation, and user-facing error messaging.
// Import and use these everywhere instead of inline validation logic.

// ── Constants ───────────────────────────────────────────────────────────────

export const MAX_PRODUCT_NAME_LENGTH = 100;
export const MAX_DISPLAY_NAME_LENGTH = 50;
export const MAX_QUANTITY = 9999;
export const MAX_THRESHOLD = 999;
export const MAX_BARCODE_LENGTH = 30;

// ── String Sanitization ─────────────────────────────────────────────────────

/**
 * Trims whitespace and enforces a character length cap.
 * Always use this before storing any user-typed string.
 */
export const sanitizeText = (value, maxLength = MAX_PRODUCT_NAME_LENGTH) => {
  if (!value || typeof value !== 'string') return '';
  return value.trim().slice(0, maxLength);
};

/**
 * Sanitizes a barcode — only allows alphanumeric characters.
 * Prevents special characters from being injected into API URLs or the DB.
 */
export const sanitizeBarcode = (barcode) => {
  if (!barcode || typeof barcode !== 'string') return null;
  const cleaned = barcode.replace(/[^a-zA-Z0-9]/g, '').slice(0, MAX_BARCODE_LENGTH);
  return cleaned.length > 0 ? cleaned : null;
};

// ── Number Validation ───────────────────────────────────────────────────────

/**
 * Validates and clamps quantity to a safe integer range [0, MAX_QUANTITY].
 * Returns null if the input cannot be parsed as a number.
 */
export const validateQuantity = (value) => {
  const n = parseInt(value, 10);
  if (isNaN(n)) return null;
  return Math.max(0, Math.min(n, MAX_QUANTITY));
};

/**
 * Validates and clamps a low-stock threshold to [0, MAX_THRESHOLD].
 * Returns null (meaning "use the global default") if input is empty or invalid.
 */
export const validateThreshold = (value) => {
  if (value === '' || value === null || value === undefined) return null;
  const n = parseInt(value, 10);
  if (isNaN(n)) return null;
  return Math.max(0, Math.min(n, MAX_THRESHOLD));
};

// ── Date Validation ─────────────────────────────────────────────────────────

/**
 * Accepts expiration dates in MM/DD/YYYY or YYYY-MM-DD format.
 * Returns the trimmed string if valid, null if empty, or false if malformed.
 * Callers should check: if (result === false) show an error to the user.
 */
export const validateExpirationDate = (value) => {
  if (!value || !value.trim()) return null; // Empty is fine — field is optional

  const trimmed = value.trim();
  const mdyPattern = /^\d{2}\/\d{2}\/\d{4}$/;
  const isoDayPattern = /^\d{4}-\d{2}-\d{2}$/;

  if (!mdyPattern.test(trimmed) && !isoDayPattern.test(trimmed)) {
    return false; // Signal a format error to the caller
  }

  // Basic calendar sanity check (won't catch Feb 31, but catches obvious garbage)
  const date = new Date(trimmed);
  if (isNaN(date.getTime())) return false;

  return trimmed;
};

// ── Error Messages ──────────────────────────────────────────────────────────

/**
 * Converts a raw Supabase or network error into a safe, user-friendly string.
 * NEVER pass JSON.stringify(e) or e.message directly to Alert.alert in production —
 * it can leak table names, schema details, and internal stack traces.
 */
export const friendlyError = (e, fallback = 'Something went wrong. Please try again.') => {
  if (!e) return fallback;

  const code = e?.code || e?.error_code || '';
  const status = e?.status || e?.statusCode || 0;
  const message = (e?.message || '').toLowerCase();

  // Network / connectivity
  if (message.includes('network') || message.includes('fetch') || message.includes('failed to fetch')) {
    return 'Network error — check your internet connection and try again.';
  }

  // Supabase RLS / permission errors
  if (status === 403 || code === '42501' || code === 'PGRST301') {
    return 'Permission denied. You may not have access to do that.';
  }

  // Duplicate / conflict
  if (status === 409 || code === '23505') {
    return 'This item already exists.';
  }

  // Not found (e.g. .single() returned no rows)
  if (code === 'PGRST116') {
    return 'Item not found.';
  }

  // Auth errors
  if (status === 401 || code === 'invalid_credentials') {
    return 'Session expired. Please sign in again.';
  }

  // Generic storage error
  if (message.includes('storage') || message.includes('upload')) {
    return 'Image upload failed. Please try again.';
  }

  return fallback;
};