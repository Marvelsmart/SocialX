const API_URL = "https://smmresellershub.com/api/v2";

class SmmProviderError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "SmmProviderError";
    this.status = status;
  }
}

async function requestProvider(action, parameters = {}) {
  const key = process.env.SMMH_API_KEY;
  if (!key) {
    const error = new Error("SMM Resellers Hub is not configured.");
    error.code = "SMMH_NOT_CONFIGURED";
    throw error;
  }
  let endpoint;
  try {
    endpoint = new URL(process.env.SMMH_API_URL || API_URL);
  } catch {
    const error = new Error("SMMH_API_URL is invalid.");
    error.code = "SMMH_CONFIG_INVALID";
    throw error;
  }
  if (
    endpoint.protocol !== "https:" ||
    endpoint.hostname !== "smmresellershub.com" ||
    endpoint.pathname.replace(/\/$/, "") !== "/api/v2"
  ) {
    const error = new Error("SMMH_API_URL must use the documented HTTPS API endpoint.");
    error.code = "SMMH_CONFIG_INVALID";
    throw error;
  }
  const body = new URLSearchParams({ key, action });
  for (const [name, value] of Object.entries(parameters)) {
    if (value !== undefined && value !== null) body.set(name, String(value));
  }

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    error.message = `SMM provider request failed: ${error.message}`;
    throw error;
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok || (payload && !Array.isArray(payload) && payload.error)) {
    const message =
      typeof payload?.error === "string"
        ? payload.error.slice(0, 250)
        : "SMM provider request was rejected.";
    throw new SmmProviderError(message, response.status);
  }
  if (payload === null) {
    throw new SmmProviderError("SMM provider returned an invalid response.", response.status);
  }
  return payload;
}

module.exports = { requestProvider, SmmProviderError };
