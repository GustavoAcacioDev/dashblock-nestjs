# Dashblock Core (Backend)

NestJS backend for Dashblock - A Minecraft server management platform that allows users to create and manage multiple Minecraft servers on their remote instances.

## Features

- JWT-based authentication
- User registration and login
- Remote instance management (SSH connection to user's cloud server)
- Minecraft server creation and management (Vanilla, Paper, Fabric, Forge, Purpur)
- Server lifecycle control (start, stop, logs)
- Plan-based limits (FREE, PRO, PREMIUM)
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
ENCRYPTION_KEY="your-encryption-key-for-ssh-credentials"
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

**All auth endpoints do not require authentication.**

#### Register a new user
- `POST /api/auth/register`
  ```json
  {
    "email": "user@example.com",
    "password": "password123",
    "name": "John Doe"
  }
  ```

#### Login
- `POST /api/auth/login`
  ```json
  {
    "email": "user@example.com",
    "password": "password123"
  }
  ```

#### Get current user
- `GET /api/auth/me`
  - Header: `Authorization: Bearer <token>`
  - No body required

---

### Remote Instances

**All instance endpoints require JWT authentication.**

#### Create/connect a remote instance
- `POST /api/instances`
  ```json
  {
    "name": "My Oracle Server",
    "ipAddress": "192.168.1.100",
    "sshPort": 22,
    "sshUser": "ubuntu",
    "sshPassword": "mypassword123"
  }
  ```
  **OR with SSH key:**
  ```json
  {
    "name": "My Oracle Server",
    "ipAddress": "192.168.1.100",
    "sshPort": 22,
    "sshUser": "ubuntu",
    "sshKey": "-----BEGIN OPENSSH PRIVATE KEY-----\n..."
  }
  ```

#### Get user's instance
- `GET /api/instances`
  - No body required

#### Update instance configuration
- `PUT /api/instances`
  ```json
  {
    "name": "Updated Server Name",
    "ipAddress": "192.168.1.101",
    "sshPort": 2222
  }
  ```
  *All fields are optional*

#### Re-check instance connection
- `POST /api/instances/recheck`
  - No body required

#### Delete instance
- `DELETE /api/instances`
  - No body required

---

### Minecraft Servers

**All server endpoints require JWT authentication.**

#### Get plan limits
- `GET /api/servers/limits`
  - No body required

#### Get available plans
- `GET /api/servers/plans`
  - No body required

#### Create a new Minecraft server
- `POST /api/servers`

  **Vanilla Server:**
  ```json
  {
    "name": "My Vanilla Server",
    "description": "A simple vanilla Minecraft server",
    "version": "1.21.1",
    "type": "VANILLA",
    "allocatedRamMb": 2048,
    "maxPlayers": 20
  }
  ```

  **Paper Server:**
  ```json
  {
    "name": "My Paper Server",
    "description": "Optimized server with Paper",
    "version": "1.21.1",
    "type": "PAPER",
    "allocatedRamMb": 4096,
    "maxPlayers": 50
  }
  ```

  **Fabric Server:**
  ```json
  {
    "name": "My Fabric Server",
    "description": "Modded server with Fabric",
    "version": "1.21.1",
    "type": "FABRIC",
    "allocatedRamMb": 4096,
    "maxPlayers": 20
  }
  ```

  **Forge Server:**
  ```json
  {
    "name": "My Forge Server",
    "description": "Modded server with Forge",
    "version": "1.21.1",
    "type": "FORGE",
    "allocatedRamMb": 4096,
    "maxPlayers": 20
  }
  ```

  **Purpur Server:**
  ```json
  {
    "name": "My Purpur Server",
    "description": "Advanced Paper fork",
    "version": "1.21.1",
    "type": "PURPUR",
    "allocatedRamMb": 3072,
    "maxPlayers": 30
  }
  ```

  **Valid server types:** `VANILLA`, `PAPER`, `FABRIC`, `FORGE`, `PURPUR`

  **Supported versions:**
  - Paper: 1.20.1, 1.20.2, 1.20.4, 1.21, 1.21.1
  - Fabric: Any Minecraft version (installer auto-fetches)
  - Forge: 1.20.1, 1.20.2, 1.20.4, 1.21, 1.21.1
  - Vanilla: Any official Minecraft version
  - Purpur: Most modern versions

#### Get all servers
- `GET /api/servers`
  - No body required

#### Get a specific server
- `GET /api/servers/:id`
  - No body required

#### Start a server
- `POST /api/servers/:id/start`
  - No body required

#### Stop a server
- `POST /api/servers/:id/stop`
  - No body required

#### Update server configuration
- `PATCH /api/servers/:id`
  ```json
  {
    "name": "Updated Server Name",
    "description": "Updated description",
    "allocatedRamMb": 4096,
    "maxPlayers": 40
  }
  ```
  *All fields are optional*

#### Delete a server
- `DELETE /api/servers/:id`
  - No body required

#### Get server logs
- `GET /api/servers/:id/logs`
  - No body required

---

## Response Format

All API responses follow this structure:

**Success:**
```json
{
  "success": true,
  "data": { /* response data */ },
  "messages": ["Optional success messages"]
}
```

**Error:**
```json
{
  "success": false,
  "data": null,
  "messages": ["Error message describing what went wrong"]
}
```

---

## Plan Limits

| Plan    | Max Servers | Max Running Servers |
|---------|-------------|---------------------|
| FREE    | 3           | 1                   |
| PRO     | 10          | 3                   |
| PREMIUM | Unlimited   | 10                  |

---

## Project Structure

```
src/
├── auth/                    # Authentication module
│   ├── dto/                # Data transfer objects
│   ├── guards/             # Auth guards (JWT)
│   ├── strategies/         # Passport strategies
│   └── decorators/         # Custom decorators (@CurrentUser)
├── modules/
│   ├── instances/          # Remote instance management
│   │   ├── dto/           # Instance DTOs
│   │   └── services/      # Instance service
│   └── servers/            # Minecraft server management
│       ├── dto/           # Server DTOs
│       └── services/      # Server services (limits, port allocation)
├── common/                 # Shared utilities
│   └── helpers/           # Response helper
├── prisma/                # Prisma service
└── main.ts                # Application entry point
```

## Development

```bash
# Development mode
npm run start:dev

# Build
npm run build

# Production mode
npm run start:prod

# View Prisma Studio (Database GUI)
npx prisma studio
```

## Technologies

- **NestJS** - Progressive Node.js framework
- **Prisma** - Next-generation ORM
- **PostgreSQL** - Database
- **JWT** - Authentication
- **node-ssh** - SSH connection management
- **class-validator** - Request validation
