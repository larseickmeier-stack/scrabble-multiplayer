const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const { createTileBag, getLetterPoints } = require('./game/tiles');
const { createBoard, isValidPlacement, getFormedWords, calculateScore, BOARD_SIZE, getPremiumType } = require('./game/board');
const { validateWords, validateWord } = require('./game/validator');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));
app.use(express.json());

// ─── GitHub Configuration ───
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO || 'larseickmeier-stack/scrabble-multiplayer';
const GITHUB_API_URL = 'https://api.github.com';

// ─── User Store ───
const USERS_FILE = path.join(__dirname, 'users.json');
let userFileSha = null; // Track GitHub file SHA for updates

function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    }
  } catch (e) {}
  return {};
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));

  // Async push to GitHub if token is available
  if (GITHUB_TOKEN) {
    pushUsersToGitHub(users).catch(err => {
      console.error('Failed to sync users to GitHub:', err.message);
    });
  }
}

// ─── GitHub API Functions ───
function makeGitHubRequest(method, endpoint, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${GITHUB_API_URL}${endpoint}`);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Scrabble-Server',
        'Authorization': `token ${GITHUB_TOKEN}`
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function loadUsersFromGitHub() {
  try {
    if (!GITHUB_TOKEN) return null;

    const response = await makeGitHubRequest(
      'GET',
      `/repos/${GITHUB_REPO}/contents/data/users.json`
    );

    if (response.status === 200 && response.data.content) {
      userFileSha = response.data.sha;
      const content = Buffer.from(response.data.content, 'base64').toString('utf8');
      return JSON.parse(content);
    }
  } catch (err) {
    console.error('Failed to load users from GitHub:', err.message);
  }
  return null;
}

async function pushUsersToGitHub(users) {
  try {
    if (!GITHUB_TOKEN) return;

    const content = Buffer.from(JSON.stringify(users, null, 2)).toString('base64');
    const body = {
      message: `Update users.json - ${new Date().toISOString()}`,
      content,
      sha: userFileSha
    };

    const response = await makeGitHubRequest(
      'PUT',
      `/repos/${GITHUB_REPO}/contents/data/users.json`,
      body
    );

    if (response.status === 200 || response.status === 201) {
      userFileSha = response.data.content?.sha;
    }
  } catch (err) {
    console.error('Failed to push users to GitHub:', err.message);
  }
}

// ─── Server Startup: Load Users ───
async function initializeUsers() {
  const gitHubUsers = await loadUsersFromGitHub();
  if (gitHubUsers) {
    fs.writeFileSync(USERS_FILE, JSON.stringify(gitHubUsers, null, 2));
  }
}

initializeUsers();

// ─── Auth Routes ───
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Benutzername und Passwort erforderlich.' });
  if (username.length < 3) return res.status(400).json({ error: 'Benutzername muss mind. 3 Zeichen lang sein.' });
  if (password.length < 4) return res.status(400).json({ error: 'Passwort muss mind. 4 Zeichen lang sein.' });

  const users = loadUsers();
  if (users[username.toLowerCase()]) {
    return res.status(409).json({ error: 'Benutzername bereits vergeben.' });
  }

  const hash = await bcrypt.hash(password, 10);
  const isFirstUser = Object.keys(users).length === 0;
  users[username.toLowerCase()] = {
    username,
    passwordHash: hash,
    created: new Date().toISOString(),
    role: isFirstUser ? 'admin' : 'user',
    banned: false,
    stats: { wins: 0, losses: 0, totalScore: 0, gamesPlayed: 0 }
  };
  saveUsers(users);

  const token = uuidv4();
  sessions[token] = username;
  res.json({ token, username, role: users[username.toLowerCase()].role });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const users = loadUsers();
  const user = users[username.toLowerCase()];

  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Ungültige Anmeldedaten.' });
  }
  if (user.banned) {
    return res.status(403).json({ error: 'Dein Konto wurde gesperrt.' });
  }

  const token = uuidv4();
  sessions[token] = user.username;
  res.json({ token, username: user.username, role: user.role || 'user', stats: user.stats });
});

app.get('/api/stats/:username', (req, res) => {
  const users = loadUsers();
  const user = users[req.params.username.toLowerCase()];
  if (!user) return res.status(404).json({ error: 'Benutzer nicht gefunden.' });
  res.json({ username: user.username, stats: user.stats });
});

// ─── Admin Middleware ───
function requireAdmin(req, res, next) {
  const authToken = req.headers['x-auth-token'];
  if (!authToken || !sessions[authToken]) {
    return res.status(401).json({ error: 'Nicht angemeldet.' });
  }
  const username = sessions[authToken];
  const users = loadUsers();
  const user = users[username.toLowerCase()];
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: 'Keine Admin-Berechtigung.' });
  }
  req.adminUser = username;
  next();
}

// ─── Admin API Routes ───

// List all users
app.get('/api/admin/users', requireAdmin, (req, res) => {
  const users = loadUsers();
  const userList = Object.values(users).map(u => ({
    username: u.username,
    role: u.role || 'user',
    banned: u.banned || false,
    created: u.created,
    stats: u.stats,
    online: !!playerSockets[u.username]
  }));
  res.json(userList);
});

// Ban/unban user
app.post('/api/admin/users/:username/ban', requireAdmin, (req, res) => {
  const users = loadUsers();
  const user = users[req.params.username.toLowerCase()];
  if (!user) return res.status(404).json({ error: 'Benutzer nicht gefunden.' });
  if (user.role === 'admin') return res.status(400).json({ error: 'Admins können nicht gesperrt werden.' });

  user.banned = !user.banned;
  saveUsers(users);

  // Kick banned user if online
  if (user.banned && playerSockets[user.username]) {
    playerSockets[user.username].emit('kicked', 'Dein Konto wurde gesperrt.');
    playerSockets[user.username].disconnect();
  }

  res.json({ username: user.username, banned: user.banned });
});

// Delete user
app.delete('/api/admin/users/:username', requireAdmin, (req, res) => {
  const users = loadUsers();
  const key = req.params.username.toLowerCase();
  const user = users[key];
  if (!user) return res.status(404).json({ error: 'Benutzer nicht gefunden.' });
  if (user.role === 'admin') return res.status(400).json({ error: 'Admins können nicht gelöscht werden.' });

  // Kick if online
  if (playerSockets[user.username]) {
    playerSockets[user.username].emit('kicked', 'Dein Konto wurde gelöscht.');
    playerSockets[user.username].disconnect();
  }

  delete users[key];
  // Remove sessions for this user
  for (const [t, u] of Object.entries(sessions)) {
    if (u === user.username) delete sessions[t];
  }
  saveUsers(users);
  res.json({ deleted: true });
});

// Reset password
app.post('/api/admin/users/:username/reset-password', requireAdmin, async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: 'Neues Passwort muss mind. 4 Zeichen lang sein.' });
  }
  const users = loadUsers();
  const user = users[req.params.username.toLowerCase()];
  if (!user) return res.status(404).json({ error: 'Benutzer nicht gefunden.' });

  user.passwordHash = await bcrypt.hash(newPassword, 10);
  saveUsers(users);

  // Invalidate existing sessions
  for (const [t, u] of Object.entries(sessions)) {
    if (u === user.username) delete sessions[t];
  }

  res.json({ success: true, username: user.username });
});

// Promote/demote user role
app.post('/api/admin/users/:username/role', requireAdmin, (req, res) => {
  const { role } = req.body;
  if (!['admin', 'user'].includes(role)) return res.status(400).json({ error: 'Ungültige Rolle.' });

  const users = loadUsers();
  const user = users[req.params.username.toLowerCase()];
  if (!user) return res.status(404).json({ error: 'Benutzer nicht gefunden.' });
  if (user.username === req.adminUser && role !== 'admin') {
    return res.status(400).json({ error: 'Du kannst dich nicht selbst degradieren.' });
  }

  user.role = role;
  saveUsers(users);
  res.json({ username: user.username, role: user.role });
});

// List active games
app.get('/api/admin/games', requireAdmin, (req, res) => {
  const gameList = Object.values(games).map(g => ({
    id: g.id,
    players: g.players,
    scores: Object.fromEntries(g.players.map(p => [p, g.playerStates[p].score])),
    currentPlayer: g.players[g.currentPlayerIndex],
    bagCount: g.bag.length,
    moveCount: g.moveHistory.length,
    gameOver: g.gameOver,
    winner: g.winner,
    startedAt: g.startedAt
  }));
  res.json(gameList);
});

// Force-end a game
app.post('/api/admin/games/:gameId/end', requireAdmin, (req, res) => {
  const game = games[req.params.gameId];
  if (!game) return res.status(404).json({ error: 'Spiel nicht gefunden.' });
  if (game.gameOver) return res.status(400).json({ error: 'Spiel ist bereits beendet.' });

  endGame(game, null);
  broadcastGameState(game);
  res.json({ ended: true, id: game.id });
});

// Delete a finished game
app.delete('/api/admin/games/:gameId', requireAdmin, (req, res) => {
  const game = games[req.params.gameId];
  if (!game) return res.status(404).json({ error: 'Spiel nicht gefunden.' });

  if (!game.gameOver) {
    endGame(game, null);
    broadcastGameState(game);
  }
  delete games[req.params.gameId];
  res.json({ deleted: true });
});

// ─── Session & Game State ───
const sessions = {}; // token -> username
const games = {};    // gameId -> gameState
const lobbies = {};  // gameId -> lobby info
const playerSockets = {}; // username -> socket
const playerGames = {}; // username -> gameId (for rejoin capability)

function createGame(gameId, players) {
  const bag = createTileBag();
  const playerStates = {};

  for (const p of players) {
    const hand = bag.splice(0, 7);
    playerStates[p] = { hand, score: 0 };
  }

  return {
    id: gameId,
    board: createBoard(),
    bag,
    players,
    playerStates,
    currentPlayerIndex: 0,
    moveHistory: [],
    isFirstMove: true,
    gameOver: false,
    passCount: 0,
    startedAt: new Date().toISOString()
  };
}

// ─── Socket.IO ───
io.on('connection', (socket) => {
  let currentUser = null;

  socket.on('authenticate', (token) => {
    if (sessions[token]) {
      currentUser = sessions[token];
      const users = loadUsers();
      const user = users[currentUser.toLowerCase()];
      if (user && user.banned) {
        socket.emit('kicked', 'Dein Konto wurde gesperrt.');
        return;
      }
      playerSockets[currentUser] = socket;
      socket.emit('authenticated', { username: currentUser, role: user?.role || 'user' });

      // Check if user has an active game to rejoin
      const activeGameId = playerGames[currentUser];
      if (activeGameId && games[activeGameId] && !games[activeGameId].gameOver) {
        const game = games[activeGameId];
        socket.join(`game_${activeGameId}`);
        socket.emit('game_rejoin', getPlayerView(game, currentUser));
      }

      broadcastLobbies();
    } else {
      socket.emit('auth_error', 'Ungültiges Token.');
    }
  });

  // ─── Lobby ───
  socket.on('create_lobby', (data) => {
    if (!currentUser) return;
    const gameId = uuidv4().slice(0, 8);
    lobbies[gameId] = {
      id: gameId,
      host: currentUser,
      players: [currentUser],
      maxPlayers: data.maxPlayers || 4,
      name: data.name || `${currentUser}s Spiel`,
      created: Date.now()
    };
    socket.join(`lobby_${gameId}`);
    broadcastLobbies();
    socket.emit('lobby_joined', lobbies[gameId]);
  });

  socket.on('join_lobby', (gameId) => {
    if (!currentUser) return;
    const lobby = lobbies[gameId];
    if (!lobby) return socket.emit('error_msg', 'Lobby nicht gefunden.');
    if (lobby.players.length >= lobby.maxPlayers) return socket.emit('error_msg', 'Lobby ist voll.');
    if (lobby.players.includes(currentUser)) return socket.emit('error_msg', 'Bereits in dieser Lobby.');

    lobby.players.push(currentUser);
    socket.join(`lobby_${gameId}`);
    broadcastLobbies();
    io.to(`lobby_${gameId}`).emit('lobby_updated', lobby);
    socket.emit('lobby_joined', lobby);
  });

  socket.on('leave_lobby', (gameId) => {
    if (!currentUser) return;
    const lobby = lobbies[gameId];
    if (!lobby) return;

    lobby.players = lobby.players.filter(p => p !== currentUser);
    socket.leave(`lobby_${gameId}`);

    if (lobby.players.length === 0) {
      delete lobbies[gameId];
    } else if (lobby.host === currentUser) {
      lobby.host = lobby.players[0];
    }

    broadcastLobbies();
    io.to(`lobby_${gameId}`).emit('lobby_updated', lobby);
  });

  socket.on('start_game', (gameId) => {
    if (!currentUser) return;
    const lobby = lobbies[gameId];
    if (!lobby || lobby.host !== currentUser) return;
    if (lobby.players.length < 2) return socket.emit('error_msg', 'Mind. 2 Spieler benötigt.');

    const game = createGame(gameId, lobby.players);
    games[gameId] = game;

    // Register all players in playerGames map
    for (const p of lobby.players) {
      playerGames[p] = gameId;
    }

    // Notify all players
    for (const p of lobby.players) {
      const ps = playerSockets[p];
      if (ps) {
        ps.join(`game_${gameId}`);
        ps.emit('game_started', getPlayerView(game, p));
      }
    }

    delete lobbies[gameId];
    broadcastLobbies();
  });

  // ─── Game Actions ───
  socket.on('place_tiles', async (data) => {
    if (!currentUser) return;
    const { gameId, placements } = data;
    const game = games[gameId];
    if (!game || game.gameOver) return;
    if (game.players[game.currentPlayerIndex] !== currentUser) {
      return socket.emit('error_msg', 'Nicht dein Zug!');
    }

    // Validate placement
    const validationResult = isValidPlacement(game.board, placements, game.isFirstMove);
    if (!validationResult.valid) {
      return socket.emit('move_rejected', validationResult.error);
    }

    // Get formed words
    const formedWords = getFormedWords(game.board, placements);
    if (formedWords.length === 0) {
      return socket.emit('move_rejected', 'Kein gültiges Wort gebildet.');
    }

    const wordStrings = formedWords.map(w => w.map(t => t.letter === '*' ? (t.chosenLetter || '?') : t.letter).join(''));

    // Validate words against Duden
    const validationResults = await validateWords(wordStrings);
    const invalidWords = validationResults.filter(r => !r.valid);

    if (invalidWords.length > 0) {
      return socket.emit('move_rejected',
        `Ungültige Wörter: ${invalidWords.map(w => w.word).join(', ')} - Nicht im Duden gefunden!`
      );
    }

    // Calculate score
    const score = calculateScore(formedWords, placements);

    // Apply move
    for (const p of placements) {
      game.board[p.row][p.col] = { letter: p.letter, points: p.points, chosenLetter: p.chosenLetter };
    }

    // Remove tiles from player hand and draw new ones
    const playerState = game.playerStates[currentUser];
    for (const p of placements) {
      const idx = playerState.hand.findIndex(t => t.id === p.tileId);
      if (idx !== -1) playerState.hand.splice(idx, 1);
    }

    // Draw new tiles
    const drawCount = Math.min(placements.length, game.bag.length);
    for (let i = 0; i < drawCount; i++) {
      playerState.hand.push(game.bag.pop());
    }

    playerState.score += score;
    game.isFirstMove = false;
    game.passCount = 0;

    game.moveHistory.push({
      player: currentUser,
      words: wordStrings,
      score,
      timestamp: Date.now()
    });

    // Check game over
    if (playerState.hand.length === 0 && game.bag.length === 0) {
      endGame(game, currentUser);
    } else {
      advanceTurn(game);
    }

    broadcastGameState(game);
  });

  socket.on('swap_tiles', (data) => {
    if (!currentUser) return;
    const { gameId, tileIds } = data;
    const game = games[gameId];
    if (!game || game.gameOver) return;
    if (game.players[game.currentPlayerIndex] !== currentUser) {
      return socket.emit('error_msg', 'Nicht dein Zug!');
    }
    if (game.bag.length < 7) {
      return socket.emit('error_msg', 'Nicht genügend Steine zum Tauschen.');
    }

    const playerState = game.playerStates[currentUser];
    const tilesToSwap = [];

    for (const id of tileIds) {
      const idx = playerState.hand.findIndex(t => t.id === id);
      if (idx !== -1) {
        tilesToSwap.push(playerState.hand.splice(idx, 1)[0]);
      }
    }

    // Draw new tiles
    for (let i = 0; i < tilesToSwap.length; i++) {
      playerState.hand.push(game.bag.pop());
    }

    // Put old tiles back in bag and shuffle
    game.bag.push(...tilesToSwap);
    for (let i = game.bag.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [game.bag[i], game.bag[j]] = [game.bag[j], game.bag[i]];
    }

    game.passCount = 0;
    game.moveHistory.push({ player: currentUser, action: 'swap', count: tilesToSwap.length, timestamp: Date.now() });
    advanceTurn(game);
    broadcastGameState(game);
  });

  socket.on('pass_turn', (gameId) => {
    if (!currentUser) return;
    const game = games[gameId];
    if (!game || game.gameOver) return;
    if (game.players[game.currentPlayerIndex] !== currentUser) return;

    game.passCount++;
    game.moveHistory.push({ player: currentUser, action: 'pass', timestamp: Date.now() });

    // Game ends if all players pass twice in a row
    if (game.passCount >= game.players.length * 2) {
      endGame(game, null);
    } else {
      advanceTurn(game);
    }

    broadcastGameState(game);
  });

  // ─── Preview Move Validation (New) ───
  socket.on('preview_move', async (data) => {
    if (!currentUser) return;
    const { gameId, placements } = data;
    const game = games[gameId];

    if (!game || game.gameOver) {
      return socket.emit('preview_result', {
        valid: false,
        error: 'Spiel nicht aktiv.'
      });
    }

    if (game.players[game.currentPlayerIndex] !== currentUser) {
      return socket.emit('preview_result', {
        valid: false,
        error: 'Nicht dein Zug!'
      });
    }

    // Validate placement (read-only check)
    const validationResult = isValidPlacement(game.board, placements, game.isFirstMove);
    if (!validationResult.valid) {
      return socket.emit('preview_result', {
        valid: false,
        error: validationResult.error
      });
    }

    // Get formed words
    const formedWords = getFormedWords(game.board, placements);
    if (formedWords.length === 0) {
      return socket.emit('preview_result', {
        valid: false,
        error: 'Kein gültiges Wort gebildet.'
      });
    }

    // Convert tiles to word strings
    const wordStrings = formedWords.map(w => w.map(t => t.letter === '*' ? (t.chosenLetter || '?') : t.letter).join(''));

    // Validate words against Duden (async)
    const validationResults = await validateWords(wordStrings);
    const invalidWords = validationResults.filter(r => !r.valid);

    if (invalidWords.length > 0) {
      return socket.emit('preview_result', {
        valid: false,
        error: `Ungültige Wörter: ${invalidWords.map(w => w.word).join(', ')}`
      });
    }

    // Calculate score
    const totalScore = calculateScore(formedWords, placements);

    // Build word details with tile positions
    const words = formedWords.map((tiles, idx) => ({
      word: wordStrings[idx],
      tiles: tiles.map(t => ({ row: t.row, col: t.col })),
      score: validationResults[idx]?.score || 0
    }));

    socket.emit('preview_result', {
      valid: true,
      words,
      totalScore
    });
  });

  // ─── Leave Game ───
  socket.on('leave_game', (gameId) => {
    if (!currentUser) return;
    const game = games[gameId];
    if (!game) return socket.emit('error_msg', 'Spiel nicht gefunden.');
    if (!game.players.includes(currentUser)) return;

    // Return player's tiles to bag
    const playerState = game.playerStates[currentUser];
    if (playerState && playerState.hand) {
      game.bag.push(...playerState.hand);
      // Shuffle bag
      for (let i = game.bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [game.bag[i], game.bag[j]] = [game.bag[j], game.bag[i]];
      }
    }

    // Adjust currentPlayerIndex before removing player
    const leavingIndex = game.players.indexOf(currentUser);
    const wasCurrentPlayer = game.currentPlayerIndex === leavingIndex;

    // Remove player
    game.players = game.players.filter(p => p !== currentUser);
    delete game.playerStates[currentUser];
    delete playerGames[currentUser];
    socket.leave(`game_${gameId}`);

    game.moveHistory.push({
      player: currentUser,
      action: 'left',
      timestamp: Date.now()
    });

    // If no players left, delete the game
    if (game.players.length === 0) {
      delete games[gameId];
      console.log(`[Game] Game ${gameId} deleted — all players left.`);
      return;
    }

    // If only 1 player left, end the game (they win by default)
    if (game.players.length === 1) {
      game.gameOver = true;
      game.winner = game.players[0];

      const users = loadUsers();
      for (const p of game.players) {
        const u = users[p.toLowerCase()];
        if (u) {
          u.stats.gamesPlayed++;
          u.stats.totalScore += game.playerStates[p].score;
          u.stats.wins++;
        }
      }
      saveUsers(users);

      delete playerGames[game.players[0]];
      broadcastGameState(game);
      return;
    }

    // Fix currentPlayerIndex
    if (wasCurrentPlayer) {
      game.currentPlayerIndex = leavingIndex % game.players.length;
    } else if (leavingIndex < game.currentPlayerIndex) {
      game.currentPlayerIndex--;
    }
    // Ensure index is in bounds
    game.currentPlayerIndex = game.currentPlayerIndex % game.players.length;

    broadcastGameState(game);
  });

  // ─── Game Rejoin (New) ───
  socket.on('rejoin_game', (gameId) => {
    if (!currentUser) return;
    const game = games[gameId];

    if (!game) {
      return socket.emit('error_msg', 'Spiel nicht gefunden.');
    }

    if (!game.players.includes(currentUser)) {
      return socket.emit('error_msg', 'Du bist nicht Teil dieses Spiels.');
    }

    if (game.gameOver) {
      return socket.emit('error_msg', 'Dieses Spiel ist bereits beendet.');
    }

    socket.join(`game_${gameId}`);
    playerGames[currentUser] = gameId;
    socket.emit('game_rejoin', getPlayerView(game, currentUser));
  });

  socket.on('disconnect', () => {
    if (currentUser) {
      delete playerSockets[currentUser];
      // Clean up empty lobbies
      for (const [id, lobby] of Object.entries(lobbies)) {
        if (lobby.players.includes(currentUser)) {
          lobby.players = lobby.players.filter(p => p !== currentUser);
          if (lobby.players.length === 0) delete lobbies[id];
          else if (lobby.host === currentUser) lobby.host = lobby.players[0];
        }
      }
      broadcastLobbies();
      // Note: Do NOT remove player from game - only clean up socket reference
    }
  });

  socket.on('get_lobbies', () => broadcastLobbies());
});

function advanceTurn(game) {
  game.currentPlayerIndex = (game.currentPlayerIndex + 1) % game.players.length;
}

function endGame(game, finisher) {
  game.gameOver = true;

  // Subtract remaining tile points from each player
  for (const p of game.players) {
    const state = game.playerStates[p];
    const remaining = state.hand.reduce((sum, t) => sum + t.points, 0);
    state.score -= remaining;

    // If finisher used all tiles, they get the deducted points
    if (finisher && p !== finisher) {
      game.playerStates[finisher].score += remaining;
    }
  }

  // Determine winner
  let maxScore = -Infinity;
  let winner = null;
  for (const p of game.players) {
    if (game.playerStates[p].score > maxScore) {
      maxScore = game.playerStates[p].score;
      winner = p;
    }
  }
  game.winner = winner;

  // Update stats
  const users = loadUsers();
  for (const p of game.players) {
    const u = users[p.toLowerCase()];
    if (u) {
      u.stats.gamesPlayed++;
      u.stats.totalScore += game.playerStates[p].score;
      if (p === winner) u.stats.wins++;
      else u.stats.losses++;
    }
  }
  saveUsers(users);

  // Clean up playerGames map
  for (const p of game.players) {
    delete playerGames[p];
  }
}

function getPlayerView(game, username) {
  return {
    id: game.id,
    board: game.board,
    hand: game.playerStates[username]?.hand || [],
    scores: Object.fromEntries(game.players.map(p => [p, game.playerStates[p].score])),
    currentPlayer: game.players[game.currentPlayerIndex],
    players: game.players,
    bagCount: game.bag.length,
    totalTiles: 102,
    isMyTurn: game.players[game.currentPlayerIndex] === username,
    gameOver: game.gameOver,
    winner: game.winner,
    moveHistory: game.moveHistory.slice(-10),
    isFirstMove: game.isFirstMove
  };
}

function broadcastGameState(game) {
  for (const p of game.players) {
    const ps = playerSockets[p];
    if (ps) {
      ps.emit('game_update', getPlayerView(game, p));
    }
  }
}

function broadcastLobbies() {
  io.emit('lobbies_update', Object.values(lobbies));
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎮 Scrabble Server läuft auf http://localhost:${PORT}`);
});
