const crypto = require("node:crypto");

const OWNER = "chukwujennifer101-jpg";
const REPO = "jennys-digital-hub";
const BRANCH = "main";
const COOKIE = "jdh_admin_session";
const SESSION_SECONDS = 60 * 60 * 12;
const loginAttempts = new Map();

function send(res, status, data, extraHeaders = {}) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  for (const [key, value] of Object.entries(extraHeaders)) res.setHeader(key, value);
  return res.status(status).json(data);
}
function cookieOptions(maxAge) {
  return `${COOKIE}=; HttpOnly; Path=/; SameSite=Strict; Max-Age=${maxAge}${process.env.VERCEL ? "; Secure" : ""}`;
}
function sign(value) {
  return crypto.createHmac("sha256", process.env.ADMIN_SESSION_SECRET).update(value).digest("base64url");
}
function issueSession() {
  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const value = String(expires);
  return value + "." + sign(value);
}
function isAuthenticated(req) {
  if (!process.env.ADMIN_SESSION_SECRET) return false;
  const cookies = String(req.headers.cookie || "").split(";").map(part => part.trim());
  const entry = cookies.find(part => part.startsWith(COOKIE + "="));
  if (!entry) return false;
  const token = decodeURIComponent(entry.slice(COOKIE.length + 1));
  const [expires, signature] = token.split(".");
  if (!expires || !signature || !/^\d+$/.test(expires) || Number(expires) < Math.floor(Date.now() / 1000)) return false;
  const expected = sign(expires);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function constantTimeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}
async function github(path, options = {}) {
  if (!process.env.GITHUB_TOKEN) throw new Error("The admin GitHub connection is not configured yet.");
  const response = await fetch("https://api.github.com" + path, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + process.env.GITHUB_TOKEN,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.message || "GitHub could not save the changes.";
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return data;
}
async function putRepoFile(path, bytes, message) {
  let sha;
  try {
    const current = await github("/repos/" + OWNER + "/" + REPO + "/contents/" + path.split("/").map(encodeURIComponent).join("/") + "?ref=" + BRANCH);
    sha = current.sha;
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  return github("/repos/" + OWNER + "/" + REPO + "/contents/" + path.split("/").map(encodeURIComponent).join("/"), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      content: Buffer.from(bytes).toString("base64"),
      branch: BRANCH,
      ...(sha ? { sha } : {})
    })
  });
}
function validateProducts(value) {
  if (!Array.isArray(value) || value.length > 100) throw new Error("The product list is invalid.");
  const ids = new Set();
  return value.map(item => {
    const id = Number(item.id);
    const name = String(item.name || "").trim().slice(0, 100);
    const category = String(item.category || "").trim().slice(0, 50);
    const description = String(item.description || "").trim().slice(0, 400);
    const image = String(item.image || "").trim().slice(0, 2000);
    const price = item.price === null || item.price === "" ? null : Number(item.price);
    if (!Number.isSafeInteger(id) || id < 1 || ids.has(id)) throw new Error("Each product must have a unique positive product ID.");
    if (!name || !category || !description) throw new Error("Every product needs a name, category and description.");
    if (!/^https:\/\//i.test(image)) throw new Error("Every product image must use a secure https address.");
    if (price !== null && (!Number.isFinite(price) || price < 0 || price > 1000000000)) throw new Error("A product price is invalid.");
    ids.add(id);
    let options;
    if (item.options !== undefined) {
      if (!Array.isArray(item.options) || item.options.length > 30) throw new Error("Product options must be a valid list.");
      const optionIds = new Set();
      options = item.options.map(option => {
        const optionId = String(option.id || "").trim().slice(0, 80);
        const optionName = String(option.name || "").trim().slice(0, 100);
        const optionDescription = String(option.description || "").trim().slice(0, 300);
        const optionImage = String(option.image || "").trim().slice(0, 2000);
        const optionPrice = option.price === null || option.price === "" ? null : Number(option.price);
        if (!optionId || optionIds.has(optionId) || !optionName) throw new Error("Every product option needs a unique ID and name.");
        if (!/^https:\/\//i.test(optionImage)) throw new Error("Every product option image must use a secure https address.");
        if (optionPrice !== null && (!Number.isFinite(optionPrice) || optionPrice < 0 || optionPrice > 1000000000)) throw new Error("A product option price is invalid.");
        optionIds.add(optionId);
        return { id: optionId, name: optionName, price: optionPrice, description: optionDescription, image: optionImage, available: option.available !== false };
      });
    }
    return { id, name, category, price, description, art: String(item.art || category.toUpperCase()).slice(0, 30), image, available: item.available !== false, ...(options ? { options } : {}) };
  });
}
module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") return send(res, 204, {});
  if (req.method === "GET") return send(res, 200, { authenticated: isAuthenticated(req) });
  if (req.method === "POST" && req.body && req.body.action === "login") {
    if (!process.env.ADMIN_PASSWORD || !process.env.ADMIN_SESSION_SECRET) return send(res, 503, { error: "Admin security is not configured. Add the required Vercel environment variables first." });
    const ip = String(req.headers["x-forwarded-for"] || "unknown").split(",")[0].trim();
    const now = Date.now();
    const attempt = loginAttempts.get(ip) || { count: 0, since: now };
    if (now - attempt.since > 15 * 60 * 1000) { attempt.count = 0; attempt.since = now; }
    if (attempt.count >= 10) return send(res, 429, { error: "Too many sign-in attempts. Please wait 15 minutes and try again." });
    if (!constantTimeEqual(req.body.password, process.env.ADMIN_PASSWORD)) {
      attempt.count += 1; loginAttempts.set(ip, attempt);
      return send(res, 401, { error: "Incorrect admin password." });
    }
    loginAttempts.delete(ip);
    return send(res, 200, { authenticated: true }, { "Set-Cookie": COOKIE + "=" + encodeURIComponent(issueSession()) + "; HttpOnly; Path=/; SameSite=Strict; Max-Age=" + SESSION_SECONDS + (process.env.VERCEL ? "; Secure" : "") });
  }
  if (req.method === "POST" && req.body && req.body.action === "logout") {
    return send(res, 200, { success: true }, { "Set-Cookie": cookieOptions(0) });
  }
  if (!isAuthenticated(req)) return send(res, 401, { error: "Please sign in to manage the website." });
  try {
    if (req.method === "POST" && req.body && req.body.action === "upload") {
      const mime = String(req.body.mime || "");
      const extensions = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
      if (!extensions[mime]) return send(res, 400, { error: "Only JPG, PNG and WebP images are supported." });
      const base64 = String(req.body.base64 || "");
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length > 4 * 1024 * 1024) return send(res, 413, { error: "The image is too large. Maximum upload size is 3 MB." });
      const bytes = Buffer.from(base64, "base64");
      if (!bytes.length || bytes.length > 3 * 1024 * 1024) return send(res, 413, { error: "The image is too large. Maximum upload size is 3 MB." });
      const name = String(req.body.name || "product-image").replace(/[^a-zA-Z0-9._-]/g, "-").replace(/\.+/g, ".").slice(0, 70);
      const path = "uploads/" + Date.now() + "-" + name.replace(/\.[^.]+$/, "") + "." + extensions[mime];
      await putRepoFile(path, bytes, "Upload product image from admin dashboard");
      return send(res, 200, { url: "https://raw.githubusercontent.com/" + OWNER + "/" + REPO + "/" + BRANCH + "/" + path });
    }
    if (req.method === "PUT" && req.body && req.body.action === "save") {
      const products = validateProducts(req.body.products);
      await putRepoFile("products.json", Buffer.from(JSON.stringify(products, null, 2) + "\n"), "Update product catalogue from admin dashboard");
      return send(res, 200, { success: true, count: products.length });
    }
    return send(res, 405, { error: "Method not allowed." }, { Allow: "GET, POST, PUT, OPTIONS" });
  } catch (error) {
    const status = error.status && error.status >= 400 && error.status < 500 ? error.status : 500;
    return send(res, status, { error: status === 500 ? "The change could not be saved. Check the admin setup and try again." : error.message });
  }
};
