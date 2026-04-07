// ============================================================
// routes/investmentRoutes.js
// مسارات الاستثمارات - كاملة
// ============================================================

const express = require('express');
const router = express.Router();
const investmentController = require('../controllers/investmentController');
const { authenticateToken } = require('../middleware/auth');

router.post('/create', authenticateToken, investmentController.createInvestment);
router.get('/my', authenticateToken, investmentController.getMyInvestments);
router.post('/withdraw-profit', authenticateToken, investmentController.withdrawProfit);
router.post('/withdraw-principal', authenticateToken, investmentController.withdrawPrincipal);

module.exports = router;