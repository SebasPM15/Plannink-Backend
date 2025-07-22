# 📦 Plannink – Plataforma de Predicción de Inventarios (Backend)

Este repositorio contiene el **servicio backend** de Plannink, una API REST para gestionar productos, consumos mensuales y generar predicciones de inventario con IA.

---

## 🚀 Características principales

- **CRUD de Productos**  
  Registro de productos con código único, descripción, unidades por caja y stock total.

- **Validaciones Avanzadas**

  - Código de producto único.
  - Mínimo de 5 consumos mensuales válidos (> 0).
  - No se permiten valores negativos.

- **Predicción de Inventario**  
  Procesamiento de un Excel con datos de consumo + modelo Python para generar proyecciones.

- **Cifrado y Seguridad**

  - Autenticación JWT (Bearer tokens).
  - Endpoints de cifrado/descifrado automático de payloads.
  - Exposición de llave pública para clientes.

- **Documentación Swagger UI**  
  Toda la API documentada en `/api-docs` con OpenAPI 3.0.

---

## 🛠 Tecnologías

- **Node.js & Express**: Servidor y rutas.
- **Sequelize + PostgreSQL**: ORM y persistencia de datos.
- **Python 3**: Modelo de predicción (ubicado en `ai_model/`).
- **Swagger / OpenAPI**: Documentación interactiva.
- **Helmet, CORS, Rate-Limit, Morgan, Winston**: Seguridad, logging y control de tasa.

---

## 📁 Estructura del proyecto (carpeta `backend/`)

ai_model/ # Código del modelo Python
├─ requirements.txt # Dependencias Python
└─ src/ # Lógica de predicción
backend/
├─ config/ # Configuración (DB, constantes)
├─ controllers/ # Lógica de cada endpoint
├─ middlewares/ # Autenticación, cifrado, validaciones
├─ models/ # Definición de entidades Sequelize
├─ routes/ # Definición de rutas Express
├─ services/ # Lógica de negocio y llamadas a IA
├─ utils/ # Helpers (logger, errorHandler, etc.)
├─ public/ # Archivos estáticos (si aplica)
├─ temp/ # Almacenamiento temporal de uploads
├─ .env # Variables de entorno
├─ app.js # Punto de entrada Express
├─ package.json # Dependencias Node.js
└─ Dockerfile # Imagen Docker del backend

---

## ⚙️ Variables de entorno (`.env`)

```dotenv
# -------------------------
# APP
# -------------------------
PORT=3500
NODE_ENV=development

# -------------------------
# JWT
# -------------------------
JWT_SECRET=change_me_super_secret_64chars_min
TOKEN_EXPIRES_IN=1h
TOKEN_ISSUER=https://your-domain.com
TOKEN_AUDIENCE=https://your-frontend.com

# -------------------------
# DATABASE (PostgreSQL)
# Usa UNA de las dos formas (URL completa o variables separadas)
# -------------------------
DATABASE_URL=postgresql://user:password@host:5432/dbname

DB_HOST=localhost
DB_PORT=5432
DB_NAME=plannink
DB_USER=postgres
DB_PASSWORD=postgres
DB_SSL=false

# -------------------------
# EMAIL (SMTP)
# -------------------------
EMAIL_USER=your_email@example.com
EMAIL_PASSWORD=app_password_or_token
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587

# -------------------------
# SUPABASE
# -------------------------
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_KEY=your_service_role_key_here

# -------------------------
# OTROS
# -------------------------
CORS_ORIGIN=http://localhost:3000

```

## 🛠️ Instalación y ejecución

Clonar y moverse al backend

- **git clone https://github.com/tu-usuario/plannink-backend.git**
- **cd plannink-backend/backend**

# Instalar dependencias Node.js

**npm install**

# Instalar dependencias Python para IA\*\*

_cd ai_model_

_pip install -r requirements.txt_

# Migraciones y sincronización

- Si usas migraciones Sequelize:

\*npx sequelize-cli db:migrate o bien deja que Sequelize sincronice automáticamente (opción sync({ alter: true })).

# Levantar el servidor

**En modo desarrollo (con hot-reload):**

_npm run dev_

**En producción:**

_npm start_

Ver documentación Swagger

Abre en tu navegador:

http://localhost:3500/api-docs
