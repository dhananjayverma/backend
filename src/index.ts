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

// Disable ETag to prevent 304 responses
app.set('etag', false);

// Disable caching for all API responses
app.use((req, res, next) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'ETag': false
  });
  next();
});

// CORS configuration - allow multiple frontend origins
const allowedOrigins = [
  process.env.FRONTEND_URL || "http://localhost:3000",
  "http://localhost:3000", // Default Next.js port
  "http://localhost:3001", // Alternative port for patient app
  "http://localhost:3002", // Alternative port for doctor app
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or Postman)
    if (!origin) return callback(null, true);
    
    // Check if origin is in allowed list
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      // In development, allow all localhost origins
      if (process.env.NODE_ENV !== "production" && origin.includes("localhost")) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    }
  },
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json());
app.use(morgan("dev"));
app.use(audit);

// Serve static files from uploads directory
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

registerRoutes(app);
app.use(errorHandler);

async function start() {
  try {
    // Initialize MongoDB connection
    const { initializeMongoDB } = await import("./config/mongodb.config");
    await initializeMongoDB(MONGO_URI);
    console.log("✅ Connected to MongoDB");

    // Create database indexes
    const { IndexService } = await import("./shared/services/index.service");
    await IndexService.createAllIndexes();

    // Initialize Socket.IO
    initializeSocket(httpServer);
    console.log("✅ Socket.IO server initialized");

    httpServer.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📡 API: http://localhost:${PORT}/api`);
      console.log(`🌐 Public API: http://localhost:${PORT}/api/public`);
    });
  } catch (err) {
    console.error("❌ Failed to start server:", err);
    process.exit(1);
  }
}

void start();
