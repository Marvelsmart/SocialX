function decimalToScaledInteger(value, decimalPlaces, label) {
  const text = String(value);
  const pattern = new RegExp(`^(\\d+)(?:\\.(\\d{1,${decimalPlaces}}))?$`);
  const match = pattern.exec(text);
  if (!match) throw new Error(`${label} must be a non-negative decimal with at most ${decimalPlaces} decimal places.`);
  const fraction = (match[2] || "").padEnd(decimalPlaces, "0");
  return BigInt(match[1]) * 10n ** BigInt(decimalPlaces) + BigInt(fraction || "0");
}

function getEngagementPricingConfig() {
  const exchangeRate = process.env.SMMH_USD_TO_NGN;
  const markupPercent = process.env.SMMH_MARKUP_PERCENT;
  if (!exchangeRate || !markupPercent) {
    const error = new Error("Set SMMH_USD_TO_NGN and SMMH_MARKUP_PERCENT before enabling orders.");
    error.code = "SMMH_PRICING_NOT_CONFIGURED";
    throw error;
  }
  const exchangeRateScaled = decimalToScaledInteger(exchangeRate, 4, "SMMH_USD_TO_NGN");
  const markupBasisPoints = decimalToScaledInteger(markupPercent, 2, "SMMH_MARKUP_PERCENT");
  if (exchangeRateScaled < 1n || exchangeRateScaled > 1000000000n) {
    throw new Error("SMMH_USD_TO_NGN must be a positive rate no greater than 100,000.");
  }
  if (markupBasisPoints > 100000n) {
    throw new Error("SMMH_MARKUP_PERCENT must be no greater than 1,000.");
  }
  return { exchangeRateScaled, markupBasisPoints };
}

function calculatePriceMinor(ratePerThousand, quantity, config) {
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new Error("Quantity must be a positive integer.");
  }
  const rateScaled = decimalToScaledInteger(ratePerThousand, 4, "Provider rate");
  const numerator =
    rateScaled *
    BigInt(quantity) *
    config.exchangeRateScaled *
    (10000n + config.markupBasisPoints) *
    100n;
  const denominator = 10000n * 1000n * 10000n * 10000n;
  const minor = (numerator + denominator - 1n) / denominator;
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Calculated order price exceeds the supported limit.");
  }
  return Math.max(1, Number(minor));
}

function calculatePriceMinorFromUsd(amount, config) {
  const amountScaled = decimalToScaledInteger(amount, 4, "Provider charge");
  const numerator =
    amountScaled *
    config.exchangeRateScaled *
    (10000n + config.markupBasisPoints) *
    100n;
  const denominator = 10000n * 10000n * 10000n;
  const minor = (numerator + denominator - 1n) / denominator;
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Calculated refund exceeds the supported limit.");
  }
  return Number(minor);
}

module.exports = {
  calculatePriceMinor,
  calculatePriceMinorFromUsd,
  getEngagementPricingConfig,
};
