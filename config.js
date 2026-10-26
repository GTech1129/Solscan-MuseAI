// ==============================================================================
// SOL REVERSAL SNIPER - DASHBOARD & BOT CONFIGURATION
// ==============================================================================
// Edit the variables below to set your RPC, Bot API, and Telegram credentials.
// These variables are loaded automatically on dashboard boot.
// ==============================================================================

window.DASHBOARD_CONFIG = {
  // ----------------------------------------------------------------------------
  // 1. SOLANA NETWORK & RPC CONFIGURATION
  // ----------------------------------------------------------------------------
  // 'devnet' (default for testing) | 'mainnet-beta'
  NETWORK: 'devnet',

  // Solana RPC Endpoint:
  // Devnet default: 'https://api.devnet.solana.com'
  // Custom Devnet RPC (e.g. Helius / QuickNode): 'https://devnet.helius-rpc.com/?api-key=YOUR_KEY'
  // Mainnet default: 'https://api.mainnet-beta.solana.com'
  SOLANA_RPC_URL: 'https://api.devnet.solana.com',

  // ----------------------------------------------------------------------------
  // 2. BACKEND DEVNET AUTO-TRADER BOT API (server.js)
  // ----------------------------------------------------------------------------
  // Same-origin default: '' (uses current web app host proxy)
  // Cloud/VPS URL: 'https://your-bot-server.com' or 'http://localhost:3001'
  BOT_URL: '',

  // ----------------------------------------------------------------------------
  // 3. MARKET DATA API (Binance Live Klines)
  // ----------------------------------------------------------------------------
  // Uses local server-side proxy route '/api/binance' to avoid CORS restrictions,
  // with automatic fallback to Binance vision/com endpoints.
  BINANCE_API_URL: '/api/binance',

  // ----------------------------------------------------------------------------
  // 4. TELEGRAM ALERT NOTIFICATIONS (Optional)
  // ----------------------------------------------------------------------------
  // Get token from @BotFather, Chat ID from @userinfobot
  TELEGRAM_TOKEN: '',
  TELEGRAM_CHAT_ID: ''
};
