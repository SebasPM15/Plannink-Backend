import Joi from 'joi';
import { validateWith } from './validation.middleware.js'; // Importa tu factory genérico
import { logger } from '../utils/logger.js';

// Esquema para validar la estructura de la petición de alerta
const sendAlertSchema = Joi.object({
    // Validamos que predictionData sea un objeto con la estructura esperada
    predictionData: Joi.object({
        success: Joi.boolean().required(),
        data: Joi.object({
            CODIGO: Joi.string().required()
            // Puedes añadir más validaciones de la estructura interna si lo deseas
        }).unknown(true).required() // .unknown(true) permite otras claves no definidas
    }).required(),
    isManual: Joi.boolean().default(false)
});

// Middleware de validación con logging
export const validateSendAlert = (req, res, next) => {
    // Log del body antes de la validación
    logger.info('Body antes de validación:', JSON.stringify(req.body, null, 2));
    
    // Validamos el cuerpo de la solicitud (req.body).
    const { error, value } = sendAlertSchema.validate(req.body, {
        abortEarly: false,
        stripUnknown: true,
        convert: true
    });

    if (error) {
        logger.warn(`Error de validación: ${error.details.map(d => d.message).join(', ')}`);
        
        return res.status(422).json({
            error: 'VALIDATION_ERROR',
            messages: error.details.map(d => d.message)
        });
    }

    // Sobrescribir req.body con los datos validados y sanitizados por Joi.
    req.body = value;
    next();
};
