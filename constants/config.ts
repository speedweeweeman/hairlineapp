export const PYTHON_SERVICE_URL =
  process.env.EXPO_PUBLIC_PYTHON_SERVICE_URL ?? 'http://localhost:8000';

// Get from app.revenuecat.com → Projects → [App] → API Keys → iOS key
// Set EXPO_PUBLIC_REVENUECAT_IOS_KEY in your .env or app.config.js
export const REVENUECAT_API_KEY =
  process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? '';
