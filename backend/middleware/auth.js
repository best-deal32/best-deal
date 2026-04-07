// ============================================================
// middleware/auth.js
// ============================================================

const jwt = require('jsonwebtoken');
const config = require('../config');

function authenticateToken(req, res, next) {
    let token = req.cookies?.token;
    if (!token) {
        const authHeader = req.headers['authorization'];
        token = authHeader && authHeader.split(' ')[1];
    }
    if (!token) {
        return res.status(401).json({ success: false, message: 'غير مصرح - يرجى تسجيل الدخول' });
    }
    try {
        const decoded = jwt.verify(token, config.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ success: false, message: 'انتهت صلاحية الجلسة، يرجى تسجيل الدخول مرة أخرى' });
        }
        return res.status(403).json({ success: false, message: 'توكن غير صالح' });
    }
}

module.exports = { authenticateToken };