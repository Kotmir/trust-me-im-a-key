/**
 * Интерфейс генератора ключей.
 * Ядро (генерация и оценка надёжности) живёт в keygen.js.
 */
(function () {
  'use strict';

  var KG = window.KeyGen;

  var SETTINGS_KEY = 'keygen.settings.v1'; // хранятся только настройки, сам ключ — никогда
  var THEME_KEY = 'keygen.theme';

  var DEFAULTS = { format: 'uuid', length: 32, prefix: '' };

  var FORMAT_HINTS = {
    uuid: 'Привычный формат: 36 символов с дефисами. Подходит почти везде.',
    hex: 'Только цифры и буквы a–f. Удобно для секретов и подписей HMAC.',
    base62: 'Буквы обоих регистров и цифры, без спецсимволов. Компактнее hex при той же стойкости.',
    base64url: 'Буквы, цифры, «-» и «_». Самый плотный формат, безопасен для URL.'
  };

  var LEVEL_LABELS = ['', 'Слабый', 'Средний', 'Надёжный', 'Максимальный'];

  function $(id) { return document.getElementById(id); }

  var el = {
    key: $('key'),
    keySr: $('keySr'),
    copyBtn: $('copyBtn'),
    copyLabel: $('copyLabel'),
    newBtn: $('newBtn'),
    maskBtn: $('maskBtn'),
    maskLabel: $('maskLabel'),
    copyError: $('copyError'),
    announcer: $('announcer'),
    meter: $('meter'),
    meterLevel: $('meterLevel'),
    meterBits: $('meterBits'),
    settings: $('settings'),
    length: $('length'),
    lengthOut: $('lengthOut'),
    lengthHint: $('lengthHint'),
    prefix: $('prefix'),
    formatHint: $('formatHint'),
    themeToggle: $('themeToggle')
  };

  var bars = el.meter.querySelectorAll('.bars i');
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  var state = {
    format: DEFAULTS.format,
    length: DEFAULTS.length,
    prefix: DEFAULTS.prefix,
    key: ''
  };

  /* ---------- Вспомогательное ---------- */

  /** Русское склонение: plural(122, ['бит', 'бита', 'бит']) -> 'бита' */
  function plural(n, forms) {
    var a = Math.abs(n) % 100;
    var b = a % 10;
    if (a > 10 && a < 20) return forms[2];
    if (b > 1 && b < 5) return forms[1];
    if (b === 1) return forms[0];
    return forms[2];
  }

  function announce(text) {
    el.announcer.textContent = '';
    window.setTimeout(function () { el.announcer.textContent = text; }, 30);
  }

  function kindOf(ch, isPrefix) {
    if (isPrefix) return 'prefix';
    if (ch >= '0' && ch <= '9') return 'digit';
    if (/[A-Za-z]/.test(ch)) return 'letter';
    return 'sep';
  }

  /* ---------- Настройки ---------- */

  function loadSettings() {
    try {
      var saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
      if (saved && typeof saved === 'object') {
        if (KG.FORMATS[saved.format]) state.format = saved.format;
        state.length = KG.clampLength(saved.length == null ? DEFAULTS.length : saved.length);
        state.prefix = KG.sanitizePrefix(saved.prefix);
      }
    } catch (e) { /* хранилище недоступно: работаем с настройками по умолчанию */ }
  }

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        format: state.format,
        length: state.length,
        prefix: state.prefix
      }));
    } catch (e) { /* не страшно */ }
  }

  function syncControls() {
    var isUuid = state.format === 'uuid';
    var shown = isUuid ? KG.UUID_LENGTH : state.length;

    var radio = el.settings.querySelector('input[name="format"][value="' + state.format + '"]');
    if (radio) radio.checked = true;

    el.length.min = KG.MIN_LENGTH;
    el.length.max = KG.MAX_LENGTH;
    el.length.value = state.length;
    el.length.disabled = isUuid;
    el.length.style.setProperty(
      '--fill',
      ((state.length - KG.MIN_LENGTH) / (KG.MAX_LENGTH - KG.MIN_LENGTH) * 100) + '%'
    );

    el.lengthOut.textContent = shown + ' ' + plural(shown, ['символ', 'символа', 'символов']);
    el.lengthHint.textContent = isUuid
      ? 'У UUID длина всегда 36 символов.'
      : 'Количество случайных символов без префикса.';
    el.formatHint.textContent = FORMAT_HINTS[state.format];

    if (el.prefix.value !== state.prefix) el.prefix.value = state.prefix;
  }

  /* ---------- Отрисовка ключа ---------- */

  var animId = 0;

  function stopAnimation() {
    if (animId) {
      cancelAnimationFrame(animId);
      animId = 0;
    }
    el.key.classList.remove('is-animating');
  }

  /**
   * «Прокрутка» символов: тело ключа мелькает случайными знаками и фиксируется
   * слева направо. Это только эффект: настоящий ключ уже готов и лежит в state.key,
   * поэтому для мелькания достаточно Math.random.
   */
  function runScramble(spans, result) {
    var key = result.key;
    var prefixLen = result.prefix.length;
    var pool = result.format === 'uuid' ? '0123456789abcdef' : KG.FORMATS[result.format].alphabet;
    var bodyLen = key.length - prefixLen;
    var step = Math.min(14, 420 / Math.max(1, bodyLen));

    var resolveAt = [];
    var resolved = [];
    for (var i = 0; i < spans.length; i++) {
      var fixed = i < prefixLen || (result.format === 'uuid' && key.charAt(i) === '-');
      resolved[i] = fixed;
      resolveAt[i] = 120 + (i - prefixLen) * step;
    }

    el.key.classList.add('is-animating');

    var start = performance.now();
    var lastRoll = -1000;

    function frame(now) {
      var t = now - start;
      var roll = now - lastRoll >= 45;
      var pending = false;

      for (var j = 0; j < spans.length; j++) {
        if (resolved[j]) continue;
        var span = spans[j];
        if (t >= resolveAt[j]) {
          span.textContent = key.charAt(j);
          span.classList.remove('is-rolling');
          resolved[j] = true;
        } else {
          pending = true;
          if (roll) {
            span.textContent = pool.charAt(Math.floor(Math.random() * pool.length));
            span.classList.add('is-rolling');
          }
        }
      }
      if (roll) lastRoll = now;

      if (pending) {
        animId = requestAnimationFrame(frame);
      } else {
        animId = 0;
        el.key.classList.remove('is-animating');
      }
    }

    frame(start); // первый кадр сразу, чтобы настоящий ключ не мелькнул до анимации
  }

  function buildKey(result, animate) {
    stopAnimation();

    var key = result.key;
    var prefixLen = result.prefix.length;
    var frag = document.createDocumentFragment();
    var spans = [];

    for (var i = 0; i < key.length; i++) {
      var ch = key.charAt(i);
      var span = document.createElement('span');
      span.className = 'ch ch-' + kindOf(ch, i < prefixLen);
      // Тело ключа визуально делится на группы по 8 символов; в буфер пробелы не попадают
      if (result.format !== 'uuid' && i >= prefixLen &&
          (i - prefixLen + 1) % 8 === 0 && i < key.length - 1) {
        span.className += ' gap';
      }
      span.textContent = ch;
      frag.appendChild(span);
      spans.push(span);
    }

    el.key.textContent = '';
    el.key.appendChild(frag);

    var gaps = result.format === 'uuid' ? 0 : Math.floor((result.body.length - 1) / 8);
    el.key.style.setProperty('--chars', String(key.length + gaps * 0.55));

    if (animate) runScramble(spans, result);
  }

  function updateMeter(result) {
    var bits = Math.floor(result.bits);
    el.meter.setAttribute('data-level', String(result.level));
    for (var i = 0; i < bars.length; i++) {
      bars[i].classList.toggle('on', i < result.level);
    }
    el.meterLevel.textContent = LEVEL_LABELS[result.level];
    el.meterBits.textContent = bits + ' ' + plural(bits, ['бит', 'бита', 'бит']) + ' энтропии';
  }

  function showFatal() {
    stopAnimation();
    state.key = '';
    el.key.textContent = 'Не удалось получить доступ к генератору случайных чисел. ' +
      'Откройте страницу в актуальной версии Chrome, Firefox, Safari или Edge.';
    el.key.style.setProperty('--chars', '200');
    el.copyBtn.disabled = true;
    el.newBtn.disabled = true;
  }

  function render(animate) {
    var result;
    try {
      result = KG.generate({ format: state.format, length: state.length, prefix: state.prefix });
    } catch (err) {
      showFatal();
      return;
    }
    state.key = result.key;
    el.keySr.textContent = result.key;
    el.copyError.hidden = true;
    buildKey(result, animate && !reduceMotion.matches);
    updateMeter(result);
  }

  /* ---------- Копирование ---------- */

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    // Запасной путь для страницы, открытой не по https (например, с диска)
    return new Promise(function (resolve, reject) {
      var previous = document.activeElement;
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      if (previous && typeof previous.focus === 'function') previous.focus();
      if (ok) resolve(); else reject(new Error('copy failed'));
    });
  }

  var copyTimer = 0;

  function onCopy() {
    if (!state.key) return;
    copyText(state.key).then(function () {
      el.copyError.hidden = true;
      el.copyBtn.classList.add('is-done');
      el.copyLabel.textContent = 'Скопировано';
      announce('Ключ скопирован');
      window.clearTimeout(copyTimer);
      copyTimer = window.setTimeout(function () {
        el.copyBtn.classList.remove('is-done');
        el.copyLabel.textContent = 'Копировать';
      }, 1800);
    }, function () {
      el.copyError.hidden = false;
    });
  }

  /* ---------- Скрытие ключа ---------- */

  function onMask() {
    var masked = el.key.getAttribute('data-masked') !== 'true';
    el.key.setAttribute('data-masked', String(masked));
    el.maskBtn.classList.toggle('is-on', masked);
    el.maskLabel.textContent = masked ? 'Показать ключ' : 'Скрыть ключ';
  }

  /* ---------- Тема ---------- */

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') ||
      (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }

  function syncThemeLabel() {
    el.themeToggle.setAttribute(
      'aria-label',
      currentTheme() === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'
    );
  }

  function hasSavedTheme() {
    try {
      var t = localStorage.getItem(THEME_KEY);
      return t === 'light' || t === 'dark';
    } catch (e) { return false; }
  }

  function onThemeToggle() {
    var next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* не страшно */ }
    syncThemeLabel();
  }

  /* ---------- События ---------- */

  el.copyBtn.addEventListener('click', onCopy);
  el.newBtn.addEventListener('click', function () { render(true); });
  el.maskBtn.addEventListener('click', onMask);
  el.themeToggle.addEventListener('click', onThemeToggle);

  el.settings.addEventListener('change', function (e) {
    if (e.target && e.target.name === 'format' && KG.FORMATS[e.target.value]) {
      state.format = e.target.value;
      saveSettings();
      syncControls();
      render(true);
    }
  });

  el.length.addEventListener('input', function () {
    state.length = KG.clampLength(el.length.value);
    saveSettings();
    syncControls();
    render(false); // при перетаскивании ползунка анимация только мешала бы
  });

  el.prefix.addEventListener('input', function () {
    state.prefix = KG.sanitizePrefix(el.prefix.value);
    if (el.prefix.value !== state.prefix) el.prefix.value = state.prefix;
    saveSettings();
    render(false);
  });

  // Enter в поле префикса не должен перезагружать страницу
  el.settings.addEventListener('submit', function (e) {
    e.preventDefault();
    render(true);
  });

  // Горячие клавиши: G — создать новый, C — копировать. Работают по физической
  // клавише, поэтому не зависят от раскладки.
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.repeat) return;
    var t = e.target;
    if (t && (t.tagName === 'TEXTAREA' || t.isContentEditable ||
        (t.tagName === 'INPUT' && t.type === 'text'))) return;
    if (e.code === 'KeyG') {
      render(true);
    } else if (e.code === 'KeyC') {
      onCopy();
    }
  });

  if (window.matchMedia) {
    var scheme = window.matchMedia('(prefers-color-scheme: dark)');
    var onSchemeChange = function (e) {
      if (!hasSavedTheme()) {
        document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
        syncThemeLabel();
      }
    };
    if (scheme.addEventListener) scheme.addEventListener('change', onSchemeChange);
  }

  /* ---------- Старт ---------- */

  loadSettings();
  syncControls();
  syncThemeLabel();
  render(true);
})();
