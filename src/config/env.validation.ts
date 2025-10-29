import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  // Database
  DATABASE_URL: Joi.string().required(),

  // JWT Authentication
  JWT_SECRET: Joi.string().min(32).required().messages({
    'string.min': 'JWT_SECRET must be at least 32 characters long',
    'any.required': 'JWT_SECRET is required for secure authentication',
  }),

  // Encryption (CRITICAL FOR PRODUCTION)
  ENCRYPTION_KEY: Joi.string().min(32).required().messages({
    'string.min': 'ENCRYPTION_KEY must be at least 32 characters long',
    'any.required':
      'ENCRYPTION_KEY is required to encrypt SSH credentials and RCON passwords',
  }),

  // Server Configuration
  PORT: Joi.number().default(3000),
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),

  // Frontend URL (for CORS)
  FRONTEND_URL: Joi.string().default('http://localhost:3001'),
});

export interface EnvironmentVariables {
  DATABASE_URL: string;
  JWT_SECRET: string;
  ENCRYPTION_KEY: string;
  PORT: number;
  NODE_ENV: 'development' | 'production' | 'test';
  FRONTEND_URL: string;
}
