import Joi from 'joi';
import { logger } from '../utils/logger.js';
import path from 'path'; // Importa el módulo 'path' de Node.js

/**
 * Middleware Factory: Crea un middleware de validación para un esquema Joi dado.
 * @param {Joi.Schema} schema - El esquema de Joi para validar.
 * @returns {Function} - Un middleware de Express.
 */
export const validateWith = (schema) => (req, res, next) => {
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

    // --- LÓGICA MEJORADA PARA EL NOMBRE DEL ANÁLISIS ---
    // Solo aplicar esta lógica si la ruta es /api/predictions/refresh y el método es POST
    const isRefreshRoute = req.originalUrl?.includes('/api/predictions/refresh') && req.method === 'POST';
    if (isRefreshRoute) {
        if (!value.analysisName && req.file) {
            value.analysisName = path.parse(req.file.originalname).name;
        } else if (!value.analysisName && !req.file) {
            const timestamp = new Date().toLocaleString('es-EC', { timeZone: 'America/Guayaquil' });
            value.analysisName = `Análisis Automático - ${timestamp}`;
        }
    }

    // Sobrescribimos req.body con los datos validados y con el nombre del análisis ya establecido.
    req.body = value;
    next();
};


// =============================================================================
// ESQUEMAS DE VALIDACIÓN PARA LAS RUTAS DE PREDICCIONES
// =============================================================================

// Esquema para los parámetros de la simulación inicial ('/refresh')
export const refreshParamsSchema = Joi.object({
    // 👇 ¡AQUÍ ESTÁ EL CAMBIO!
    // 'analysisName' ahora es opcional. El middleware se encargará de poner el valor por defecto.
    analysisName: Joi.string().optional().allow(''),
    
    // El resto de los campos mantienen sus valores por defecto.
    serviceLevel: Joi.number().min(0).max(100).default(99.99),
    diasOperacion: Joi.number().integer().min(1).max(30).default(22),
    minUnidadesCaja: Joi.number().min(0).default(1.0),
    leadTimeDays: Joi.number().integer().min(1).max(365).default(20),
    safetyStock: Joi.number().min(0).allow(null).default(null)
});

// Esquema para actualizar el stock de seguridad
export const safetyStockSchema = Joi.object({
    safetyStock: Joi.number().min(0).required().messages({
        'any.required': 'El campo safetyStock es requerido.',
        'number.base': 'El stock de seguridad debe ser un número.',
        'number.min': 'El stock de seguridad no puede ser negativo.'
    })
});

// Esquema para actualizar una alerta
export const updateAlertSchema = Joi.object({
    unidades: Joi.number().min(0),
    lead_time_especifico: Joi.number().integer().min(0)
}).or('unidades', 'lead_time_especifico').messages({ // Al menos uno de los dos es requerido
    'object.missing': 'Debe proporcionar al menos "unidades" o "lead_time_especifico" para actualizar.'
});

// Esquema para añadir unidades en tránsito manuales
export const transitUnitsSchema = Joi.object({
    units: Joi.number().positive().required().messages({
        'any.required': 'El campo "units" es requerido.',
        'number.positive': 'Las unidades deben ser un número positivo.'
    }),
    expectedArrivalDate: Joi.date().iso().required().messages({
        'any.required': 'El campo "expectedArrivalDate" es requerido y debe estar en formato YYYY-MM-DD.',
        'date.format': 'La fecha de arribo debe estar en formato ISO (YYYY-MM-DD).'
    }),
    poNumber: Joi.string().allow(null, '') // Opcional
});