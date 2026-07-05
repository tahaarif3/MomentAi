import { PrismaClient } from '@prisma/client';

// Initialize the Prisma client.
// In production, the connection string is loaded from the DATABASE_URL environment variable.
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'info', 'warn', 'error'] : ['error']
});

export default prisma;
