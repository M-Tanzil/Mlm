# MLM Management System

Direct-selling management system (Binary + Generation plan): Distributor, Admin and Depo/Franchise panels.

**Stack:** React + Vite + Tailwind + Redux Toolkit | Node.js + Express | PostgreSQL (Supabase) + Prisma | Redis (Upstash/local) + BullMQ | JWT + bcrypt.

Docs: `docs/Architecture.md`, `docs/Database.md`, `docs/Workflow.md`

## Setup

1. **Supabase:** create a project; enable `ltree` and `citext` (Database -> Extensions); copy the pooled (6543) and direct (5432) connection strings.
2. **Redis:** create a free Upstash Redis (or install Redis locally); copy the URL.
3. **Server**
   ```
   cd server
   copy .env.example .env      (cp on Mac/Linux) and fill it
   npm install
   ```
   In the Supabase SQL Editor run, in order: `server/prisma/sql/001_init.sql`, `002_enable_rls.sql`, `003_initial_data.sql` (add the Super Admin insert with a bcrypt hash).
   ```
   npx prisma db pull
   npx prisma generate
   npm run dev                 -> http://localhost:5000/api/health
   npm run worker              (second terminal)
   ```
4. **Client**
   ```
   cd client
   copy .env.example .env
   npm install
   npm run dev                 -> http://localhost:5173
   ```

## Module ownership
| Student A | Student B |
|---|---|
| auth, masters, member/network, e-pin, kyc, commission, payout | inventory, depo/franchise, orders, schemes, notifications, support, announcements |
