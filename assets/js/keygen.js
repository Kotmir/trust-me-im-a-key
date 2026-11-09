/**
 * Ядро генератора ключей. Без зависимостей и без обращения к DOM.
 *
 * Все случайные значения берутся из Web Crypto (crypto.getRandomValues).
 * Math.random для ключей НЕ используется: он предсказуем и не подходит
 * для секретов.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.KeyGen = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MIN_LENGTH = 16;
  var MAX_LENGTH = 128;
  var MAX_PREFIX = 16;
  var UUID_LENGTH = 36;
  var UUID_BITS = 122; // 128 бит минус 6 служебных (версия и вариант)

  var FORMATS = {
    uuid: { alphabet: null },
    hex: { alphabet: '0123456789abcdef' },
    base62: { alphabet: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz' },
    base64url: { alphabet: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_' }
  };

  function getCrypto() {
    var c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
    if (!c || typeof c.getRandomValues !== 'function') {
      throw new Error('Web Crypto API недоступен');
    }
    return c;
  }

  function randomBytes(count) {
    var bytes = new Uint8Array(count);
    getCrypto().getRandomValues(bytes);
    return bytes;
  }

  /**
   * Случайная строка из алфавита без «перекоса» (modulo bias):
   * байты, не вписывающиеся в целое число полных кругов алфавита, отбрасываются.
   */
  function randomString(alphabet, length) {
    var n = alphabet.length;
    var limit = 256 - (256 % n);
    var out = '';
    while (out.length < length) {
      var bytes = randomBytes(Math.max(16, (length - out.length) * 2));
      for (var i = 0; i < bytes.length && out.length < length; i++) {
        if (bytes[i] < limit) out += alphabet.charAt(bytes[i] % n);
      }
    }
    return out;
  }

  function uuidV4() {
    var b = randomBytes(16);
    b[6] = (b[6] & 0x0f) | 0x40; // версия 4
    b[8] = (b[8] & 0x3f) | 0x80; // вариант RFC 4122
    var h = '';
    for (var i = 0; i < 16; i++) h += (b[i] + 256).toString(16).slice(1);
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' +
           h.slice(16, 20) + '-' + h.slice(20);
  }

  function clampLength(value) {
    var n = Math.round(Number(value));
    if (!isFinite(n)) n = 32;
    return Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, n));
  }

  function sanitizePrefix(value) {
    return String(value == null ? '' : value).replace(/[^A-Za-z0-9_-]/g, '').slice(0, MAX_PREFIX);
  }

  function entropyBits(format, length) {
    if (format === 'uuid') return UUID_BITS;
    return length * (Math.log(FORMATS[format].alphabet.length) / Math.LN2);
  }

  /** Уровень надёжности от 1 до 4 по числу бит энтропии. */
  function strength(bits) {
    if (bits < 64) return 1;
    if (bits < 96) return 2;
    if (bits < 128) return 3;
    return 4;
  }

  /**
   * @param {{format?: string, length?: number, prefix?: string}} options
   * @returns {{key: string, body: string, prefix: string, format: string, length: number, bits: number, level: number}}
   */
  function generate(options) {
    options = options || {};
    var format = FORMATS[options.format] ? options.format : 'uuid';
    var length = format === 'uuid' ? UUID_LENGTH : clampLength(options.length);
    var prefix = sanitizePrefix(options.prefix);
    var body = format === 'uuid' ? uuidV4() : randomString(FORMATS[format].alphabet, length);
    var bits = entropyBits(format, length);

    return {
      key: prefix + body,
      body: body,
      prefix: prefix,
      format: format,
      length: length,
      bits: bits,
      level: strength(bits)
    };
  }

  return {
    FORMATS: FORMATS,
    MIN_LENGTH: MIN_LENGTH,
    MAX_LENGTH: MAX_LENGTH,
    MAX_PREFIX: MAX_PREFIX,
    UUID_LENGTH: UUID_LENGTH,
    generate: generate,
    clampLength: clampLength,
    sanitizePrefix: sanitizePrefix,
    entropyBits: entropyBits,
    strength: strength
  };
});
