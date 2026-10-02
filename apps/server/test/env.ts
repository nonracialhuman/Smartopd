try { process.loadEnvFile(".env"); } catch { /* env may already be provided */ }
process.env.JWT_SECRET ??= "test-secret-test-secret-test-secret-123456";
process.env.SMTP_URL = "";
process.env.LOG_LEVEL = "silent";
