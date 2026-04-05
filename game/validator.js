// Word validation using Duden API (duden.de)
const https = require('https');
const http = require('http');

// Cache for validated words
const wordCache = new Map();

function validateWordDuden(word) {
  return new Promise((resolve) => {
    const normalizedWord = word.toLowerCase();

    if (wordCache.has(normalizedWord)) {
      return resolve(wordCache.get(normalizedWord));
    }

    // Use duden.de search API
    const url = `https://www.duden.de/suchen/dudenonline/${encodeURIComponent(normalizedWord)}`;

    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ScrabbleGame/1.0)',
        'Accept': 'text/html'
      },
      timeout: 5000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        // If redirected to a word page, or if search results contain the exact word
        const found = res.statusCode === 301 || res.statusCode === 302 ||
          data.includes(`/rechtschreibung/${normalizedWord}`) ||
          data.toLowerCase().includes(`<strong>${normalizedWord}</strong>`) ||
          (res.headers.location && res.headers.location.includes('/rechtschreibung/'));

        // Also check for exact match in search results
        const exactMatch = data.includes(`Rechtschreibung`) &&
          (data.toLowerCase().includes(normalizedWord));

        const isValid = found || exactMatch;
        wordCache.set(normalizedWord, isValid);
        resolve(isValid);
      });
    });

    req.on('error', () => {
      // On network error, try alternative validation
      resolve(validateWordFallback(normalizedWord));
    });

    req.on('timeout', () => {
      req.destroy();
      resolve(validateWordFallback(normalizedWord));
    });
  });
}

// Alternative: Use dwds.de API as fallback
function validateWordFallback(word) {
  return new Promise((resolve) => {
    const url = `https://www.dwds.de/api/wb/snippet?q=${encodeURIComponent(word)}`;

    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ScrabbleGame/1.0)' },
      timeout: 5000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const isValid = Array.isArray(json) && json.length > 0;
          wordCache.set(word, isValid);
          resolve(isValid);
        } catch {
          // If all else fails, accept the word (offline mode)
          resolve(true);
        }
      });
    });

    req.on('error', () => resolve(true));
    req.on('timeout', () => { req.destroy(); resolve(true); });
  });
}

async function validateWords(words) {
  const results = [];
  for (const word of words) {
    const isValid = await validateWordDuden(word);
    results.push({ word, valid: isValid });
  }
  return results;
}

module.exports = { validateWords, validateWordDuden };
