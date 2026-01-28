import express from "express";
import cors from "cors";
import path from "path";
import dotenv from "dotenv";

import { authRouter } from "./routes/auth";
import { usersRouter } from "./routes/users";
import { coursesRouter } from "./routes/courses";
import { lessonsRouter } from "./routes/lessons";
import { enrollmentsRouter } from "./routes/enrollments";
import { authMiddleware } from "./middleware/auth";

dotenv.config();

const app = express();

const PORT = process.env.PORT || 8080;

// CORS configuration mirroring WebConfig
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || "https://mind-leaf.netlify.app,http://localhost:3000,http://127.0.0.1:3000")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowedOrigins.includes(origin)) {
        return cb(null, true);
      }
      return cb(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["*"],
    credentials: true,
  })
);

app.use(express.json());

// Static file handling equivalent to /files/** from uploads
const uploadsDir = path.join(process.cwd(), "uploads");
app.use("/files", express.static(uploadsDir));

// Public routes (match SecurityConfig permitAll list)
app.use("/auth", authRouter);
app.use("/users", usersRouter.publicRouter);
app.use("/courses", coursesRouter.publicRouter);
app.use("/files", (req, res, next) => next()); // already static above

// Auth middleware for protected routes
app.use(authMiddleware);

// Protected sub-routers
app.use("/users", usersRouter.protectedRouter);
app.use("/courses", coursesRouter.protectedRouter);
app.use("/lessons", lessonsRouter);
app.use("/enrollments", enrollmentsRouter);

// Simple root similar to HelloController
app.get("/", (_req, res) => {
  res.json({ message: "Courses Node backend is running" });
});

// Global error handler returning JSON
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  if (res.headersSent) return;
  res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
