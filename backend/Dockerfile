# backend/Dockerfile

FROM python:3.10-slim

# 1) Dependencias del sistema y Node 18
RUN apt-get update && \
    apt-get install -y --no-install-recommends build-essential python3-dev python3-pip curl gnupg && \
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# --- Python deps ---
# Copiamos solo requirements para aprovechar cache
COPY ai_model/requirements.txt /tmp/ai_model/requirements.txt
RUN pip install --no-cache-dir -r /tmp/ai_model/requirements.txt

# --- Instala deps de Node (backend) ---
WORKDIR /usr/src/backend
COPY backend/package*.json ./
RUN npm install && npm rebuild bcrypt --build-from-source

# --- Copia código ---
# Copia backend
COPY backend/ ./
# Copia modelo IA a su propia ruta (no dentro del backend)
COPY ai_model/ /usr/src/ai_model/

# Variables de entorno
ENV PYTHONPATH=/usr/src/ai_model \
    AI_MODEL_DIR=/usr/src/ai_model

EXPOSE 3500
CMD ["npm", "run", "dev"]
