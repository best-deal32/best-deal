// ============================================================
// utils/helpers.js
// دوال مساعدة عامة
// ============================================================

function generateVerificationCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateReferralCode(username) {
    return username + "_" + Math.random().toString(36).substr(2, 6);
}

function formatDate(date) {
    return new Date(date).toISOString().slice(0, 19).replace('T', ' ');
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

module.exports = {
    generateVerificationCode,
    generateReferralCode,
    formatDate,
    escapeHtml
};