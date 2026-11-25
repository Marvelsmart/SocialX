const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  calculatePriceMinor,
  calculatePriceMinorFromUsd,
  getEngagementPricingConfig,
} = require("../src/engagement-pricing");

test("engagement prices convert provider USD rates and apply configured markup", () => {
  const config = {
    exchangeRateScaled: 15000000n,
    markupBasisPoints: 2000n,
  };
  assert.equal(calculatePriceMinor("1.2000", 1000, config), 216000);
  assert.equal(calculatePriceMinorFromUsd("0.6000", config), 108000);
});

test("engagement prices round up to the smallest wallet unit", () => {
  const config = {
    exchangeRateScaled: 15000000n,
    markupBasisPoints: 0n,
  };
  assert.equal(calculatePriceMinor("0.0001", 1, config), 1);
});

test("engagement pricing requires explicit exchange-rate and markup settings", () => {
  const previousRate = process.env.SMMH_USD_TO_NGN;
  const previousMarkup = process.env.SMMH_MARKUP_PERCENT;
  delete process.env.SMMH_USD_TO_NGN;
  delete process.env.SMMH_MARKUP_PERCENT;
  try {
    assert.throws(
      getEngagementPricingConfig,
      (error) => error.code === "SMMH_PRICING_NOT_CONFIGURED",
    );
  } finally {
    if (previousRate === undefined) delete process.env.SMMH_USD_TO_NGN;
    else process.env.SMMH_USD_TO_NGN = previousRate;
    if (previousMarkup === undefined) delete process.env.SMMH_MARKUP_PERCENT;
    else process.env.SMMH_MARKUP_PERCENT = previousMarkup;
  }
});

test("engagement pricing rejects malformed decimals", () => {
  const config = {
    exchangeRateScaled: 15000000n,
    markupBasisPoints: 0n,
  };
  assert.throws(() => calculatePriceMinor("1.23456", 1000, config), /Provider rate/);
});
