import "dotenv/config";
import express from "express";
import cors from "cors";
import morgan from "morgan";
import { createServer } from "http";
import "express-async-errors";
import path from "path";
import cookieParser from "cookie-parser";
import { registerRoutes } from "./routes";
import { errorHandler } from "./shared/middleware/errorHandler";
import { MONGO_URI, PORT } from "./config";
import { audit } from "./shared/middleware/audit";
import { initializeSocket } from "./socket/socket.server";

const app = express();
const httpServer = createServer(app);

app.set("etag", false);

app.use(
  cors({
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "Accept",
    ],
  })
);

app.options("*", cors());

app.use((req, res, next) => {
  res.set({
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
    ETag: false,
  });
  next();
});

app.use(cookieParser());
app.use(express.json());
app.use(morgan("dev"));
app.use(audit);

app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

registerRoutes(app);
app.use(errorHandler);

async function start() {
  try {
    if (!MONGO_URI) {
      throw new Error("MONGO_URI is not defined in environment variables");
    }

    const { initializeMongoDB } = await import("./config/mongodb.config");
    await initializeMongoDB(MONGO_URI);

    const { IndexService } = await import("./shared/services/index.service");
    await IndexService.createAllIndexes();

    initializeSocket(httpServer);

    httpServer.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error("Server failed to start:", err);
    process.exit(1);
  }
}

void start();
