/** Intentionally missing GET /health. */
export function handleRequest(req, res) {
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
}
