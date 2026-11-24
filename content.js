/**
 * Gemini Archive Hider (MVP)
 * Скрывает элементы <gem-nav-list-item>, название которых начинается с заданного префикса архива.
 */

(() => {
  'use strict';

  // Префикс архивного чата.
  // В JavaScript обратный слэш экранируется, поэтому '[\\A\\]' соответствует строке [\A\].
  // Если в будущем решите использовать просто [A], замените значение на '[A]'.
  const ARCHIVE_PREFIX = '[\\A\\]';

  // Селектор элементов списка навигации в Gemini
  const ITEM_SELECTOR = 'gem-nav-list-item';

  // Регулярное выражение для класса чатов Angular (ng-tns-c{10 цифр}-9).
  // По умолчанию строгая проверка отключена, чтобы расширение не сломалось,
  // если Google пересоберёт фронтенд и индекс -9 изменится.
  const STRICT_ANGULAR_CLASS_CHECK = false;
  const CHAT_CLASS_REGEX = /^ng-tns-c\d{10}-9$/;

  // Дата-атрибут для отслеживания скрытых нами элементов (важно при переиспользовании DOM в Angular)
  const HIDDEN_ATTR = 'data-gemini-archive-hidden';
  const ARCHIVE_ID_ATTR = 'data-gemini-archive-id';

  // Селектор целевого элемента в правом верхнем углу, слева от которого выводится метка
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
   * Извлекает ссылку на чат, если внутри элемента есть <a>.
   * @param {Element} item
   * @returns {string | null}
   */
  function extractChatHref(item) {
    const link = item.matches('a[href]') ? item : item.querySelector('a[href]');
    return link ? link.getAttribute('href') : null;
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
        // Игнорируем некорректные относительные URL
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
      // Выбираем родительскую кнопку (если есть), чтобы надпись не обрезалась границами круглой icon-button
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
   * Создаёт или обновляет плашку «Архивный чат» слева от элемента в правом верхнем углу.
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
      badge = document.createElement('span');
      badge.id = BADGE_ID;
      badge.textContent = 'Архивный чат';
      Object.assign(badge.style, {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '6px 12px',
        marginRight: '10px',
        borderRadius: '9999px',
        fontSize: '12px',
        fontWeight: '500',
        lineHeight: '1',
        letterSpacing: '0.01em',
        whiteSpace: 'nowrap',
        userSelect: 'none',
        pointerEvents: 'none',
        flexShrink: '0',
        fontFamily: "'Google Sans', Roboto, Arial, sans-serif",
        backgroundColor: 'rgba(245, 158, 11, 0.16)',
        color: '#b45309',
        border: '1px solid rgba(245, 158, 11, 0.42)',
        boxSizing: 'border-box',
      });

      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        badge.style.backgroundColor = 'rgba(251, 191, 36, 0.16)';
        badge.style.color = '#fcd34d';
        badge.style.borderColor = 'rgba(251, 191, 36, 0.4)';
      }
    }

    const anchor = findTopRightBadgeAnchor();
    if (anchor && anchor.parentElement) {
      // Сбрасываем резервное фиксированное позиционирование, если ранее оно применялось
      badge.style.position = '';
      badge.style.top = '';
      badge.style.right = '';
      badge.style.zIndex = '';

      if (badge.parentElement !== anchor.parentElement || badge.nextElementSibling !== anchor) {
        anchor.parentElement.insertBefore(badge, anchor);
      }
    } else if (document.body) {
      // Резервное размещение в правом верхнем углу, пока кнопка шапки не отрендерилась
      badge.style.position = 'fixed';
      badge.style.top = '14px';
      badge.style.right = '72px';
      badge.style.zIndex = '9999';

      if (badge.parentElement !== document.body) {
        document.body.appendChild(badge);
      }
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
        // Если переход произошёл не в момент клика по архиву, сбрасываем ручную сессию
        if (manualArchiveSession && Date.now() - manualArchiveSession.openedAt > 2500) {
          manualArchiveSession = null;
        }
      }

      let isArchivedOpen = false;

      // 1. Проверяем, совпадает ли открытый чат с одним из скрытых архивных элементов
      const archivedItems = document.querySelectorAll(`${ITEM_SELECTOR}[${HIDDEN_ATTR}="true"]`);
      for (const item of archivedItems) {
        if (isItemCurrentlyActive(item)) {
          isArchivedOpen = true;
          break;
        }
      }

      // 2. Проверяем заголовок вкладки на случай, если список чатов ещё не прогружен
      if (!isArchivedOpen && document.title.trim().startsWith(ARCHIVE_PREFIX)) {
        isArchivedOpen = true;
      }

      // 3. Учитываем только что открытый через popup архивный чат (пока Angular обновляет DOM)
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
          // Возвращаем отображение, если чат переименовали или Angular переиспользовал DOM-узел
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

  // Группируем частые мутации DOM через requestAnimationFrame для минимальной нагрузки
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
   * Инициализация наблюдателя за DOM (так как Gemini — это SPA с динамической подгрузкой списка).
   */
  function init() {
    processChatList();

    // Подписываемся на сообщения из выпадающей панели (popup)
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

    // Отслеживаем смену истории браузера (кнопки Назад/Вперёд в SPA)
    window.addEventListener('popstate', scheduleProcess);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (
          mutation.type === 'childList' ||
          mutation.type === 'characterData'
        ) {
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
