import Joi from 'joi';
import { validateWith } from './validation.middleware.js'; // Importa tu factory genérico

// Esquema para el registro de usuario
export const registerSchema = Joi.object({
    nombre: Joi.string().min(3).max(100).required(),
    email: Joi.string().email().required(),
    password: Joi.string().min(6).required(),
    celular: Joi.string().pattern(/^[0-9]+$/).min(9).max(15).required()
});

// Esquema para el login
export const loginSchema = Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required()
});

// Esquema para la verificación de cuenta y reenvío de código
export const emailSchema = Joi.object({
    email: Joi.string().email().required()
});

// Esquema para la verificación con código
export const verificationSchema = Joi.object({
    email: Joi.string().email().required(),
    verificationCode: Joi.string().length(6).required()
});

// Esquema para el reseteo de contraseña
export const resetPasswordSchema = Joi.object({
    email: Joi.string().email().required(),
    verificationCode: Joi.string().length(6).required(),
    newPassword: Joi.string().min(6).required()
});

// Exporta los middlewares de validación listos para usar
export const validateRegister = validateWith(registerSchema);
export const validateLogin = validateWith(loginSchema);
export const validateEmail = validateWith(emailSchema);
export const validateVerification = validateWith(verificationSchema);
export const validateResetPassword = validateWith(resetPasswordSchema);
