/** Intentionally broken: always allows. */
export function requireAuth(req, res, next) {
  next();
}

export function handleAuthRequest(req, res) {
  requireAuth(req, res, () => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
}
