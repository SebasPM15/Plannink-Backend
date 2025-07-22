import jwt from 'jsonwebtoken';
import User from '../models/user.model.js';
import { logger } from '../utils/logger.js'; // Asegúrate de tener tu logger disponible

const verifyToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    //1. Validar el formato del Bearer Token
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Acceso no autorizado. Se requiere un Bearer Token.' });
    }

    const token = authHeader.split(' ')[1];

    try {
        // 2. Verificar el token con los mismos claims que se usaron para firmarlo.
        const decoded = jwt.verify(token, process.env.JWT_SECRET,{
            issuer: process.env.TOKEN_ISSUER,
            audience: process.env.TOKEN_AUDIENCE,
            algorithms: ['HS256']
        });

        // Verificar que el usuario exista
        const user = await User.findByPk(decoded.sub, {
            attributes: { exclude: ['password', 'verification_code', 'verification_code_expires'] }
        });

        if (!user) {
            return res.status(404).json({ message: 'El usuario asociado al token ya no existe.' });
        }

        req.user = user;
        next();
    } catch (error) {
        logger.error(`Error en la verificación del token: ${error.message}`);
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ message: 'El token ha expirado. Por favor, inicie sesión de nuevo.' });
        }
        if (error.name === 'JsonWebTokenError') {
            return res.status(403).json({ message: 'Token inválido o malformado.' });
        }
        return res.status(403).json({ message: 'Token inválido.' });
    }
};

export default verifyToken;