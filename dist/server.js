"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
const dotenv_1 = __importDefault(require("dotenv"));
const auth_1 = require("./routes/auth");
const users_1 = require("./routes/users");
const courses_1 = require("./routes/courses");
const lessons_1 = require("./routes/lessons");
const enrollments_1 = require("./routes/enrollments");
const auth_2 = require("./middleware/auth");
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 8080;
// CORS configuration mirroring WebConfig
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || "https://mind-leaf.netlify.app,http://localhost:3000,http://127.0.0.1:3000")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
app.use((0, cors_1.default)({
    origin: (origin, cb) => {
        if (!origin || allowedOrigins.includes(origin)) {
            return cb(null, true);
        }
        return cb(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["*"],
    credentials: true,
}));
app.use(express_1.default.json());
// Static file handling equivalent to /files/** from uploads
const uploadsDir = path_1.default.join(process.cwd(), "uploads");
app.use("/files", express_1.default.static(uploadsDir));
// Public routes (match SecurityConfig permitAll list)
app.use("/auth", auth_1.authRouter);
app.use("/users", users_1.usersRouter.publicRouter);
app.use("/courses", courses_1.coursesRouter.publicRouter);
app.use("/files", (req, res, next) => next()); // already static above
// Auth middleware for protected routes
app.use(auth_2.authMiddleware);
// Protected sub-routers
app.use("/users", users_1.usersRouter.protectedRouter);
app.use("/courses", courses_1.coursesRouter.protectedRouter);
app.use("/lessons", lessons_1.lessonsRouter);
app.use("/enrollments", enrollments_1.enrollmentsRouter);
// Simple root similar to HelloController
app.get("/", (_req, res) => {
    res.json({ message: "Courses Node backend is running" });
});
// Global error handler returning JSON
app.use((err, _req, res, _next) => {
    console.error(err);
    if (res.headersSent)
        return;
    res.status(500).json({ error: "Internal server error" });
});
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
