// models/analysis.model.js
import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';
import User from './user.model.js';

const Analysis = sequelize.define('Analysis', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
    },
    // Un nombre descriptivo que el usuario le da al análisis
    name: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    // El nombre del archivo original, por referencia
    originalFileName: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    // La ruta del archivo dentro del bucket de Supabase
    storagePath: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    // La URL pública para acceder al archivo
    url: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
            model: User,
            key: 'id',
        },
    },
}, {
    tableName: 'analyses',
    timestamps: true,
});

// Definir la relación
Analysis.belongsTo(User, { foreignKey: 'userId' });
User.hasMany(Analysis, { foreignKey: 'userId' });

export default Analysis;