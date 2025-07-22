// File: controllers/auth.controller.js
import AuthService from "../services/authService.js";
import { handleHttpError } from "../utils/errorHandler.js";

const fmtUser = (u) => ({
  id: u.id,
  nombre: u.nombre,
  email: u.email,
  celular: u.celular,
});

/**
 * @swagger
 * tags:
 *   name: Auth
 *   description: Autenticación y gestión de usuarios
 */

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Registra un nuevo usuario
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [nombre,email,password,celular]
 *             properties:
 *               nombre: { type: string }
 *               email: { type: string, format: email }
 *               password: { type: string }
 *               celular: { type: string }
 *     responses:
 *       201:
 *         description: Usuario creado
 */
export const register = async (req, res) => {
  try {
    const { user, token, message } = await AuthService.register(req.body);
    res
      .status(201)
      .json({ success: true, message, token, user: fmtUser(user) });
  } catch (err) {
    handleHttpError(res, "REGISTER_ERROR", err, err.status || 400);
  }
};

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Loguea un usuario existente
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email,password]
 *             properties:
 *               email: { type: string }
 *               password: { type: string }
 *     responses:
 *       200:
 *         description: Login exitoso
 */
export const login = async (req, res) => {
  try {
    const { user, token, message } = await AuthService.login(
      req.body.email,
      req.body.password
    );
    res
      .status(200)
      .json({ success: true, message, token, user: fmtUser(user) });
  } catch (err) {
    handleHttpError(res, "LOGIN_ERROR", err, err.status || 400);
  }
};

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Cierra sesión (invalida token)
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logout satisfactorio
 */
export const logout = async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    await AuthService.logout(token);
    res.status(200).json({ success: true, message: "Logout exitoso" });
  } catch (err) {
    handleHttpError(res, "LOGOUT_ERROR", err, err.status || 500);
  }
};

/**
 * @swagger
 * /api/auth/request-reset:
 *   post:
 *     summary: Solicita código para restablecer contraseña
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string }
 *     responses:
 *       200:
 *         description: Código enviado
 */
export const requestPasswordReset = async (req, res) => {
  try {
    const { message } = await AuthService.requestPasswordReset(req.body.email);
    res.status(200).json({ success: true, message });
  } catch (err) {
    handleHttpError(res, "REQUEST_RESET_ERROR", err, err.status || 400);
  }
};

/**
 * @swagger
 * /api/auth/verify-reset:
 *   post:
 *     summary: Verifica código de restablecimiento
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email,verificationCode]
 *             properties:
 *               email: { type: string }
 *               verificationCode: { type: string }
 *     responses:
 *       200:
 *         description: Código verificado
 */
export const verifyResetCode = async (req, res) => {
  try {
    const { message } = await AuthService.verifyResetCode(req.body);
    res.status(200).json({ success: true, message });
  } catch (err) {
    handleHttpError(res, "VERIFY_RESET_ERROR", err, err.status || 400);
  }
};

/**
 * @swagger
 * /api/auth/reset-password:
 *   post:
 *     summary: Restablece la contraseña
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email,verificationCode,newPassword]
 *             properties:
 *               email: { type: string }
 *               verificationCode: { type: string }
 *               newPassword: { type: string }
 *     responses:
 *       200:
 *         description: Contraseña actualizada
 */
export const resetPassword = async (req, res) => {
  try {
    const { message } = await AuthService.resetPassword(req.body);
    res.status(200).json({ success: true, message });
  } catch (err) {
    handleHttpError(res, "RESET_PASSWORD_ERROR", err, err.status || 400);
  }
};
