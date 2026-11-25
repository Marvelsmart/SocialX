const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { app } = require("../server");

let server;
let baseUrl;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("health endpoint responds without a database connection", async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.ok(response.headers.get("content-security-policy"));
});

test("customer and admin sign-in paths serve the SocialX app", async () => {
  const [customerLogin, adminLogin] = await Promise.all([
    fetch(`${baseUrl}/login`),
    fetch(`${baseUrl}/admin/login`),
  ]);
  for (const response of [customerLogin, adminLogin]) {
    assert.equal(response.status, 200);
    const page = await response.text();
    assert.match(page, /id="auth-form"/);
    assert.doesNotMatch(page, /adminAccessToken|Administrator access code/);
  }
});

test("protected social routes reject requests without a session", async () => {
  const response = await fetch(`${baseUrl}/api/feed`);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Please sign in." });
});

test("engagement services and wallet routes require a signed-in user", async () => {
  const [services, wallet, topup] = await Promise.all([
    fetch(`${baseUrl}/api/engagement/services`),
    fetch(`${baseUrl}/api/billing/wallet`),
    fetch(`${baseUrl}/api/billing/wallet/checkout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount: 10000 }),
    }),
  ]);
  for (const response of [services, wallet, topup]) {
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Please sign in." });
  }
});

test("support ticket routes require a signed-in user", async () => {
  const [tickets, createTicket, reply] = await Promise.all([
    fetch(`${baseUrl}/api/support/tickets`),
    fetch(`${baseUrl}/api/support/tickets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subject: "Payment question",
        category: "payments",
        message: "I need help with a wallet payment.",
      }),
    }),
    fetch(`${baseUrl}/api/support/tickets/507f1f77bcf86cd799439011/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "Any update?" }),
    }),
  ]);
  for (const response of [tickets, createTicket, reply]) {
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Please sign in." });
  }
});

test("admin endpoints reject requests without an admin session", async () => {
  const [overview, users, orders, tickets, balance] = await Promise.all([
    fetch(`${baseUrl}/api/admin/overview`),
    fetch(`${baseUrl}/api/admin/users`),
    fetch(`${baseUrl}/api/admin/orders`),
    fetch(`${baseUrl}/api/admin/tickets`),
    fetch(`${baseUrl}/api/admin/provider-balance`),
  ]);
  for (const response of [overview, users, orders, tickets, balance]) {
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Please sign in." });
  }
});

test("Squad webhook rejects requests with an invalid signature", async () => {
  const previousSecret = process.env.SQUAD_SECRET_KEY;
  process.env.SQUAD_SECRET_KEY = "test-squad-secret";
  try {
    const response = await fetch(`${baseUrl}/api/billing/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-squad-encrypted-body": "0".repeat(128),
      },
      body: JSON.stringify({ Event: "charge_successful" }),
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      error: "Invalid Squad webhook signature.",
    });
  } finally {
    if (previousSecret === undefined) delete process.env.SQUAD_SECRET_KEY;
    else process.env.SQUAD_SECRET_KEY = previousSecret;
  }
});

test("Squad webhook acknowledges signed events it does not handle", async () => {
  const previousSecret = process.env.SQUAD_SECRET_KEY;
  const secret = "test-squad-secret";
  process.env.SQUAD_SECRET_KEY = secret;
  try {
    const body = '{"Event":"charge_failed","TransactionRef":"test-reference"}';
    const signature = crypto
      .createHmac("sha512", secret)
      .update(body)
      .digest("hex")
      .toUpperCase();
    const response = await fetch(`${baseUrl}/api/billing/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-squad-encrypted-body": signature,
      },
      body,
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { received: true });
  } finally {
    if (previousSecret === undefined) delete process.env.SQUAD_SECRET_KEY;
    else process.env.SQUAD_SECRET_KEY = previousSecret;
  }
});

test("invalid signup input is rejected before touching the database", async () => {
  const response = await fetch(`${baseUrl}/api/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "not-an-email", password: "short" }),
  });
  assert.equal(response.status, 400);
  assert.equal(typeof (await response.json()).error, "string");
});

test("signup rejects passwords that exceed bcrypt's UTF-8 byte limit", async () => {
  const response = await fetch(`${baseUrl}/api/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Test User",
      username: "test_user",
      email: "test@example.com",
      password: "😀".repeat(20),
    }),
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /72 bytes/);
});
