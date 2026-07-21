/**
 * @module engine/request_context/parse_size
 * @description Parse human-readable body size strings (e.g. "25mb") to bytes.
 * Used only by the gingee() middleware. Engine-internal.
 */

/**
 * @param {string} sizeStr
 * @returns {number} size in bytes
 */
function parseSize(sizeStr) {
  if (typeof sizeStr !== 'string') {
    throw new Error('Input must be a string');
  }

  // Trim and normalize
  const str = sizeStr.trim().toUpperCase();

  // Match number + unit (KB, MB, GB, TB, etc.)
  const match = str.match(/^([\d.]+)\s*([KMGTPE]?I?B?)$/i);
  if (!match) {
    throw new Error('Invalid size format: ' + sizeStr);
  }

  const value = parseFloat(match[1]);
  let unit = match[2].toUpperCase();

  // Default to bytes if no unit
  if (!unit || unit === 'B') return value;

  const units = {
    B: 1,
    KB: 1000,
    MB: 1000 ** 2,
    GB: 1000 ** 3,
    TB: 1000 ** 4,
    PB: 1000 ** 5,
    EB: 1000 ** 6,

    // IEC binary units
    KIB: 1024,
    MIB: 1024 ** 2,
    GIB: 1024 ** 3,
    TIB: 1024 ** 4,
    PIB: 1024 ** 5,
    EIB: 1024 ** 6
  };

  if (!(unit in units)) {
    throw new Error('Unknown unit: ' + unit);
  }

  return value * units[unit];
}

module.exports = {
  parseSize,
  /** @deprecated alias used by legacy call sites */
  _parseSize: parseSize
};
