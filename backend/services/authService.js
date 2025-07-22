import bcrypt from 'bcrypt';
import User from '../models/user.model.js';
import Session from '../models/Session.js';
import generateToken from '../utils/generateToken.js';
import { generateVerificationCode } from '../utils/generateVerificationCode.js';
import emailService from './emailService.js';

// 1. Aumentar el costo de hashing para mayor seguridad contra fuerza bruta
const BCRYPT_SALT_ROUNDS = 12;

class AuthService {
    async register(nombre, email, password, celular) {
        const existingUser = await User.findOne({ where: { email } });

        if (existingUser && existingUser.is_verified) {
            throw new Error('El correo ya está registrado y verificado');
        }

        // Sobreescribir datos del usuario no verificado
        const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
        const verificationCode = generateVerificationCode();
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutos de validez

        let user;
        if (existingUser) {
            await existingUser.update({
                password_hash: passwordHash,
                nombre,
                celular,
                verification_code: verificationCode,
                verification_code_expires: expiresAt,
            });
            user = existingUser;
        } else {
            user = await User.create({
                nombre, email, celular,
                password_hash: passwordHash,
                verification_code: verificationCode,
                verification_code_expires: expiresAt,
                is_verified: false
            });
        }

        // Enviar el correo con el código de verificación
        await emailService.sendVerificationEmail(email, verificationCode);
        // Devolver confirmación sin código
        return { user, message: 'Se ha enviado un nuevo código de verificación a tu correo' };
    }

    async resendVerificationCode(email) {
        // Buscar el usuario por email
        const user = await User.findOne({ where: { email } });
        if (!user) throw new Error('Usuario no encontrado');

        // Verificar que el usuario no esté verificado
        if (user.is_verified) throw new Error('El usuario ya está verificado');

        // Generar un nuevo código de verificación y actualizar tiempo de expiración
        const newVerificationCode = generateVerificationCode();
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutos de validez

        // Actualizar el usuario con el nuevo código y tiempo de expiración
        await user.update({
            verification_code: newVerificationCode,
            verification_code_expires: expiresAt,
        });

        // Enviar correo con el nuevo código de verificación
        await emailService.sendVerificationEmail(email, newVerificationCode);

        // Devolver confirmación sin el código
        return { message: 'Se ha reenviado un nuevo código de verificación a tu correo' };
    }

    async verifyRegistration(email, verificationCode) {
        // Verificar si el usuario existe
        const user = await User.findOne({ where: { email } });
        if (!user || user.verification_code !== verificationCode) {
            throw new Error('Código de verificación inválido o el usuario no existe.');
        }

        if (user.is_verified) throw new Error('El usuario ya está verificado');

        // Validar si el código ha expirado
        const now = new Date();
        if (user.verification_code_expires < now) {
            await user.update({ verification_code: null, verification_code_expires: null });
            throw new Error('El código de verificación ha expirado. Por favor, solicita uno nuevo.');
        }

        // Marcar como verificado y limpiar el código y tiempo de expiración
        await user.update({
            is_verified: true,
            verification_code: null,
            verification_code_expires: null,
        });

        // Generar Token JWT y guardar sesión
        const token = generateToken(user);
        await Session.create({
            user_id: user.id,
            token,
            expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000), // 1 día
        });

        return { user, token };
    }

    async login(email, password) {
        // Buscar usuario por email
        const user = await User.findOne({ where: { email } });
        if (!user) throw new Error('Usuario no encontrado');

        // Validar contraseña
        // Prevenir enumeración de usuarios. La comparación de hash se hace de forma segura
        // incluso si el usuario no existe para que el tiempo de respuesta sea similar.
        const isPasswordValid = user ? await bcrypt.compare(password, user.password_hash) : false;

        if (!user || !isPasswordValid) {
            throw new Error('Credenciales inválidas'); // Mensaje genérico
        }

        if (!user.is_verified) {
            throw new Error('Por favor, verifica tu cuenta primero');
        }

        // Generar token JWT y actualizar sesión
        const token = generateToken(user);
        await Session.create({
            user_id: user.id,
            token,
            expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000) // 1 día
        });

        return { user, token };
    }

    async logout(token) {
        const session = await Session.findOne({ where: { token } });
        if (!session) throw new Error('Sesión no encontrada');

        await session.destroy();
        return { message: 'Sesión cerrada exitosamente' };
    }

    async requestPasswordReset(email) {
        const user = await User.findOne({ where: { email } });
        if (!user) throw new Error('Usuario no encontrado');
        if (!user.is_verified) throw new Error('El usuario no está verificado');

        const verificationCode = generateVerificationCode();
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

        await user.update({
            verification_code: verificationCode,
            verification_code_expires: expiresAt,
        });

        await emailService.sendPasswordResetEmail(email, verificationCode);
        return { message: 'Se ha enviado un código de verificación a tu correo para restablecer la contraseña' };
    }

    async verifyResetCode(email, verificationCode) {
        const user = await User.findOne({ where: { email } });
        if (!user || user.verification_code !== verificationCode) throw new Error('Código de verificación incorrecto');

        const now = new Date();
        if (user.verification_code_expires < now) {
            await user.update({ verification_code: null, verification_code_expires: null });
            throw new Error('El código de verificación ha expirado. Por favor, solicita uno nuevo.');
        }

        return { message: 'Código de verificación válido' };
    }

    async resetPassword(email, verificationCode, newPassword) {
        const user = await User.findOne({ where: { email } });
        if (!user || user.verification_code !== verificationCode) {
            throw new Error('Código de verificación inválido.');
        }

        const now = new Date();
        if (user.verification_code_expires < now) {
            await user.update({ verification_code: null, verification_code_expires: null });
            throw new Error('El código de verificación ha expirado.');
        }

        const passwordHash = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);
        await user.update({
            password_hash: passwordHash,
            verification_code: null,
            verification_code_expires: null,
        });

        await Session.destroy({ where: { user_id: user.id } });
        return { message: 'Contraseña restablecida exitosamente. Por favor, inicia sesión con tu nueva contraseña.' };
    }
}

export default new AuthService();