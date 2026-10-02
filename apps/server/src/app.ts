import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import compression from "compression";
import { pinoHttp } from "pino-http";
import { config } from "./config";
import { logger } from "./logger";
import { api, errorHandler } from "./http/routes";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === "/api/health" }, quietReqLogger: true }));
  app.use(compression());
  app.use(cors({ origin: config.webOrigins, credentials: true }));
  app.use(express.json({ limit: "64kb" }));
  app.use(cookieParser());
  app.use("/api", api);
  app.use(errorHandler);
  return app;
}
