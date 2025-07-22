import jwt from 'jsonwebtoken';
import { logger } from './logger.js'; // Es buena práctica tener un logger centralizado.

const generateToken = (user) => {
    //1. Claims para mayor estándar y seguridad
    const payload = {
        sub: user.id,

        // 'iss' (Issuer): Quien emite el token. Debe ser tu backend.
        // Esto asegura que solo los tokens generados por tu API sean válidos.
        iss: 'https://app-plannink.onrender.com',
        
        // 'aud' (Audience): Para quién es el token. Debe ser tu frontend.
        // Previene que el token sea usado en una aplicación diferente.
        aud: 'https://app-plannink-v2.onrender.com',
        email: user.email,
    };

    if(!process.env.JWT_SECRET) {
        logger.error('FATAL ERROR: JWT_SECRET no está definido en las variables de entorno.');
        throw new Error('La configuración de seguridad del servidor es incompleta.');
    }

    //2. Firmar el token
    return jwt.sign(payload, process.env.JWT_SECRET, {
        expiresIn: process.env.TOKEN_EXPIRES_IN || '1h',
        algorithm: 'HS256' // 4. Prevenir ataques de degradación de algoritmo.
    });
};

export default generateToken;
