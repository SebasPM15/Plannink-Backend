import express from "express";
import cors from "cors";
import morgan from "morgan";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { handleHttpError } from "./utils/errorHandler.js";
import { logger } from "./utils/logger.js";
import sequelize from "./config/db.js";

// --- Importación de Middlewares y Rutas ---
import verifyToken from "./middlewares/auth.middleware.js";
import { decryptionMiddleware } from "./middlewares/decryption.middleware.js";
import { encryptionMiddleware } from "./middlewares/encryption.middleware.js";
import authRoutes from "./routes/auth.routes.js";
import predictionsRouter from "./routes/predictions.routes.js";
import alertRoutes from "./routes/alert.routes.js";
import activityLog from "./routes/activity.routes.js";
import securityRoutes from "./routes/security.routes.js";
import { swaggerMiddleware, swaggerUiSetup } from "./config/swagger.js";

const PORT = process.env.PORT || 3500;
const HOST = process.env.HOST || "0.0.0.0";

const app = express();

// 1. Seguridad esencial
app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "*",
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "Accept",
    ],
  })
);

// 2. Rate limiter para rutas protegidas
const protectedLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    handleHttpError(
      res,
      "TOO_MANY_REQUESTS",
      new Error("Límite de solicitudes excedido"),
      429
    );
  },
});

// 3. Middlewares básicos
app.use(morgan("combined", { stream: logger.stream }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// 4. Swagger UI
app.use("/api-docs", swaggerMiddleware, swaggerUiSetup);

// 5. Conexión a la base de datos
sequelize
  .sync({ alter: true })
  .then(() => console.log("✅ Base de datos conectada y sincronizada"))
  .catch((err) => console.error("❌ Error de conexión a la DB:", err));

// --- RUTAS ---

// A) Públicas (NO cifradas)
app.use("/api/security", securityRoutes);
app.use("/api/auth", authRoutes);

// B) Protegidas (requieren token Y pasan por cifrado/descifrado)
app.use(
  "/api/predictions",
  protectedLimiter,
  verifyToken,
  decryptionMiddleware,
  encryptionMiddleware,
  predictionsRouter
);

app.use(
  "/api/alertas",
  protectedLimiter,
  verifyToken,
  decryptionMiddleware,
  encryptionMiddleware,
  alertRoutes
);

app.use(
  "/api/history",
  protectedLimiter,
  verifyToken,
  decryptionMiddleware,
  encryptionMiddleware,
  activityLog
);

// C) Health Check (públicas)
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

// --- Manejo de errores ---
app.use((req, res) => {
  handleHttpError(
    res,
    "NOT_FOUND",
    new Error(`Ruta no encontrada: ${req.originalUrl}`),
    404
  );
});
app.use((err, req, res, next) => {
  logger.error(`Error no manejado: ${err.stack}`);
  handleHttpError(res, "INTERNAL_SERVER_ERROR", err, 500);
});

// Iniciar servidor
app.listen(PORT, HOST, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});

export default app;
