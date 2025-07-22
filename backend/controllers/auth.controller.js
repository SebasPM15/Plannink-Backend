import AuthService from '../services/authService.js';
import { handleHttpError } from '../utils/errorHandler.js';

// Función para limpiar y formatear la respuesta del usuario
const formatUserResponse = (user) => ({
    id: user.id,
    nombre: user.nombre,
    email: user.email,
    celular: user.celular
});

// Registro
export const register = async (req, res) => {
    try {
        // La validación ya fue hecha por el middleware
        const { nombre, email, password, celular } = req.body;
        const { user, message } = await AuthService.register(nombre, email, password, celular);

        res.status(201).json({
            success: true,
            message,
            user: formatUserResponse(user)
        });
    } catch (error) {
        handleHttpError(res, 'REGISTER_ERROR', error, error.status || 500);
    }
};

// Reenviar código de verificación
export const resendVerificationCode = async (req, res) => {
    try {
        const { email } = req.body;
        // Llamar al servicio para reenviar el código
        const { message } = await AuthService.resendVerificationCode(email);
        res.status(200).json({ success: true, message });
    } catch (error) {
        handleHttpError(res, 'RESEND_CODE_ERROR', error, error.status || 500);
    }
};

// Verificar registro
export const verifyRegistration = async (req, res) => {
    try {
        const { email, verificationCode } = req.body;
        // Llamar al servicio para verificar el registro
        const { user, token } = await AuthService.verifyRegistration(email, verificationCode);
        res.status(200).json({
            success: true,
            message: 'Usuario verificado exitosamente',
            user: formatUserResponse(user),
            token
        });
    } catch (error) {
        handleHttpError(res, 'VERIFY_ERROR', error, error.status || 500);
    }
};

// Login
export const login = async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                error: 'MISSING_CREDENTIALS',
                message: 'Email y contraseña son requeridos'
            });
        }
        
        // Llamar al servicio para iniciar sesión
        const { user, token } = await AuthService.login(email, password);
        
        res.status(200).json({
            success: true,
            message: 'Login exitoso',
            user: formatUserResponse(user),
            token
        });
    } catch (error) {
        handleHttpError(res, 'LOGIN_ERROR', error, error.status || 500);
    }
};

export const logout = async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return handleHttpError(res, 'NO_TOKEN_PROVIDED', new Error('Token no proporcionado.'), 401);
        }
        const { message } = await AuthService.logout(token);
        res.status(200).json({ success: true, message });
    } catch (error) {
        handleHttpError(res, 'LOGOUT_ERROR', error, error.status || 500);
    }
};

// Solicitar restablecimiento de contraseña
export const requestPasswordReset = async (req, res) => {
    try {
        const { email } = req.body;
        const { message } = await AuthService.requestPasswordReset(email);
        res.status(200).json({ success: true, message });
    } catch (error) {
        handleHttpError(res, 'REQUEST_PASSWORD_RESET_ERROR', error, error.status || 500);
    }
};

// Verificar código de restablecimiento
export const verifyResetCode = async (req, res) => {
    try {
        const { email, verificationCode } = req.body;
        const { message } = await AuthService.verifyResetCode(email, verificationCode);
        res.status(200).json({ success: true, message });
    } catch (error) {
        handleHttpError(res, 'VERIFY_RESET_CODE_ERROR', error, error.status || 500);
    }
};

// Restablecer contraseña
export const resetPassword = async (req, res) => {
    try {
        const { email, verificationCode, newPassword } = req.body;
        const { message } = await AuthService.resetPassword(email, verificationCode, newPassword);
        res.status(200).json({ success: true, message });
    } catch (error) {
        handleHttpError(res, 'RESET_PASSWORD_ERROR', error, error.status || 500);
    }
};