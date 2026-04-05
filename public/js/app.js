// ═══ State ═══
let socket = null;
let token = localStorage.getItem('scrabble_token');
let currentUser = localStorage.getItem('scrabble_user');
let currentUserRole = localStorage.getItem('scrabble_role') || 'user';
let currentLobbyId = null;
let currentGameId = null;
let gameState = null;
let selectedTile = null;
let placedTiles = []; // { row, col, tile, element }
let swapMode = false;
let swapSelection = new Set();

// Premium square labels
const PREMIUM_LABELS = {
  'TW': '3×W', 'DW': '2×W', 'TL': '3×B', 'DL': '2×B', 'CE': '★'
};

const PREMIUM_CSS = {
  'TW': 'tw', 'DW': 'dw', 'TL': 'tl', 'DL': 'dl', 'CE': 'ce'
};

// Premium positions (same as server)
const PREMIUM_MAP = {};
[[0,0],[0,7],[0,14],[7,0],[7,14],[14,0],[14,7],[14,14]].forEach(([r,c]) => PREMIUM_MAP[`${r},${c}`]='TW');
[[1,1],[2,2],[3,3],[4,4],[1,13],[2,12],[3,11],[4,10],[13,1],[12,2],[11,3],[10,4],[13,13],[12,12],[11,11],[10,10]].forEach(([r,c]) => PREMIUM_MAP[`${r},${c}`]='DW');
PREMIUM_MAP['7,7']='CE';
[[1,5],[1,9],[5,1],[5,5],[5,9],[5,13],[9,1],[9,5],[9,9],[9,13],[13,5],[13,9]].forEach(([r,c]) => PREMIUM_MAP[`${r},${c}`]='TL');
[[0,3],[0,11],[2,6],[2,8],[3,0],[3,7],[3,14],[6,2],[6,6],[6,8],[6,12],[7,3],[7,11],[8,2],[8,6],[8,8],[8,12],[11,0],[11,7],[11,14],[12,6],[12,8],[14,3],[14,11]].forEach(([r,c]) => PREMIUM_MAP[`${r},${c}`]='DL');

// ═══ Screen Management ═══
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active', 'flex'));
  const screen = document.getElementById(id);
  screen.classList.add('active');
  if (id === 'auth-screen') screen.classList.add('flex');
  if (id === 'admin-screen') loadAdminData();
}

// ═══ Auth ═══
function showLogin() {
  document.getElementById('login-form').style.display = 'block';
  document.getElementById('register-form').style.display = 'none';
  document.getElementById('auth-error').style.display = 'none';
}

function showRegister() {
  document.getElementById('login-form').style.display = 'none';
  document.getElementById('register-form').style.display = 'block';
  document.getElementById('auth-error').style.display = 'none';
}

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.style.display = 'block';
}

async function doLogin() {
  const username = document.getElementById('login-user').value.trim();
  const password = document.getElementById('login-pass').value;
  if (!username || !password) return showAuthError('Alle Felder ausfüllen.');

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) return showAuthError(data.error);

    token = data.token;
    currentUser = data.username;
    currentUserRole = data.role || 'user';
    localStorage.setItem('scrabble_token', token);
    localStorage.setItem('scrabble_user', currentUser);
    localStorage.setItem('scrabble_role', currentUserRole);
    connectSocket();
  } catch (e) {
    showAuthError('Verbindungsfehler.');
  }
}

async function doRegister() {
  const username = document.getElementById('reg-user').value.trim();
  const password = document.getElementById('reg-pass').value;
  const password2 = document.getElementById('reg-pass2').value;

  if (!username || !password) return showAuthError('Alle Felder ausfüllen.');
  if (password !== password2) return showAuthError('Passwörter stimmen nicht überein.');

  try {
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (!res.ok) return showAuthError(data.error);

    token = data.token;
    currentUser = data.username;
    currentUserRole = data.role || 'user';
    localStorage.setItem('scrabble_token', token);
    localStorage.setItem('scrabble_user', currentUser);
    localStorage.setItem('scrabble_role', currentUserRole);
    connectSocket();
  } catch (e) {
    showAuthError('Verbindungsfehler.');
  }
}

function doLogout() {
  localStorage.removeItem('scrabble_token');
  localStorage.removeItem('scrabble_user');
  localStorage.removeItem('scrabble_role');
  token = null;
  currentUser = null;
  currentUserRole = 'user';
  if (socket) socket.disconnect();
  showScreen('auth-screen');
}

// ═══ Socket ═══
function connectSocket() {
  socket = io();

  socket.on('connect', () => {
    socket.emit('authenticate', token);
  });

  socket.on('authenticated', (data) => {
    currentUser = data.username;
    currentUserRole = data.role || 'user';
    localStorage.setItem('scrabble_role', currentUserRole);
    document.getElementById('lobby-username').textContent = currentUser;
    document.getElementById('admin-btn').style.display = (currentUserRole === 'admin') ? 'inline-block' : 'none';
    showScreen('lobby-screen');
    socket.emit('get_lobbies');
  });

  socket.on('kicked', (msg) => {
    alert(msg);
    doLogout();
  });

  socket.on('auth_error', () => {
    localStorage.removeItem('scrabble_token');
    showScreen('auth-screen');
    showAuthError('Sitzung abgelaufen. Bitte erneut anmelden.');
  });

  socket.on('lobbies_update', renderLobbies);

  socket.on('lobby_joined', (lobby) => {
    currentLobbyId = lobby.id;
    renderCurrentLobby(lobby);
  });

  socket.on('lobby_updated', renderCurrentLobby);

  socket.on('game_started', (state) => {
    currentGameId = state.id;
    gameState = state;
    placedTiles = [];
    selectedTile = null;
    showScreen('game-screen');
    renderGame();
  });

  socket.on('game_update', (state) => {
    gameState = state;
    // Remove placed tiles that were accepted
    placedTiles = [];
    selectedTile = null;
    renderGame();

    if (state.gameOver) {
      showGameOver();
    }
  });

  socket.on('move_rejected', (msg) => {
    alert('Zug abgelehnt: ' + msg);
  });

  socket.on('error_msg', (msg) => {
    alert(msg);
  });
}

// ═══ Lobby ═══
function renderLobbies(lobbies) {
  const list = document.getElementById('lobby-list');
  const filtered = lobbies.filter(l => l.id !== currentLobbyId);

  if (filtered.length === 0) {
    list.innerHTML = '<div class="no-lobbies">Keine offenen Spiele. Erstelle eines!</div>';
    return;
  }

  list.innerHTML = filtered.map(l => `
    <div class="lobby-card">
      <div>
        <div class="lobby-name">${escHtml(l.name)}</div>
        <div class="lobby-info">${l.players.length}/${l.maxPlayers} Spieler · Host: ${escHtml(l.host)}</div>
      </div>
      <button class="btn btn-gold btn-small" onclick="joinLobby('${l.id}')"
        ${l.players.length >= l.maxPlayers ? 'disabled style="opacity:0.5"' : ''}>
        Beitreten
      </button>
    </div>
  `).join('');
}

function renderCurrentLobby(lobby) {
  const el = document.getElementById('current-lobby');
  const info = document.getElementById('current-lobby-info');
  el.style.display = 'block';

  info.innerHTML = `
    <div style="font-weight:600;margin-bottom:8px;">${escHtml(lobby.name)}</div>
    <div>Spieler (${lobby.players.length}/${lobby.maxPlayers}):</div>
    <div style="margin-top:6px;">${lobby.players.map(p =>
      `<span style="display:inline-block;padding:4px 10px;margin:2px;border-radius:4px;background:rgba(255,255,255,0.08);font-size:14px;">
        ${escHtml(p)} ${p === lobby.host ? '👑' : ''}
      </span>`
    ).join('')}</div>
  `;

  const startBtn = document.getElementById('start-btn');
  startBtn.style.display = (lobby.host === currentUser && lobby.players.length >= 2) ? 'block' : 'none';
}

function createLobby() {
  const name = document.getElementById('lobby-name').value.trim() || `${currentUser}s Spiel`;
  const maxPlayers = parseInt(document.getElementById('max-players').value);
  socket.emit('create_lobby', { name, maxPlayers });
}

function joinLobby(id) {
  socket.emit('join_lobby', id);
}

function leaveLobby() {
  if (currentLobbyId) {
    socket.emit('leave_lobby', currentLobbyId);
    currentLobbyId = null;
    document.getElementById('current-lobby').style.display = 'none';
  }
}

function startGame() {
  if (currentLobbyId) socket.emit('start_game', currentLobbyId);
}

// ═══ Game Rendering ═══
function renderGame() {
  renderBoard();
  renderRack();
  renderScores();
  renderBagCount();
  renderHistory();
  renderTurnIndicator();
}

function renderBoard() {
  const boardEl = document.getElementById('board');
  boardEl.innerHTML = '';

  for (let r = 0; r < 15; r++) {
    for (let c = 0; c < 15; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.row = r;
      cell.dataset.col = c;

      const boardTile = gameState.board[r][c];
      const placed = placedTiles.find(p => p.row === r && p.col === c);

      if (boardTile) {
        cell.classList.add('occupied');
        const letter = boardTile.chosenLetter || boardTile.letter;
        cell.innerHTML = `${letter}<span class="points">${boardTile.points}</span>`;
      } else if (placed) {
        cell.classList.add('preview');
        const letter = placed.tile.chosenLetter || placed.tile.letter;
        cell.innerHTML = `${letter}<span class="points">${placed.tile.points}</span>`;
        cell.onclick = () => recallSingleTile(r, c);
      } else {
        const premium = PREMIUM_MAP[`${r},${c}`];
        if (premium) {
          cell.classList.add(PREMIUM_CSS[premium]);
          cell.innerHTML = `<span class="label">${PREMIUM_LABELS[premium]}</span>`;
        }
        cell.onclick = () => placeTileOnBoard(r, c);
      }

      boardEl.appendChild(cell);
    }
  }
}

function renderRack() {
  const rackEl = document.getElementById('rack');
  rackEl.innerHTML = '';

  // Get tiles still in hand (not placed on board)
  const placedIds = new Set(placedTiles.map(p => p.tile.id));
  const handTiles = gameState.hand.filter(t => !placedIds.has(t.id));

  handTiles.forEach(tile => {
    const el = document.createElement('div');
    el.className = 'tile';
    if (tile.letter === '*') el.classList.add('blank');
    if (selectedTile && selectedTile.id === tile.id) el.classList.add('selected');
    if (swapMode && swapSelection.has(tile.id)) el.classList.add('selected');

    el.innerHTML = `${tile.letter === '*' ? '?' : tile.letter}<span class="tile-points">${tile.points}</span>`;

    el.onclick = () => {
      if (swapMode) {
        if (swapSelection.has(tile.id)) swapSelection.delete(tile.id);
        else swapSelection.add(tile.id);
        renderRack();
      } else {
        if (selectedTile && selectedTile.id === tile.id) {
          selectedTile = null;
        } else {
          selectedTile = tile;
        }
        renderRack();
      }
    };

    rackEl.appendChild(el);
  });
}

function renderScores() {
  const el = document.getElementById('scores-list');
  el.innerHTML = gameState.players.map(p => `
    <div class="score-row ${p === gameState.currentPlayer ? 'active' : ''}">
      <span class="name">${escHtml(p)} ${p === gameState.currentPlayer ? '◄' : ''}</span>
      <span class="score">${gameState.scores[p]}</span>
    </div>
  `).join('');
}

function renderBagCount() {
  document.getElementById('bag-count').textContent = gameState.bagCount;
}

function renderHistory() {
  const el = document.getElementById('history-list');
  el.innerHTML = gameState.moveHistory.slice().reverse().map(m => {
    if (m.action === 'pass') {
      return `<div class="history-item"><span class="player-name">${escHtml(m.player)}</span> hat gepasst</div>`;
    }
    if (m.action === 'swap') {
      return `<div class="history-item"><span class="player-name">${escHtml(m.player)}</span> hat ${m.count} Steine getauscht</div>`;
    }
    return `<div class="history-item">
      <span class="player-name">${escHtml(m.player)}</span>:
      <span class="words">${m.words.join(', ')}</span>
      <span class="move-score">(+${m.score})</span>
    </div>`;
  }).join('');
}

function renderTurnIndicator() {
  const el = document.getElementById('turn-indicator');
  if (gameState.isMyTurn) {
    el.className = 'turn-indicator my-turn';
    el.textContent = 'Du bist am Zug!';
  } else {
    el.className = 'turn-indicator waiting';
    el.textContent = `${gameState.currentPlayer} ist am Zug...`;
  }
}

// ═══ Game Actions ═══
function placeTileOnBoard(row, col) {
  if (!selectedTile || !gameState.isMyTurn) return;

  // If blank tile, ask for letter
  if (selectedTile.letter === '*') {
    showBlankModal((chosenLetter) => {
      const tileWithLetter = { ...selectedTile, chosenLetter: chosenLetter.toUpperCase() };
      placedTiles.push({ row, col, tile: tileWithLetter });
      selectedTile = null;
      renderGame();
    });
    return;
  }

  placedTiles.push({ row, col, tile: selectedTile });
  selectedTile = null;
  renderGame();
}

function recallSingleTile(row, col) {
  placedTiles = placedTiles.filter(p => !(p.row === row && p.col === col));
  renderGame();
}

function recallTiles() {
  placedTiles = [];
  selectedTile = null;
  renderGame();
}

function shuffleRack() {
  // Fisher-Yates shuffle of hand
  const hand = gameState.hand;
  for (let i = hand.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [hand[i], hand[j]] = [hand[j], hand[i]];
  }
  renderRack();
}

function submitMove() {
  if (!gameState.isMyTurn) return alert('Nicht dein Zug!');
  if (placedTiles.length === 0) return alert('Lege zuerst Steine auf das Brett.');

  const placements = placedTiles.map(p => ({
    row: p.row,
    col: p.col,
    letter: p.tile.letter,
    points: p.tile.points,
    tileId: p.tile.id,
    chosenLetter: p.tile.chosenLetter || null
  }));

  socket.emit('place_tiles', { gameId: currentGameId, placements });
}

function swapTiles() {
  if (!gameState.isMyTurn) return alert('Nicht dein Zug!');

  if (!swapMode) {
    swapMode = true;
    swapSelection.clear();
    recallTiles();
    alert('Wähle die Steine aus, die du tauschen möchtest, und klicke erneut auf "Tauschen".');
    return;
  }

  if (swapSelection.size === 0) {
    swapMode = false;
    renderRack();
    return;
  }

  socket.emit('swap_tiles', { gameId: currentGameId, tileIds: [...swapSelection] });
  swapMode = false;
  swapSelection.clear();
}

function passTurn() {
  if (!gameState.isMyTurn) return alert('Nicht dein Zug!');
  if (confirm('Möchtest du wirklich passen?')) {
    recallTiles();
    socket.emit('pass_turn', currentGameId);
  }
}

// ═══ Blank Tile Modal ═══
function showBlankModal(callback) {
  const modal = document.getElementById('blank-modal');
  const grid = document.getElementById('letter-grid');
  modal.style.display = 'flex';

  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÜ'.split('');
  grid.innerHTML = letters.map(l =>
    `<button onclick="selectBlankLetter('${l}')">${l}</button>`
  ).join('');

  window._blankCallback = callback;
}

function selectBlankLetter(letter) {
  document.getElementById('blank-modal').style.display = 'none';
  if (window._blankCallback) {
    window._blankCallback(letter);
    window._blankCallback = null;
  }
}

// ═══ Game Over ═══
function showGameOver() {
  document.getElementById('game-over').style.display = 'flex';
  document.getElementById('winner-text').textContent =
    gameState.winner === currentUser ? 'Du hast gewonnen! 🎉' : `${gameState.winner} gewinnt!`;

  document.getElementById('final-scores').innerHTML = gameState.players.map(p => `
    <div class="score-row" style="margin:4px 0;justify-content:center;gap:20px;">
      <span class="name">${escHtml(p)}</span>
      <span class="score">${gameState.scores[p]} Punkte</span>
    </div>
  `).join('');
}

function backToLobby() {
  document.getElementById('game-over').style.display = 'none';
  currentGameId = null;
  gameState = null;
  placedTiles = [];
  showScreen('lobby-screen');
  socket.emit('get_lobbies');
}

// ═══ Utils ═══
function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ═══ Keyboard Shortcuts ═══
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    recallTiles();
    swapMode = false;
    swapSelection.clear();
    if (gameState) renderGame();
  }
  if (e.key === 'Enter' && gameState && gameState.isMyTurn && placedTiles.length > 0) {
    submitMove();
  }
});

// ═══ Admin Panel ═══
let adminUsers = [];
let adminGames = [];
let resetPasswordTarget = null;

function adminHeaders() {
  return { 'Content-Type': 'application/json', 'X-Auth-Token': token };
}

async function loadAdminData() {
  try {
    const [usersRes, gamesRes] = await Promise.all([
      fetch('/api/admin/users', { headers: adminHeaders() }),
      fetch('/api/admin/games', { headers: adminHeaders() })
    ]);
    if (usersRes.ok) { adminUsers = await usersRes.json(); renderAdminUsers(); }
    if (gamesRes.ok) { adminGames = await gamesRes.json(); renderAdminGames(); }
  } catch (e) { console.error('Admin load error', e); }
}

function switchAdminTab(tab) {
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.admin-tab-content').forEach(c => c.style.display = 'none');
  document.querySelector(`.admin-tab[onclick*="${tab}"]`).classList.add('active');
  document.getElementById(`admin-tab-${tab}`).style.display = 'block';
}

function filterAdminUsers() {
  renderAdminUsers();
}

function renderAdminUsers() {
  const search = (document.getElementById('admin-search')?.value || '').toLowerCase();
  const filtered = adminUsers.filter(u => u.username.toLowerCase().includes(search));
  const el = document.getElementById('admin-user-list');
  document.getElementById('admin-user-count').textContent = `${filtered.length} von ${adminUsers.length} Benutzer`;

  if (filtered.length === 0) {
    el.innerHTML = '<div class="no-lobbies">Keine Benutzer gefunden.</div>';
    return;
  }

  el.innerHTML = filtered.map(u => `
    <div class="admin-card">
      <div class="user-meta">
        <div>
          <span class="name">${escHtml(u.username)}</span>
          <span class="badge ${u.role === 'admin' ? 'badge-admin' : 'badge-user'}">${u.role}</span>
          ${u.banned ? '<span class="badge badge-banned">Gesperrt</span>' : ''}
          ${u.online ? '<span class="badge badge-online">Online</span>' : ''}
        </div>
        <div class="meta">
          Registriert: ${new Date(u.created).toLocaleDateString('de')} ·
          Spiele: ${u.stats.gamesPlayed} · Siege: ${u.stats.wins} · Punkte: ${u.stats.totalScore}
        </div>
      </div>
      <div class="admin-actions">
        ${u.role !== 'admin' || u.username !== currentUser ? `
          <button class="btn-admin-action" onclick="adminToggleBan('${escHtml(u.username)}')">${u.banned ? 'Entsperren' : 'Sperren'}</button>
          <button class="btn-admin-action" onclick="adminShowResetPw('${escHtml(u.username)}')">Passwort</button>
          <button class="btn-admin-action" onclick="adminToggleRole('${escHtml(u.username)}', '${u.role}')">${u.role === 'admin' ? 'Zum User' : 'Zum Admin'}</button>
          ${u.role !== 'admin' ? `<button class="btn-danger" onclick="adminDeleteUser('${escHtml(u.username)}')">Löschen</button>` : ''}
        ` : '<span style="color:var(--text2);font-size:12px;">Du (Admin)</span>'}
      </div>
    </div>
  `).join('');
}

function renderAdminGames() {
  const el = document.getElementById('admin-game-list');

  if (adminGames.length === 0) {
    el.innerHTML = '<div class="no-lobbies">Keine aktiven Spiele.</div>';
    return;
  }

  el.innerHTML = adminGames.map(g => `
    <div class="game-admin-card">
      <div class="game-info">
        <span class="game-id">Spiel #${g.id}</span>
        <span style="margin-left:8px;color:var(--text2);font-size:12px;">
          Gestartet: ${new Date(g.startedAt).toLocaleString('de')} ·
          Züge: ${g.moveCount}
          ${g.gameOver ? ' · <span style="color:#4caf50;">Beendet</span>' : ' · <span style="color:var(--gold);">Läuft</span>'}
        </span>
      </div>
      <div class="game-players">
        Spieler: ${g.players.map(p => `${escHtml(p)} (${g.scores[p]} Pkt.)`).join(' vs. ')}
        ${!g.gameOver ? ` · Am Zug: <strong>${escHtml(g.currentPlayer)}</strong>` : ''}
        ${g.winner ? ` · Gewinner: <strong style="color:var(--gold);">${escHtml(g.winner)}</strong>` : ''}
      </div>
      <div style="display:flex;gap:6px;margin-top:8px;">
        ${!g.gameOver ? `<button class="btn-danger" onclick="adminEndGame('${g.id}')">Spiel beenden</button>` : ''}
        <button class="btn-danger" onclick="adminDeleteGame('${g.id}')">Löschen</button>
      </div>
    </div>
  `).join('');
}

async function adminToggleBan(username) {
  const user = adminUsers.find(u => u.username === username);
  if (!user) return;
  const action = user.banned ? 'entsperren' : 'sperren';
  if (!confirm(`"${username}" wirklich ${action}?`)) return;

  const res = await fetch(`/api/admin/users/${encodeURIComponent(username)}/ban`, {
    method: 'POST', headers: adminHeaders()
  });
  if (res.ok) loadAdminData();
  else alert((await res.json()).error);
}

async function adminDeleteUser(username) {
  if (!confirm(`"${username}" wirklich ENDGÜLTIG löschen?`)) return;

  const res = await fetch(`/api/admin/users/${encodeURIComponent(username)}`, {
    method: 'DELETE', headers: adminHeaders()
  });
  if (res.ok) loadAdminData();
  else alert((await res.json()).error);
}

function adminShowResetPw(username) {
  resetPasswordTarget = username;
  document.getElementById('reset-pw-user').textContent = `Benutzer: ${username}`;
  document.getElementById('reset-pw-input').value = '';
  document.getElementById('reset-pw-modal').style.display = 'flex';
}

async function doResetPassword() {
  const newPassword = document.getElementById('reset-pw-input').value;
  if (!newPassword || newPassword.length < 4) return alert('Passwort muss mind. 4 Zeichen lang sein.');

  const res = await fetch(`/api/admin/users/${encodeURIComponent(resetPasswordTarget)}/reset-password`, {
    method: 'POST', headers: adminHeaders(),
    body: JSON.stringify({ newPassword })
  });

  document.getElementById('reset-pw-modal').style.display = 'none';
  if (res.ok) alert(`Passwort von "${resetPasswordTarget}" wurde zurückgesetzt.`);
  else alert((await res.json()).error);
}

async function adminToggleRole(username, currentRole) {
  const newRole = currentRole === 'admin' ? 'user' : 'admin';
  const label = newRole === 'admin' ? 'zum Admin befördern' : 'zum User degradieren';
  if (!confirm(`"${username}" wirklich ${label}?`)) return;

  const res = await fetch(`/api/admin/users/${encodeURIComponent(username)}/role`, {
    method: 'POST', headers: adminHeaders(),
    body: JSON.stringify({ role: newRole })
  });
  if (res.ok) loadAdminData();
  else alert((await res.json()).error);
}

async function adminEndGame(gameId) {
  if (!confirm('Spiel wirklich beenden?')) return;
  const res = await fetch(`/api/admin/games/${gameId}/end`, {
    method: 'POST', headers: adminHeaders()
  });
  if (res.ok) loadAdminData();
  else alert((await res.json()).error);
}

async function adminDeleteGame(gameId) {
  if (!confirm('Spiel wirklich löschen?')) return;
  const res = await fetch(`/api/admin/games/${gameId}`, {
    method: 'DELETE', headers: adminHeaders()
  });
  if (res.ok) loadAdminData();
  else alert((await res.json()).error);
}

// ═══ Init ═══
if (token && currentUser) {
  connectSocket();
} else {
  showScreen('auth-screen');
}
