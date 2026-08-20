/**
 * ChoKaguya Favorites Codec
 * - Compresses an array of non-negative integer IDs into the shortest of
 *   three encodings, and decodes it back losslessly (except method D, which
 *   only preserves the de-duplicated/sorted set — favorites are unordered).
 * - Pure functions, no DOM/localStorage — reused by favoritesShare.js.
 */
(function (global) {
  var ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.split('');
  var ALPHABET_INDEX = {};
  for (var ai = 0; ai < ALPHABET.length; ai++) ALPHABET_INDEX[ALPHABET[ai]] = ai;

  // --- varint: 5 data bits + 1 continuation bit per base64 char. Division/
  // modulo only (never << or >>>) so values beyond 32 bits stay exact.
  function encodeVarint(n) {
    var chars = [];
    while (true) {
      var chunk = n % 32;
      n = Math.floor(n / 32);
      if (n > 0) {
        chars.push(ALPHABET[chunk + 32]);
      } else {
        chars.push(ALPHABET[chunk]);
        break;
      }
    }
    return chars.join('');
  }

  function decodeVarintAt(str, pos) {
    var value = 0;
    var multiplier = 1;
    var i = pos;
    while (true) {
      var idx = ALPHABET_INDEX[str.charAt(i)];
      var data = idx % 32;
      var cont = idx >= 32;
      value += data * multiplier;
      multiplier *= 32;
      i++;
      if (!cont) break;
    }
    return { value: value, next: i };
  }

  function encodeVarintSeq(nums) {
    var parts = [];
    for (var i = 0; i < nums.length; i++) parts.push(encodeVarint(nums[i]));
    return parts.join('');
  }

  function decodeVarintSeq(str) {
    var result = [];
    var pos = 0;
    while (pos < str.length) {
      var r = decodeVarintAt(str, pos);
      result.push(r.value);
      pos = r.next;
    }
    return result;
  }

  // --- method V: varint per id, original order and duplicates preserved.
  function encodeV(ids) { return encodeVarintSeq(ids); }
  function decodeV(payload) { return decodeVarintSeq(payload); }

  // --- method F: fixed-width bit packing. Best when id magnitudes are similar.
  function bitLength(n) {
    if (n === 0) return 1;
    var w = 0;
    while (n > 0) { w++; n = Math.floor(n / 2); }
    return w;
  }

  function encodeF(ids) {
    var maxVal = 0;
    for (var i = 0; i < ids.length; i++) if (ids[i] > maxVal) maxVal = ids[i];
    var width = bitLength(maxVal);
    var header = encodeVarint(ids.length) + encodeVarint(width);

    var bits = [];
    for (var j = 0; j < ids.length; j++) {
      var n = ids[j];
      var idBits = [];
      for (var b = 0; b < width; b++) {
        idBits.push(n % 2);
        n = Math.floor(n / 2);
      }
      idBits.reverse();
      for (var k = 0; k < idBits.length; k++) bits.push(idBits[k]);
    }
    while (bits.length % 6 !== 0) bits.push(0);

    var chars = [];
    for (var p = 0; p < bits.length; p += 6) {
      var val = 0;
      for (var q = 0; q < 6; q++) val = val * 2 + bits[p + q];
      chars.push(ALPHABET[val]);
    }
    return header + chars.join('');
  }

  function decodeF(payload) {
    var countR = decodeVarintAt(payload, 0);
    var count = countR.value;
    var widthR = decodeVarintAt(payload, countR.next);
    var width = widthR.value;
    var bitsStr = payload.slice(widthR.next);

    var bits = [];
    for (var i = 0; i < bitsStr.length; i++) {
      var v = ALPHABET_INDEX[bitsStr.charAt(i)];
      var chunk = [];
      for (var b = 0; b < 6; b++) { chunk.push(v % 2); v = Math.floor(v / 2); }
      chunk.reverse();
      for (var c = 0; c < 6; c++) bits.push(chunk[c]);
    }

    var result = [];
    var idx = 0;
    for (var n = 0; n < count; n++) {
      var val = 0;
      for (var b2 = 0; b2 < width; b2++) { val = val * 2 + bits[idx]; idx++; }
      result.push(val);
    }
    return result;
  }

  // --- method D: dedupe + sort + delta. Best when ids cluster close together.
  function encodeD(ids) {
    var seen = {};
    var unique = [];
    for (var i = 0; i < ids.length; i++) {
      if (!Object.prototype.hasOwnProperty.call(seen, ids[i])) {
        seen[ids[i]] = true;
        unique.push(ids[i]);
      }
    }
    unique.sort(function (a, b) { return a - b; });

    var seq = [];
    for (var j = 0; j < unique.length; j++) {
      seq.push(j === 0 ? unique[j] : unique[j] - unique[j - 1]);
    }
    return encodeVarintSeq(seq);
  }

  function decodeD(payload) {
    var seq = decodeVarintSeq(payload);
    var result = [];
    var running = 0;
    for (var i = 0; i < seq.length; i++) {
      running = i === 0 ? seq[i] : running + seq[i];
      result.push(running);
    }
    return result;
  }

  function encodeFavorites(ids) {
    if (!ids || !ids.length) return 'V';
    var best = 'V' + encodeV(ids);
    var candF = 'F' + encodeF(ids);
    if (candF.length < best.length) best = candF;
    var candD = 'D' + encodeD(ids);
    if (candD.length < best.length) best = candD;
    return best;
  }

  function decodeFavorites(str) {
    if (!str) return [];
    var scheme = str.charAt(0);
    var payload = str.slice(1);
    if (scheme === 'V') return decodeV(payload);
    if (scheme === 'F') return decodeF(payload);
    if (scheme === 'D') return decodeD(payload);
    return [];
  }

  global.FavoritesCodec = {
    encodeFavorites: encodeFavorites,
    decodeFavorites: decodeFavorites
  };
})(typeof window !== 'undefined' ? window : this);
