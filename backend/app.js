import express from "express";
import cors from "cors";
import morgan from "morgan";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { handleHttpError } from "./utils/errorHandler.js";
import { logger } from "./utils/logger.js";
import sequelize from "./config/db.js";
import bodyParser from "body-parser";

// --- Middlewares y Rutas ---
import verifyToken from "./middlewares/auth.middleware.js";
import authRoutes from "./routes/auth.routes.js";
import predictionsRouter from "./routes/predictions.routes.js";
import alertRoutes from "./routes/alert.routes.js";
import activityLog from "./routes/activity.routes.js";
import securityRoutes from "./routes/security.routes.js";
import { swaggerMiddleware, swaggerUiSetup } from "./config/swagger.js";

const PORT = process.env.PORT || 3500;
const HOST = process.env.HOST || "0.0.0.0";

const app = express();

// Render proxy fix
app.set("trust proxy", 1);

// 1. Parser JSON
app.use(bodyParser.json({ limit: "10mb" }));

// 2. Seguridad y CORS
app.use(helmet());
app.use(
  cors({
    origin: "https://app-plannink-v2.onrender.com",
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "Accept",
    ],
  })
);

// 3. Logging
app.use(morgan("combined", { stream: logger.stream }));

// 4. Swagger UI
app.use("/api-docs", swaggerMiddleware, swaggerUiSetup);

// 5. DB Sync
sequelize
  .sync({ alter: true })
  .then(() => console.log("✅ Base de datos conectada y sincronizada"))
  .catch((err) => console.error("❌ Error de conexión a la DB:", err));

// 6. Rutas públicas
app.use("/api/security", securityRoutes);
app.use("/api/auth", authRoutes);

// 7. Rutas protegidas (token + rate limiting)
const protectedLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) =>
    handleHttpError(
      res,
      "TOO_MANY_REQUESTS",
      new Error("Límite de solicitudes excedido"),
      429
    ),
});

app.use("/api/predictions", protectedLimiter, verifyToken, predictionsRouter);
app.use("/api/alertas", protectedLimiter, verifyToken, alertRoutes);
app.use("/api/history", protectedLimiter, verifyToken, activityLog);

// 8. Health check
const healthResponse = async (req, res) => {
  const dbStatus = await sequelize
    .authenticate()
    .then(() => "connected")
    .catch(() => "disconnected");

  res.status(200).json({
    status: "OK",
    dbStatus,
    timestamp: new Date().toISOString(),
    service: "Inventory Prediction API",
    version: process.env.npm_package_version,
    environment: process.env.NODE_ENV || "development",
    port: PORT,
  });
};
app.get("/health", healthResponse);
app.get("/api/health", healthResponse);

// 9. Error handlers
app.use((req, res) =>
  handleHttpError(
    res,
    "NOT_FOUND",
    new Error(`Ruta no encontrada: ${req.originalUrl}`),
    404
  )
);
app.use((err, req, res, next) => {
  logger.error(`Error no manejado: ${err.stack}`);
  handleHttpError(res, "INTERNAL_SERVER_ERROR", err, 500);
});

// 10. Server start
app.listen(PORT, HOST, () => {
  console.log(`🚀 Servidor corriendo en http://${HOST}:${PORT}`);
});

export default app;
