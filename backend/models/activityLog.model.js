import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';
import User from './user.model.js';
import Analysis from './analysis.model.js';

const ActivityLog = sequelize.define('ActivityLog', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
    },
    // Tipo de acción realizada (ej: 'CREACION_ANALISIS', 'OVERRIDE_SS', 'NUEVO_TRANSITO')
    actionType: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    // Descripción legible para el usuario de lo que ocurrió.
    description: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    // Objeto JSON con detalles técnicos o valores cambiados.
    details: {
        type: DataTypes.JSON,
        allowNull: true,
    },
    userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: User,
            key: 'id',
        },
    },
    // A qué análisis pertenece esta actividad.
    analysisId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: Analysis,
            key: 'id',
        },
    },
    // Opcional: A qué producto específico afecta la actividad.
    productCode: {
        type: DataTypes.STRING,
        allowNull: true,
    },
}, {
    tableName: 'activity_logs',
    timestamps: true,
    updatedAt: false, // Solo nos interesa cuándo se creó el log.
});

// Definir relaciones
ActivityLog.belongsTo(User, { foreignKey: 'userId' });
ActivityLog.belongsTo(Analysis, { foreignKey: 'analysisId' });
User.hasMany(ActivityLog, { foreignKey: 'userId' });
Analysis.hasMany(ActivityLog, { foreignKey: 'analysisId' });

export default ActivityLog;