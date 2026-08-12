# Haroa Eats — Real Backend Starter

This is a real multi-user starter using Node.js + Express + SQLite + sessions.
It is NOT yet production-hardened.

## Run locally
1. Install Node.js 18+.
2. In this folder run: `npm install`
3. Run: `npm start`
4. Open: `http://localhost:3000`

Demo admin:
- Mobile: 9999999999
- Password: admin123

Before public launch:
- Change the admin credentials.
- Set a strong SESSION_SECRET.
- Add HTTPS.
- Use a managed production database.
- Add proper admin/restaurant/delivery authentication and authorization.
- Add payment gateway and webhook verification.
- Add rate limiting, validation, CSRF protection where applicable, audit logs, backups and privacy/terms pages.
- Replace demo restaurant/menu data.
- Configure WhatsApp/business notifications.
