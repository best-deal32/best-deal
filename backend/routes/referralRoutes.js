// ============================================================
// routes/referralRoutes.js
// مسارات الإحالات - كاملة
// ============================================================

const express = require('express');
const router = express.Router();
const referralController = require('../controllers/referralController');
const { authenticateToken } = require('../middleware/auth');

router.get('/my', authenticateToken, referralController.getMyReferrals);
router.post('/record-deposit', authenticateToken, referralController.recordDeposit);

module.exports = router;