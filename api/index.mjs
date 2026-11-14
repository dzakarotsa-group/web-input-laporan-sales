import { handleRequest } from "../server.mjs";

export default async function vercelHandler(request, response) {
  const url = new URL(request.url || "/", `https://${request.headers.host || "localhost"}`);
  const appPath = url.searchParams.get("__lead_desk_path");
  if (!appPath || !appPath.startsWith("/api")) {
    response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "Rute aplikasi tidak valid." }));
    return;
  }

  url.searchParams.delete("__lead_desk_path");
  request.url = `${appPath}${url.search ? url.search : ""}`;
  await handleRequest(request, response);
}
