import Joi from 'joi';
import { logger } from '../utils/logger.js';

/**
 * Middleware Factory: Crea un middleware de validación para un esquema Joi dado.
 * @param {Joi.Schema} schema - El esquema de Joi para validar.
 * @returns {Function} - Un middleware de Express.
 */
const validateWith = (schema) => (req, res, next) => {
    // Validamos el cuerpo de la solicitud (req.body).
    const { error, value } = schema.validate(req.body, {
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


// --- Esquema de Validación para la Creación de Reportes ---

// El validador ahora espera un 'productCode' (string) en lugar de un 'productId'.
// Como la petición es de tipo form-data, este esquema se aplica a los campos de texto
// que acompañan al archivo.
export const validateCreateReport = validateWith(Joi.object({
    productCode: Joi.string().required().messages({
        'any.required': 'El campo "productCode" (SKU del producto) es requerido.',
        'string.empty': 'El campo "productCode" no puede estar vacío.'
    })
}));
