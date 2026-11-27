# De 5th Bite ordering

The current site remains static HTML/CSS/JavaScript, served by a Cloudflare Worker. The Worker provides the backend API; Cloudflare D1 stores products, orders, staff sessions, order events, and SMS delivery state.

## Ordering behavior

- Fixed-price shawarma and loaded-fries items are paid online through Paystack.
- Cake enquiries remain on WhatsApp because prices vary and cakes require at least three days' notice. Cakes are excluded from Paystack checkout even if they are in the same cart.
- The backend recalculates prices from D1 and independently verifies Paystack transactions before accepting an order.
- After payment is verified, the two approved staff numbers receive an order overview and a staff-dashboard link by SMS.
- Queued or failed SMS notifications are retried automatically every five minutes, up to five total automatic attempts. Staff can also manually retry notifications from the dashboard.
- The unlinked `admin.html` dashboard uses a configured admin username and long access key. Login does not send SMS.
- The owner dashboard at `/admin.html` manages orders, menu items, news drafts and scheduled posts, homepage banner slides, and public business details. Selected news photos remain in the banner until removed, even if the news post is unpublished or deleted. Menu changes drive both the customer menu and checkout pricing.
- Owner-uploaded menu and news images are stored in the `de-5th-bite-media` Cloudflare R2 bucket.
- Order statuses are Received, Preparing, Ready for pickup, and Completed. The customer receives SMS when staff marks Received and Ready for pickup. On completion, the customer receives a direct order-tracking link so they can rate the order and leave a review.
- Customers track orders with the order number and the same phone number used at checkout.
- After an order is marked Completed, the customer can submit one 1-to-5-star rating and written review. Reviews are stored with the order and shown in its staff dashboard details. Customers may separately consent to showing their full name and review publicly; only consented 5-star reviews for completed, paid orders appear in the homepage carousel.

## Local setup

1. Install the development dependencies: `npm install`.
2. Create `.dev.vars` (ignored by Git) with test credentials and your admin login:

   ```text
   PAYSTACK_SECRET_KEY=sk_test_replace_me
   ARKESEL_API_KEY=replace_me
   ARKESEL_SENDER_ID=replace_me
   ADMIN_USERNAME=choose_a_username
   ADMIN_ACCESS_KEY=paste_a_long_random_key_here
   ```

   Generate a 64-character access key with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` and save it somewhere private. Admin login uses this key without sending a text message. Arkesel is still used for order notifications.
3. Apply the local schema: `npm run db:local`.
4. Start Cloudflare's local runtime: `npm run dev`.

The local migration creates the owner content tables and imports the current menu into D1. Wrangler emulates the configured R2 bucket locally for image uploads.

Use `npm run check` for TypeScript validation and `npm run build` to build static assets into `dist/`.

## Cloudflare and provider setup

1. Authenticate Wrangler: `npx wrangler login`.
2. Create D1: `npx wrangler d1 create de-5th-bite`. Put the returned ID in `wrangler.jsonc` in place of `REPLACE_WITH_D1_DATABASE_ID`.
3. Create the image bucket once: `npx wrangler r2 bucket create de-5th-bite-media`.
4. Set `SITE_URL` to the real HTTPS origin in `wrangler.jsonc`, and keep `ADMIN_PHONES` as the authorized Ghana numbers in international digits.
5. Apply the production migrations: `npm run db:remote`.
6. Add credentials interactively so they are stored as Cloudflare Worker secrets, not in Git:

   ```powershell
   npx wrangler secret put PAYSTACK_SECRET_KEY
   npx wrangler secret put ARKESEL_API_KEY
   npx wrangler secret put ARKESEL_SENDER_ID
   npx wrangler secret put ADMIN_USERNAME
   npx wrangler secret put ADMIN_ACCESS_KEY
   ```

   Keep test and live Paystack credentials separate. Configure the approved Arkesel sender ID before testing SMS.
7. Deploy with `npm run deploy`.
8. Configure Paystack's webhook URL as `https://YOUR_DOMAIN/api/paystack/webhook`.
9. Test checkout, successful and failed payments, duplicate webhook delivery, order notification SMS and retry, admin sign-in, menu editing and checkout consistency, image uploads, scheduled news publication, and customer lookup with test credentials before going live.

The owner dashboard is not linked from customer navigation and is marked `noindex`, but its URL is not its security boundary: management APIs require an authenticated session. Keep the admin access key private; do not place secrets in browser JavaScript or public source files.

Cloudflare Pages/Workers and D1 are configured for the free tier, which has usage limits. Paystack transaction fees, Arkesel messages, and the custom domain remain separate costs. Use HTTPS and the custom domain before accepting live orders.
