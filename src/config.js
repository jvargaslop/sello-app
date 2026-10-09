import 'dotenv/config';
const e = process.env;
export const cfg = {
  base: (e.BASE_URL || e.RENDER_EXTERNAL_URL || 'http://localhost:3000').replace(/\/$/, ''),
  port: +e.PORT || 3000,
  prod: e.NODE_ENV === 'production',
  adminKey: e.ADMIN_KEY,
  tz: 'America/Bogota',
  msg: {
    resendKey: e.RESEND_API_KEY, emailFrom: e.EMAIL_FROM_ADDRESS,
    waToken: e.WHATSAPP_TOKEN, waPhoneId: e.WHATSAPP_PHONE_ID, waLang: e.WHATSAPP_LANG || 'es',
    waTplInactivity: e.WHATSAPP_TEMPLATE_INACTIVITY, waTplBirthday: e.WHATSAPP_TEMPLATE_BIRTHDAY
  },
  jobs: { enabled: e.JOBS_ENABLED !== 'false', hour: +e.JOBS_HOUR || 10, dry: e.JOBS_DRY_RUN === 'true' },
  google: { issuer: e.GOOGLE_ISSUER_ID, creds: e.GOOGLE_SERVICE_ACCOUNT_JSON },
  apple: {
    passType: e.APPLE_PASS_TYPE_ID, team: e.APPLE_TEAM_ID, org: e.APPLE_ORG_NAME || 'Sello',
    wwdr: e.APPLE_WWDR_PATH, cert: e.APPLE_SIGNER_CERT_PATH, key: e.APPLE_SIGNER_KEY_PATH, pass: e.APPLE_KEY_PASSPHRASE || undefined
  }
};
