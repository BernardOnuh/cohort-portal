// send-login-email.js — send one student their Web3Nova Academy portal login.
// Copy into the bootcamp mailer folder (it uses that folder's .env, nodemailer and header.png), then:
//   node send-login-email.cjs "<Full Name>" <email> "<Course>" <studentName> <password> [--deadline 24] [--dry]
//   --dry          preview, sends nothing
//   --deadline N   adds "log in within N hours or your spot is revoked"
require('dotenv').config();
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const flag = name => { const i = argv.indexOf(name); return i === -1 ? null : argv.splice(i, 2)[1]; };
const DEADLINE_HOURS = Number(flag('--deadline')) || null;
const DRY_RUN = argv.includes('--dry');
const [name, email, course, studentName, password] = argv.filter(a => a !== '--dry');
if (!password) {
  console.error('usage: node send-login-email.cjs "<Full Name>" <email> "<Course>" <studentName> <password> [--deadline 24] [--dry]');
  process.exit(1);
}
const STUDENT = { name, email, course, studentName, password };
const PORTAL_URL = 'https://acad.web3nova.org';

const SUBJECT = '🔑 Your Web3Nova Academy login details' + (DEADLINE_HOURS ? ` — log in within ${DEADLINE_HOURS} hours` : '');
const FROM_NAME = 'Team web3nova.org';
const HEADER_IMAGE_PATH = path.join(__dirname, 'header.png');

const firstName = STUDENT.name.trim().split(/\s+/)[0];
const hasHeader = fs.existsSync(HEADER_IMAGE_PATH);
const deadlineText = DEADLINE_HOURS
  ? `You have ${DEADLINE_HOURS} hours to log in. If you haven't logged in by then, your access will be revoked and your spot given to someone else.`
  : null;

function buildText() {
  return `Hi ${firstName},

Here are your login details for the Web3Nova Academy portal (${STUDENT.course}):

Portal:   ${PORTAL_URL}
Username: ${STUDENT.studentName}
Password: ${STUDENT.password}
${deadlineText ? `\n⏰ ${deadlineText}\n` : ''}
Once you sign in:
- Complete the welcome tour and set up your profile to earn bonus points
- Go to the WhatsApp group and share the pinned post with your friends for extra points
- Your first Knowledge Check unlocks 24 hours after you finish the tour

Please keep these details private.

- Team web3nova.org`;
}

function buildHtml() {
  const INK = '#1a1a1a';
  const header = hasHeader
    ? `<img src="cid:header" alt="Web3Nova" style="width:100%;max-width:650px;height:auto;display:block;"/>`
    : '';
  const row = (label, value) =>
    `<tr><td style="padding:6px 12px 6px 0;color:#555;font-size:14px;">${label}</td>` +
    `<td style="padding:6px 0;font-family:Menlo,Consolas,monospace;font-size:15px;font-weight:bold;color:${INK};">${value}</td></tr>`;
  return `<body style="font-family:Arial,Helvetica,sans-serif;max-width:650px;margin:0 auto;padding:20px;background:#f5f5f5;color:${INK};">
  <div style="background:#ffffff;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,.1);overflow:hidden;">
    ${header}
    <div style="padding:30px;color:${INK};">
      <h1 style="color:#0052ff;font-size:24px;text-align:center;margin:0 0 20px;">Welcome to the Academy, ${firstName}! 🚀</h1>

      <p style="font-size:16px;line-height:1.6;margin:0 0 20px;color:${INK};">Here are your login details for the <strong>Web3Nova Academy portal</strong> (${STUDENT.course}):</p>

      <div style="background:#f0f6ff;padding:20px;border-radius:8px;border-left:4px solid #0052ff;margin:0 0 20px;">
        <table style="border-collapse:collapse;">
          ${row('Username', STUDENT.studentName)}
          ${row('Password', STUDENT.password)}
        </table>
      </div>

      ${deadlineText ? `<div style="background:#fff4ec;padding:14px 18px;border-radius:8px;border-left:4px solid #e0521b;margin:0 0 20px;font-size:14px;line-height:1.6;color:${INK};"><strong style="color:#e0521b;">⏰ Log in within ${DEADLINE_HOURS} hours.</strong> If you haven't logged in by then, your access will be revoked and your spot given to someone else.</div>` : ''}

      <p style="text-align:center;margin:0 0 25px;">
        <a href="${PORTAL_URL}/login" style="display:inline-block;background:#0052ff;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 28px;border-radius:8px;">Sign in to the portal</a>
      </p>

      <p style="margin:0 0 10px;font-weight:bold;color:#0052ff;">Once you sign in</p>
      <ul style="margin:0 0 20px;padding-left:20px;line-height:1.9;font-size:14px;color:${INK};">
        <li>✅ Complete the welcome tour and set up your profile to earn bonus points</li>
        <li>✅ Go to the WhatsApp group and share the pinned post with your friends for extra points</li>
        <li>✅ Your first Knowledge Check unlocks 24 hours after you finish the tour</li>
      </ul>

      <p style="font-size:13px;line-height:1.6;margin:0 0 25px;color:#8a8a8a;">Please keep these details private.</p>
      <p style="font-size:15px;margin:0;color:${INK};">&mdash; <strong>Team web3nova.org</strong> 💙</p>
    </div>
  </div>
  <p style="text-align:center;font-size:11px;color:#8a8a8a;margin-top:20px;">
    <a href="https://web3nova.org" style="color:#8a8a8a;">web3nova.org</a> | Building Africa's Web3 Future
  </p>
</body>`;
}

async function main() {
  if (DRY_RUN) {
    console.log(`[dry] To: ${STUDENT.name} <${STUDENT.email}>\nSubject: ${SUBJECT}\n\n${buildText()}`);
    return;
  }
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    throw new Error('GMAIL_USER / GMAIL_APP_PASSWORD missing in .env — run this from the mailer folder');
  }
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });
  const mail = {
    from: `"${FROM_NAME}" <${process.env.GMAIL_USER}>`,
    to: STUDENT.email,
    subject: SUBJECT,
    text: buildText(),
    html: buildHtml(),
  };
  if (hasHeader) mail.attachments = [{ filename: 'header.png', path: HEADER_IMAGE_PATH, cid: 'header' }];
  await transporter.sendMail(mail);
  console.log(`✓ Sent login details to ${STUDENT.name} <${STUDENT.email}>`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
