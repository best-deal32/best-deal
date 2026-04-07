// ============================================================
// routes/withdrawalRoutes.js
// مسارات السحب (بدون رمز تحقق)
// ============================================================

const express = require('express');
const router = express.Router();
const withdrawalController = require('../controllers/withdrawalController');
const { authenticateToken } = require('../middleware/auth');
const { withdrawLimiter } = require('../middleware/rateLimiter');

// تقديم طلب سحب (بدون رمز)
router.post('/add', authenticateToken, withdrawLimiter, withdrawalController.addWithdrawal);

module.exports = router;