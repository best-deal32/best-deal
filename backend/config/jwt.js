// ============================================================
// config/jwt.js
// دوال مساعدة خاصة بـ JWT
// ============================================================

const jwt = require('jsonwebtoken');
const config = require('./index');

/**
 * إنشاء توكن عادي (Access Token)
 */
function generateToken(userId, username, role) {
    return jwt.sign(
        { id: userId, username, role },
        config.JWT_SECRET,
        { expiresIn: '15m' }
    );
}

/**
 * إنشاء Refresh Token
 */
function generateRefreshToken(userId) {
    return jwt.sign(
        { id: userId },
        config.REFRESH_SECRET,
        { expiresIn: '7d' }
    );
}

/**
 * التحقق من Refresh Token
 */
function verifyRefreshToken(token) {
    try {
        return jwt.verify(token, config.REFRESH_SECRET);
    } catch (e) {
        return null;
    }
}

module.exports = {
    generateToken,
    generateRefreshToken,
    verifyRefreshToken
};