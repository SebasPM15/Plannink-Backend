import { DataTypes } from 'sequelize';
import sequelize from '../config/db.js';
import User from './user.model.js';

const Report = sequelize.define('Report', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  filename: {
    type: DataTypes.STRING,
    allowNull: false,
  },
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
  // --- ¡CAMBIO CLAVE! ---
  // Reemplazamos 'productId' por 'productCode' para guardar el SKU directamente.
  productCode: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  content: {
    type: DataTypes.TEXT,
    allowNull: true
  },
}, {
  tableName: 'reports',
  timestamps: true,
  createdAt: 'createdAt',
  updatedAt: false, // Se establece en false ya que no se actualizan los reportes
});

// Definir la relación solo con User
Report.belongsTo(User, { foreignKey: 'userId' });
User.hasMany(Report, { foreignKey: 'userId' });

export default Report;