# Jenny's Digital Hub

A responsive online storefront for laptops and computer accessories, with a private admin dashboard and server-side order handling.

## Storefront

- Responsive product catalogue with search and category filtering
- Shopping cart with quantity controls
- Checkout for Bank Transfer and Paystack
- Server-side catalogue price validation before an order is accepted
- Private order records stored in Vercel Blob
- Paystack transaction initialization and server-side verification
- Customer contact: WhatsApp +234 901 740 2219

## Admin dashboard

Open `/admin.html` on the deployed website and sign in with the private admin password.

- Add, edit, hide, and delete catalogue products
- Upload product images
- View recent customer orders and customer/delivery details
- Filter orders and update fulfilment status
- Confirm Bank Transfer payments manually after checking the bank account
- Paystack orders can only be marked paid after server-side verification

See [ADMIN_SETUP.md](ADMIN_SETUP.md) for environment variables and setup guidance.

## Runtime and deployment

This project uses Vercel serverless functions and `@vercel/blob`. Deploy through the connected GitHub repository on Vercel. The static storefront alone can be opened locally, but checkout, private order storage, admin authentication, and image uploads require the Vercel Functions runtime and configured environment variables.

## Required server-side environment variables

- `ADMIN_PASSWORD`
- `ADMIN_SESSION_SECRET`
- `GITHUB_TOKEN` (fine-grained token limited to this repository with Contents read/write)
- `BLOB_READ_WRITE_TOKEN`
- `PAYSTACK_SECRET_KEY` (use a Paystack test key for testing; switch to a live key only when ready to accept real payments)

Never place secrets in browser code or commit them to this repository.

## Important launch checks

Before accepting live orders, verify the production Paystack key mode, complete a controlled end-to-end payment test, confirm bank details and catalogue prices, and decide delivery fees/areas, returns, and warranty terms. No delivery charge or warranty promise is added by default.
