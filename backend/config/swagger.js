// swagger.js
import swaggerUi from "swagger-ui-express";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

// Get the directory name for relative paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load the OpenAPI specification from a JSON file
const swaggerDocument = JSON.parse(
  fs.readFileSync(path.join(__dirname, "swagger.json"), "utf8")
);

// Swagger setup
const swaggerOptions = {
  swaggerOptions: {
    validatorUrl: null,
  },
};

// Export the middleware for use in app.js
export const swaggerMiddleware = swaggerUi.serve;
export const swaggerUiSetup = swaggerUi.setup(swaggerDocument, swaggerOptions);
