// lib/text-normalize.ts
// Shared normalization helpers for matching German real-estate names,
// cities and streets across dedup, fuzzy matching and tenant→asset linking.

// Combining diacritical marks (U+0300–U+036F), left over after NFD decomposition.
const COMBINING_MARKS = new RegExp('[\\u0300-\\u036f]', 'g');

/**
 * Lowercase, expand German umlauts/ß (ä→ae, ß→ss), strip remaining accents,
 * and collapse all punctuation/whitespace runs to single spaces.
 * "Alleestraße 24-26, Bad Soden" → "alleestrasse 24 26 bad soden"
 */
export function normalizeGerman(input: string | null | undefined): string {
  if (!input) return '';
  return String(input)
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Normalize a city name for comparison ("Frankfurt a.M." → "frankfurt a m"). */
export function normalizeCity(input: string | null | undefined): string {
  return normalizeGerman(input);
}

/**
 * Normalize a street for comparison: unify Straße/Strasse/Str. to "str"
 * and drop trailing house numbers ("Alleestraße 24-26" → "alleestr").
 */
export function normalizeStreet(input: string | null | undefined): string {
  let s = normalizeGerman(input);
  if (!s) return '';
  s = s.replace(/strasse\b/g, 'str').replace(/\bstr\b/g, 'str');
  // Drop trailing house numbers (possibly several: "24 26", "24 26a")
  s = s.replace(/(\s+\d+[a-z]?)+$/g, '').trim();
  return s;
}

/**
 * Whole-word containment on already-normalized strings:
 * does `haystack` contain `needle` as a complete word sequence?
 * Avoids substring false positives ("burg" matching "neuburg").
 */
export function containsWords(haystack: string, needle: string): boolean {
  if (!haystack || !needle) return false;
  return ` ${haystack} `.includes(` ${needle} `);
}
