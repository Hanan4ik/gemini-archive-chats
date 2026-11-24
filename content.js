/**
 * Gemini Archive Hider
 * Скрывает элементы <gem-nav-list-item>, название которых начинается с заданного префикса архива,
 * отдаёт список в popup и отображает плашку «Архивный чат» для открытого архивного чата.
 */

(() => {
  'use strict';

  // Префикс архивного чата (экранированный [\A\])
  const ARCHIVE_PREFIX = '[\\A\\]';

  // Селектор элементов списка навигации в Gemini
  const ITEM_SELECTOR = 'gem-nav-list-item';

  // Опциональная строгая проверка класса Angular (ng-tns-c{10 цифр}-9)
  const STRICT_ANGULAR_CLASS_CHECK = false;
  const CHAT_CLASS_REGEX = /^ng-tns-c\d{10}-9$/;

  // Дата-атрибуты для отслеживания скрытых элементов
  const HIDDEN_ATTR = 'data-gemini-archive-hidden';
  const ARCHIVE_ID_ATTR = 'data-gemini-archive-id';

  // Селектор целевого элемента в правом верхнем углу
  const RIPPLE_SELECTOR = 'span.mat-mdc-button-persistent-ripple.mdc-icon-button__ripple';
  const BADGE_ID = 'gemini-archive-status-badge';

  const runtimeApi = typeof browser !== 'undefined' ? browser : chrome;

  let archiveIdCounter = 0;
  let lastKnownUrl = window.location.href;
  let manualArchiveSession = null;

  /**
   * Возвращает или назначает уникальный идентификатор архивному элементу.
   * @param {Element} item
   * @returns {string}
   */
  function ensureArchiveId(item) {
    let id = item.getAttribute(ARCHIVE_ID_ATTR);
    if (!id) {
      archiveIdCounter += 1;
      id = `arch-${archiveIdCounter}`;
      item.setAttribute(ARCHIVE_ID_ATTR, id);
    }
    return id;
  }

  /**
   * Извлекает полный URL чата из ссылки <a> или резервно из атрибута jslog.
   * @param {Element} item
   * @returns {string | null}
   */
  function extractChatHref(item) {
    const link =
      (item.matches('a[href]') && item) ||
      item.querySelector('a[href]') ||
      item.closest('a[href]');

    if (link) {
      const rawHref = link.getAttribute('href');
      if (rawHref) {
        try {
          return new URL(rawHref, window.location.origin).href;
        } catch (_err) {
          return rawHref;
        }
      }
    }

    // Резервный поиск идентификатора чата (c_<hex>) в атрибуте jslog, если <a> отсутствует
    const jslogHost = item.hasAttribute('jslog') ? item : item.querySelector('[jslog]');
    const jslog = jslogHost ? jslogHost.getAttribute('jslog') : '';
    const match = jslog && jslog.match(/c_([a-zA-Z0-9_-]{8,})/);
    if (match && match[1]) {
      const accountPrefixMatch = window.location.pathname.match(/^(\/u\/\d+)\//);
      const accountPrefix = accountPrefixMatch ? accountPrefixMatch[1] : '';
      return `${window.location.origin}${accountPrefix}/app/${match[1]}`;
    }

    return null;
  }

  /**
   * Проверяет, является ли элемент целевым чатом.
   * @param {Element} item
   * @returns {boolean}
   */
  function isTargetChatElement(item) {
    if (!STRICT_ANGULAR_CLASS_CHECK) {
      return true;
    }
    return Array.from(item.classList).some((cls) => CHAT_CLASS_REGEX.test(cls));
  }

  /**
   * Извлекает очищенное название чата, игнорируя текстовые лигатуры иконок Angular Material.
   * @param {Element} item
   * @returns {string}
   */
  function extractChatTitle(item) {
    const clone = item.cloneNode(true);
    clone
      .querySelectorAll(
        'mat-icon, font-icon, .mat-icon, .material-icons, .material-symbols-outlined, .google-symbols, svg, script, style'
      )
      .forEach((el) => el.remove());

    const text = (clone.textContent || '').replace(/\s+/g, ' ').trim();
    if (text) {
      return text;
    }

    return (item.getAttribute('aria-label') || item.textContent || '').replace(/\s+/g, ' ').trim();
  }

  /**
   * Проверяет, является ли элемент <gem-nav-list-item> текущим открытым чатом.
   * @param {Element} item
   * @returns {boolean}
   */
  function isItemCurrentlyActive(item) {
    const href = extractChatHref(item);
    if (href) {
      try {
        const itemPath = new URL(href, window.location.origin).pathname;
        if (itemPath && itemPath !== '/app' && itemPath === window.location.pathname) {
          return true;
        }
      } catch (_err) {
        // Игнорируем некорректные URL
      }
    }

    if (
      item.getAttribute('aria-current') === 'page' ||
      item.classList.contains('selected') ||
      item.classList.contains('active') ||
      item.classList.contains('is-active') ||
      item.classList.contains('mdc-list-item--activated')
    ) {
      return true;
    }

    return Boolean(
      item.querySelector(
        '[aria-current="page"], .selected, .active, .is-active, .mdc-list-item--activated'
      )
    );
  }

  /**
   * Собирает актуальный список всех архивных чатов из DOM.
   * @returns {Array<{id: string, title: string, displayTitle: string, href: string | null}>}
   */
  function collectArchivedChats() {
    processChatList();
    const chats = [];
    const items = document.querySelectorAll(`${ITEM_SELECTOR}[${HIDDEN_ATTR}="true"]`);

    items.forEach((item) => {
      const title = extractChatTitle(item);
      if (!title.startsWith(ARCHIVE_PREFIX)) return;

      const id = ensureArchiveId(item);
      const displayTitle = title.slice(ARCHIVE_PREFIX.length).trim() || title;
      const href = extractChatHref(item);

      chats.push({ id, title, displayTitle, href });
    });

    return chats;
  }

  /**
   * Находит целевой элемент в правом верхнем углу экрана, содержащий ripple-span.
   * @returns {Element | null}
   */
  function findTopRightBadgeAnchor() {
    const ripples = document.querySelectorAll(RIPPLE_SELECTOR);
    let bestAnchor = null;
    let bestScore = -Infinity;

    ripples.forEach((ripple) => {
      const anchor = ripple.closest('button') || ripple;
      const rect = anchor.getBoundingClientRect();

      if (rect.width === 0 || rect.height === 0) return;
      if (rect.top < 0 || rect.top > 120) return;
      if (rect.left < window.innerWidth * 0.5) return;

      const score = rect.right - rect.top * 2;
      if (score > bestScore) {
        bestScore = score;
        bestAnchor = anchor;
      }
    });

    return bestAnchor;
  }

  /**
   * Определяет, используется ли сейчас тёмная тема на странице Gemini.
   * @returns {boolean}
   */
  function isDarkThemeActive() {
    if (document.body) {
      if (document.body.classList.contains('dark-theme')) return true;
      if (document.body.classList.contains('light-theme')) return false;
      const bg = window.getComputedStyle(document.body).backgroundColor;
      const rgb = bg.match(/\d+/g);
      if (rgb && rgb.length >= 3) {
        const luminance = 0.299 * Number(rgb[0]) + 0.587 * Number(rgb[1]) + 0.114 * Number(rgb[2]);
        return luminance < 128;
      }
    }
    return Boolean(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  /**
   * Создаёт или обновляет независимую плашку «Архивный чат» поверх страницы.
   * @param {boolean} visible
   */
  function renderArchiveBadge(visible) {
    let badge = document.getElementById(BADGE_ID);

    if (!visible) {
      if (badge) {
        badge.remove();
      }
      return;
    }

    if (!badge) {
      badge = document.createElement('div');
      badge.id = BADGE_ID;
      badge.setAttribute('role', 'status');
      badge.textContent = 'Архивный чат';
      Object.assign(badge.style, {
        position: 'fixed',
        zIndex: '2147483640',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '6px',
        height: '32px',
        padding: '0 14px',
        borderRadius: '9999px',
        fontSize: '13px',
        fontWeight: '500',
        lineHeight: '1',
        letterSpacing: '0.01em',
        whiteSpace: 'nowrap',
        userSelect: 'none',
        pointerEvents: 'none',
        fontFamily: "'Google Sans', 'Segoe UI', Roboto, Arial, sans-serif",
        boxSizing: 'border-box',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.16)',
        transition: 'top 0.15s ease, right 0.15s ease',
      });
    }

    if (isDarkThemeActive()) {
      badge.style.backgroundColor = '#282a2c';
      badge.style.color = '#c2e7ff';
      badge.style.border = '1px solid rgba(168, 199, 250, 0.32)';
    } else {
      badge.style.backgroundColor = '#e9eef6';
      badge.style.color = '#041e49';
      badge.style.border = '1px solid rgba(11, 87, 208, 0.24)';
    }

    if (document.body && badge.parentElement !== document.body) {
      document.body.appendChild(badge);
    }

    const anchor = findTopRightBadgeAnchor();
    if (anchor) {
      const rect = anchor.getBoundingClientRect();
      const topPos = Math.max(8, Math.round(rect.top + (rect.height - 32) / 2));
      const rightPos = Math.max(16, Math.round(window.innerWidth - rect.left + 12));
      badge.style.top = `${topPos}px`;
      badge.style.right = `${rightPos}px`;
    } else {
      badge.style.top = '16px';
      badge.style.right = '112px';
    }
  }

  /**
   * Определяет, открыт ли сейчас архивный чат, и синхронизирует отображение плашки.
   */
  function syncArchiveBadge() {
    try {
      const currentUrl = window.location.href;
      if (currentUrl !== lastKnownUrl) {
        lastKnownUrl = currentUrl;
        if (manualArchiveSession && Date.now() - manualArchiveSession.openedAt > 2500) {
          manualArchiveSession = null;
        }
      }

      let isArchivedOpen = false;

      const archivedItems = document.querySelectorAll(`${ITEM_SELECTOR}[${HIDDEN_ATTR}="true"]`);
      for (const item of archivedItems) {
        if (isItemCurrentlyActive(item)) {
          isArchivedOpen = true;
          break;
        }
      }

      if (!isArchivedOpen && document.title.trim().startsWith(ARCHIVE_PREFIX)) {
        isArchivedOpen = true;
      }

      if (!isArchivedOpen && manualArchiveSession) {
        const withinGracePeriod = Date.now() - manualArchiveSession.openedAt <= 2500;
        const matchesSessionUrl =
          manualArchiveSession.targetPath &&
          window.location.pathname === manualArchiveSession.targetPath;

        if (withinGracePeriod || matchesSessionUrl) {
          isArchivedOpen = true;
        } else {
          manualArchiveSession = null;
        }
      }

      renderArchiveBadge(isArchivedOpen);
    } catch (error) {
      console.error('[Gemini Archive Hider] Ошибка при обновлении плашки архива:', error);
    }
  }

  /**
   * Открывает выбранный в popup архивный чат и активирует плашку «Архивный чат».
   * @param {{id?: string, title?: string, href?: string | null}} payload
   * @returns {boolean}
   */
  function openArchivedChat(payload) {
    try {
      const { id, title, href } = payload || {};
      let targetItem = id
        ? document.querySelector(`${ITEM_SELECTOR}[${ARCHIVE_ID_ATTR}="${CSS.escape(id)}"]`)
        : null;

      if (!targetItem && title) {
        const items = document.querySelectorAll(ITEM_SELECTOR);
        for (const item of items) {
          if (extractChatTitle(item) === title) {
            targetItem = item;
            break;
          }
        }
      }

      let targetPath = null;
      const resolvedHref = href || (targetItem ? extractChatHref(targetItem) : null);
      if (resolvedHref) {
        try {
          targetPath = new URL(resolvedHref, window.location.origin).pathname;
        } catch (_err) {
          targetPath = null;
        }
      }

      manualArchiveSession = {
        id: id || null,
        targetPath,
        openedAt: Date.now(),
      };

      if (targetItem) {
        const clickable =
          targetItem.querySelector('a[href], button, [role="button"], [role="link"]') || targetItem;
        clickable.click();
        syncArchiveBadge();
        return true;
      }

      if (resolvedHref) {
        window.location.assign(resolvedHref);
        syncArchiveBadge();
        return true;
      }

      return false;
    } catch (error) {
      console.error('[Gemini Archive Hider] Ошибка при открытии архивного чата:', error);
      return false;
    }
  }

  /**
   * Сканирует список элементов <gem-nav-list-item> и скрывает/показывает их в зависимости от префикса.
   */
  function processChatList() {
    try {
      const items = document.querySelectorAll(ITEM_SELECTOR);

      items.forEach((item) => {
        if (!isTargetChatElement(item)) {
          return;
        }

        const title = extractChatTitle(item);
        const shouldHide = title.startsWith(ARCHIVE_PREFIX);
        const isAlreadyHidden = item.getAttribute(HIDDEN_ATTR) === 'true';

        if (shouldHide) {
          ensureArchiveId(item);
        }

        if (shouldHide && !isAlreadyHidden) {
          item.style.setProperty('display', 'none', 'important');
          item.setAttribute(HIDDEN_ATTR, 'true');
        } else if (!shouldHide && isAlreadyHidden) {
          item.style.removeProperty('display');
          item.removeAttribute(HIDDEN_ATTR);
          item.removeAttribute(ARCHIVE_ID_ATTR);
        }
      });

      syncArchiveBadge();
    } catch (error) {
      console.error('[Gemini Archive Hider] Ошибка при обработке списка чатов:', error);
    }
  }

  let rafScheduled = false;
  function scheduleProcess() {
    if (rafScheduled) return;
    rafScheduled = true;
    window.requestAnimationFrame(() => {
      rafScheduled = false;
      processChatList();
    });
  }

  /**
   * Инициализация наблюдателя за DOM и обработчика сообщений от popup.
   */
  function init() {
    processChatList();

    if (runtimeApi?.runtime?.onMessage) {
      runtimeApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (!message || typeof message !== 'object') return false;

        if (message.type === 'GET_ARCHIVED_CHATS') {
          sendResponse({ ok: true, chats: collectArchivedChats() });
          return false;
        }

        if (message.type === 'OPEN_ARCHIVED_CHAT') {
          const opened = openArchivedChat(message.payload);
          sendResponse({ ok: opened });
          return false;
        }

        return false;
      });
    }

    window.addEventListener('popstate', scheduleProcess);
    window.addEventListener('resize', syncArchiveBadge);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList' || mutation.type === 'characterData') {
          scheduleProcess();
          break;
        }
      }
    });

    if (document.body) {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }
  }

  init();
})();
