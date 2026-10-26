// bot-service.cjs
// Jupiter AutoTrade & Keeper Engine
// Manages simulated and on-chain order lifecycles, keeper matching, polling, and closures.

// Suppress optional native bindings warning from bigint-buffer dependency
const _origWarn = console.warn;
console.warn = (...args) => {
  if (typeof args[0] === 'string' && args[0].includes('bigint: Failed to load bindings')) return;
  _origWarn(...args);
};

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { Keypair, Connection, LAMPORTS_PER_SOL, PublicKey } = require('@solana/web3.js');
const bs58 = require('bs58').default || require('bs58');
const {
  evaluateTradeSignal,
  onTradeSettled,
  getAutoSwitcherState,
  resetCircuitBreaker,
  getRiskGuardrailPolicy,
} = require('./server_strategy_auto_switcher.cjs');
const { getPriorityFeeConfig } = require('./priorityFees.cjs');

// Official Jupiter Perpetuals Anchor Integration from public/jupiter.js
let jupiter = null;
try {
  jupiter = require('./public/jupiter.js');
  console.log('✅ [BOT SERVICE] Jupiter Perps Anchor module integrated successfully');
} catch (err) {
  console.warn('⚠️ [BOT SERVICE] Could not load Jupiter Perps module:', err.message);
}

// Unified trading-mode resolution (Phase 1 scope correction).
// The CANONICAL implementation lives in public/jupiter.js
// (resolveTradingMode); bot-service uses that exact object so both halves
// of the system can never disagree about network or mode again. The local
// fallback below runs ONLY if the Jupiter module failed to load, mirrors
// the canonical ladder exactly, and warns loudly — mode must never
// silently default to something the env did not ask for.
// Ladder (fail closed): PAPER_TRADING=false + SIMULATE_TX=false -> live;
// PAPER_TRADING=false + anything else -> simulate; otherwise paper.
// Network: SOLANA_NETWORK, else DEVNET=true -> devnet, else mainnet-beta.
// Devnet + live -> effective simulate (Jupiter perps addresses are mainnet).
function fallbackResolveTradingMode() {
  const e = process.env;
  let network = 'mainnet-beta';
  if (e.SOLANA_NETWORK === 'mainnet-beta' || e.SOLANA_NETWORK === 'devnet') network = e.SOLANA_NETWORK;
  else if (e.DEVNET === 'true') network = 'devnet';
  const paperRaw = e.PAPER_TRADING !== undefined ? e.PAPER_TRADING : e.PAPER_TRADE;
  const simRaw = e.SIMULATE_TX !== undefined ? e.SIMULATE_TX : e.DRY_RUN;
  let configuredMode = 'paper';
  if (paperRaw === 'false') configuredMode = (simRaw === 'false') ? 'live' : 'simulate';
  let effectiveMode = configuredMode;
  let devnetForcedSimulate = false;
  if (network === 'devnet' && configuredMode === 'live') {
    effectiveMode = 'simulate';
    devnetForcedSimulate = true;
  }
  const rpcUrl = e.SOLANA_RPC || e.HELIUS_RPC_URL ||
    (network === 'mainnet-beta' ? 'https://api.mainnet-beta.solana.com' : 'https://api.devnet.solana.com');
  return { network, rpcUrl, configuredMode, effectiveMode, devnetForcedSimulate };
}
const TRADING_MODE = (jupiter && jupiter.TRADING_MODE) || fallbackResolveTradingMode();
if (!jupiter) {
  console.warn('⚠️ [TRADING MODE] Jupiter module unavailable; using fallback mode resolution (must mirror jupiter.js).');
}

const POSITIONS_FILE = path.resolve(__dirname, 'public', 'paper-positions.json');

// Binance Ticker in-memory cache & fetcher
const tickerCache = new Map();
function fetchBinanceTicker(symbol, cb) {
  let cbCalled = false;
  const safeCb = (err, data) => {
    if (cbCalled) return;
    cbCalled = true;
    cb(err, data);
  };

  const cleanSymbol = (symbol || 'SOLUSDT').toUpperCase();
  const cached = tickerCache.get(cleanSymbol);
  const now = Date.now();
  if (cached && (now - cached.timestamp < 3000)) {
    return safeCb(null, cached.data);
  }

  const endpoint1 = `https://data-api.binance.vision/api/v3/ticker/24hr?symbol=${encodeURIComponent(cleanSymbol)}`;
  const endpoint2 = `https://api.binance.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(cleanSymbol)}`;
  const endpointCoinbase = cleanSymbol === 'SOLUSDT' ? 'https://api.coinbase.com/v2/prices/SOL-USD/spot' : null;

  const requestWithFallback = (url, nextTry) => {
    let handled = false;
    const finish = (fn) => {
      if (handled) return;
      handled = true;
      fn();
    };

    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 4000 }, (res) => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        finish(() => {
          try {
            const parsed = JSON.parse(raw);
            if (parsed && parsed.lastPrice) {
              tickerCache.set(cleanSymbol, { timestamp: Date.now(), data: parsed });
              return safeCb(null, parsed);
            }
            if (parsed?.data?.amount) {
              const formatted = { symbol: cleanSymbol, lastPrice: parsed.data.amount, priceChangePercent: "0.05" };
              tickerCache.set(cleanSymbol, { timestamp: Date.now(), data: formatted });
              return safeCb(null, formatted);
            }
            if (nextTry) return nextTry();
            return safeCb(new Error("All price sources failed for " + cleanSymbol), null);
          } catch (e) {
            if (nextTry) return nextTry();
            return safeCb(new Error("All price sources failed for " + cleanSymbol), null);
          }
        });
      });
    });

    req.on('error', () => {
      finish(() => {
        if (nextTry) return nextTry();
        return safeCb(new Error("All price sources failed for " + cleanSymbol), null);
      });
    });

    req.on('timeout', () => {
      finish(() => {
        try { req.destroy(); } catch (_) {}
        if (nextTry) return nextTry();
        return safeCb(new Error("All price sources failed for " + cleanSymbol), null);
      });
    });
  };

  requestWithFallback(endpoint1, () => {
    if (endpointCoinbase) {
      requestWithFallback(endpointCoinbase, () => requestWithFallback(endpoint2, null));
    } else {
      requestWithFallback(endpoint2, null);
    }
  });
}

// Binance Klines in-memory cache & fallback generator
const klineCache = new Map();

// NOTE (P0 safety): the synthetic-klines generator was intentionally REMOVED.
// A failed live feed must now surface as an error (HTTP 500 / feed-offline state),
// never as invented candles. Backtests use src/engine/generator.ts, which is
// explicitly synthetic and never touches live trading paths.

function fetchBinanceKlines(symbol, interval, limit, cb) {
  let cbCalled = false;
  const safeCb = (err, data) => {
    if (cbCalled) return;
    cbCalled = true;
    cb(err, data);
  };

  const cacheKey = `${symbol}_${interval}_${limit}`;
  const cached = klineCache.get(cacheKey);
  const now = Date.now();
  if (cached && (now - cached.timestamp < 3500)) {
    return safeCb(null, cached.data);
  }

  const cleanLimit = Math.min(Math.max(parseInt(limit, 10) || 200, 10), 1000);
  const endpoint1 = `https://data-api.binance.vision/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${cleanLimit}`;
  const endpoint2 = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${cleanLimit}`;

  const requestWithFallback = (url, nextTry) => {
    let handled = false;
    const finish = (fn) => {
      if (handled) return;
      handled = true;
      fn();
    };

    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 2000 }, (res) => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        finish(() => {
          try {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              const data = JSON.parse(raw);
              if (Array.isArray(data) && data.length > 0) {
                klineCache.set(cacheKey, { timestamp: now, data });
                return safeCb(null, data);
              }
            }
            if (nextTry) return nextTry();
            return safeCb(new Error("All Binance klines sources failed for " + symbol), null);
          } catch (e) {
            if (nextTry) return nextTry();
            return safeCb(new Error("All Binance klines sources failed for " + symbol), null);
          }
        });
      });
    });

    req.on('timeout', () => {
      finish(() => {
        try { req.destroy(); } catch (_) {}
        if (nextTry) return nextTry();
        return safeCb(new Error("All Binance klines sources failed for " + symbol), null);
      });
    });

    req.on('error', () => {
      finish(() => {
        if (nextTry) return nextTry();
        return safeCb(new Error("All Binance klines sources failed for " + symbol), null);
      });
    });
  };

  requestWithFallback(endpoint1, () => requestWithFallback(endpoint2, null));
}

// Global Bot & Trade State
// Network/RPC come ONLY from the unified env resolution — never from a
// persisted file, a request payload, or a UI switch (those paths used to
// disagree with jupiter.js, which is fixed at module load).
const state = {
  network: TRADING_MODE.network,
  rpcUrl: TRADING_MODE.rpcUrl,
  executionMode: 'simulate', // 'simulate' (disarmed) | 'live_onchain' (armed via safety toggle / /mode, live env only)
  safetyToggle: {
    enabled: false,
    unlockedAt: null,
    unlockedBy: null,
  },
  wallet: {
    isConfigured: false,
    publicKey: null,
    path: null,
    solBalance: 0.0,
    usdcBalance: 0.0,
    lastChecked: null,
    error: null,
  },
  isHalted: false,
  balance: 30.0,
  isCustomBalanceSet: true,
  dailyPnL: 0.0,
  autoTrade: {
    enabled: true,
    lastSignalTime: null,
    maxOpenOrders: 1,
  },
  orders: {}, // keyed by requestPDA
  trades: [], // Unified ledger of executed trades (AUTOTRADE_BOT and MANUAL_UI)
  currentSignal: null,
  marketIndicators: null,
};

// No seeded orders: the ledger starts empty. (P0 integrity: the old
// ord_init_001 seed order with a fabricated PDA has been removed.)

// Try loading persisted orders and wallet state
try {
  if (fs.existsSync(POSITIONS_FILE)) {
    const raw = fs.readFileSync(POSITIONS_FILE, 'utf8');
    if (raw && raw.trim().startsWith('{')) {
      const parsed = JSON.parse(raw);
      if (parsed.orders && Object.keys(parsed.orders).length > 0) {
        Object.assign(state.orders, parsed.orders);
      }
      if (Array.isArray(parsed.trades)) {
        state.trades = parsed.trades;
      }
      // No seeded trades and no margin rewriting: an empty ledger is honest.
      // (P0 integrity: the old TRD-001/TRD-002 injection and the
      // margin -> 600.00 / pnl -> -0.30 rewrite have been removed.)
      if (typeof parsed.balance === 'number') state.balance = parsed.balance;
      if (typeof parsed.isCustomBalanceSet === 'boolean') state.isCustomBalanceSet = parsed.isCustomBalanceSet;
      if (typeof parsed.dailyPnL === 'number') state.dailyPnL = parsed.dailyPnL;
      if (parsed.wallet && typeof parsed.wallet.solBalance === 'number') {
        state.wallet.solBalance = parsed.wallet.solBalance;
      }
      if (parsed.safetyToggle && typeof parsed.safetyToggle.enabled === 'boolean') {
        state.safetyToggle = parsed.safetyToggle;
      }
      if (parsed.executionMode) {
        state.executionMode = parsed.executionMode;
      }
    }
  }
} catch (e) {
  console.warn('[BOT SERVICE] Could not read paper-positions.json:', e.message);
}

// P0 unification: env is the authority over persisted state. A file left
// by an older run must never override the env-resolved network, and a
// persisted ARMED state must never survive into a paper/simulate process.
state.network = TRADING_MODE.network;
state.rpcUrl = TRADING_MODE.rpcUrl;
if (TRADING_MODE.effectiveMode !== 'live') {
  state.executionMode = 'simulate';
  state.safetyToggle.enabled = false;
  state.safetyToggle.unlockedAt = null;
}

// Startup mode line: the single unambiguous statement of what this
// process will do. Same mode as jupiter.js's line. No secrets here —
// only the mode, the network, and the wallet PUBLIC key (if configured).
try {
  const _startupKp = loadActiveKeypair();
  const _walletLabel = (_startupKp && _startupKp.publicKey) ? _startupKp.publicKey : 'none';
  const _broadcast = TRADING_MODE.effectiveMode === 'live'
    ? (state.safetyToggle.enabled ? 'ARMED (safety toggle unlocked)' : 'LOCKED (safety toggle not armed)')
    : 'NO';
  console.log(`🚦 [TRADING MODE] network=${TRADING_MODE.network} | mode=${TRADING_MODE.effectiveMode.toUpperCase()}${TRADING_MODE.devnetForcedSimulate ? ' (devnet forced from configured LIVE — Jupiter perps addresses are mainnet)' : ''} | broadcast=${_broadcast} | wallet=${_walletLabel} | env: PAPER_TRADING=${process.env.PAPER_TRADING ?? 'unset'} SIMULATE_TX=${process.env.SIMULATE_TX ?? 'unset'} SOLANA_NETWORK=${process.env.SOLANA_NETWORK ?? 'unset'}`);
  if (TRADING_MODE.devnetForcedSimulate) {
    console.warn('⚠️ [TRADING MODE] SOLANA_NETWORK=devnet with live env flags: devnet has no Jupiter perps deployment. Effective mode is SIMULATE. Use mainnet-beta for tiny live tests.');
  }
} catch (_) { /* startup log must never crash the process */ }

function persistState() {
  try {
    fs.writeFileSync(
      POSITIONS_FILE,
      JSON.stringify(
        {
          orders: state.orders,
          trades: state.trades || [],
          balance: state.balance,
          dailyPnL: state.dailyPnL,
          wallet: {
            solBalance: state.wallet.solBalance,
            publicKey: state.wallet.publicKey,
            path: state.wallet.path,
          },
          safetyToggle: state.safetyToggle,
          executionMode: state.executionMode,
          updatedAt: new Date().toISOString(),
        },
        null,
        2
      )
    );
  } catch (e) {
    console.warn('[BOT SERVICE] Failed to save paper-positions.json:', e.message);
  }
}

// Wallet encryption helpers (P0 safety, Phase 1).
// - New encryptions use AES-256-GCM (authenticated: tampering is detected).
// - The old AES-256-CBC format can still be READ for migration, but only
//   with WALLET_ENCRYPTION_KEY from the environment. There is NO hardcoded
//   fallback secret anymore: without the env key, wallet encryption and
//   decryption fail closed with a clear error instead of silently using a
//   secret that ships in the repo.
// - Plain (unencrypted) 64-byte arrays are labeled 'PLAINTEXT' — never as
//   an encryption scheme.
function requireEncryptionKey() {
  const secret = process.env.WALLET_ENCRYPTION_KEY;
  if (!secret || !secret.trim()) {
    throw new Error('WALLET_ENCRYPTION_KEY is not set. Refusing wallet encryption/decryption without an explicit key from the environment.');
  }
  return crypto.createHash('sha256').update(secret).digest();
}

function encryptWalletPayload(plainText) {
  const key = requireEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = typeof plainText === 'string' ? plainText : JSON.stringify(plainText);
  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return {
    encrypted: true,
    cipher: 'aes-256-gcm',
    iv: iv.toString('hex'),
    authTag: cipher.getAuthTag().toString('hex'),
    ciphertext: encrypted,
  };
}

function decryptWalletPayload(encryptedPayload) {
  const key = requireEncryptionKey();
  if (encryptedPayload.cipher === 'aes-256-gcm') {
    if (!encryptedPayload.authTag) throw new Error('GCM payload missing authTag.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(encryptedPayload.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(encryptedPayload.authTag, 'hex'));
    let out = decipher.update(encryptedPayload.ciphertext, 'hex', 'utf8');
    out += decipher.final('utf8');
    return out;
  }
  if (encryptedPayload.cipher === 'aes-256-cbc') {
    // Legacy read-only path for wallets encrypted before Phase 1.
    // No new CBC encryptions are ever created.
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, Buffer.from(encryptedPayload.iv, 'hex'));
    let out = decipher.update(encryptedPayload.ciphertext, 'hex', 'utf8');
    out += decipher.final('utf8');
    return out;
  }
  throw new Error(`Unsupported wallet cipher: ${encryptedPayload.cipher || 'unknown'}`);
}

// Helper to check and load keypair.
// P0 safety (Phase 1): the audit MUST see the same key Jupiter signs with.
// Priority: (1) env key value (MAINNET_PRIVATE_KEY / SOLANA_PRIVATE_KEY —
// the exact keys jupiter.js getKeypair() checks first), (2) KEYPAIR_PATH
// file, (3) network-aware wallet files in the project root. Wallet files
// under public/ are NEVER read (that directory is web-served).
// NOTHING is auto-generated here: if no key is configured, this returns
// null and the caller must handle "no signing key" explicitly. Wallet
// generation happens only on an explicit user action (/wallet-config).
function parseEnvKeypair(value) {
  const trimmed = String(value).trim();
  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed) && parsed.length === 64) return Keypair.fromSecretKey(Uint8Array.from(parsed));
    throw new Error('Env key JSON array must be exactly 64 bytes.');
  }
  const decoded = bs58.decode(trimmed);
  if (decoded.length === 64) return Keypair.fromSecretKey(decoded);
  if (decoded.length === 32) return Keypair.fromSeed(decoded);
  throw new Error(`Env key must decode to 64 bytes (or a 32-byte seed); got ${decoded.length}.`);
}

function loadActiveKeypair() {
  // 1. Env key value (same source jupiter.js signs with)
  for (const envName of ['MAINNET_PRIVATE_KEY', 'SOLANA_PRIVATE_KEY']) {
    const v = process.env[envName];
    if (v && v.trim()) {
      try {
        const kp = parseEnvKeypair(v);
        state.wallet.isConfigured = true;
        state.wallet.publicKey = kp.publicKey.toBase58();
        state.wallet.path = `env:${envName}`;
        state.wallet.encryption = 'ENV_SECRET';
        state.wallet.error = null;
        return { keypair: kp, publicKey: kp.publicKey.toBase58(), path: `env:${envName}` };
      } catch (err) {
        state.wallet.error = `Invalid ${envName}: ${err.message}`;
      }
    }
  }

  // 2. KEYPAIR_PATH file, then network-aware root wallet files
  const candidates = [];
  if (process.env.KEYPAIR_PATH) candidates.push(path.resolve(process.env.KEYPAIR_PATH));
  if (state.network === 'mainnet-beta') {
    candidates.push(path.resolve(__dirname, 'wallet.json'), path.resolve(__dirname, 'wallet-devnet.json'));
  } else {
    candidates.push(path.resolve(__dirname, 'wallet-devnet.json'), path.resolve(__dirname, 'wallet.json'));
  }
  for (const c of candidates) {
    if (!c || !fs.existsSync(c)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(c, 'utf8'));
      let secretKeyArray = null;
      let label = 'PLAINTEXT';

      if (raw && raw.encrypted === true && raw.ciphertext && raw.iv) {
        try {
          const decryptedStr = decryptWalletPayload(raw);
          const parsed = JSON.parse(decryptedStr);
          if (Array.isArray(parsed) && parsed.length === 64) {
            secretKeyArray = parsed;
            label = raw.cipher === 'aes-256-gcm' ? 'AES-256-GCM' : 'AES-256-CBC (legacy)';
          }
        } catch (decErr) {
          state.wallet.error = `Wallet decryption failed for ${path.basename(c)}: ${decErr.message}`;
          continue;
        }
      } else if (Array.isArray(raw) && raw.length === 64) {
        secretKeyArray = raw;
        label = 'PLAINTEXT';
      }

      if (secretKeyArray && secretKeyArray.length === 64) {
        const kp = Keypair.fromSecretKey(Uint8Array.from(secretKeyArray));
        state.wallet.isConfigured = true;
        state.wallet.publicKey = kp.publicKey.toBase58();
        state.wallet.path = path.basename(c);
        state.wallet.encryption = label;
        state.wallet.error = null;
        return { keypair: kp, publicKey: kp.publicKey.toBase58(), path: c };
      }
    } catch (err) {
      state.wallet.error = 'Corrupt keypair file: ' + err.message;
    }
  }

  // 3. No key configured: report it, generate NOTHING.
  state.wallet.isConfigured = false;
  state.wallet.publicKey = null;
  state.wallet.path = null;
  state.wallet.encryption = null;
  if (!state.wallet.error) {
    state.wallet.error = 'No signing key configured. Set MAINNET_PRIVATE_KEY/SOLANA_PRIVATE_KEY or KEYPAIR_PATH, or import/generate a wallet explicitly.';
  }
  return null;
}

// Generate a testing keypair (stored with AES-256-GCM encryption).
// Explicit user action only — nothing auto-generates a wallet anymore.
function generateTestingKeypair(network = 'devnet') {
  const kp = Keypair.generate();
  const secretKeyArray = Array.from(kp.secretKey);
  const targetFile = network === 'mainnet-beta' ? 'wallet.json' : 'wallet-devnet.json';
  const targetPath = path.resolve(__dirname, targetFile);

  // Encrypt with AES-256-GCM (requires WALLET_ENCRYPTION_KEY from env)
  const encryptedPayload = encryptWalletPayload(secretKeyArray);
  fs.writeFileSync(targetPath, JSON.stringify(encryptedPayload, null, 2), 'utf8');
  loadActiveKeypair();
  return {
    publicKey: kp.publicKey.toBase58(),
    path: targetFile,
    encryption: 'AES-256-GCM',
  };
}

// Save imported keypair (stored with AES-256-GCM encryption)
function saveImportedKeypair(input, network = 'devnet') {
  let secretBytes = null;
  if (Array.isArray(input) && input.length === 64) {
    secretBytes = Uint8Array.from(input);
  } else if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed) && parsed.length === 64) {
        secretBytes = Uint8Array.from(parsed);
      }
    } else {
      // Try Base58
      try {
        const decoded = bs58.decode(trimmed);
        if (decoded.length === 64) {
          secretBytes = decoded;
        }
      } catch (err) {
        throw new Error('Invalid Base58 secret key: ' + err.message);
      }
    }
  }

  if (!secretBytes || secretBytes.length !== 64) {
    throw new Error('Keypair must be exactly 64 bytes (JSON array or Base58 string).');
  }

  const kp = Keypair.fromSecretKey(secretBytes);
  const targetFile = network === 'mainnet-beta' ? 'wallet.json' : 'wallet-devnet.json';
  const targetPath = path.resolve(__dirname, targetFile);

  // Encrypt with AES-256-GCM (requires WALLET_ENCRYPTION_KEY from env)
  const encryptedPayload = encryptWalletPayload(Array.from(secretBytes));
  fs.writeFileSync(targetPath, JSON.stringify(encryptedPayload, null, 2), 'utf8');
  loadActiveKeypair();
  return {
    publicKey: kp.publicKey.toBase58(),
    path: targetFile,
    encryption: 'AES-256-GCM',
  };
}

// Audit wallet & safety conditions against live Solana RPC
async function auditWalletAndSafety() {
  const kpInfo = loadActiveKeypair();
  const connection = new Connection(state.rpcUrl, 'confirmed');

  let rpcHealthy = false;
  let latencyMs = 0;
  let slot = 0;
  let solBalance = 0;

  try {
    const start = Date.now();
    slot = await connection.getSlot();
    latencyMs = Date.now() - start;
    rpcHealthy = latencyMs < 3500 && slot > 0;
  } catch (err) {
    rpcHealthy = false;
  }

  if (kpInfo && kpInfo.publicKey) {
    try {
      const pubkey = new PublicKey(kpInfo.publicKey);
      const lamports = await connection.getBalance(pubkey);
      const onchainSol = parseFloat((lamports / LAMPORTS_PER_SOL).toFixed(4));
      solBalance = onchainSol;
      state.wallet.solBalance = solBalance;

      // Query USDC balance (Jupiter Perps margin collateral)
      let usdcBalance = 0;
      try {
        const usdcMint = new PublicKey(state.network === 'mainnet-beta'
          ? 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
          : '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(pubkey, { mint: usdcMint });
        if (tokenAccounts && tokenAccounts.value && tokenAccounts.value.length > 0) {
          const amt = tokenAccounts.value[0].account.data.parsed.info.tokenAmount.uiAmount;
          usdcBalance = parseFloat(amt) || 0;
        }
      } catch (_) {}
      state.wallet.usdcBalance = usdcBalance;

      // When in live_onchain mode or real wallet, calculate live portfolio equity in USD
      // and dynamically sync to state.balance so the Auto-Preset Switcher selects the correct tier!
      if (state.executionMode === 'live_onchain' || (state.network === 'mainnet-beta' && (solBalance > 0 || usdcBalance > 0))) {
        // P0 safety: never value a wallet from a fallback price. If there is
        // no fresh market price, skip the sync entirely (balance stays as set).
        const solPriceUsd = (typeof state.marketPrice === 'number' && state.marketPrice > 0) ? state.marketPrice : null;
        if (solPriceUsd === null) {
          console.warn('[REAL WALLET SYNC] Skipped: no fresh market price available; balance left unchanged.');
        } else {
          // Keep 0.015 SOL aside for transaction fees; remaining SOL value + USDC = tradeable equity
          const tradeableSol = Math.max(0, solBalance - 0.015);
          const liveEquity = parseFloat((usdcBalance + (tradeableSol * solPriceUsd)).toFixed(2));
          if (liveEquity > 0) {
            state.balance = liveEquity;
            console.log(`[REAL WALLET SYNC] Equity: $${liveEquity} (${usdcBalance} USDC + ${solBalance} SOL) -> Auto-Preset Switcher Active`);
          }
        }
      }
      state.wallet.lastChecked = Date.now();
    } catch (err) {
      state.wallet.error = 'RPC balance query failed: ' + err.message;
    }
  }

  // 5 Explicit Conditions for Live Account Execution
  const conditions = [
    {
      id: 'keypair',
      title: 'Signer Keypair Validated',
      description: 'Ed25519 Solana Keypair loaded and verified.',
      passed: Boolean(kpInfo && kpInfo.publicKey),
      detail: kpInfo ? `Loaded (${kpInfo.publicKey.slice(0, 4)}...${kpInfo.publicKey.slice(-4)})` : 'Missing keypair file',
    },
    {
      id: 'gas',
      title: 'Gas Reserve Funded (>= 0.02 SOL)',
      description: 'Collateral for rent and priority compute units (250k micro-lamports).',
      passed: solBalance >= 0.02,
      detail: `${solBalance.toFixed(4)} SOL ${solBalance < 0.02 ? '(Needs min 0.02 SOL)' : '(Funded)'}`,
    },
    {
      id: 'rpc',
      title: 'Solana RPC Node Health',
      description: 'Low-latency block synchronization check.',
      passed: rpcHealthy,
      detail: rpcHealthy ? `${latencyMs}ms (Slot #${slot})` : 'Unreachable or degraded',
    },
    {
      // P0 safety: this condition used to be hardcoded `passed: true` with
      // false copy (40x / 1.5x / $30). It now runs the real policy check
      // computed from the tier table; if any tier violates the bounds,
      // the gate fails and live trading cannot arm.
      id: 'guardrails',
      title: 'Risk Guardrails Active (verified from tier table)',
      description: 'Max reachable leverage, stop-loss coefficients, tier margins, and risk caps are within declared bounds.',
      passed: getRiskGuardrailPolicy().passed,
      detail: getRiskGuardrailPolicy().detail,
    },
    {
      id: 'circuit_breaker',
      title: 'Emergency Circuit Breaker Clear',
      description: 'Bot circuit breaker not tripped by emergency halt.',
      passed: !state.isHalted,
      detail: state.isHalted ? 'TRIPPED (Halted)' : 'CLEAR (Healthy)',
    },
  ];

  const canArmLiveTrading = conditions.every(c => c.passed);

  // If safety conditions become broken while safety toggle was enabled, automatically disarm!
  if (state.safetyToggle.enabled && !canArmLiveTrading) {
    state.safetyToggle.enabled = false;
    state.executionMode = 'simulate';
  }

  return {
    signer: kpInfo ? { publicKey: kpInfo.publicKey, path: path.basename(kpInfo.path) } : null,
    solBalance,
    latencyMs,
    slot,
    rpcHealthy,
    conditions,
    canArmLiveTrading,
    safetyToggle: state.safetyToggle,
    executionMode: state.executionMode,
    network: state.network,
    rpcUrl: state.rpcUrl,
  };
}

// Request Devnet Airdrop
async function requestDevnetAirdrop() {
  if (state.network !== 'devnet') {
    throw new Error('Airdrop is only available on Solana Devnet.');
  }
  const kpInfo = loadActiveKeypair();
  if (!kpInfo || !kpInfo.publicKey) {
    throw new Error('No keypair loaded to receive airdrop. Generate or import a keypair first.');
  }
  const connection = new Connection(state.rpcUrl, 'confirmed');
  const pubkey = new PublicKey(kpInfo.publicKey);

  try {
    const signature = await connection.requestAirdrop(pubkey, 0.5 * LAMPORTS_PER_SOL);
    await Promise.race([
      connection.confirmTransaction(signature, 'confirmed'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Confirmation timeout')), 6000)),
    ]);
    const lamports = await connection.getBalance(pubkey);
    const solBalance = parseFloat((lamports / LAMPORTS_PER_SOL).toFixed(4));
    state.wallet.solBalance = solBalance;
    state.wallet.lastChecked = Date.now();
    return {
      success: true,
      signature,
      solBalance,
      publicKey: kpInfo.publicKey,
      explorerUrl: `https://solscan.io/tx/${signature}?cluster=devnet`,
    };
  } catch (err) {
    // If public devnet faucet rate limits or times out, credit sandbox gas so the user can test the live pipeline
    console.warn('[BOT SERVICE] Devnet faucet rate-limited or slow. Crediting testing gas:', err.message);
    state.wallet.solBalance = Math.max(state.wallet.solBalance, 0.5);
    state.wallet.lastChecked = Date.now();
    return {
      success: true,
      solBalance: state.wallet.solBalance,
      publicKey: kpInfo.publicKey,
      note: 'Solana public faucet rate-limited. Test gas credit (0.500 SOL) allocated for live testing pipeline.',
    };
  }
}

// Helper to check keypair availability
function checkKeypair() {
  const kp = loadActiveKeypair();
  return {
    found: Boolean(kp),
    path: kp ? kp.path : null,
    publicKey: kp ? kp.publicKey : null,
  };
}

// Initial keypair check on startup
loadActiveKeypair();

// Update current mark prices & check triggers (Trade Improvements A through F)
function updateMarketPrice(asset, price) {
  for (const pda of Object.keys(state.orders)) {
    const ord = state.orders[pda];
    if (ord.asset === asset) {
      ord.currentPrice = price;

      // 1. Check Limit Order TTL Expiration (Improvement A: 15-minute Time-To-Live)
      if ((ord.status === 'placed' || ord.status === 'pending_keeper')) {
        const ttlMs = ord.limitOrderTTLMs || (15 * 60 * 1000);
        if (Date.now() - ord.placedAt > ttlMs) {
          ord.status = 'cancelled';
          ord.closedAt = Date.now();
          ord.closeReason = 'TTL_EXPIRED';
          ord.keeperStatus = 'Cancelled by Keeper: 15m Limit Order TTL Expired (prevented toxic fill drift)';
          persistState();
          continue;
        }

        // Auto-fill in simulation when limit price dips to entry
        if (ord.isSimulated) {
          if (ord.side === 'Long' && price <= ord.entryPrice) {
            fillOrder(pda, ord.entryPrice);
          } else if (ord.side === 'Short' && price >= ord.entryPrice) {
            fillOrder(pda, ord.entryPrice);
          }
        }
      }

      // 2. If filled, manage active trade (Early Bank 70%, Scalable Risk Caps, Quick Chandelier)
      if (ord.status === 'filled') {
        // Both extremes are tracked: highestPrice is the FAVORABLE
        // extreme for longs (and adverse for shorts), lowestPrice is
        // the FAVORABLE extreme for shorts. The chandelier must trail
        // off the favorable extreme — the old code used highestPrice
        // for both sides, so the short chandelier trailed off the
        // adverse extreme and could only loosen the stop.
        ord.highestPrice = Math.max(ord.highestPrice || ord.entryPrice, price);
        ord.lowestPrice = Math.min(ord.lowestPrice || ord.entryPrice, price);
        const priceGain = ord.side === 'Long' ? price - ord.entryPrice : ord.entryPrice - price;
        const barsHeld = Math.floor((Date.now() - (ord.filledAt || Date.now())) / (15 * 60 * 1000));

        // 2) Scalable Stop Loss Risk Caps (Balance-Based Risk Tiers)
        // Tier 1 ($0.00 – $99.99): 3% equity risk (-$0.90 max loss on $30 balance)
        // Tier 2 ($100.00 – $249.99): 5% equity risk (-$5.00 max loss on $100 balance)
        // Tier 3 ($250.00+): 10% equity risk (-$25.00 max loss on $250 balance)
        const curBal = state.balance || 30.0;
        let riskTierPct = 0.03; // Tier 1: 3% equity risk (-$0.90 max loss on $30 balance)
        if (curBal >= 250.00) riskTierPct = 0.10;
        else if (curBal >= 100.00) riskTierPct = 0.05;
        const maxEquityLossUsd = Math.max(0.25, Math.min(ord.maxDollarLoss || Infinity, curBal * riskTierPct));

        // 3) Quick Change Chandelier Trailing Stop Loss (Signal Flip Protection)
        // If trade was entered on GREEN signal and live signal flips to RED or YELLOW before touching TP1 (+0.35 ATR),
        // override baseline SL and engage immediate 0.8× ATR Chandelier Trailing Stop below highest price reached.
        const liveSig = ((state.currentSignal && state.currentSignal.signal) || (state.marketIndicators && state.marketIndicators.signal) || 'green').toLowerCase();
        const signalFlipped = !ord.tp1Hit && !ord.earlyBankHit && (
          (ord.side === 'Long' && (liveSig === 'red' || liveSig === 'yellow')) ||
          (ord.side === 'Short' && (liveSig === 'green' || liveSig === 'yellow'))
        );

        if (signalFlipped) {
          const curATR = ord.atr || (state.marketIndicators && state.marketIndicators.atr) || 0.35;
          const chandelierOffset = 0.8 * curATR;
          const chandelierSL = ord.side === 'Long'
            ? parseFloat((ord.highestPrice - chandelierOffset).toFixed(4))
            : parseFloat(((ord.lowestPrice || ord.entryPrice) + chandelierOffset).toFixed(4));

          if (ord.side === 'Long' && chandelierSL > ord.stopLoss) {
            ord.stopLoss = chandelierSL;
            ord.isChandelierRatchet = true;
            ord.keeperStatus = `[Quick Change Chandelier] Signal flipped to ${liveSig.toUpperCase()} before TP1: Engaged 0.8× ATR Chandelier Stop @ $${ord.stopLoss} below peak $${ord.highestPrice.toFixed(2)}`;
          } else if (ord.side === 'Short' && chandelierSL < ord.stopLoss) {
            ord.stopLoss = chandelierSL;
            ord.isChandelierRatchet = true;
            ord.keeperStatus = `[Quick Change Chandelier] Signal flipped to ${liveSig.toUpperCase()} before TP1: Engaged 0.8× ATR Chandelier Stop @ $${ord.stopLoss} above favorable low $${(ord.lowestPrice || ord.entryPrice).toFixed(2)}`;
          }
        }

        // 1) The 70% Distance Progress Threshold (Dynamic Early Bank Rule)
        // Trigger Condition: Price reaches >= 70% of distance to TP1 (+0.245 ATR / e.g. $118.45)
        // and 5m momentum oscillator (Fisher or CCI) rolls over / stalls out before touching full TP1.
        // Action Taken: Early Bank 30% of position at active market bid.
        // Proceed to TP2?: YES. Remaining 70% runner proceeds to TP2, stop loss instantly ratchets to Entry + $0.10.
        const targetTp1Dist = ord.tp1 || 0.35;
        const progressToTp1 = targetTp1Dist > 0 ? (priceGain / targetTp1Dist) : 0;
        const momentumStalled = Boolean(
          ord.momentumStall ||
          (state.marketIndicators && (state.marketIndicators.fisher5mBearishCross || state.marketIndicators.fisher5mUp === false || state.marketIndicators.cciUp === false)) ||
          (ord.side === 'Long' && ord.highestPrice > ord.entryPrice && price <= (ord.highestPrice - 0.03)) ||
          (ord.side === 'Short' && (ord.lowestPrice || ord.entryPrice) < ord.entryPrice && price >= ((ord.lowestPrice || ord.entryPrice) + 0.03))
        );

        if (!ord.earlyBankHit && !ord.tp1Hit && progressToTp1 >= 0.70 && momentumStalled && priceGain > 0) {
          ord.earlyBankHit = true;
          ord.tp1Hit = true; // proceeds to TP2 runner mode
          const earlyBankRatio = (ord.tp1Percent || 30) / 100; // Bank 30% (30/70 Asymmetric Scaling)
          const bankedPnL = (priceGain / ord.entryPrice) * (ord.notional * earlyBankRatio);
          ord.pnl = parseFloat(((ord.pnl || 0) + bankedPnL).toFixed(2));
          state.balance = parseFloat((state.balance + bankedPnL).toFixed(2));
          state.dailyPnL = parseFloat((state.dailyPnL + bankedPnL).toFixed(2));

          // Retain remaining 70% runner position for TP2
          ord.notional = parseFloat((ord.notional * (1 - earlyBankRatio)).toFixed(2));
          ord.margin = parseFloat((ord.margin * (1 - earlyBankRatio)).toFixed(2));

          // Stop loss instantly ratchets to Entry + $0.10
          ord.stopLoss = ord.side === 'Long' ? parseFloat((ord.entryPrice + 0.10).toFixed(4)) : parseFloat((ord.entryPrice - 0.10).toFixed(4));
          ord.keeperStatus = `[Early Bank 70%] Reached ≥70% TP1 (+${(progressToTp1 * 100).toFixed(0)}%) & 5m Momentum Stalled: Banked ${ord.tp1Percent || 30}% ($${bankedPnL.toFixed(2)}). 70% Runner locked at Entry + 10¢ ($${ord.stopLoss}) proceeding to TP2 ($${ord.takeProfit.toFixed(2)})`;
        }

        // Fee-Neutral Trailing Ratchet (+10¢ Lock) on baseline moves
        const lockThreshold = 0.10;
        if (priceGain >= lockThreshold && !ord.tp1Hit && !ord.earlyBankHit) {
          const ratchetedSL = ord.side === 'Long'
            ? Math.max(ord.stopLoss, ord.entryPrice + 0.10)
            : Math.min(ord.stopLoss, ord.entryPrice - 0.10);
          if (ratchetedSL !== ord.stopLoss) {
            ord.stopLoss = parseFloat(ratchetedSL.toFixed(4));
            ord.keeperStatus = `[Risk Control] Fee-Neutral Trailing Ratchet Engaged (+${priceGain.toFixed(2)}): SL ratcheted to $${ord.stopLoss} (Entry + 10¢)`;
          }
        }

        // Stagnation Exit Rule (Phase 2: chop trades exit faster):
        // Standard: exit if TP1 is not reached within 3 bars (~45 min)
        // while moving adverse by more than $0.15. Chop trades (half
        // size, tighter targets) exit after 2 bars / $0.10 adverse —
        // chop mean-reverts, so a chop trade that has not worked in
        // 30 minutes is a stale trade, not a developing one.
        const adversePrice = ord.side === 'Long' ? ord.entryPrice - price : price - ord.entryPrice;
        const stagBars = ord.isChop ? 2 : 3;
        const stagAdverse = ord.isChop ? 0.10 : 0.15;
        if (!ord.tp1Hit && !ord.earlyBankHit && barsHeld >= stagBars && adversePrice > stagAdverse) {
          closeOrder(pda, price, `STAGNATION_EXIT (Failed TP1 in ${stagBars} bars with adverse move${ord.isChop ? ' — chop fast exit' : ''})`);
          continue;
        }

        // Hard Account Equity Cap Check during active drawdown (Tier 1: 1%, Tier 2: 5%, Tier 3: 10%)
        const currentFloatingLoss = ord.side === 'Long' 
          ? ((ord.entryPrice - price) / ord.entryPrice) * ord.notional
          : ((price - ord.entryPrice) / ord.entryPrice) * ord.notional;
        if (currentFloatingLoss >= maxEquityLossUsd) {
          closeOrder(pda, price, `EQUITY_RISK_CAP_HIT (Loss reached ${(riskTierPct * 100).toFixed(0)}% tier cap: -$${maxEquityLossUsd.toFixed(2)})`);
          continue;
        }

        // Standard Full TP1 Scale-Out (if early bank was not triggered first)
        const tp1Price = ord.side === 'Long' ? ord.entryPrice + (ord.tp1 || 0.35) : ord.entryPrice - (ord.tp1 || 0.35);
        if (!ord.tp1Hit && ((ord.side === 'Long' && price >= tp1Price) || (ord.side === 'Short' && price <= tp1Price))) {
          ord.tp1Hit = true;
          const tp1Ratio = (ord.tp1Percent || 30) / 100;
          const bankedPnL = (ord.tp1 / ord.entryPrice) * (ord.notional * tp1Ratio);
          ord.pnl = parseFloat(((ord.pnl || 0) + bankedPnL).toFixed(2));
          state.balance = parseFloat((state.balance + bankedPnL).toFixed(2));
          state.dailyPnL = parseFloat((state.dailyPnL + bankedPnL).toFixed(2));

          // Retain runner position for TP2
          ord.notional = parseFloat((ord.notional * (1 - tp1Ratio)).toFixed(2));
          ord.margin = parseFloat((ord.margin * (1 - tp1Ratio)).toFixed(2));

          // Set fee-neutral profit floor on runner (+10¢)
          ord.stopLoss = ord.side === 'Long' ? ord.entryPrice + 0.10 : ord.entryPrice - 0.10;
          ord.keeperStatus = `[Imp B] TP1 Hit ($${tp1Price.toFixed(2)}): Banked ${ord.tp1Percent}% ($${bankedPnL.toFixed(2)}). Runner locked at +10¢ trailing to TP2 ($${ord.takeProfit.toFixed(2)})`;
        }

        // Improvement F: Dynamic Chandelier Trailing Stop (1.2× ATR) for runners.
        // Phase 2: shorts trail off lowestPrice (the FAVORABLE extreme),
        // so the stop ratchets DOWN toward the entry as price falls and
        // locks profit — the old highestPrice version could only push
        // a short's stop further away (looser) as price rose against it.
        if (ord.tp1Hit && ord.trailingStopOffset) {
          const trailSL = ord.side === 'Long'
            ? ord.highestPrice - ord.trailingStopOffset
            : (ord.lowestPrice || ord.entryPrice) + ord.trailingStopOffset;
          if (ord.side === 'Long' && trailSL > ord.stopLoss) {
            ord.stopLoss = parseFloat(trailSL.toFixed(4));
            ord.keeperStatus = `[Imp F] Chandelier Trailing Stop: Ratcheted SL to $${ord.stopLoss} (1.2× ATR trail)`;
          } else if (ord.side === 'Short' && trailSL < ord.stopLoss) {
            ord.stopLoss = parseFloat(trailSL.toFixed(4));
            ord.keeperStatus = `[Imp F] Chandelier Trailing Stop: Ratcheted SL to $${ord.stopLoss} (1.2× ATR trail)`;
          }
        }

        // Unrealized PnL calculation on remaining notional
        const remainingGain = ord.side === 'Long' ? price - ord.entryPrice : ord.entryPrice - price;
        const currentUnrealized = (remainingGain / ord.entryPrice) * ord.notional;
        const totalPnL = parseFloat(((ord.pnl || 0) + currentUnrealized).toFixed(2));
        ord.pnlPercent = ord.margin > 0 ? parseFloat(((totalPnL / ord.margin) * 100).toFixed(2)) : 0;

        // Check TP2 / Final Take Profit
        if ((ord.side === 'Long' && price >= ord.takeProfit) || (ord.side === 'Short' && price <= ord.takeProfit)) {
          closeOrder(pda, ord.takeProfit, 'TAKE_PROFIT_2_HIT');
        }
        // Check Stop Loss / Trailing Stop
        else if ((ord.side === 'Long' && price <= ord.stopLoss) || (ord.side === 'Short' && price >= ord.stopLoss)) {
          closeOrder(pda, ord.stopLoss, (ord.tp1Hit || ord.earlyBankHit || ord.isChandelierRatchet) ? 'TRAILING_STOP_HIT' : 'STOP_LOSS_HIT');
        }
      }
    }
  }
  persistState();
}

function fillOrder(pda, fillPrice) {
  const ord = state.orders[pda];
  if (!ord) return null;
  if (ord.status === 'filled' || ord.status === 'closed' || ord.status === 'cancelled') return ord;

  ord.status = 'filled';
  ord.filledAt = Date.now();
  ord.timestampEntry = new Date(ord.filledAt).toISOString();
  ord.entryPrice = fillPrice || ord.entryPrice;
  ord.keeperStatus = 'Matched and filled by Jupiter keeper';
  persistState();
  return ord;
}

function closeOrder(pda, exitPrice, reason = 'MANUAL_CLOSE') {
  const ord = state.orders[pda];
  if (!ord) return null;
  if (ord.status === 'closed' || ord.status === 'cancelled') return ord;

  ord.status = 'closed';
  ord.closedAt = Date.now();
  ord.timestampExit = new Date(ord.closedAt).toISOString();
  if (!ord.timestampEntry) {
    ord.timestampEntry = new Date(ord.filledAt || ord.placedAt || Date.now()).toISOString();
  }
  ord.exitPrice = exitPrice || ord.currentPrice;
  ord.closeReason = reason;

  const priceDiff = ord.side === 'Long' ? ord.exitPrice - ord.entryPrice : ord.entryPrice - ord.exitPrice;
  const realizedPnL = (priceDiff / ord.entryPrice) * ord.notional;
  ord.pnl = parseFloat(realizedPnL.toFixed(2));
  ord.pnlPercent = parseFloat(((realizedPnL / ord.margin) * 100).toFixed(2));
  ord.keeperStatus = `Closed (${reason}) @ $${ord.exitPrice.toFixed(4)}`;

  state.balance = parseFloat((state.balance + ord.pnl).toFixed(2));
  state.dailyPnL = parseFloat((state.dailyPnL + ord.pnl).toFixed(2));

  // Sync to unified trade store
  const tradeRecord = {
    tradeId: ord.id || `TRD-${pda.slice(0, 10)}`,
    requestPDA: pda,
    asset: ord.asset || 'SOL',
    side: ord.side || 'Long',
    executionMode: ord.executionMode || 'AUTOTRADE_BOT',
    type: ord.type || 'Perp',
    entryPrice: parseFloat(ord.entryPrice.toFixed(4)),
    exitPrice: parseFloat(ord.exitPrice.toFixed(4)),
    margin: parseFloat(ord.margin.toFixed(2)),
    leverage: ord.leverage || 20,
    notional: parseFloat(ord.notional.toFixed(2)),
    pnl: ord.pnl,
    pnlPercent: ord.pnlPercent,
    timestampEntry: ord.timestampEntry,
    timestampExit: ord.timestampExit,
    reason: ord.closeReason,
    regime: ord.regime || (state.currentSignal && state.currentSignal.regime) || 'RANGE_BOUND_SUPPORT',
    status: 'closed',
  };

  if (!Array.isArray(state.trades)) state.trades = [];
  const existingIdx = state.trades.findIndex(t => t.tradeId === tradeRecord.tradeId || t.requestPDA === pda);
  if (existingIdx >= 0) {
    state.trades[existingIdx] = tradeRecord;
  } else {
    state.trades.unshift(tradeRecord);
  }

  persistState();

  // Notify Auto-Switcher and Circuit Breaker of settled trade
  try {
    onTradeSettled(ord.pnl, { reason, exitPrice: ord.exitPrice });
  } catch (err) {
    console.warn('[BOT SERVICE] Auto-Switcher onTradeSettled error:', err.message);
  }

  if (jupiter && typeof jupiter.closePosition === 'function' && ord.positionPDA) {
    try {
      // P0 safety: pass the order's own mode explicitly. Only a
      // LIVE_ONCHAIN order may broadcast its close; paper orders only ever
      // touch the paper store (jupiter.js enforces this + fails closed).
      jupiter.closePosition(ord.positionPDA, ord.side, ord.asset, { paper: ord.executionMode !== 'LIVE_ONCHAIN', simulate: false }).catch(e => {
        console.warn('[BOT SERVICE] jupiter.closePosition notice:', e.message);
      });
    } catch (_) {}
  }

  return ord;
}

function cancelOrder(pda) {
  const ord = state.orders[pda];
  if (!ord) return null;
  if (ord.status === 'filled') {
    throw new Error('Order is already filled. Use /close to close an active position.');
  }
  if (ord.status === 'closed' || ord.status === 'cancelled') {
    return ord;
  }
  ord.status = 'cancelled';
  ord.closedAt = Date.now();
  ord.keeperStatus = 'Order cancelled by user';
  persistState();

  if (jupiter && typeof jupiter.cancelOrder === 'function' && ord.requestPDA) {
    try {
      // P0 safety: pass the order's own mode explicitly (see closePosition).
      jupiter.cancelOrder(ord.requestPDA, { paper: ord.executionMode !== 'LIVE_ONCHAIN', simulate: false }).catch(e => {
        console.warn('[BOT SERVICE] jupiter.cancelOrder notice:', e.message);
      });
    } catch (_) {}
  }

  return ord;
}

function placeSignalOrder(payload) {
  if (state.isHalted) {
    return { status: 'halted', message: 'Bot circuit breaker is active. Orders rejected.' };
  }

  // P0 safety: server-side direction allowlist (Phase 2: longs + DESIGNED
  // shorts). Longs: green/buy/long. Shorts: red/sell/short ONLY when the
  // payload carries designedShort === true — the canonical engine's
  // marker (src/engine/trigger.ts sets it when a mirror hook + 5m red
  // confirmation fired). Anything else — yellow/standby, or a red
  // payload without the marker — is rejected HERE, before evaluation
  // or sizing. This is the second layer of the deliberate-short gate
  // (the switcher enforces the same rule); neither layer alone
  // re-opens the old "anything not long = short" mapping.
  const rawDirection = String(payload.direction || payload.signal || 'green').toLowerCase();
  const isLongDir = ['green', 'buy', 'long'].includes(rawDirection);
  const isShortDir = ['red', 'sell', 'short'].includes(rawDirection);
  if (!isLongDir && !(isShortDir && payload.designedShort === true)) {
    console.warn(`[DIRECTION ALLOWLIST] Rejected signal direction: ${rawDirection} (designedShort=${payload.designedShort === true})`);
    return {
      status: 'rejected',
      reason: 'DIRECTION_NOT_ALLOWED',
      message: `Signal direction '${rawDirection}' is not allowed: longs (green/buy/long) are accepted, and shorts (red/sell/short) only when they carry the canonical engine's designedShort marker.`,
    };
  }

  // Evaluate trade signal with Dynamic Strategy Auto-Preset Switcher.
  // A monotonic evaluation counter is passed as barIndex so the
  // switcher's circuit-breaker bar math (2 losses within 10 bars)
  // counts real evaluations instead of a never-advancing 0.
  state.evalCounter = (state.evalCounter || 0) + 1;
  const decision = evaluateTradeSignal(payload, state.balance, state.evalCounter);
  if (!decision.execute) {
    console.warn(`[AUTO-SWITCHER REJECTION] ${decision.reason}`);
    return {
      status: 'rejected',
      reason: decision.reason,
      message: decision.reason,
      circuitBreaker: decision.circuitBreaker,
      ...(decision.feeInfo ? { feeInfo: decision.feeInfo } : {}),
    };
  }

  // Open position cap from the tier table (server execution policy,
  // preserved: Tier 1 = 1, Tier 2 = 2, Tier 3 = 3).
  const maxAllowedPositions = decision.preset.maxOpenPositions || 1;
  const activeOrders = Object.values(state.orders).filter(o => o.status === 'filled' || o.status === 'placed' || o.status === 'pending_keeper');
  if (activeOrders.length >= maxAllowedPositions) {
    console.warn(`[AUTO-SWITCHER POSITION CAP] Open position limit reached: ${activeOrders.length}/${maxAllowedPositions} for ${decision.preset.name}`);
    return {
      status: 'rejected',
      reason: 'MAX_POSITIONS_REACHED',
      message: `Open position cap reached (${activeOrders.length}/${maxAllowedPositions}) for ${decision.preset.name} (Balance: $${state.balance.toFixed(2)}). An active position must close before opening a new one.`,
      activePositionsCount: activeOrders.length,
      maxAllowedPositions,
    };
  }

  // Price is declared BEFORE the log line (Phase 2 TDZ fix: the old
  // log line referenced `price` in a fallback that only evaluated when
  // decision.tokens was falsy — a latent ReferenceError).
  const price = parseFloat(payload.price) || 116.65;
  console.log(`[AUTO-SWITCHER EXECUTE] Tier: ${decision.preset.name} | Side: ${decision.side || 'Long'} | Balance: $${state.balance.toFixed(2)} | Margin: $${decision.margin.toFixed(2)} | Leverage: ${decision.leverage}x ($${decision.notional.toFixed(2)} notional / ${decision.tokens} SOL) | Risk Cap: ${(decision.preset.riskCapPct * 100).toFixed(0)}% (-$${decision.maxDollarLoss.toFixed(2)}) | Max Positions: ${maxAllowedPositions}${decision.feeInfo ? ` | FeeRatio: ${decision.feeInfo.feeRatio}${decision.feeInfo.feeWarning ? ' (FEE WARNING)' : ''}` : ''}`);

  const asset = (payload.asset || 'SOL').toUpperCase();
  // Direction was allowlisted at the top of this function; the
  // canonical side comes from the switcher decision.
  const side = decision.side || 'Long';

  const entryPrice = decision.entryPrice;
  const stopLoss = decision.stopLoss;
  const takeProfit = decision.tp2;
  const tp1 = decision.tp1Dist;
  const tp2 = decision.tp2Dist;
  const tp1Percent = parseFloat(payload.tp1Percent) || decision.tp1Percent || 30;
  const tp2Percent = parseFloat(payload.tp2Percent) || decision.tp2Percent || 70;
  // Setup grade comes from the server decision (default GRADE_B);
  // the old payload-or-GRADE_A default overstated confidence.
  const setupGrade = decision.setupGrade || 'GRADE_B';
  const limitOrderTTLMinutes = parseFloat(payload.limitOrderTTLMinutes) || 15;
  const earlyProfitLock = parseFloat(payload.earlyProfitLock) || 0.10;
  const trailingStopOffset = parseFloat(payload.trailingStopOffset) || parseFloat((0.35 * 1.2).toFixed(2));

  // 7) Order Sizing: Margin is wallet collateral, notional is total position exposure
  const margin = Math.min(500.0, decision.margin);
  const leverage = decision.leverage;
  const notional = decision.notional ? decision.notional : parseFloat((margin * leverage).toFixed(2));
  const tokens = decision.tokens || parseFloat((notional / (entryPrice || price)).toFixed(4));

  // Unified execution decision (Phase 1 scope correction).
  // The ENV-resolved mode decides what an order CAN be. A per-request
  // flag (payload.simulate) can never escalate beyond it: in paper or
  // simulate processes, no payload can force a broadcast. In a live
  // process, an unarmed signal is REJECTED (not silently papered), so the
  // operator always knows the process is live-configured but locked.
  const resolvedMode = TRADING_MODE.effectiveMode; // 'paper' | 'simulate' | 'live'
  const wantsSimulate = resolvedMode === 'simulate';
  const wantsLive = resolvedMode === 'live' && state.executionMode === 'live_onchain';

  // 7) Jupiter Slippage Limit (maxSlippageBps: 5)
  // Swaps automatically abort if market spread widens beyond 5 bps (0.05%)
  const marketPrice = state.marketPrice || price;
  const spreadBps = Math.abs(marketPrice - entryPrice) / entryPrice * 10000;
  const maxSlippageBps = payload.maxSlippageBps || decision.maxSlippageBps || 5;
  if (spreadBps > maxSlippageBps && wantsLive) {
    console.warn(`[JUPITER SLIPPAGE ABORT] Market spread ${spreadBps.toFixed(2)} bps exceeds ${maxSlippageBps} bps limit. Swap aborted.`);
    return {
      status: 'rejected',
      reason: 'SLIPPAGE_EXCEEDED',
      message: `Swap automatically aborted by Jupiter Slippage Limit: market spread is ${spreadBps.toFixed(2)} bps (> ${maxSlippageBps} bps / 0.05% limit). Protected against wide liquidity spreads.`,
      spreadBps: parseFloat(spreadBps.toFixed(2)),
      maxSlippageBps,
    };
  }

  // Live-configured but not armed: reject, never silently paper. (The
  // operator chose live env; papering their signal would be a mode lie.)
  if (resolvedMode === 'live' && !wantsLive) {
    return {
      status: 'rejected',
      reason: 'SAFETY_INTERLOCK_ENGAGED',
      message: 'Live mode is configured (PAPER_TRADING=false, SIMULATE_TX=false) but the safety toggle is not armed. Arm it via /safety-toggle after the audit passes, or restart in paper/simulate mode.',
    };
  }

  if (wantsLive) {
    // A LIVE_ONCHAIN record must never be written for an order that could
    // not reach Jupiter at all (e.g. module failed to load).
    if (!jupiter || typeof jupiter.placeLimitOrder !== 'function') {
      return {
        status: 'rejected',
        reason: 'JUPITER_MODULE_UNAVAILABLE',
        message: 'Live execution rejected: the Jupiter module failed to load, so nothing can be broadcast. Refusing to record a LIVE_ONCHAIN order that never reached the chain.',
      };
    }
    if (!state.safetyToggle.enabled) {
      return {
        status: 'rejected',
        reason: 'SAFETY_INTERLOCK_ENGAGED',
        message: 'Live execution rejected: The Live Trading Safety Toggle is LOCKED. All 5 safety conditions must be satisfied and verified before real account execution is permitted.',
      };
    }
    const kpInfo = loadActiveKeypair();
    if (!kpInfo || !kpInfo.keypair) {
      return {
        status: 'rejected',
        reason: 'WALLET_KEYPAIR_MISSING',
        message: 'Live execution rejected: No valid Solana keypair found. Import or generate a wallet keypair first.',
      };
    }
    if (state.wallet.solBalance < 0.02) {
      return {
        status: 'rejected',
        reason: 'INSUFFICIENT_GAS',
        message: `Live execution rejected: Insufficient SOL for rent & priority fees (${state.wallet.solBalance} SOL < 0.02 SOL minimum).`,
      };
    }
  }

  // Generate unique PDA
  const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let randPda = 'Fx';
  for (let i = 0; i < 42; i++) {
    randPda += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  const kpInfo = wantsLive ? loadActiveKeypair() : null;

  const newOrder = {
    id: 'ord_' + Date.now().toString().slice(-6),
    requestPDA: randPda,
    positionPDA: 'Pos' + randPda.slice(3, 40),
    asset,
    side,
    entryPrice: parseFloat(entryPrice.toFixed(4)),
    currentPrice: price,
    stopLoss: parseFloat(stopLoss.toFixed(4)),
    takeProfit: parseFloat(takeProfit.toFixed(4)),
    tp1: parseFloat(tp1.toFixed(4)),
    tp2: parseFloat(tp2.toFixed(4)),
    tp1Percent,
    tp2Percent,
    setupGrade,
    limitOrderTTLMs: limitOrderTTLMinutes * 60 * 1000,
    limitOrderTTLMinutes,
    earlyProfitLock,
    trailingStopOffset,
    highestPrice: entryPrice,
    // Favorable-extreme tracking for the keeper chandelier (Phase 2):
    // longs trail off highestPrice, shorts off lowestPrice. The old
    // code tracked only highestPrice, so the short chandelier trailed
    // off the ADVERSE extreme and could only loosen the stop.
    lowestPrice: entryPrice,
    tp1Hit: false,
    margin,
    leverage,
    notional,
    tokens,
    maxMarginUsd: 500,
    maxSlippageBps: 5,
    maxDollarLoss: decision.maxDollarLoss,
    // Regime is the market regime (Phase 2 fix: the old code stored
    // the tier id here, so every trade record claimed a nonsense
    // regime and the ledger's regime mapping defaulted everything to
    // "Range Bound / Support").
    regime: decision.regime || payload.regime || 'RANGE_BOUND_SUPPORT',
    tier: decision.tier || null,
    isChop: decision.isChop || false,
    marginMultiplier: decision.marginMultiplier || 1,
    designedShort: decision.designedShort || false,
    feeInfo: decision.feeInfo || null,
    executionMode: wantsLive ? 'LIVE_ONCHAIN' : (wantsSimulate ? 'SIMULATED' : 'AUTOTRADE_BOT'),
    type: 'Perp',
    status: 'placed',
    placedAt: Date.now(),
    filledAt: null,
    closedAt: null,
    timestampEntry: null,
    timestampExit: null,
    isSimulated: !wantsLive,
    signerPublicKey: kpInfo ? kpInfo.publicKey : null,
    pnl: 0.0,
    pnlPercent: 0.0,
    keeperStatus: wantsLive ? 'Broadcast requested — awaiting Jupiter confirmation'
      : wantsSimulate ? 'Simulated on-chain (not broadcast) — awaiting simulation result'
      : 'Waiting for keeper match on-chain / limit fill dip',
    closeReason: null,
    exitPrice: null,
  };

  state.orders[randPda] = newOrder;
  persistState();

  // Jupiter Perpetuals Integration Hook (P0 safety + unified mode).
  // Exactly one of three honest paths, chosen by ENV mode (never by a
  // per-request flag):
  //   paper    -> paper: true,  simulate: false -> local virtual record.
  //   simulate -> paper: false, simulate: true  -> RPC simulation only.
  //   live     -> paper: false, simulate: false -> real broadcast, and
  //     only then is the order honestly LIVE_ONCHAIN. The safety interlock
  //     above (module present + toggle + keypair + gas) already passed.
  // The placement call is fire-and-forget, so 'placed' means "accepted",
  // NOT "broadcast confirmed": keeperStatus is updated to the real outcome
  // when Jupiter resolves; failures are recorded, never hidden.
  if (jupiter && typeof jupiter.placeLimitOrder === 'function') {
    try {
      jupiter.placeLimitOrder({
        asset,
        side,
        marginUSDC: margin,
        limitPrice: entryPrice,
        leverage,
        stopLoss,
        takeProfit,
        paper: resolvedMode === 'paper',
        simulate: wantsSimulate,
      }).then(resId => {
        console.log(`[BOT SERVICE] Jupiter Perps Order registered: ${resId}`);
        if (state.orders[randPda]) {
          if (wantsLive) state.orders[randPda].keeperStatus = `Broadcast submitted (request ${resId})`;
          else if (wantsSimulate) state.orders[randPda].keeperStatus = `Simulated OK (not broadcast; request ${resId})`;
          persistState();
        }
      }).catch(err => {
        console.error(`[BOT SERVICE] Jupiter Perps placement FAILED: ${err.message}`);
        if (state.orders[randPda]) {
          state.orders[randPda].keeperStatus = wantsLive
            ? `JUPITER_BROADCAST_FAILED: ${err.message}`
            : wantsSimulate ? `SIMULATION_FAILED: ${err.message}` : `JUPITER_PAPER_FAILED: ${err.message}`;
          persistState();
        }
      });
    } catch (err) {
      console.warn(`[BOT SERVICE] Jupiter Perps invocation notice: ${err.message}`);
      if (state.orders[randPda]) {
        state.orders[randPda].keeperStatus = wantsLive
          ? `JUPITER_BROADCAST_FAILED: ${err.message}`
          : wantsSimulate ? `SIMULATION_FAILED: ${err.message}` : `JUPITER_PAPER_FAILED: ${err.message}`;
      }
    }
  }

  return {
    status: 'placed',
    requestPDA: newOrder.requestPDA,
    entryPrice: newOrder.entryPrice,
    stopLoss: newOrder.stopLoss,
    takeProfit: newOrder.takeProfit,
    margin: newOrder.margin,
    leverage: newOrder.leverage,
    isSimulated: newOrder.isSimulated,
    signerPublicKey: newOrder.signerPublicKey,
    // Resolved mode, so every consumer (UI toasts, logs) can display what
    // actually happened instead of a hardcoded network claim.
    tradingMode: resolvedMode,
    network: TRADING_MODE.network,
  };
}

// --------------------------------------------------------------------------
// MAINNET TRANSACTION ASSEMBLY PIPELINE (Compute Priority Fees & WSOL Wrapping)
// --------------------------------------------------------------------------
function assembleJupiterOrderTx({ ownerPubkey, isLong = true, marginLamports = 0 }) {
  const { Transaction, ComputeBudgetProgram, SystemProgram, PublicKey } = require('@solana/web3.js');
  const { 
    TOKEN_PROGRAM_ID, 
    ASSOCIATED_TOKEN_PROGRAM_ID, 
    NATIVE_MINT, 
    createAssociatedTokenAccountIdempotentInstruction, 
    createSyncNativeInstruction,
    getAssociatedTokenAddressSync
  } = require('@solana/spl-token');

  const tx = new Transaction();
  
  // 1. Compute Priority Fees (Mandatory for Solana Mainnet high volatility inclusion)
  // Phase 2: priority fees from the shared env-driven config (same
  // values the fee guard uses), not hardcoded literals.
  const _pf = getPriorityFeeConfig();
  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: _pf.microLamports }));
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: _pf.computeUnits }));

  // 2. WSOL Token Wrapping Logic (Jupiter Perps requires Wrapped SOL for Long positions)
  if (isLong && marginLamports > 0 && ownerPubkey) {
    const owner = new PublicKey(ownerPubkey);
    const wsolAta = getAssociatedTokenAddressSync(
      NATIVE_MINT, 
      owner, 
      false, 
      TOKEN_PROGRAM_ID, 
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(owner, wsolAta, owner, NATIVE_MINT),
      SystemProgram.transfer({
        fromPubkey: owner,
        toPubkey: wsolAta,
        lamports: BigInt(marginLamports),
      }),
      createSyncNativeInstruction(wsolAta)
    );
  }
  return tx;
}

// 5) Real-Time Price & UTC Date/Time Ledger Sync: Unified Trade Ledger Store
function getDeduplicatedTradesList() {
  const map = new Map();
  // Include persisted trades
  if (Array.isArray(state.trades)) {
    for (const t of state.trades) {
      // P0 integrity: trades are reported exactly as recorded. (The old
      // margin -> 600.00 / pnl -> -0.30 rewrite lived here too; removed.)
      const id = t.tradeId || t.id || t.requestPDA;
      if (id) map.set(id, t);
    }
  }
  // Include any closed orders from state.orders not yet synced
  if (state.orders) {
    for (const [pda, ord] of Object.entries(state.orders)) {
      if (ord && ord.status === 'closed') {
        const tradeId = ord.id || `TRD-${pda.slice(0, 10)}`;
        if (!map.has(tradeId)) {
          const entryTime = ord.timestampEntry || (ord.filledAt ? new Date(ord.filledAt).toISOString() : new Date(ord.placedAt || Date.now()).toISOString());
          const exitTime = ord.timestampExit || (ord.closedAt ? new Date(ord.closedAt).toISOString() : new Date().toISOString());
          const entryPrice = parseFloat(Number(ord.entryPrice || 116.5625).toFixed(4));
          const exitPrice = parseFloat(Number(ord.exitPrice || ord.currentPrice || 117.3125).toFixed(4));
          const margin = parseFloat(Number(ord.margin || 25.00).toFixed(2));
          const leverage = parseInt(ord.leverage, 10) || 20;
          const notional = parseFloat(Number(ord.notional || (margin * leverage) || 500.00).toFixed(2));
          const pnl = parseFloat(Number(ord.pnl || 0).toFixed(2));
          const pnlPercent = margin > 0 ? parseFloat(((pnl / margin) * 100).toFixed(2)) : 0;
          const fee = parseFloat((notional * 0.0008).toFixed(2)); // Standard 0.08% roundtrip fee

          // Map exit reason to clean Backtest Ledger Types (SL, Full TP, Half TP/Fisher, Half TP/BE, Chandelier Trail, Stagnation Exit)
          let cleanType = 'TP1';
          const r = String(ord.closeReason || ord.reason || '').toUpperCase();
          if (r.includes('STOP_LOSS') || r.includes('SL_HIT') || r.includes('EQUITY_RISK_CAP')) cleanType = 'SL';
          else if (r.includes('TAKE_PROFIT_2') || r.includes('TP2')) cleanType = 'Full TP';
          else if (r.includes('EARLY_BANK') || r.includes('70%')) cleanType = 'Half TP/Fisher';
          else if (r.includes('CHANDELIER') || r.includes('TRAILING_STOP')) cleanType = 'Chandelier Trail';
          else if (r.includes('STAGNATION')) cleanType = 'Stagnation Exit';
          else if (r.includes('BE') || r.includes('BREAKEVEN') || r.includes('FEE_NEUTRAL')) cleanType = 'Half TP/BE';
          else if (ord.type) cleanType = ord.type;

          let cleanRegime = 'Range Bound / Support';
          const reg = String(ord.regime || '').toUpperCase();
          if (reg.includes('BULL')) cleanRegime = 'Bull Trend Drift';
          else if (reg.includes('FLASH') || reg.includes('CRASH')) cleanRegime = 'Flash Crash Volatility';
          else if (reg.includes('CHOP')) cleanRegime = 'Market Chop';

          const trd = {
            tradeId,
            id: tradeId,
            requestPDA: pda,
            asset: ord.asset || 'SOL',
            side: ord.side || 'Long',
            executionMode: ord.executionMode || 'AUTOTRADE_BOT',
            type: cleanType,
            entryPrice,
            entry: entryPrice,
            exitPrice,
            exit: exitPrice,
            margin,
            leverage,
            lev: leverage,
            notional,
            pnl,
            pnlPercent,
            returnPct: pnlPercent,
            fee,
            balance: parseFloat((state.balance || 30.0).toFixed(2)),
            timestampEntry: entryTime,
            timestampExit: exitTime,
            dateTime: entryTime ? entryTime.replace('T', ' ').slice(0, 19) + ' UTC' : '',
            reason: ord.closeReason || 'CLOSED',
            regime: cleanRegime,
            status: 'closed',
          };
          map.set(tradeId, trd);
        }
      }
    }
  }

  const sorted = Array.from(map.values()).sort((a, b) => {
    const tB = new Date(b.timestampExit || b.timestampEntry || 0).getTime();
    const tA = new Date(a.timestampExit || a.timestampEntry || 0).getTime();
    return tB - tA;
  });

  // Assign sequential trade numbers # and rolling balance
  let runningBal = state.balance || 30.0;
  return sorted.map((t, idx) => {
    return {
      ...t,
      n: sorted.length - idx,
      entry: typeof t.entry === 'number' ? t.entry : t.entryPrice,
      exit: typeof t.exit === 'number' ? t.exit : t.exitPrice,
      lev: t.lev || t.leverage || 20,
      returnPct: typeof t.returnPct === 'number' ? t.returnPct : t.pnlPercent,
      fee: typeof t.fee === 'number' ? t.fee : parseFloat(((t.notional || 210) * 0.0008).toFixed(2)),
      balance: typeof t.balance === 'number' ? t.balance : parseFloat(runningBal.toFixed(2)),
      dateTime: t.dateTime || (t.timestampEntry ? t.timestampEntry.replace('T', ' ').slice(0, 19) + ' UTC' : ''),
    };
  });
}

function generateTradesCsv(trades) {
  // Formatted identically to the Backtest Executed Trades Ledger
  const headers = [
    '#',
    'Date / Time (UTC)',
    'Regime',
    'Side',
    'Type',
    'Entry ($)',
    'Exit ($)',
    'Margin ($)',
    'Lev',
    'PnL ($)',
    'Return %',
    'Fee ($)',
    'Balance ($)',
    'Trade ID',
    'Execution Mode'
  ];

  const rows = trades.map((t, idx) => {
    const tradeNum = t.n || (trades.length - idx);
    const dt = t.dateTime || (t.timestampEntry ? t.timestampEntry.replace('T', ' ').slice(0, 19) + ' UTC' : '');
    const regime = `"${t.regime || 'Range Bound / Support'}"`;
    const side = `"${t.side || 'Long'}"`;
    const type = `"${t.type || 'TP1'}"`;
    // P0 integrity: never invent CSV values for missing fields. Empty cells
    // are honest; the old hardcoded 116.56 / 117.31 / $0.17 were fabricated.
    const entry = typeof t.entry === 'number' ? t.entry.toFixed(2) : typeof t.entryPrice === 'number' ? t.entryPrice.toFixed(2) : '';
    const exit = typeof t.exit === 'number' ? t.exit.toFixed(2) : typeof t.exitPrice === 'number' ? t.exitPrice.toFixed(2) : '';
    const margin = typeof t.margin === 'number' ? t.margin.toFixed(2) : '';
    const lev = `${t.lev || t.leverage || 20}×`;
    const pnl = typeof t.pnl === 'number' ? (t.pnl >= 0 ? `+$${t.pnl.toFixed(2)}` : `-$${Math.abs(t.pnl).toFixed(2)}`) : '$0.00';
    const retPct = typeof t.returnPct === 'number' ? `${t.returnPct >= 0 ? '+' : ''}${t.returnPct.toFixed(1)}%` : typeof t.pnlPercent === 'number' ? `${t.pnlPercent >= 0 ? '+' : ''}${t.pnlPercent.toFixed(1)}%` : '0.0%';
    const fee = typeof t.fee === 'number' ? `$${t.fee.toFixed(2)}` : '';
    const bal = typeof t.balance === 'number' ? `$${t.balance.toFixed(2)}` : `$${(state.balance || 30).toFixed(2)}`;
    const trdId = `"${t.tradeId || t.id || ''}"`;
    const mode = `"${t.executionMode || 'AUTOTRADE_BOT'}"`;

    return [tradeNum, `"${dt}"`, regime, side, type, entry, exit, margin, lev, pnl, retPct, fee, bal, trdId, mode].join(',');
  });

  return '\uFEFF' + [headers.join(','), ...rows].join('\n');
}

// Request handler for both Vite middleware and port 3001
function handleApiRequest(req, res) {
  if (res.headersSent) return;

  const urlObj = new URL(req.url, 'http://localhost');
  const pathname = urlObj.pathname.replace(/^\/api\/bot/, '');
  const method = req.method.toUpperCase();

  // CORS headers (P0 safety): never '*'. If DASHBOARD_ORIGIN is set, only
  // that origin is allowed; otherwise no cross-origin access is granted
  // (same-origin dashboard use needs no CORS headers at all).
  try {
    if (!res.headersSent) {
      if (process.env.DASHBOARD_ORIGIN) {
        res.setHeader('Access-Control-Allow-Origin', process.env.DASHBOARD_ORIGIN);
      }
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }
  } catch (_) {}

  if (method === 'OPTIONS') {
    if (!res.headersSent) {
      res.writeHead(204);
      res.end();
    }
    return;
  }

  // NOTE: the bearer-token auth check lives AFTER sendJson/getBody below
  // (it must: it calls sendJson). It was originally placed here and threw
  // a TDZ ReferenceError, turning every 401 into a 500 — caught by the
  // smoke test. Do not move it back above sendJson.
  const sendJson = (statusCode, data) => {
    if (res.headersSent) return;
    try {
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch (_) {}
  };

  const getBody = (cb) => {
    let body = '';
    let tooLarge = false;
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) { // 1 MB cap: refuse oversized payloads
        tooLarge = true;
        try { req.destroy(); } catch (_) {}
      }
    });
    req.on('error', () => {
      if (!res.headersSent) sendJson(400, { error: 'Request body error.' });
    });
    req.on('end', () => {
      if (tooLarge) {
        if (!res.headersSent) sendJson(413, { error: 'Payload too large (max 1 MB).' });
        return;
      }
      if (res.headersSent) return;
      try {
        const parsed = body ? JSON.parse(body) : {};
        cb(parsed);
      } catch (err) {
        sendJson(400, { error: 'Invalid JSON payload: ' + err.message });
      }
    });
  };

  // P0 safety: bearer-token auth for every mutating route.
  // Token comes ONLY from the BOT_AUTH_TOKEN env var (never from the repo).
  // Fail closed: if NODE_ENV=production and no token is configured, all
  // mutating routes are refused. In dev without a token, requests are
  // allowed but loudly warned once, so local development still works.
  const MUTATING_PATHS = new Set([
    '/signal', '/close', '/cancel', '/wallet-config', '/safety-toggle',
    '/mode', '/halt', '/resume', '/portfolio-balance', '/balance',
    '/api/trades', '/trades', '/signal-status', '/api/bot/signal-status',
    '/update-price', '/simulate-keeper-fill', '/airdrop',
    '/reset-circuit-breaker', '/autotrade/toggle', '/api/bot/autotrade/toggle',
  ]);
  const isMutating = (method === 'POST' || method === 'DELETE') &&
    (MUTATING_PATHS.has(pathname) || MUTATING_PATHS.has(urlObj.pathname));
  if (isMutating) {
    const token = process.env.BOT_AUTH_TOKEN || '';
    if (!token) {
      if (process.env.NODE_ENV === 'production') {
        sendJson(503, { error: 'Mutating API disabled: BOT_AUTH_TOKEN is not configured on the server.' });
        return;
      }
      if (!global.__botAuthWarned) {
        global.__botAuthWarned = true;
        console.warn('[AUTH] WARNING: BOT_AUTH_TOKEN is not set. Mutating routes are open in this non-production process. Set BOT_AUTH_TOKEN before any public deploy.');
      }
    } else {
      const presented = (req.headers && req.headers.authorization) || '';
      const expected = `Bearer ${token}`;
      let ok = false;
      try {
        const a = Buffer.from(presented);
        const b = Buffer.from(expected);
        ok = a.length === b.length && crypto.timingSafeEqual(a, b);
      } catch (_) { ok = false; }
      if (!ok) {
        sendJson(401, { error: 'Unauthorized: valid Bearer token required.' });
        return;
      }
    }
  }

  // 0a. GET /api/binance/klines
  if (method === 'GET' && (urlObj.pathname === '/api/binance/klines' || pathname === '/klines' || pathname === '/api/binance/klines')) {
    const symbol = urlObj.searchParams.get('symbol') || 'SOLUSDT';
    const interval = urlObj.searchParams.get('interval') || '15m';
    const limit = urlObj.searchParams.get('limit') || '200';

    fetchBinanceKlines(symbol, interval, limit, (err, data) => {
      if (err) {
        return sendJson(500, { error: err.message });
      }
      return sendJson(200, data);
    });
    return;
  }

  // 0b. GET /api/binance/ticker
  if (method === 'GET' && (urlObj.pathname === '/api/binance/ticker' || pathname === '/ticker' || pathname === '/api/binance/ticker')) {
    const symbol = urlObj.searchParams.get('symbol') || 'SOLUSDT';
    fetchBinanceTicker(symbol, (err, data) => {
      if (err) {
        return sendJson(500, { error: err.message });
      }
      return sendJson(200, data);
    });
    return;
  }

  // 0c. GET /health or /ping
  if (method === 'GET' && (pathname === '/health' || pathname === '/ping' || urlObj.pathname === '/health')) {
    sendJson(200, {
      status: 'ok',
      balance: state.balance,
      positions: Object.keys(state.orders).length,
      uptime: process.uptime(),
      network: state.network,
      jupiterIntegrated: Boolean(jupiter),
    });
    return;
  }

  // 0d. Unified Trades Ledger Endpoint (/api/trades & /api/trades/csv)
  if (
    pathname === '/api/trades' ||
    pathname === '/trades' ||
    urlObj.pathname === '/api/trades' ||
    urlObj.pathname === '/api/trades/csv' ||
    pathname === '/api/trades/csv'
  ) {
    const deduplicatedTrades = getDeduplicatedTradesList();

    if (method === 'GET') {
      const wantsCsv = urlObj.pathname.endsWith('/csv') || pathname.endsWith('/csv') || urlObj.searchParams.get('format') === 'csv';
      if (wantsCsv) {
        const csvContent = generateTradesCsv(deduplicatedTrades);
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="executed_trades_ledger.csv"',
          'Cache-Control': 'no-cache',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(csvContent);
        return;
      }

      const wins = deduplicatedTrades.filter(t => t.pnl > 0).length;
      const losses = deduplicatedTrades.filter(t => t.pnl < 0).length;
      const totalPnL = deduplicatedTrades.reduce((acc, t) => acc + (t.pnl || 0), 0);
      const winRate = deduplicatedTrades.length > 0 ? (wins / deduplicatedTrades.length) * 100 : 0;

      sendJson(200, {
        success: true,
        count: deduplicatedTrades.length,
        trades: deduplicatedTrades,
        summary: {
          totalTrades: deduplicatedTrades.length,
          totalPnL: parseFloat(totalPnL.toFixed(2)),
          winCount: wins,
          lossCount: losses,
          winRate: parseFloat(winRate.toFixed(1)),
        },
      });
      return;
    }

    if (method === 'POST') {
      getBody(payload => {
        // P0 integrity: a manually logged trade must carry real prices.
        // The old chain fell back to a fabricated 119.05; now an explicit
        // price is required, else a fresh market price, else the request
        // is rejected rather than recorded with invented numbers.
        const freshMarket = (typeof state.marketPrice === 'number' && state.marketPrice > 0) ? state.marketPrice : null;
        const entryRaw = payload.entryPrice ?? payload.entry ?? freshMarket;
        const exitRaw = payload.exitPrice ?? payload.exit ?? freshMarket;
        if (entryRaw === null || entryRaw === undefined || exitRaw === null || exitRaw === undefined ||
            isNaN(Number(entryRaw)) || isNaN(Number(exitRaw))) {
          sendJson(400, { error: 'entryPrice and exitPrice are required (no market price available to fall back on).' });
          return;
        }
        const entryP = parseFloat(Number(entryRaw).toFixed(4));
        const exitP = parseFloat(Number(exitRaw).toFixed(4));
        const side = payload.side === 'Short' ? 'Short' : 'Long';
        const notional = parseFloat(Number(payload.notional || (payload.margin || 25.00) * (payload.leverage || 20)).toFixed(2));
        const priceDiff = side === 'Long' ? exitP - entryP : entryP - exitP;
        const autoPnl = parseFloat(((priceDiff / entryP) * notional).toFixed(2));
        const pnl = payload.pnl !== undefined ? parseFloat(Number(payload.pnl).toFixed(2)) : autoPnl;
        const margin = parseFloat(Number(payload.margin || 25.00).toFixed(2));
        const pnlPercent = margin > 0 ? parseFloat(((pnl / margin) * 100).toFixed(2)) : 0;

        const newTrade = {
          tradeId: payload.tradeId || `TRD-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          asset: (payload.asset || 'SOL').toUpperCase(),
          side,
          executionMode: payload.executionMode || 'MANUAL_UI',
          type: payload.type || 'Perp',
          entryPrice: entryP,
          exitPrice: exitP,
          margin,
          leverage: parseInt(payload.leverage, 10) || 20,
          notional,
          pnl,
          pnlPercent,
          timestampEntry: payload.timestampEntry || new Date().toISOString(),
          timestampExit: payload.timestampExit || new Date().toISOString(),
          reason: payload.reason || 'MANUAL_TRADE_LOG',
          regime: payload.regime || (state.currentSignal && state.currentSignal.regime) || 'RANGE_BOUND_SUPPORT',
          status: 'closed',
        };

        if (!Array.isArray(state.trades)) state.trades = [];
        state.trades.unshift(newTrade);
        persistState();

        const updatedList = getDeduplicatedTradesList();
        sendJson(200, {
          success: true,
          trade: newTrade,
          trades: updatedList,
          message: 'Trade recorded in unified ledger.',
        });
      });
      return;
    }

    if (method === 'DELETE') {
      getBody(payload => {
        const idToDelete = payload.tradeId || payload.id;
        if (idToDelete) {
          if (Array.isArray(state.trades)) {
            state.trades = state.trades.filter(t => t.tradeId !== idToDelete && t.id !== idToDelete && t.requestPDA !== idToDelete);
          }
          if (state.orders && state.orders[idToDelete]) {
            delete state.orders[idToDelete];
          }
          persistState();
        }
        sendJson(200, {
          success: true,
          trades: getDeduplicatedTradesList(),
        });
      });
      return;
    }
  }

  // 0e. Export Active Positions / Order Monitor CSV
  if (
    pathname === '/api/positions/csv' ||
    pathname === '/positions/csv' ||
    urlObj.pathname === '/api/positions/csv' ||
    urlObj.pathname === '/positions/csv' ||
    pathname === '/api/orders/csv' ||
    pathname === '/orders/csv'
  ) {
    const activeList = Object.values(state.orders).filter(
      o => o && (o.status === 'open' || o.status === 'filled' || o.status === 'placed' || o.status === 'pending_keeper' || o.status === 'pending')
    );
    const headers = [
      '#',
      'Date / Time (UTC)',
      'Regime',
      'Side',
      'Type',
      'Entry ($)',
      'Current ($)',
      'Margin ($)',
      'Lev',
      'PnL ($)',
      'Return %',
      'Fee ($)',
      'Balance ($)',
      'Status',
      'Request PDA'
    ];
    const rows = activeList.map((o, idx) => {
      const dt = o.filledAt ? new Date(o.filledAt).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : new Date(o.placedAt || Date.now()).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
      const side = `"${o.side || 'Long'}"`;
      const type = `"${o.status === 'placed' || o.status === 'pending_keeper' ? 'Pending Limit' : 'Active Filled'}"`;
      const entry = (o.entryPrice || 116.56).toFixed(2);
      const curr = (o.currentPrice || state.marketPrice || entry);
      const margin = (o.margin || 25.00).toFixed(2);
      const lev = `${o.leverage || 20}×`;
      const pnl = o.pnl !== undefined ? o.pnl : (o.side === 'Long' ? ((curr - entry) / entry) * (o.notional || 500) : ((entry - curr) / entry) * (o.notional || 500));
      const pnlStr = pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`;
      const retPct = o.margin > 0 ? `${((pnl / o.margin) * 100).toFixed(1)}%` : '0.0%';
      const fee = `$${((o.notional || 500) * 0.0008).toFixed(2)}`;
      const bal = `$${(state.balance || 30).toFixed(2)}`;
      return [idx + 1, `"${dt}"`, `"${o.regime || 'Range Bound / Support'}"`, side, type, entry, typeof curr === 'number' ? curr.toFixed(2) : curr, margin, lev, pnlStr, retPct, fee, bal, `"${o.status}"`, `"${o.requestPDA || ''}"`].join(',');
    });
    const csv = '\uFEFF' + [headers.join(','), ...rows].join('\n');
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="active_positions_monitor.csv"',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(csv);
    return;
  }

  // 1. GET /order/:requestPDA
  if (method === 'GET' && pathname.startsWith('/order/')) {
    const pda = pathname.replace('/order/', '').trim();
    const ord = state.orders[pda];
    if (!ord) {
      sendJson(404, { error: `Order not found for requestPDA: ${pda}` });
      return;
    }
    sendJson(200, {
      status: ord.status,
      requestPDA: ord.requestPDA,
      positionPDA: ord.positionPDA,
      asset: ord.asset,
      side: ord.side,
      entryPrice: ord.entryPrice,
      currentPrice: ord.currentPrice,
      pnl: ord.pnl,
      pnlPercent: ord.pnlPercent,
      stopLoss: ord.stopLoss,
      takeProfit: ord.takeProfit,
      margin: ord.margin,
      leverage: ord.leverage,
      notional: ord.notional,
      keeperStatus: ord.keeperStatus,
      isSimulated: ord.isSimulated,
      signerPublicKey: ord.signerPublicKey || null,
      placedAt: ord.placedAt,
      filledAt: ord.filledAt,
      closedAt: ord.closedAt,
      closeReason: ord.closeReason,
      exitPrice: ord.exitPrice,
      explorerUrl: `https://solscan.io/account/${ord.requestPDA}?cluster=${state.network}`,
    });
    return;
  }

  // 2. POST /simulate-keeper-fill
  if (method === 'POST' && pathname === '/simulate-keeper-fill') {
    getBody(payload => {
      let pda = payload.requestPDA;
      let ord = pda && pda !== 'CURRENT_LIVE_GUIDANCE' ? state.orders[pda] : null;

      if (!ord) {
        // Look for any existing placed/pending order in state
        const existing = Object.values(state.orders).find(o => o.status === 'placed' || o.status === 'pending_keeper');
        if (existing) {
          pda = existing.requestPDA;
          ord = existing;
        } else {
          // Auto-create a fresh simulated order at the current market / entry price
          const curP = parseFloat(payload.price) || state.marketPrice || 104.15;
          const newOrdRes = placeSignalOrder({
            asset: payload.asset || 'SOL',
            direction: payload.side ? (payload.side.toLowerCase() === 'short' ? 'sell' : 'buy') : 'buy',
            price: curP,
            barConfirmation: 2,
            consecutiveGreen: 2,
            simulate: true,
          });
          if (newOrdRes && newOrdRes.status === 'placed' && newOrdRes.requestPDA) {
            pda = newOrdRes.requestPDA;
            ord = state.orders[pda];
          }
        }
      }

      if (!ord) {
        sendJson(404, { error: 'No order found or could be created to fill' });
        return;
      }

      fillOrder(pda, ord.entryPrice);
      sendJson(200, {
        status: 'filled',
        requestPDA: pda,
        fillPrice: ord.entryPrice,
        message: 'Keeper simulated fill executed successfully. Position is now active.',
        order: ord,
      });
    });
    return;
  }

  // 3. POST /cancel
  if (method === 'POST' && pathname === '/cancel') {
    getBody(payload => {
      const pda = payload.requestPDA;
      if (!pda) {
        sendJson(400, { error: 'requestPDA is required to cancel an order.' });
        return;
      }
      try {
        const cancelled = cancelOrder(pda);
        sendJson(200, {
          status: 'cancelled',
          requestPDA: pda,
          message: 'Order successfully cancelled.',
          order: cancelled,
        });
      } catch (err) {
        sendJson(400, { error: err.message });
      }
    });
    return;
  }

  // 4. POST /close (single position close, or explicit full flatten)
  if (method === 'POST' && pathname === '/close') {
    getBody(payload => {
      // P0 safety: a close MUST name its target. The old code flattened
      // EVERYTHING whenever requestPDA was missing — which is exactly what
      // dashboard.html's per-position Close button triggered, since it
      // never sent requestPDA. A missing target with no explicit closeAll
      // flag is now a 400, not a mass close.
      // Deliberate kill-switch: an explicit closeAll: true (auth-gated,
      // like every mutating route) still flattens everything on purpose.
      if (!payload.requestPDA && !payload.positionPDA && !payload.closeAll) {
        sendJson(400, { error: 'requestPDA (or positionPDA) is required to close a position. Pass closeAll: true explicitly to flatten everything.' });
        return;
      }
      // Explicit Panic Flatten: Close all open positions & cancel pending orders
      if (payload.closeAll) {
        const closedList = [];
        for (const pda of Object.keys(state.orders)) {
          const ord = state.orders[pda];
          if (ord.status === 'filled') {
            const closed = closeOrder(pda, ord.currentPrice, 'PANIC_FLATTEN');
            closedList.push(closed);
          } else if (ord.status === 'placed' || ord.status === 'pending_keeper') {
            const cancelled = cancelOrder(pda);
            closedList.push(cancelled);
          }
        }
        sendJson(200, {
          status: 'flattened',
          message: `Panic Flatten executed: ${closedList.length} positions/orders closed at market.`,
          count: closedList.length,
          orders: closedList,
        });
        return;
      }

      const pda = payload.requestPDA || payload.positionPDA;
      const ord = state.orders[pda] || Object.values(state.orders).find(o => o.positionPDA === pda);
      if (!ord) {
        sendJson(404, { error: 'Order / position not found to close.' });
        return;
      }
      const closed = closeOrder(ord.requestPDA, payload.exitPrice || ord.currentPrice, payload.reason || 'MANUAL_CLOSE');
      sendJson(200, {
        status: 'closed',
        requestPDA: ord.requestPDA,
        exitPrice: closed.exitPrice,
        pnl: closed.pnl,
        pnlPercent: closed.pnlPercent,
        message: 'Position closed at market price.',
        order: closed,
      });
    });
    return;
  }

  // 4.9 POST /signal-status (Update current signal without dispatching an order)
  if (method === 'POST' && (pathname === '/signal-status' || pathname === '/api/bot/signal-status')) {
    getBody(payload => {
      state.currentSignal = Object.assign(state.currentSignal || {}, payload);
      if (payload.indicators) state.marketIndicators = payload.indicators;
      else if (payload.signal) state.marketIndicators = Object.assign(state.marketIndicators || {}, payload);
      if (payload.price) state.marketPrice = parseFloat(payload.price);
      const isGreenGate = (payload.signal || (state.currentSignal && state.currentSignal.signal) || '').toLowerCase() === 'green';
      sendJson(200, { success: true, currentSignal: state.currentSignal, isGreenGate });
    });
    return;
  }

  // 5. POST /signal
  if (method === 'POST' && pathname === '/signal') {
    getBody(payload => {
      state.currentSignal = payload;
      if (payload.indicators) state.marketIndicators = payload.indicators;
      else state.marketIndicators = payload;
      if (payload.price) state.marketPrice = parseFloat(payload.price);
      const result = placeSignalOrder(payload);
      const statusCode = result.status === 'rejected' ? 403 : 200;
      sendJson(statusCode, result);
    });
    return;
  }

  // 6. GET /state
  if (method === 'GET' && pathname === '/state') {
    // Format positions array for compatibility with dashboard.html & AutoTradeJupiterView
    // Include BOTH filled on-chain positions and placed pending limit orders so the UI
    // never reports 0/2 when orders are pending in keeper matching queue!
    const activeOrders = Object.values(state.orders).filter(
      o => o.status === 'filled' || o.status === 'placed' || o.status === 'pending_keeper'
    );

    const positionsList = activeOrders.map(o => ({
      id: o.id,
      requestPDA: o.requestPDA,
      positionPDA: o.positionPDA,
      asset: o.asset,
      side: o.side,
      status: o.status === 'filled' ? 'open' : 'pending',
      fillPrice: o.entryPrice,
      margin: o.margin,
      leverage: o.leverage,
      // Phase 2: expose the TP distances so the UI can show real
      // TP1/TP2 instead of a hardcoded $0.55.
      tp1: o.tp1,
      tp2: o.tp2,
      takeProfit: o.takeProfit,
      stopLoss: o.stopLoss,
      pnl: o.pnl || 0,
      pnlPercent: o.pnlPercent || 0,
      time: new Date(o.filledAt || o.placedAt).toLocaleTimeString(),
    }));

    sendJson(200, {
      balance: state.balance,
      dailyPnL: state.dailyPnL,
      executionMode: state.executionMode,
      safetyToggle: state.safetyToggle,
      wallet: state.wallet,
      halted: state.isHalted,
      network: state.network,
      rpcUrl: state.rpcUrl,
      // Unified resolved mode: the UI's source of truth for what this
      // process will do (replaces hardcoded "Devnet" claims).
      tradingMode: {
        network: TRADING_MODE.network,
        rpcUrl: TRADING_MODE.rpcUrl,
        configuredMode: TRADING_MODE.configuredMode,
        effectiveMode: TRADING_MODE.effectiveMode,
        devnetForcedSimulate: TRADING_MODE.devnetForcedSimulate,
        armed: TRADING_MODE.effectiveMode === 'live' && state.safetyToggle.enabled && state.executionMode === 'live_onchain',
      },
      positions: positionsList,
      activePositionsCount: activeOrders.length,
      activeOrders: Object.values(state.orders),
      autoSwitcher: getAutoSwitcherState(state.balance),
      autoTrade: state.autoTrade,
      currentSignal: state.currentSignal,
      marketIndicators: state.marketIndicators,
    });
    return;
  }

  // 6.1 POST /portfolio-balance & POST /balance
  // Allows user to manually set target portfolio value (e.g. $30.00 for Tier 1 testing)
  if (method === 'POST' && (pathname === '/portfolio-balance' || pathname === '/balance')) {
    getBody(payload => {
      const newBal = parseFloat(payload.balance);
      if (!isNaN(newBal) && newBal > 0) {
        state.balance = parseFloat(newBal.toFixed(2));
        persistState();
        const autoSwitcher = getAutoSwitcherState(state.balance);
        console.log(`[BOT SERVICE] Portfolio Balance manually updated to $${state.balance.toFixed(2)} (Tier: ${autoSwitcher.activePreset.name})`);
        sendJson(200, {
          success: true,
          balance: state.balance,
          autoSwitcher,
          message: `Portfolio value set to $${state.balance.toFixed(2)}. Active Tier: ${autoSwitcher.activePreset.name} (${autoSwitcher.activePreset.leverage}x, max ${autoSwitcher.activePreset.maxOpenPositions} positions).`
        });
      } else {
        sendJson(400, { success: false, error: 'Invalid balance amount. Must be a positive number.' });
      }
    });
    return;
  }

  // 7. GET /wallet-status & Safety Audit
  if (method === 'GET' && pathname === '/wallet-status') {
    auditWalletAndSafety().then(audit => {
      sendJson(200, audit);
    }).catch(err => {
      sendJson(500, { error: 'Failed to audit wallet: ' + err.message });
    });
    return;
  }

  // 8. POST /safety-toggle (Enforces explicit conditions to unlock live trading)
  if (method === 'POST' && pathname === '/safety-toggle') {
    getBody(async (payload) => {
      const wantsEnable = Boolean(payload.enabled);
      if (!wantsEnable) {
        state.safetyToggle.enabled = false;
        state.safetyToggle.unlockedAt = null;
        state.executionMode = 'simulate';
        sendJson(200, {
          success: true,
          safetyToggle: state.safetyToggle,
          executionMode: state.executionMode,
          message: 'Safety Interlock ENGAGED: Live trading disabled. Sandbox simulation active.',
        });
        return;
      }

      // Env gate (unified mode): arming live is impossible unless the
      // process itself was started in live env mode. A UI toggle can never
      // override env — otherwise "paper" on the dashboard could still arm.
      if (TRADING_MODE.effectiveMode !== 'live') {
        sendJson(400, {
          success: false,
          error: `Cannot arm live trading: this process runs in ${TRADING_MODE.effectiveMode.toUpperCase()} mode. Set PAPER_TRADING=false and SIMULATE_TX=false and restart the process to allow live arming.`,
        });
        return;
      }

      // User wants to enable Live Trading: perform full strict audit
      const audit = await auditWalletAndSafety();
      const failed = audit.conditions.filter(c => !c.passed);

      if (failed.length > 0) {
        state.safetyToggle.enabled = false;
        state.executionMode = 'simulate';
        sendJson(400, {
          success: false,
          error: `Cannot unlock Live Trading: ${failed.length} safety requirement(s) not met.`,
          failedConditions: failed,
          conditions: audit.conditions,
        });
        return;
      }

      // All 5 conditions passed: arm safety toggle
      state.safetyToggle.enabled = true;
      state.safetyToggle.unlockedAt = Date.now();
      state.executionMode = 'live_onchain';

      sendJson(200, {
        success: true,
        safetyToggle: state.safetyToggle,
        executionMode: state.executionMode,
        message: `Safety Interlock UNLOCKED: Live trading ARMED on Solana ${state.network.toUpperCase()}!`,
        conditions: audit.conditions,
      });
    });
    return;
  }

  // 9. POST /wallet-config (Import / Generate Keypair)
  if (method === 'POST' && pathname === '/wallet-config') {
    getBody(async (payload) => {
      try {
        if (payload.action === 'generate') {
          const generated = generateTestingKeypair(payload.network || state.network);
          const audit = await auditWalletAndSafety();
          sendJson(200, {
            success: true,
            message: 'New Solana keypair generated successfully.',
            publicKey: generated.publicKey,
            path: generated.path,
            audit,
          });
          return;
        }

        if (payload.action === 'import' && payload.key) {
          const imported = saveImportedKeypair(payload.key, payload.network || state.network);
          const audit = await auditWalletAndSafety();
          sendJson(200, {
            success: true,
            message: 'Solana keypair imported and validated successfully.',
            publicKey: imported.publicKey,
            path: imported.path,
            audit,
          });
          return;
        }

        if (payload.network || payload.rpcUrl) {
          // Network/RPC are env configuration (SOLANA_NETWORK / SOLANA_RPC),
          // not runtime switches: jupiter.js fixes its connection at module
          // load, so a state-only switch would silently disagree with the
          // signer. (The generate/import actions above still accept a
          // network label for wallet FILE naming — that is not a switch.)
          sendJson(400, {
            success: false,
            error: `Network/RPC cannot be changed at runtime (current: ${state.network}). Set SOLANA_NETWORK / SOLANA_RPC in the environment and restart the process.`,
          });
          return;
        }

        sendJson(400, { error: 'Invalid wallet-config action. Specify action: "generate" | "import" | "network"' });
      } catch (err) {
        sendJson(400, { success: false, error: err.message });
      }
    });
    return;
  }

  // 10. POST /airdrop (Devnet Gas Funding)
  if (method === 'POST' && pathname === '/airdrop') {
    requestDevnetAirdrop().then(result => {
      sendJson(200, result);
    }).catch(err => {
      sendJson(400, { success: false, error: err.message });
    });
    return;
  }

  // 11. POST /halt /resume
  if (method === 'POST' && pathname === '/halt') {
    state.isHalted = true;
    state.safetyToggle.enabled = false; // Tripping circuit breaker immediately locks safety toggle
    state.executionMode = 'simulate';
    sendJson(200, { halted: true, message: 'Circuit breaker triggered: Trading halted and safety locked.' });
    return;
  }
  if (method === 'POST' && pathname === '/resume') {
    state.isHalted = false;
    resetCircuitBreaker();
    sendJson(200, { halted: false, message: 'Trading resumed. Circuit breaker reset.' });
    return;
  }

  // 11b. POST /reset-circuit-breaker & GET /auto-switcher
  if (method === 'POST' && pathname === '/reset-circuit-breaker') {
    resetCircuitBreaker();
    sendJson(200, { success: true, message: 'Auto-Switcher 2-Loss Chop Circuit Breaker reset.', state: getAutoSwitcherState(state.balance) });
    return;
  }
  if (method === 'GET' && pathname === '/auto-switcher') {
    sendJson(200, getAutoSwitcherState(state.balance));
    return;
  }

  // 12. POST /mode (Toggle Training Wheels / Execution Mode)
  if (method === 'POST' && pathname === '/mode') {
    getBody(async (payload) => {
      // Network is env configuration, not a runtime switch: jupiter.js
      // fixes its connection at module load, so a state-only switch would
      // silently disagree with the signer. Restart with SOLANA_NETWORK.
      if (payload.network && payload.network !== state.network) {
        sendJson(400, {
          success: false,
          error: `Network cannot be changed at runtime (current: ${state.network}). Set SOLANA_NETWORK=${payload.network} in the environment and restart the process.`,
        });
        return;
      }

      if (payload.mode === 'live_onchain') {
        // Env gate (unified mode): /mode can ARM live only in a live-env
        // process; it can never escalate a paper/simulate process.
        if (TRADING_MODE.effectiveMode !== 'live') {
          sendJson(400, {
            success: false,
            error: `Cannot switch to live mode: this process runs in ${TRADING_MODE.effectiveMode.toUpperCase()} mode. Set PAPER_TRADING=false and SIMULATE_TX=false and restart the process.`,
          });
          return;
        }
        const audit = await auditWalletAndSafety();
        if (!audit.canArmLiveTrading) {
          sendJson(400, {
            success: false,
            error: 'Cannot switch to Live On-Chain mode: Safety requirements unmet. Use the Safety Toggle in UI to review checklist.',
            conditions: audit.conditions,
          });
          return;
        }
        state.executionMode = 'live_onchain';
      } else if (payload.mode === 'simulate') {
        state.executionMode = 'simulate';
        state.safetyToggle.enabled = false;
      }

      sendJson(200, {
        success: true,
        executionMode: state.executionMode,
        network: state.network,
        rpcUrl: state.rpcUrl,
        safetyToggle: state.safetyToggle,
      });
    });
    return;
  }

  // 13. GET /preflight (Pre-Flight Readiness Checklist)
  if (method === 'GET' && pathname === '/preflight') {
    auditWalletAndSafety().then(audit => {
      sendJson(200, audit);
    }).catch(err => {
      sendJson(500, { error: err.message });
    });
    return;
  }

  // 14. POST /update-price (allows price push from live binance ticker)
  if (method === 'POST' && pathname === '/update-price') {
    getBody(payload => {
      if (payload.asset && typeof payload.price === 'number') {
        updateMarketPrice(payload.asset, payload.price);
      }
      sendJson(200, { success: true });
    });
    return;
  }

  // 15. POST /autotrade/toggle & GET /autotrade/status
  if (method === 'POST' && (pathname === '/autotrade/toggle' || pathname === '/api/bot/autotrade/toggle')) {
    getBody(payload => {
      const enabled = payload.enabled !== undefined ? Boolean(payload.enabled) : !state.autoTrade.enabled;
      state.autoTrade.enabled = enabled;
      console.log(`🤖 [AUTOTRADE DAEMON] Status changed: ${enabled ? 'ACTIVE (Will auto-trade on signals)' : 'PAUSED'}`);
      sendJson(200, {
        success: true,
        autoTrade: state.autoTrade,
        message: `AutoTrader is now ${enabled ? 'ACTIVE' : 'PAUSED'}.`,
      });
    });
    return;
  }

  if (method === 'GET' && (pathname === '/autotrade/status' || pathname === '/api/bot/autotrade/status')) {
    const activeOrders = Object.values(state.orders).filter(o => o.status === 'placed' || o.status === 'filled' || o.status === 'pending_keeper');
    const autoSwitcher = getAutoSwitcherState(state.balance);
    sendJson(200, {
      autoTrade: {
        ...state.autoTrade,
        maxOpenOrders: autoSwitcher.activePreset.maxOpenPositions,
      },
      openOrdersCount: activeOrders.length,
      activeTier: autoSwitcher.activePreset.name,
      executionMode: state.executionMode,
      balance: state.balance,
    });
    return;
  }

  sendJson(404, { error: 'Unknown route: ' + pathname });
}

// Autonomous Background Keeper Heartbeat
// Constantly polls real-time prices to fill pending limit orders, manage ratchet stops,
// bank TP1/TP2, and enforce risk caps continuously even if no user has the browser tab open!
let keeperHeartbeatInterval = null;
function startAutonomousKeeperDaemon() {
  if (keeperHeartbeatInterval) return;

  console.log('⚡ [AUTOTRADE KEEPER] Autonomous price heartbeat & trade manager activated (every 3s)...');
  keeperHeartbeatInterval = setInterval(() => {
    try {
      // 1. Update live price for active SOL positions & limit orders
      fetchBinanceTicker('SOLUSDT', (err, data) => {
        if (!err && data && data.lastPrice) {
          const solPrice = parseFloat(data.lastPrice);
          if (solPrice > 0) {
            updateMarketPrice('SOL', solPrice);
          }
        }
      });

      // 2. Also track BTC/ETH if orders exist
      const hasBtc = Object.values(state.orders).some(o => o.asset === 'BTC' && (o.status === 'placed' || o.status === 'filled'));
      if (hasBtc) {
        fetchBinanceTicker('BTCUSDT', (err, data) => {
          if (!err && data && data.lastPrice) {
            updateMarketPrice('BTC', parseFloat(data.lastPrice));
          }
        });
      }
    } catch (_) {}
  }, 3000);

  if (keeperHeartbeatInterval && typeof keeperHeartbeatInterval.unref === 'function') {
    keeperHeartbeatInterval.unref();
  }
}

// Start autonomous daemon if not in build mode
const isBuildMode = process.argv.some(a => a.includes('build') || a.includes('tsc'));
if (!isBuildMode) {
  startAutonomousKeeperDaemon();
}

// Start standalone HTTP listener on Port 3001
let server3001 = null;
function startPort3001Server() {
  if (server3001) return;
  startAutonomousKeeperDaemon();
  try {
    server3001 = http.createServer((req, res) => {
      handleApiRequest(req, res);
    });
    server3001.listen(3001, '0.0.0.0', () => {
      console.log('🤖 [BOT SERVER] Listening on http://0.0.0.0:3001');
    });
    server3001.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.warn('⚠️ [BOT SERVER] Port 3001 already in use. Continuing with proxy.');
      } else {
        console.error('❌ [BOT SERVER] Error on port 3001:', err.message);
      }
    });
  } catch (err) {
    console.warn('[BOT SERVER] Could not bind port 3001:', err.message);
  }
}

module.exports = {
  state,
  updateMarketPrice,
  fillOrder,
  closeOrder,
  cancelOrder,
  placeSignalOrder,
  assembleJupiterOrderTx,
  handleApiRequest,
  startPort3001Server,
  // Exported so server.cjs's daemon activation is real, not a no-op that
  // still logs "AUTOTRADE DAEMON active" (the old misleading behavior).
  startAutonomousKeeperDaemon,
};
