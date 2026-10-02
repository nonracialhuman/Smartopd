import { createServer } from "node:http";
import { config } from "./config";
import { logger } from "./logger";
import { createApp } from "./app";
import { attachSocketServer } from "./realtime/socket";
import { publishAdmin, publishAllDepartments, publishBeds } from "./realtime/hub";
import { setSimulator } from "./sim/simulator";

const http = createServer(createApp());
attachSocketServer(http);

// keep countdowns and "confirmed N min ago" honest even when nothing changes
setInterval(() => {
  void Promise.all([publishAllDepartments(), publishBeds(), publishAdmin()]).catch((err) => logger.error({ err }, "heartbeat failed"));
}, 60_000).unref();

http.listen(config.PORT, () => {
  logger.info(`SmartOPD realtime server on :${config.PORT} (${config.HOSPITAL_NAME})`);
  if (config.SIMULATOR === "1") setSimulator(true);
});

const shutdown = () => { http.close(); process.exit(0); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
