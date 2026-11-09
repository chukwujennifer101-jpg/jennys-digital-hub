const crypto = require("node:crypto");
const { get, put } = require("@vercel/blob");

module.exports.config = { api: { bodyParser: false } };

function send(res, status, data) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(data);
}

async function readRawBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error("Webhook payload is too large.");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function readOrder(reference) {
  const stored = await get("orders/" + reference + ".json", { access: "private", useCache: false });
  if (!stored || stored.statusCode !== 200 || !stored.stream) return null;
  const chunks = [];
  for await (const chunk of stored.stream) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed." });

  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret || !process.env.BLOB_READ_WRITE_TOKEN) {
    return send(res, 503, { error: "Webhook is not configured." });
  }

  try {
    const rawBody = await readRawBody(req);
    const signature = String(req.headers["x-paystack-signature"] || "");
    const expected = crypto.createHmac("sha512", secret).update(rawBody).digest("hex");
    if (!/^[a-f0-9]{128}$/i.test(signature)) return send(res, 401, { error: "Invalid webhook signature." });

    const supplied = Buffer.from(signature, "hex");
    const expectedBuffer = Buffer.from(expected, "hex");
    if (supplied.length !== expectedBuffer.length || !crypto.timingSafeEqual(supplied, expectedBuffer)) {
      return send(res, 401, { error: "Invalid webhook signature." });
    }

    const event = JSON.parse(rawBody.toString("utf8"));
    if (event.event !== "charge.success") return send(res, 200, { received: true, ignored: true });

    const transaction = event.data || {};
    const reference = String(transaction.reference || "");
    if (!/^JDH-[A-Z0-9]+-[A-F0-9]{6}$/.test(reference)) return send(res, 200, { received: true, ignored: true });

    const order = await readOrder(reference);
    if (!order) return send(res, 404, { error: "Order not found." });

    const validPayment = order.paymentMethod === "Paystack"
      && transaction.status === "success"
      && transaction.currency === "NGN"
      && Number(transaction.amount) === Number(order.total) * 100
      && transaction.reference === order.orderId;
    if (!validPayment) return send(res, 200, { received: true, paymentConfirmed: false });

    if (order.paymentStatus !== "paid") {
      order.paymentStatus = "paid";
      order.paidAt = new Date().toISOString();
      order.paystackTransactionId = String(transaction.id || "");
      order.paymentConfirmationSource = "paystack_webhook";
      await put("orders/" + reference + ".json", JSON.stringify(order), {
        access: "private",
        addRandomSuffix: false,
        contentType: "application/json"
      });
    }

    return send(res, 200, { received: true, paymentConfirmed: true, orderId: reference });
  } catch (error) {
    return send(res, 500, { error: "Webhook processing failed. Paystack may retry the notification." });
  }
};
