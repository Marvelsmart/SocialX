# SocialX

SocialX is a full-stack community and engagement app built with plain HTML, CSS and JavaScript, an Express API, and MongoDB. It includes account creation and sign-in, a social feed, likes, comments, follows, wallet payments, engagement orders, and customer support tickets.

## Run locally

Requirements: Node.js 20+ and MongoDB. Wallet credits and order debits use MongoDB transactions, so use Atlas or a local replica set for those features; a standalone local MongoDB instance cannot process wallet/order transactions.

1. Install packages: `npm install`
2. Create a `.env` file and set `MONGODB_URI` and a random `JWT_SECRET` of at least 32 characters.
3. Start the frontend and backend together:
   - Development: `npm run dev`
   - Standard start: `npm start`
4. Open `http://localhost:3000` (or the port configured by `PORT`).

There is no separate frontend server command: Express serves the frontend files from `public/` and the API from `/api` on the same origin. Both start commands launch the full app and require MongoDB plus the `.env` settings above. For local MongoDB, the example URI uses the standard `socialx` database.
If the connection URI omits a database name, the app uses `socialx`; override this with `MONGODB_DB_NAME` if needed. If your system DNS resolver refuses MongoDB Atlas SRV lookups, set `MONGODB_DNS_SERVERS` to comma-separated resolvers permitted by your network (for example `1.1.1.1,8.8.8.8`). This affects DNS resolution in the app process only, not Windows network settings.

## Deploy to Vercel

Select the Express preset and use the repository root. Leave the Build Command and Output Directory unset; Vercel uses the root `index.js` entry point. Set `MONGODB_URI` and a unique `JWT_SECRET` of at least 32 characters in the Vercel project environment variables. Set any optional payment or provider variables only when enabling those features. Allow the Vercel deployment to connect to MongoDB Atlas, and create administrator accounts against the production database with `npm run create-admin`.

## Sign-in pages

- Customer sign-in: `https://<your-domain>/login` (account creation: `/signup`)
- Administrator sign-in: `https://<your-domain>/admin/login`

Both pages share the same application host and session cookie, but use separate role-specific sign-in screens. Create an administrator from an interactive terminal with `npm run create-admin`; the command prompts for the email, name, username, and password, with password input hidden as you type. If the email already belongs to a customer, the command can promote that account and set its admin password. The email and `isAdmin` role are stored in MongoDB, and only a bcrypt hash of the password is stored. Admin setup is local-only; public signup cannot grant admin privileges. Sign in at `/admin/login` with the email and password created by the command.

## Squad checkout

Payments remain disabled until a Squad secret key is configured. Add your **server-side secret key** to `SQUAD_SECRET_KEY`; never put it in browser code or commit it. This server-side checkout flow does not use a public key. Set `SQUAD_BASE_URL` to `https://sandbox-api-d.squadco.com` for testing or `https://api-d.squadco.com` for production, and set `APP_URL` to the public origin used for the payment callback. `SQUAD_PRO_PLAN_AMOUNT_MINOR` is the plan amount in the provider's smallest currency unit; the default is 500,000 (NGN 5,000). Use sandbox credentials and verify the provider's current API settings before production.

Checkout initiation and verification run on the server. Returning from checkout does not grant Pro access: `/api/billing/verify` checks the transaction reference, amount, currency, and success status with Squad before updating the user's account. The frontend stores the pending reference locally only to resume that server-side verification after returning. Configure the Squad dashboard webhook URL as `https://<your-backend-domain>/api/billing/webhook`; the handler validates Squad's `x-squad-encrypted-body` HMAC-SHA512 signature and re-verifies successful events with Squad before granting Pro access. The redirect callback remains `https://<your-app-domain>/?payment=return`.

## SMM Resellers Hub

The service catalog and order flow use the documented form-encoded `POST https://smmresellershub.com/api/v2` API. Configure `SMMH_API_KEY` only in the server `.env`; do not use a fabricated key or expose the real key in browser code. Set `SMMH_USD_TO_NGN` and `SMMH_MARKUP_PERCENT` to explicit values before allowing orders. The catalog remains viewable without pricing, but order submission is disabled until those settings are valid. Prices are calculated server-side from the provider's USD-per-1,000 rate, converted to NGN and rounded up to the smallest currency unit.

The provider catalog determines the available platforms and engagement types at runtime. The provider advertises Instagram, TikTok, YouTube, Facebook, Telegram, X, Threads, Snapchat, Pinterest, LinkedIn, Discord, Spotify, Twitch, SoundCloud, Canva, CapCut, ChatGPT, Gemini, WhatsApp, Shopee, Kick, and websites; available offerings include followers, likes/reactions, views, comments, shares, saves, reach/impressions, and other listed services. Only services returned by the authenticated API are shown. Standard and drip-feed orders are supported when the individual service advertises drip-feed.

Users fund their NGN wallet through the existing Squad checkout. A verified payment credits the wallet once; submitting an order atomically debits the wallet and records an order/ledger entry. These MongoDB transactions require a replica set (MongoDB Atlas is supported). Provider rejections refund the debit; ambiguous network/provider failures remain marked for support review and are not automatically retried, to avoid duplicate orders. Status checks reconcile provider-reported partial and canceled orders with wallet refunds. Customers can view their own orders, request cancellation while in progress, and request eligible refills. Customers can also create support tickets and reply to their own tickets. Administrator roles are stored on user records and are granted only through the local `npm run create-admin` command; the admin workspace includes a support inbox, paginated customer/order lists, and provider balance.

## Included API

- `POST /api/auth/signup`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- `GET /api/feed`, `POST /api/posts`
- `PUT /api/posts/:postId/like`
- `GET /api/posts/:postId/comments`, `POST /api/posts/:postId/comments`
- `PUT /api/users/:userId/follow`, `GET /api/discover`
- `GET /api/dashboard`
- `GET /api/billing/config`, `POST /api/billing/checkout`, `POST /api/billing/verify`, `POST /api/billing/webhook`
- `GET /api/billing/wallet`, `POST /api/billing/wallet/checkout`
- `GET /api/engagement/services`, `GET /api/engagement/orders`, `POST /api/engagement/orders`
- `GET /api/engagement/orders/:orderId`, `POST /api/engagement/orders/:orderId/cancel`, `POST /api/engagement/orders/:orderId/refill`, `GET /api/engagement/orders/:orderId/refill`
- Customer support: `GET /api/support/tickets`, `POST /api/support/tickets`, `POST /api/support/tickets/:ticketId/messages`
- Admin-only: `GET /api/admin/tickets`, `POST /api/admin/tickets/:ticketId/messages`, `PATCH /api/admin/tickets/:ticketId/status`, `GET /api/admin/users`, `GET /api/admin/orders`, `POST /api/admin/orders/:orderId/refresh`, `GET /api/admin/provider-balance`
- `GET /api/health`

## Production checklist

- Deploy behind HTTPS and set `COOKIE_SECURE=true`; use a long, unique `JWT_SECRET`.
- If running behind a reverse proxy, set `TRUST_PROXY_HOPS` to the exact number of trusted proxy hops.
- Keep Squad credentials and the MongoDB connection string in your host's secret manager.
- Keep SMM Resellers Hub credentials in the host's secret manager and set a current USD/NGN rate and your markup.
- Grant administrator roles only with the local `npm run create-admin` command.
- Use a shared rate-limit store when deploying multiple server instances.
- Configure MongoDB backups, monitoring, and least-privilege credentials.
- Before inviting real users, add email verification, password reset, account deletion/export, moderation/reporting tools, and a published privacy/terms policy.
- Configure payment reconciliation and test success, failure, cancellation, duplicate callbacks, and network timeouts with Squad's current sandbox docs.

This is a working starter MVP, not a substitute for a production security and operational review.
