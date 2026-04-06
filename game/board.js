// Scrabble board logic (15x15)
const BOARD_SIZE = 15;

// Premium square types
const TRIPLE_WORD = 'TW';
const DOUBLE_WORD = 'DW';
const TRIPLE_LETTER = 'TL';
const DOUBLE_LETTER = 'DL';
const CENTER = 'CE';
const NORMAL = '';

// Premium square positions
const PREMIUM_SQUARES = {};

// Triple Word
[[0,0],[0,7],[0,14],[7,0],[7,14],[14,0],[14,7],[14,14]].forEach(([r,c]) => {
  PREMIUM_SQUARES[`${r},${c}`] = TRIPLE_WORD;
});

// Double Word
[[1,1],[2,2],[3,3],[4,4],[1,13],[2,12],[3,11],[4,10],
 [13,1],[12,2],[11,3],[10,4],[13,13],[12,12],[11,11],[10,10]].forEach(([r,c]) => {
  PREMIUM_SQUARES[`${r},${c}`] = DOUBLE_WORD;
});

// Center
PREMIUM_SQUARES['7,7'] = CENTER;

// Triple Letter
[[1,5],[1,9],[5,1],[5,5],[5,9],[5,13],
 [9,1],[9,5],[9,9],[9,13],[13,5],[13,9]].forEach(([r,c]) => {
  PREMIUM_SQUARES[`${r},${c}`] = TRIPLE_LETTER;
});

// Double Letter
[[0,3],[0,11],[2,6],[2,8],[3,0],[3,7],[3,14],
 [6,2],[6,6],[6,8],[6,12],[7,3],[7,11],
 [8,2],[8,6],[8,8],[8,12],[11,0],[11,7],[11,14],
 [12,6],[12,8],[14,3],[14,11]].forEach(([r,c]) => {
  PREMIUM_SQUARES[`${r},${c}`] = DOUBLE_LETTER;
});

function createBoard() {
  const board = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    board[r] = [];
    for (let c = 0; c < BOARD_SIZE; c++) {
      board[r][c] = null; // null = empty
    }
  }
  return board;
}

function getPremiumType(row, col) {
  return PREMIUM_SQUARES[`${row},${col}`] || NORMAL;
}

function isValidPlacement(board, placements, isFirstMove) {
  if (placements.length === 0) return { valid: false, error: 'Keine Steine gelegt.' };

  // Check all in same row or column
  const rows = [...new Set(placements.map(p => p.row))];
  const cols = [...new Set(placements.map(p => p.col))];
  const isHorizontal = rows.length === 1;
  const isVertical = cols.length === 1;

  if (!isHorizontal && !isVertical) {
    return { valid: false, error: 'Steine müssen in einer Reihe oder Spalte liegen.' };
  }

  // Check no overlap with existing tiles
  for (const p of placements) {
    if (board[p.row][p.col] !== null) {
      return { valid: false, error: 'Feld ist bereits belegt.' };
    }
    if (p.row < 0 || p.row >= BOARD_SIZE || p.col < 0 || p.col >= BOARD_SIZE) {
      return { valid: false, error: 'Feld außerhalb des Spielbretts.' };
    }
  }

  // First move must cover center
  if (isFirstMove) {
    const coversCenter = placements.some(p => p.row === 7 && p.col === 7);
    if (!coversCenter) {
      return { valid: false, error: 'Der erste Zug muss das Mittelfeld (★) bedecken.' };
    }
    if (placements.length < 2) {
      return { valid: false, error: 'Der erste Zug muss mindestens 2 Buchstaben enthalten.' };
    }
  }

  // Check continuity (no gaps in the line)
  if (isHorizontal) {
    const row = rows[0];
    const sortedCols = placements.map(p => p.col).sort((a, b) => a - b);
    for (let c = sortedCols[0]; c <= sortedCols[sortedCols.length - 1]; c++) {
      const isNewTile = placements.some(p => p.col === c);
      const isExisting = board[row][c] !== null;
      if (!isNewTile && !isExisting) {
        return { valid: false, error: 'Lücke in der Wortlinie.' };
      }
    }
  } else {
    const col = cols[0];
    const sortedRows = placements.map(p => p.row).sort((a, b) => a - b);
    for (let r = sortedRows[0]; r <= sortedRows[sortedRows.length - 1]; r++) {
      const isNewTile = placements.some(p => p.row === r);
      const isExisting = board[r][col] !== null;
      if (!isNewTile && !isExisting) {
        return { valid: false, error: 'Lücke in der Wortlinie.' };
      }
    }
  }

  // If not first move, must connect to existing tile
  if (!isFirstMove) {
    let connects = false;
    for (const p of placements) {
      const neighbors = [
        [p.row - 1, p.col], [p.row + 1, p.col],
        [p.row, p.col - 1], [p.row, p.col + 1]
      ];
      for (const [nr, nc] of neighbors) {
        if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE) {
          if (board[nr][nc] !== null && !placements.some(pp => pp.row === nr && pp.col === nc)) {
            connects = true;
            break;
          }
        }
      }
      if (connects) break;
    }
    if (!connects) {
      return { valid: false, error: 'Neue Steine müssen an bestehende Steine angrenzen.' };
    }
  }

  return { valid: true };
}

function getFormedWords(board, placements) {
  // Temporarily place tiles
  const tempBoard = board.map(row => [...row]);
  for (const p of placements) {
    tempBoard[p.row][p.col] = { letter: p.letter, points: p.points, isNew: true, chosenLetter: p.chosenLetter || null };
  }

  const words = [];
  const placementSet = new Set(placements.map(p => `${p.row},${p.col}`));

  // Get the main word
  const rows = [...new Set(placements.map(p => p.row))];
  const isHorizontal = rows.length === 1 || placements.length === 1;

  function extractWord(startRow, startCol, dRow, dCol) {
    let r = startRow, c = startCol;
    // Go to the start of the word
    while (r - dRow >= 0 && c - dCol >= 0 && r - dRow < BOARD_SIZE && c - dCol < BOARD_SIZE && tempBoard[r - dRow][c - dCol]) {
      r -= dRow;
      c -= dCol;
    }
    // Read the word
    const tiles = [];
    while (r >= 0 && c >= 0 && r < BOARD_SIZE && c < BOARD_SIZE && tempBoard[r][c]) {
      tiles.push({ ...tempBoard[r][c], row: r, col: c });
      r += dRow;
      c += dCol;
    }
    return tiles;
  }

  if (placements.length === 1) {
    // Single tile: check both directions
    const p = placements[0];
    const hWord = extractWord(p.row, p.col, 0, 1);
    if (hWord.length > 1) words.push(hWord);
    const vWord = extractWord(p.row, p.col, 1, 0);
    if (vWord.length > 1) words.push(vWord);
  } else {
    // Main word direction
    if (isHorizontal) {
      const mainWord = extractWord(placements[0].row, placements[0].col, 0, 1);
      if (mainWord.length > 1) words.push(mainWord);
      // Cross words for each new tile
      for (const p of placements) {
        const crossWord = extractWord(p.row, p.col, 1, 0);
        if (crossWord.length > 1) words.push(crossWord);
      }
    } else {
      const mainWord = extractWord(placements[0].row, placements[0].col, 1, 0);
      if (mainWord.length > 1) words.push(mainWord);
      for (const p of placements) {
        const crossWord = extractWord(p.row, p.col, 0, 1);
        if (crossWord.length > 1) words.push(crossWord);
      }
    }
  }

  return words;
}

function calculateScore(words, placements) {
  let totalScore = 0;
  const newTilePositions = new Set(placements.map(p => `${p.row},${p.col}`));

  for (const wordTiles of words) {
    let wordScore = 0;
    let wordMultiplier = 1;

    for (const tile of wordTiles) {
      let letterScore = tile.points;
      const key = `${tile.row},${tile.col}`;
      const premium = getPremiumType(tile.row, tile.col);

      if (newTilePositions.has(key)) {
        if (premium === DOUBLE_LETTER) letterScore *= 2;
        else if (premium === TRIPLE_LETTER) letterScore *= 3;
        else if (premium === DOUBLE_WORD || premium === CENTER) wordMultiplier *= 2;
        else if (premium === TRIPLE_WORD) wordMultiplier *= 3;
      }

      wordScore += letterScore;
    }

    totalScore += wordScore * wordMultiplier;
  }

  // Bonus for using all 7 tiles
  if (placements.length === 7) {
    totalScore += 50;
  }

  return totalScore;
}

module.exports = {
  BOARD_SIZE, createBoard, getPremiumType, isValidPlacement,
  getFormedWords, calculateScore,
  TRIPLE_WORD, DOUBLE_WORD, TRIPLE_LETTER, DOUBLE_LETTER, CENTER, NORMAL
};
