# UandWe Labs - Backend API (Node.js + Express + Neo4j)

A high-performance backend with **Express.js** and **Neo4j Graph Database** providing secure User Authentication with JWT, password hashing with bcrypt, and Graph data modeling.

---

## 🛠️ Tech Stack
- **Runtime:** Node.js (ES Modules)
- **Framework:** Express.js
- **Database:** Neo4j (via official `neo4j-driver`)
- **Authentication:** JSON Web Tokens (`jsonwebtoken`)
- **Security:** `bcryptjs` for password hashing, `cors`, `dotenv`

---

## 🚀 Quick Start

### 1. Install Dependencies
```bash
cd server
npm install
```

### 2. Configure Environment (`.env`)
Create or edit `server/.env`:
```env
PORT=5000
NODE_ENV=development

# Neo4j Database URI and Credentials
# Option A: Local Neo4j Desktop / Community Edition
NEO4J_URI=neo4j://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=your_password
NEO4J_DATABASE=neo4j

# Option B: Free Neo4j AuraDB Cloud (Recommended if no local Neo4j installed)
# NEO4J_URI=neo4j+s://<dbid>.databases.neo4j.io
# NEO4J_USER=neo4j
# NEO4J_PASSWORD=<aura-password>

# JWT Secret
JWT_SECRET=uandwelabs_jwt_secret_key_2026_super_secure
JWT_EXPIRES_IN=7d
```

### 3. Start the Server
```bash
# Production mode:
npm start

# Development mode (with auto-restart via nodemon):
npm run dev
```

---

## 📡 API Endpoints

### Health Check
- `GET /api/health` — Check server & Neo4j status

### Authentication
- `POST /api/auth/register` — Register a new user in Neo4j
  ```json
  {
    "name": "Jane Doe",
    "email": "jane@example.com",
    "password": "securepassword123"
  }
  ```
- `POST /api/auth/login` — Sign in and get JWT token
  ```json
  {
    "email": "jane@example.com",
    "password": "securepassword123"
  }
  ```
- `GET /api/auth/me` — Get current user profile (requires `Authorization: Bearer <token>`)
- `POST /api/auth/logout` — Logout user

---

## 🌐 Neo4j Graph Model
Users are stored as `:User` nodes with:
```cypher
(:User {
  id: "uuid-v4",
  email: "jane@example.com",
  name: "Jane Doe",
  password: "$2a$10$hashed_password...",
  role: "member",
  createdAt: "2026-10-30T...",
  updatedAt: "2026-10-30T..."
})
```
Uniqueness is enforced with:
```cypher
CREATE CONSTRAINT user_email_unique IF NOT EXISTS
FOR (u:User) REQUIRE u.email IS UNIQUE
```

