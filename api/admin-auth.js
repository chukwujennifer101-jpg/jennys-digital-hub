module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  return res.status(410).json({ error: "Google sign-in is disabled. Please use the administrator username and password." });
};
