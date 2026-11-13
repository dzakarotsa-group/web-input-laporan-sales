import { createServer } from "node:http";
import { handleRequest } from "./server.mjs";

const server = createServer(handleRequest);
server.listen(Number(process.env.PORT || 3000));
