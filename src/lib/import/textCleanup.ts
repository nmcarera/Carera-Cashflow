/**
 * Best-effort description cleanup shared by adapters whose source
 * descriptions are dense, fixed-width-padded free text (ABN AMRO's SEPA
 * remittance lines are the primary case). This never invents information —
 * it only reformats and, where a clear label like "Naam:" is present,
 * extracts a merchant name. The original, unmodified description is always
 * preserved separately (`originalDescription`) regardless of what this
 * produces.
 */

/** Collapses runs of whitespace (ABN AMRO pads fields to fixed width with
 *  spaces) into single spaces and trims. */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

const NAAM_PATTERN = /Naam:\s*([^\n]+?)(?=\s{2,}|Kenmerk:|Omschrijving:|Machtiging:|IBAN:|BIC:|Betalingskenm\.:|$)/;
const BEA_MERCHANT_PATTERN = /^BEA,\s*[^,]+,\s*(.+?),\s*PAS/;

/** Extracts a best-guess merchant/counterparty name from a raw bank
 *  description, or null when no reliable pattern matches. */
export function extractMerchant(rawDescription: string): string | null {
  const naam = rawDescription.match(NAAM_PATTERN);
  if (naam?.[1]) {
    const m = collapseWhitespace(naam[1]);
    if (m.length > 0) return m;
  }
  const bea = rawDescription.match(BEA_MERCHANT_PATTERN);
  if (bea?.[1]) {
    const m = collapseWhitespace(bea[1]);
    if (m.length > 0) return m;
  }
  return null;
}

/** A human-readable, whitespace-normalized version of the description,
 *  capped to a reasonable display length. Never truncates data that's still
 *  available in full via `originalDescription`. */
export function cleanDescription(rawDescription: string): string {
  const collapsed = collapseWhitespace(rawDescription);
  return collapsed.length > 140 ? collapsed.slice(0, 137) + "…" : collapsed;
}
