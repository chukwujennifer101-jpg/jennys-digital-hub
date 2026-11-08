const { createHmac, timingSafeEqual } = require("node:crypto");
const { get, put } = require("@vercel/blob");

function send(res, status, data) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(data);
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function readOrder(reference) {
  const stored = await get("orders/" + reference + ".json", { access: "private" });
  if (!stored || stored.statusCode !== 200) return null;
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
    const expected = createHmac("sha512", secret).update(rawBody).digest("hex");

    if (!signature || !/^[a-f0-9]{128}$/i.test(signature)) {
      return send(res, 401, { error: "Invalid webhook signature." });
    }

    const suppliedBuffer = Buffer.from(signature, "hex");
    const expectedBuffer = Buffer.from(expected, "hex");
    if (suppliedBuffer.length !== expectedBuffer.length || !timingSafeEqual(suppliedBuffer, expectedBuffer)) {
      return send(res, 401, { error: "Invalid webhook signature." });
    }

    const event = JSON.parse(rawBody.toString("utf8"));
    if (event.event !== "charge.success") {
      return send(res, 200, { received: true, ignored: true });
    }

    const data = event.data || {};
    const reference = String(data.reference || "");
    if (!/^JDH-[A-Z0-9]+-[A-F0-9]{6}$/.test(reference)) {
      return send(res, 200, { received: true, ignored: true });
    }

    const order = await readOrder(reference);
    if (!order) return send(res, 404, { error: "Order not found." });

    const validPayment =
      data.status === "success" &&
      data.currency === "NGN" &&
      Number(data.amount) === Number(order.total) * 100 &&
      data.reference === order.orderId;

    if (!validPayment) {
      return send(res, 200, { received: true, paymentConfirmed: false });
    }

    if (order.paymentStatus !== "paid") {
      order.paymentStatus = "paid";
      order.paidAt = new Date().toISOString();
      order.paystackTransactionId = String(data.id || "");
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

module.exports.config = { api: { bodyParser: false } };
