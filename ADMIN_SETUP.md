# Jenny's Digital Hub — Admin setup

The private store dashboard is available at `/admin.html`. It includes product catalogue management and a customer order desk. The dashboard and API are deployed with the existing Vercel project.

## Required Vercel environment variables

The dashboard intentionally stays locked until the admin security variables are configured. Checkout and order management also require the Blob and Paystack variables below. Do not put these values in `index.html`, `admin.html`, or any `NEXT_PUBLIC_*` variable.

1. `ADMIN_PASSWORD` — choose a long, unique password used only for this dashboard.
2. `ADMIN_SESSION_SECRET` — generate a random secret of at least 32 bytes (a 64-character or longer random value is recommended).
3. `GITHUB_TOKEN` — a GitHub fine-grained personal access token limited to this repository, with **Contents: Read and write** permission. No organization-wide access is needed.\n4. `BLOB_READ_WRITE_TOKEN` — the Vercel Blob read/write token used for private order records.\n5. `PAYSTACK_SECRET_KEY` — the Paystack secret key. Use a test key while testing; only use the live secret key when ready to accept real payments.\n\nIn your Paystack Dashboard, set the webhook URL to `https://www.polarxlayer.com/api/paystack-webhook`. The webhook validates Paystack's signature and confirms the reference, amount, currency, and payment method before marking an order paid.

In Vercel, open the **jennys-digital-hub** project → **Settings** → **Environment Variables**. Add each variable as a server-side variable for the **Production** environment (and Preview too, if you intend to test the admin on preview deployments). Save them, then redeploy the latest production deployment so the Functions receive the values.

Create the GitHub token under GitHub **Settings → Developer settings → Personal access tokens → Fine-grained tokens**. Select only `chukwujennifer101-jpg/jennys-digital-hub`, grant repository **Contents: Read and write**, and store the token directly in Vercel. Do not send the token or admin password in a chat or commit them to the repository.

## How to use

1. Open `https://jennys-digital-hub.vercel.app/admin.html` (or your current production domain plus `/admin.html`).
2. Sign in with the `ADMIN_PASSWORD`.
3. Select a product to edit its name, category, price, description, image URL, or availability.
4. To upload an image, choose a JPG, PNG, or WebP file no larger than 3 MB. The image is committed to the repository; its URL is placed in the product form.
5. Press **Save product** to update `products.json`. The connected GitHub-to-Vercel deployment then publishes the catalogue update.

## Security and publishing notes

- The password is checked by a Vercel serverless function. The signed session cookie is HttpOnly, Secure on Vercel, and SameSite=Strict.
- The GitHub token and session secret are read only by the server-side API and are never sent to the browser.
- The dashboard page is not linked from the public storefront and is marked noindex. The API enforces authentication for product changes and order access.\n- Customer order files are stored as private Vercel Blob objects. The order list displays the most recent 200 orders.\n- Paystack status is verified server-side against the order reference, amount, and NGN currency. The webhook endpoint also validates Paystack's HMAC signature and confirms payment even if the customer closes the return page. Configure the webhook URL in Paystack Dashboard and complete a live-key end-to-end test before launch.
- Product images are public website assets once uploaded; do not upload private or personal images.
- Saving a product updates the GitHub repository and triggers a Vercel deployment. The storefront changes after that deployment is ready.
