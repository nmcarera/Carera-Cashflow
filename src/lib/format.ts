/** Shared, locale-consistent formatting helpers for money and dates. */

const eurFormatter = new Intl.NumberFormat("nl-NL", {
  style: "currency",
  currency: "EUR",
  currencySign: "accounting",
});

const genericMoneyFormatter = (currency: string) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    currencySign: "accounting",
  });

export function formatEur(amount: number | null): string {
  if (amount === null) return "—";
  return eurFormatter.format(amount);
}

export function formatMoney(amount: number, currency: string): string {
  try {
    return genericMoneyFormatter(currency).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

export function formatPercent(fraction: number): string {
  return new Intl.NumberFormat("en-GB", { style: "percent", maximumFractionDigits: 0 }).format(
    fraction
  );
}
