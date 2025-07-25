import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  register,
  resendVerificationCode,
  verifyRegistration,
  login,
  logout,
  requestPasswordReset,
  resetPassword,
  verifyResetCode,
} from "../controllers/auth.controller.js";

// --- Middlewares de Seguridad y Validación ---
import verifyToken from "../middlewares/auth.middleware.js";
import {
  validateRegister,
  validateLogin,
  validateEmail,
  validateVerification,
  validateResetPassword,
} from "../middlewares/auth.validation.js";

const router = Router();

// --- Configuración de Rate Limiting ---

// Limiter general para la mayoría de las rutas de autenticación
// const authLimiter = rateLimit({
// 	windowMs: 15 * 60 * 1000, // 15 minutos
// 	max: 20, // Limita cada IP a 20 peticiones por ventana (registro, login, etc.)
// 	standardHeaders: true,
// 	legacyHeaders: false,
// 	message: {
//         success: false,
//         error: 'TOO_MANY_REQUESTS',
//         message: 'Demasiadas solicitudes desde esta IP, por favor intente de nuevo después de 15 minutos.'
//     }
// });

// Limiter más estricto para las funciones de reseteo de contraseña para prevenir spam
const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 5, // Limita cada IP a 5 peticiones de reseteo por hora
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "TOO_MANY_REQUESTS",
    message:
      "Demasiadas solicitudes de reseteo de contraseña, por favor intente de nuevo más tarde.",
  },
});

// =============================================================================
// RUTAS PÚBLICAS CON RATE LIMITING Y VALIDACIÓN
// =============================================================================

// Aplicar limiter y validador a cada ruta
router.post("/register", validateRegister, register);
router.post("/resend-verification", validateEmail, resendVerificationCode);
router.post("/verify", validateVerification, verifyRegistration);
router.post("/login", validateLogin, login);

// Rutas de reseteo de contraseña con un limiter más estricto
router.post(
  "/request-password-reset",
  passwordResetLimiter,
  validateEmail,
  requestPasswordReset
);
router.post(
  "/verify-reset-code",
  passwordResetLimiter,
  validateVerification,
  verifyResetCode
);
router.post(
  "/reset-password",
  passwordResetLimiter,
  validateResetPassword,
  resetPassword
);

// =============================================================================
// RUTAS PROTEGIDAS (Requieren autenticación)
// =============================================================================

// La ruta de logout es la única que necesita verificar el token de sesión
// No necesita un rate limiter tan estricto porque requiere un token válido para usarse.
router.post("/logout", verifyToken, logout);

export default router;
