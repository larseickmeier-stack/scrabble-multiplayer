// Word validation using multiple German dictionary sources
const https = require('https');

// Cache for validated words
const wordCache = new Map();

function httpsGet(url, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*'
      },
      timeout: timeoutMs
    }, (res) => {
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        return httpsGet(res.headers.location, timeoutMs).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// Capitalize first letter (DWDS requires it for nouns)
function capitalize(word) {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

// DWDS API — only has base forms (Grundformen), NOT inflected forms
async function validateViaDWDS(word) {
  try {
    const variants = [capitalize(word), word.toLowerCase()];

    for (const variant of variants) {
      const url = `https://www.dwds.de/api/wb/snippet?q=${encodeURIComponent(variant)}`;
      const res = await httpsGet(url, 8000);

      if (res.statusCode === 200) {
        const json = JSON.parse(res.data);
        if (Array.isArray(json) && json.length > 0) {
          console.log(`[Validator] DWDS found "${variant}" — valid`);
          return true;
        }
      }
    }

    // DWDS has no entry — but DWDS only stores base forms,
    // so inflected forms (meint, Häuser, ging, etc.) won't be found here.
    // Return null = inconclusive, so Wiktionary gets tried.
    return null;
  } catch (e) {
    console.log(`[Validator] DWDS error for "${word}":`, e.message);
    return null;
  }
}

// Wiktionary DE — has inflected forms (conjugations, declensions, plurals)
async function validateViaWiktionary(word) {
  try {
    // Try capitalized first (nouns), then lowercase
    const variants = [capitalize(word), word.toLowerCase()];

    for (const variant of variants) {
      const url = `https://de.wiktionary.org/w/api.php?action=query&titles=${encodeURIComponent(variant)}&format=json`;
      const res = await httpsGet(url, 8000);

      if (res.statusCode === 200) {
        const json = JSON.parse(res.data);
        const pages = json.query?.pages || {};
        // Page exists if there's no "-1" key (missing page)
        if (!Object.keys(pages).includes('-1')) {
          console.log(`[Validator] Wiktionary found "${variant}" — valid`);
          return true;
        }
      }
    }

    return false;
  } catch (e) {
    console.log(`[Validator] Wiktionary error for "${word}":`, e.message);
    return null;
  }
}

async function validateWord(word) {
  const normalized = word.trim();

  if (normalized.length < 2) return false;

  // Check cache (case-insensitive)
  const cacheKey = normalized.toLowerCase();
  if (wordCache.has(cacheKey)) {
    return wordCache.get(cacheKey);
  }

  console.log(`[Validator] Checking word: "${normalized}"`);

  // Try DWDS first (most authoritative for German base forms)
  const dwdsResult = await validateViaDWDS(normalized);
  if (dwdsResult === true) {
    wordCache.set(cacheKey, true);
    return true;
  }

  // Always try Wiktionary (has inflected forms: conjugations, plurals, etc.)
  const wiktResult = await validateViaWiktionary(normalized);
  if (wiktResult === true) {
    wordCache.set(cacheKey, true);
    return true;
  }

  // Both sources say "not found" or unreachable
  if (dwdsResult === null && wiktResult === null) {
    // Both had network errors — reject to be safe
    console.log(`[Validator] ALL sources unreachable for "${normalized}" — rejecting`);
    wordCache.set(cacheKey, false);
    return false;
  }

  // At least one source definitively said "not found"
  console.log(`[Validator] "${normalized}" not found in any source — rejecting`);
  wordCache.set(cacheKey, false);
  return false;
}

async function validateWords(words) {
  const results = [];
  for (const word of words) {
    const isValid = await validateWord(word);
    results.push({ word, valid: isValid });
  }
  return results;
}

module.exports = { validateWords, validateWord };
