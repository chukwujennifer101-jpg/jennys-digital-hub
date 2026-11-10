const crypto = require("node:crypto");

const COOKIE = "jdh_admin_session";
const OAUTH_COOKIE = "jdh_google_oauth";
const ADMIN_EMAIL = "chukwujennifer101@gmail.com";
const REDIRECT_URI = "https://www.polarxlayer.com/api/admin-auth";
const SESSION_SECONDS = 60 * 60 * 12;
const OAUTH_SECONDS = 10 * 60;

function cookie(name, value, maxAge, sameSite = "Lax") {
  return name + "=" + encodeURIComponent(value) + "; HttpOnly; Path=/; SameSite=" + sameSite + "; Max-Age=" + maxAge + (process.env.VERCEL ? "; Secure" : "");
}
function sign(value) {
  return crypto.createHmac("sha256", process.env.ADMIN_SESSION_SECRET).update(value).digest("base64url");
}
function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}
function redirect(res, location, clearOAuth = false) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (clearOAuth) res.setHeader("Set-Cookie", cookie(OAUTH_COOKIE, "", 0));
  return res.redirect(302, location);
}
module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method !== "GET") return res.status(405).send("Method not allowed.");
  if (!process.env.ADMIN_SESSION_SECRET || !process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(503).send("Google admin sign-in is not configured yet.");
  }

  const params = req.query || {};
  if (params.action === "google") {
    const state = crypto.randomBytes(32).toString("base64url");
    const verifier = crypto.randomBytes(48).toString("base64url");
    const transaction = state + "." + verifier;
    const transactionCookie = transaction + "." + sign(transaction);
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      scope: "openid email profile",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      prompt: "select_account"
    }).toString();
    res.setHeader("Set-Cookie", cookie(OAUTH_COOKIE, transactionCookie, OAUTH_SECONDS));
    return redirect(res, url.toString());
  }

  if (!params.code || !params.state) return redirect(res, "/admin.html?auth=failed");
  const cookies = String(req.headers.cookie || "").split(";").map(part => part.trim());
  const entry = cookies.find(part => part.startsWith(OAUTH_COOKIE + "="));
  if (!entry) return redirect(res, "/admin.html?auth=failed", true);

  let transactionCookie;
  try { transactionCookie = decodeURIComponent(entry.slice(OAUTH_COOKIE.length + 1)); }
  catch { return redirect(res, "/admin.html?auth=failed", true); }
  const pieces = transactionCookie.split(".");
  if (pieces.length !== 3) return redirect(res, "/admin.html?auth=failed", true);
  const [state, verifier, signature] = pieces;
  if (!safeEqual(params.state, state) || !safeEqual(signature, sign(state + "." + verifier))) {
    return redirect(res, "/admin.html?auth=failed", true);
  }

  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: String(params.code),
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
        code_verifier: verifier
      })
    });
    const tokens = await tokenResponse.json();
    if (!tokenResponse.ok || !tokens.id_token) throw new Error("Google token exchange failed.");

    const verifyResponse = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(tokens.id_token));
    const identity = await verifyResponse.json();
    const expiry = Number(identity.exp);
    const issuerValid = identity.iss === "https://accounts.google.com" || identity.iss === "accounts.google.com";
    if (!verifyResponse.ok || identity.aud !== process.env.GOOGLE_CLIENT_ID || !issuerValid ||
        identity.email !== ADMIN_EMAIL || identity.email_verified !== "true" ||
        !Number.isFinite(expiry) || expiry <= Math.floor(Date.now() / 1000)) {
      return redirect(res, "/admin.html?auth=denied", true);
    }

    const expires = String(Math.floor(Date.now() / 1000) + SESSION_SECONDS);
    const session = expires + "." + sign(expires);
    res.setHeader("Set-Cookie", [
      cookie(COOKIE, session, SESSION_SECONDS, "Strict"),
      cookie(OAUTH_COOKIE, "", 0)
    ]);
    return redirect(res, "/admin.html?auth=success");
  } catch {
    return redirect(res, "/admin.html?auth=failed", true);
  }
};
