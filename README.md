# Dashblock Core (Backend)

NestJS backend for Dashblock application with authentication.

## Features

- JWT-based authentication
- User registration and login
- PostgreSQL database with Prisma ORM
- CORS enabled for frontend integration

## Setup

1. Install dependencies:
```bash
npm install
```

2. Configure environment variables in `.env`:
```
DATABASE_URL="postgresql://user:password@localhost:5432/dashblock"
JWT_SECRET="your-secret-key-change-in-production"
JWT_EXPIRATION="7d"
PORT=3001
FRONTEND_URL="http://localhost:3000"
```

3. Run database migrations:
```bash
npx prisma migrate dev
```

4. Generate Prisma client:
```bash
npx prisma generate
```

5. Start the development server:
```bash
npm run start:dev
```

The API will be available at `http://localhost:3001/api`

## API Endpoints

### Authentication

- `POST /api/auth/register` - Register a new user
  ```json
  {
    "email": "user@example.com",
    "password": "password123",
    "name": "User Name"
  }
  ```

- `POST /api/auth/login` - Login
  ```json
  {
    "email": "user@example.com",
    "password": "password123"
  }
  ```

- `GET /api/auth/me` - Get current user (requires JWT token)
  - Header: `Authorization: Bearer <token>`

## Project Structure

```
src/
├── auth/              # Authentication module
│   ├── dto/          # Data transfer objects
│   ├── guards/       # Auth guards
│   ├── strategies/   # Passport strategies
│   └── decorators/   # Custom decorators
├── prisma/           # Prisma service
└── main.ts           # Application entry point
```

## Development

```bash
# Development mode
npm run start:dev

# Build
npm run build

# Production mode
npm run start:prod
```
