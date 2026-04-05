// German Scrabble tile distribution and scoring
const TILE_DEFINITIONS = {
  'A': { count: 5, points: 1 },
  'Ä': { count: 1, points: 6 },
  'B': { count: 2, points: 3 },
  'C': { count: 2, points: 4 },
  'D': { count: 4, points: 1 },
  'E': { count: 15, points: 1 },
  'F': { count: 2, points: 4 },
  'G': { count: 3, points: 2 },
  'H': { count: 4, points: 2 },
  'I': { count: 6, points: 1 },
  'J': { count: 1, points: 6 },
  'K': { count: 2, points: 4 },
  'L': { count: 3, points: 2 },
  'M': { count: 4, points: 3 },
  'N': { count: 9, points: 1 },
  'O': { count: 3, points: 2 },
  'Ö': { count: 1, points: 8 },
  'P': { count: 1, points: 4 },
  'Q': { count: 1, points: 10 },
  'R': { count: 6, points: 1 },
  'S': { count: 7, points: 1 },
  'T': { count: 6, points: 1 },
  'U': { count: 6, points: 1 },
  'Ü': { count: 1, points: 6 },
  'V': { count: 1, points: 6 },
  'W': { count: 1, points: 3 },
  'X': { count: 1, points: 8 },
  'Y': { count: 1, points: 10 },
  'Z': { count: 1, points: 3 },
  '*': { count: 2, points: 0 } // Blank tiles
};

function createTileBag() {
  const bag = [];
  for (const [letter, def] of Object.entries(TILE_DEFINITIONS)) {
    for (let i = 0; i < def.count; i++) {
      bag.push({ letter, points: def.points, id: `${letter}_${i}` });
    }
  }
  // Shuffle
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
}

function getLetterPoints(letter) {
  if (letter === '*' || !TILE_DEFINITIONS[letter]) return 0;
  return TILE_DEFINITIONS[letter].points;
}

module.exports = { TILE_DEFINITIONS, createTileBag, getLetterPoints };
