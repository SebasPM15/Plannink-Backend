// File: routes/auth.routes.js
import { Router } from "express";
import rateLimit from "express-rate-limit";
import verifyToken from "../middlewares/auth.middleware.js";
import {
  register,
  login,
  logout,
  requestPasswordReset,
  verifyResetCode,
  resetPassword,
} from "../controllers/auth.controller.js";
import {
  validateRegister,
  validateLogin,
  validateEmail,
  validateVerification,
  validateResetPassword,
} from "../middlewares/auth.validation.js";

const router = Router();
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

router.post("/register", authLimiter, validateRegister, register);
router.post("/login", authLimiter, validateLogin, login);

router.post("/logout", verifyToken, logout);

router.post("/request-reset", authLimiter, validateEmail, requestPasswordReset);
router.post(
  "/verify-reset",
  authLimiter,
  validateVerification,
  verifyResetCode
);
router.post(
  "/reset-password",
  authLimiter,
  validateResetPassword,
  resetPassword
);

export default router;
