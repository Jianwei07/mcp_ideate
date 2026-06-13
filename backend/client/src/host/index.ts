import { loadClientConfig } from "./config.ts";
import { createHost } from "./server.ts";

const server = createHost(loadClientConfig());

console.log(`Host listening on http://${server.hostname}:${server.port}`);

const shutdown = () => {
  server.stop();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
