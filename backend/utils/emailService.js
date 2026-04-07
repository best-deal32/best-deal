// ============================================================
// utils/emailService.js
// إعداد وإرسال البريد الإلكتروني
// ============================================================

const nodemailer = require('nodemailer');
const config = require('../config');

let transporter = null;

function initEmailTransporter() {
    if (config.SMTP_HOST && config.SMTP_USER && config.SMTP_PASS) {
        transporter = nodemailer.createTransport({
            host: config.SMTP_HOST,
            port: config.SMTP_PORT,
            secure: false,
            auth: { user: config.SMTP_USER, pass: config.SMTP_PASS }
        });
        console.log("✅ تم إعداد البريد الإلكتروني");
    } else {
        console.warn("⚠️ لم يتم إعداد البريد الإلكتروني - سيتم طباعة الرموز في التيرمنال");
    }
}

async function sendVerificationEmail(email, code, type) {
    if (!transporter) {
        console.log(`[تطوير] رمز ${type} للبريد ${email} هو: ${code}`);
        return true;
    }
    
    const subject = type === 'reset' 
        ? 'إعادة تعيين كلمة المرور' 
        : (type === 'withdraw' 
            ? 'رمز تأكيد السحب' 
            : 'رمز التحقق');
    
    const messageText = type === 'withdraw' 
        ? 'استخدم الرمز التالي لتأكيد عملية السحب' 
        : (type === 'reset' 
            ? 'استخدم الرمز التالي لإعادة تعيين كلمة المرور' 
            : 'استخدم الرمز التالي للتحقق');
    
    try {
        await transporter.sendMail({
            from: `"Best Deal" <${config.SMTP_USER}>`,
            to: email,
            subject,
            html: `<div dir="rtl">
                <h2>${subject}</h2>
                <p>${messageText}:</p>
                <div style="font-size:32px; font-weight:bold; color:#b8860b;">${code}</div>
                <p>صالح لمدة 10 دقائق.</p>
            </div>`
        });
        return true;
    } catch(e) { 
        console.error(e);
        return false; 
    }
}

module.exports = { initEmailTransporter, sendVerificationEmail };