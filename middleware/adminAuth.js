const crypto = require('crypto');

// Both admin-gated routes previously compared the header to
// process.env.ADMIN_API_KEY with a plain !==. If the env var is ever unset
// (e.g. a redeploy that forgets to copy it over), that's `undefined !==
// undefined` -> false -> the guard is skipped entirely, turning an
// admin-only endpoint public. This version fails CLOSED when the key isn't
// configured, requires the header to be a non-empty string, and compares
// with a constant-time check so response timing can't leak how much of the
// key an attacker has guessed right.
function isAdminRequest(req) {
  const configured = process.env.ADMIN_API_KEY;
  if (!configured || typeof configured !== 'string' || configured.length === 0) {
    return false;
  }
  const supplied = req.headers['x-admin-key'];
  if (typeof supplied !== 'string' || supplied.length !== configured.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(configured));
}

// Express middleware form, for routes wired directly off the router.
function requireAdmin(req, res, next) {
  if (!isAdminRequest(req)) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  next();
}

module.exports = { isAdminRequest, requireAdmin };
