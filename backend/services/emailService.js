import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import { text } from 'stream/consumers';
import sanitizeHtml from 'sanitize-html'; // Importamos la librería
import { logger } from '../utils/logger.js';

dotenv.config();

class EmailService {
    constructor() {
        //1. Configuración flexible y centralizada de Transporter
        if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD || !process.env.EMAIL_HOST || !process.env.EMAIL_PORT) {
            logger.error('Configuración de email incompleta en variables de entorno.');
            throw new Error('Las credenciales de email no están completamente configuradas.');
        }

        this.transporter = nodemailer.createTransport({
            host: process.env.EMAIL_HOST,
            port: parseInt(process.env.EMAIL_PORT, 10),
            secure: process.env.EMAIL_PORT === '465',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASSWORD,
            },
            // Añadir esta opción puede ayudar con algunos proveedores de correo y firewalls
            tls: {
                ciphers:'SSLv3'
            }
        });
    }

    //2. Método de envío principal y genérico
    async sendEmail({ to, subject, html, text, fromName = 'Plannink' }) {
        // 3. Sanitizar el HTML final antes de enviarlo
        const cleanHtml = sanitizeHtml(html, {
            allowedTags: ['h2', 'p', 'strong', 'a', 'div'], // Etiquetas permitidas
            allowedAttributes: {
                'a': ['href'], // Permitir el atributo href en los enlaces
                'div': ['style'] // Ejemplo: si necesitaras permitir estilos en un div
            }
        });

        const mailOptions = {
            from: `"${sanitizeHtml(fromName, {allowedTags: []})}" <${process.env.EMAIL_USER}>`,
            to,
            subject,
            html: cleanHtml,
            text: text || 'Este correo requiere un cliente con capacidad HTML para ser visualizado.'
        };

        try {
            const info = await this.transporter.sendMail(mailOptions);
            logger.info(`Correo enviado a ${to}. MessageId: ${info.messageId}`);
            return { success: true, message: 'Correo enviado correctamente.', messageId: info.messageId };
        } catch (error) {
            logger.error(`Error al enviar correo a ${to}`, { errorMessage: error.message, stack: error.stack });
            throw new Error('No se pudo enviar el correo.');
        }
    }

    // 4. Plantilla HTML base para consistencia
    _createHtmlWrapper(title, body) {
        // No sanitizamos aquí, se hará en el método `sendEmail` sobre el resultado final.
        return `
            <div>
                <h2>${title}</h2>
                ${body}
                <p>Si no solicitaste esto, por favor ignora este mensaje.</p>
            </div>
        `;
    }

    async sendVerificationEmail(toEmail, verificationCode) {
        const title = 'Código de Verificación - Plannink';
        // El código en sí no debe tener HTML, pero lo envolvemos en strong
        const body = `
            <p>Gracias por registrarte.</p>
            <p>Tu código de verificación es: <strong>${verificationCode}</strong></p>
            <p>Este código es válido por 15 minutos.</p>
        `;
        const html = this._createHtmlWrapper(title, body);
        const text = `Tu código de verificación es: ${verificationCode}. Válido por 15 minutos.`;

        return this.sendEmail({ to: toEmail, subject: title, html, text });
    }

    async sendPasswordResetEmail(toEmail, verificationCode) {
        const title = 'Restablecer Contraseña - Plannink';
        const body = `
            <p>Recibimos una solicitud para restablecer tu contraseña.</p>
            <p>Tu código de verificación es: <strong>${verificationCode}</strong></p>
            <p>Este código es válido por 15 minutos.</p>
            <p><a href="https://app-plannink-v2.onrender.com/reset-password">Restablecer mi contraseña</a></p>
        `;
        const html = this._createHtmlWrapper(title, body);
        const text = `Tu código para restablecer la contraseña es: ${verificationCode}. Válido por 15 minutos.`;

        return this.sendEmail({ to: toEmail, subject: title, html, text });
    }
};

export default new EmailService();