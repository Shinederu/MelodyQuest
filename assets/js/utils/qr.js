const VERSION = 5;
const SIZE = 21 + (VERSION - 1) * 4;
const DATA_CODEWORDS = 108;
const ERROR_CORRECTION_CODEWORDS = 26;
const TOTAL_CODEWORDS = DATA_CODEWORDS + ERROR_CORRECTION_CODEWORDS;
const ECL_FORMAT_BITS = 1; // L

const GF_EXP = new Array(512);
const GF_LOG = new Array(256);

let gfReady = false;

function initGaloisField() {
  if (gfReady) return;

  let value = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = value;
    GF_LOG[value] = i;
    value <<= 1;
    if (value & 0x100) {
      value ^= 0x11d;
    }
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }

  gfReady = true;
}

function gfMultiply(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function reedSolomonGenerator(degree) {
  initGaloisField();

  let result = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(result.length + 1).fill(0);
    for (let j = 0; j < result.length; j++) {
      next[j] ^= result[j];
      next[j + 1] ^= gfMultiply(result[j], GF_EXP[i]);
    }
    result = next;
  }

  return result;
}

function reedSolomonCompute(data, degree) {
  const generator = reedSolomonGenerator(degree);
  const result = new Array(degree).fill(0);

  data.forEach((byte) => {
    const factor = byte ^ result.shift();
    result.push(0);
    for (let i = 0; i < degree; i++) {
      result[i] ^= gfMultiply(generator[i + 1], factor);
    }
  });

  return result;
}

function appendBits(target, value, length) {
  for (let i = length - 1; i >= 0; i--) {
    target.push(((value >>> i) & 1) !== 0);
  }
}

function buildCodewords(text) {
  const bytes = Array.from(new TextEncoder().encode(text));
  const bits = [];
  const capacityBits = DATA_CODEWORDS * 8;

  appendBits(bits, 0x4, 4);
  appendBits(bits, bytes.length, 8);
  bytes.forEach((byte) => appendBits(bits, byte, 8));

  if (bits.length > capacityBits) {
    throw new Error("QR text too long");
  }

  const terminator = Math.min(4, capacityBits - bits.length);
  appendBits(bits, 0, terminator);
  while (bits.length % 8 !== 0) {
    bits.push(false);
  }

  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) {
      byte = (byte << 1) | (bits[i + j] ? 1 : 0);
    }
    data.push(byte);
  }

  for (let pad = 0xec; data.length < DATA_CODEWORDS; pad ^= 0xfd) {
    data.push(pad);
  }

  return [...data, ...reedSolomonCompute(data, ERROR_CORRECTION_CODEWORDS)];
}

function createMatrix() {
  return {
    modules: Array.from({ length: SIZE }, () => new Array(SIZE).fill(false)),
    reserved: Array.from({ length: SIZE }, () => new Array(SIZE).fill(false)),
  };
}

function setFunction(matrix, row, col, dark) {
  if (row < 0 || row >= SIZE || col < 0 || col >= SIZE) return;
  matrix.modules[row][col] = Boolean(dark);
  matrix.reserved[row][col] = true;
}

function drawFinder(matrix, row, col) {
  for (let dy = -1; dy <= 7; dy++) {
    for (let dx = -1; dx <= 7; dx++) {
      const r = row + dy;
      const c = col + dx;
      if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) continue;

      const inPattern = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6;
      const dark = inPattern
        && (dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4));
      setFunction(matrix, r, c, dark);
    }
  }
}

function drawAlignment(matrix, centerRow, centerCol) {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const distance = Math.max(Math.abs(dx), Math.abs(dy));
      setFunction(matrix, centerRow + dy, centerCol + dx, distance !== 1);
    }
  }
}

function reserveFormatAreas(matrix) {
  for (let i = 0; i <= 8; i++) {
    matrix.reserved[8][i] = true;
    matrix.reserved[i][8] = true;
  }
  for (let i = 0; i < 8; i++) {
    matrix.reserved[8][SIZE - 1 - i] = true;
    matrix.reserved[SIZE - 1 - i][8] = true;
  }
}

function drawFunctionPatterns(matrix) {
  drawFinder(matrix, 0, 0);
  drawFinder(matrix, 0, SIZE - 7);
  drawFinder(matrix, SIZE - 7, 0);

  for (let i = 0; i < SIZE; i++) {
    if (!matrix.reserved[6][i]) setFunction(matrix, 6, i, i % 2 === 0);
    if (!matrix.reserved[i][6]) setFunction(matrix, i, 6, i % 2 === 0);
  }

  drawAlignment(matrix, 30, 30);
  reserveFormatAreas(matrix);
  setFunction(matrix, SIZE - 8, 8, true);
}

function maskBit(mask, row, col) {
  switch (mask) {
    case 0: return (row + col) % 2 === 0;
    case 1: return row % 2 === 0;
    case 2: return col % 3 === 0;
    case 3: return (row + col) % 3 === 0;
    case 4: return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5: return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6: return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    case 7: return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
    default: return false;
  }
}

function drawData(matrix, codewords, mask) {
  const bits = [];
  codewords.forEach((byte) => appendBits(bits, byte, 8));
  while (bits.length < TOTAL_CODEWORDS * 8) {
    bits.push(false);
  }

  let bitIndex = 0;
  let upward = true;
  for (let col = SIZE - 1; col > 0; col -= 2) {
    if (col === 6) col -= 1;

    for (let i = 0; i < SIZE; i++) {
      const row = upward ? SIZE - 1 - i : i;
      for (let offset = 0; offset < 2; offset++) {
        const c = col - offset;
        if (matrix.reserved[row][c]) continue;

        const bit = bitIndex < bits.length ? bits[bitIndex] : false;
        matrix.modules[row][c] = bit !== maskBit(mask, row, c);
        bitIndex++;
      }
    }

    upward = !upward;
  }
}

function getFormatBits(mask) {
  const data = (ECL_FORMAT_BITS << 3) | mask;
  let bits = data << 10;
  for (let i = 14; i >= 10; i--) {
    if (((bits >>> i) & 1) !== 0) {
      bits ^= 0x537 << (i - 10);
    }
  }

  return ((data << 10) | bits) ^ 0x5412;
}

function drawFormatBits(matrix, mask) {
  const bits = getFormatBits(mask);
  const getBit = (i) => ((bits >>> i) & 1) !== 0;

  for (let i = 0; i <= 5; i++) setFunction(matrix, i, 8, getBit(i));
  setFunction(matrix, 7, 8, getBit(6));
  setFunction(matrix, 8, 8, getBit(7));
  setFunction(matrix, 8, 7, getBit(8));
  for (let i = 9; i < 15; i++) setFunction(matrix, 8, 14 - i, getBit(i));

  for (let i = 0; i < 8; i++) setFunction(matrix, 8, SIZE - 1 - i, getBit(i));
  for (let i = 8; i < 15; i++) setFunction(matrix, SIZE - 15 + i, 8, getBit(i));
  setFunction(matrix, SIZE - 8, 8, true);
}

function getPenalty(matrix) {
  let penalty = 0;

  const countRuns = (line) => {
    let runColor = line[0];
    let runLength = 1;
    let score = 0;
    for (let i = 1; i < line.length; i++) {
      if (line[i] === runColor) {
        runLength++;
      } else {
        if (runLength >= 5) score += 3 + (runLength - 5);
        runColor = line[i];
        runLength = 1;
      }
    }
    if (runLength >= 5) score += 3 + (runLength - 5);
    return score;
  };

  for (let row = 0; row < SIZE; row++) {
    penalty += countRuns(matrix.modules[row]);
  }
  for (let col = 0; col < SIZE; col++) {
    penalty += countRuns(matrix.modules.map((line) => line[col]));
  }

  for (let row = 0; row < SIZE - 1; row++) {
    for (let col = 0; col < SIZE - 1; col++) {
      const color = matrix.modules[row][col];
      if (
        color === matrix.modules[row][col + 1]
        && color === matrix.modules[row + 1][col]
        && color === matrix.modules[row + 1][col + 1]
      ) {
        penalty += 3;
      }
    }
  }

  const finderPatternA = "10111010000";
  const finderPatternB = "00001011101";
  for (let row = 0; row < SIZE; row++) {
    const line = matrix.modules[row].map((v) => (v ? "1" : "0")).join("");
    for (let i = 0; i <= SIZE - 11; i++) {
      const slice = line.slice(i, i + 11);
      if (slice === finderPatternA || slice === finderPatternB) penalty += 40;
    }
  }
  for (let col = 0; col < SIZE; col++) {
    const line = matrix.modules.map((row) => (row[col] ? "1" : "0")).join("");
    for (let i = 0; i <= SIZE - 11; i++) {
      const slice = line.slice(i, i + 11);
      if (slice === finderPatternA || slice === finderPatternB) penalty += 40;
    }
  }

  const total = SIZE * SIZE;
  const dark = matrix.modules.flat().filter(Boolean).length;
  penalty += Math.floor(Math.abs((dark * 100) / total - 50) / 5) * 10;

  return penalty;
}

function buildMatrix(text) {
  const codewords = buildCodewords(text);
  let bestMatrix = null;
  let bestPenalty = Number.POSITIVE_INFINITY;

  for (let mask = 0; mask < 8; mask++) {
    const matrix = createMatrix();
    drawFunctionPatterns(matrix);
    drawData(matrix, codewords, mask);
    drawFormatBits(matrix, mask);
    const penalty = getPenalty(matrix);
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestMatrix = matrix;
    }
  }

  return bestMatrix.modules;
}

export function renderQrSvg(text, options = {}) {
  const quietZone = Number(options.quietZone ?? 4);
  const matrix = buildMatrix(String(text || ""));
  const total = SIZE + quietZone * 2;
  const dark = options.dark || "#06111f";
  const light = options.light || "#ffffff";
  const paths = [];

  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      if (!matrix[row][col]) continue;
      paths.push(`M${col + quietZone} ${row + quietZone}h1v1h-1z`);
    }
  }

  return `
    <svg class="mq-qr-svg" viewBox="0 0 ${total} ${total}" role="img" aria-label="QR code">
      <rect width="${total}" height="${total}" rx="2" fill="${light}"></rect>
      <path d="${paths.join("")}" fill="${dark}"></path>
    </svg>
  `;
}
