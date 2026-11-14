import { createServer } from "node:http";
import { handleRequest } from "./server.mjs";

const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");

createServer(handleRequest).listen(port, host, () => {
  console.log(`Lead Desk running at http://127.0.0.1:${port}`);
});
