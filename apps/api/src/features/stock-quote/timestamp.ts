// Feature-local epoch-millis to ISO helper shared by both providers.
// Finite positive numbers are not enough: values outside the JS Date range
// (e.g. Number.MAX_VALUE) make toISOString() throw RangeError, which would
// surface as a defect instead of the promised asOf-null degradation.
export function epochMsToIsoOrNull(ms: number): string | null {
  if (!Number.isFinite(ms) || ms <= 0) {
    return null;
  }
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}
