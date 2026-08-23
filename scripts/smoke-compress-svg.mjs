import fs from "fs";
import path from "path";

function findKey() {
  for (const f of [
    path.join(process.env.USERPROFILE || "", ".cursor", "mcp.json"),
    "d:/Jourey/Products/toolyour/.cursor/mcp.json",
  ]) {
    if (!fs.existsSync(f)) continue;
    const j = JSON.parse(fs.readFileSync(f, "utf8"));
    for (const [name, cfg] of Object.entries(j.mcpServers || {})) {
      if (!/toolyour/i.test(name)) continue;
      for (const [hk, hv] of Object.entries(cfg.headers || {})) {
        if (/api.?key/i.test(hk) && String(hv).startsWith("ty_")) return hv;
      }
    }
  }
  return null;
}

const apiKey = findKey();
if (!apiKey) {
  console.error("NO_KEY");
  process.exit(2);
}

const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120">' +
  '<circle cx="60" cy="60" r="50" fill="#336699"/>' +
  "<!-- noise -->" +
  '<rect x="10" y="10" width="20" height="20" fill="red"/>' +
  "</svg>";

const form = new FormData();
form.append("image", new Blob([svg], { type: "image/svg+xml" }), "ty-smoke.svg");
const res = await fetch("https://api.toolyour.com/api/v1/convertors/compress-svg", {
  method: "POST",
  headers: { "X-Api-Key": apiKey },
  body: form,
});
const ct = res.headers.get("content-type") || "";
const buf = Buffer.from(await res.arrayBuffer());
console.log(
  JSON.stringify(
    {
      status: res.status,
      ct,
      inBytes: Buffer.byteLength(svg),
      outBytes: buf.length,
      head: buf.slice(0, 160).toString("utf8"),
    },
    null,
    2
  )
);
