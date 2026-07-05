import express from 'express';
import prisma from '../config/db.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    // Perform a fast raw query to check database connectivity
    await prisma.$queryRaw`SELECT 1`;
    
    res.status(200).json({
      status: 'UP',
      timestamp: new Date().toISOString(),
      services: {
        database: 'UP'
      }
    });
  } catch (error) {
    console.error("Health check failed:", error);
    res.status(500).json({
      status: 'DOWN',
      timestamp: new Date().toISOString(),
      services: {
        database: 'DOWN'
      },
      error: error.message
    });
  }
});

export default router;
