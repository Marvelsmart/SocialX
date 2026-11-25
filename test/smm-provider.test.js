const { afterEach, test } = require("node:test");
const assert = require("node:assert/strict");
const { requestProvider, SmmProviderError } = require("../src/smm-provider");

const originalFetch = global.fetch;
const originalKey = process.env.SMMH_API_KEY;
const originalUrl = process.env.SMMH_API_URL;

afterEach(() => {
  global.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.SMMH_API_KEY;
  else process.env.SMMH_API_KEY = originalKey;
  if (originalUrl === undefined) delete process.env.SMMH_API_URL;
  else process.env.SMMH_API_URL = originalUrl;
});

test("provider requests use the documented form-encoded endpoint and keep the key server-side", async () => {
  process.env.SMMH_API_KEY = "test-key";
  let requestUrl;
  let requestOptions;
  global.fetch = async (url, options) => {
    requestUrl = url;
    requestOptions = options;
    return new Response(JSON.stringify([{ service: 3 }]), { status: 200 });
  };

  const result = await requestProvider("services");
  assert.deepEqual(result, [{ service: 3 }]);
  assert.equal(String(requestUrl), "https://smmresellershub.com/api/v2");
  assert.equal(requestOptions.method, "POST");
  assert.equal(
    requestOptions.headers["Content-Type"],
    "application/x-www-form-urlencoded",
  );
  assert.equal(requestOptions.body.get("key"), "test-key");
  assert.equal(requestOptions.body.get("action"), "services");
});

test("provider HTTP errors are surfaced without treating an error payload as success", async () => {
  process.env.SMMH_API_KEY = "test-key";
  global.fetch = async () =>
    new Response(JSON.stringify({ error: "Not enough balance" }), { status: 400 });
  await assert.rejects(
    requestProvider("add", { service: 3 }),
    (error) => error instanceof SmmProviderError && error.status === 400,
  );
});

test("provider API keys are not sent to untrusted endpoint URLs", async () => {
  process.env.SMMH_API_KEY = "test-key";
  process.env.SMMH_API_URL = "https://attacker.example/api/v2";
  let called = false;
  global.fetch = async () => {
    called = true;
    return new Response("[]", { status: 200 });
  };
  await assert.rejects(
    requestProvider("services"),
    (error) => error.code === "SMMH_CONFIG_INVALID",
  );
  assert.equal(called, false);
});
