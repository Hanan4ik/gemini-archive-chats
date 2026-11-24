/**
 * Gemini Archive Hider
 * Скрывает элементы <gem-nav-list-item>, название которых начинается с заданного префикса архива,
 * добавляет кнопку «Архивировать» в меню «трёх точек» чата, отдаёт список в popup
 * и отображает плашку «Архивный чат» для открытого архивного чата.
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

  // Дата-атрибуты для отслеживания скрытых элементов и внедрённых кнопок
  const HIDDEN_ATTR = 'data-gemini-archive-hidden';
  const ARCHIVE_ID_ATTR = 'data-gemini-archive-id';
  const MENU_ARCHIVE_BTN_ATTR = 'data-gemini-archive-menu-btn';

  // Селектор целевого элемента в правом верхнем углу
  const RIPPLE_SELECTOR = 'span.mat-mdc-button-persistent-ripple.mdc-icon-button__ripple';
  const BADGE_ID = 'gemini-archive-status-badge';

  const runtimeApi = typeof browser !== 'undefined' ? browser : chrome;

  let archiveIdCounter = 0;
  let lastKnownUrl = window.location.href;
  let manualArchiveSession = null;
  let isArchivingInProgress = false;

  /**
   * Ожидает выполнения условия predicate с заданным интервалом и таймаутом.
   * @template T
   * @param {() => T | null | undefined | false} predicate
   * @param {number} [timeoutMs=3000]
   * @param {number} [intervalMs=50]
   * @returns {Promise<T | null>}
   */
  function waitForCondition(predicate, timeoutMs = 3000, intervalMs = 50) {
    return new Promise((resolve) => {
      const immediate = predicate();
      if (immediate) {
        resolve(immediate);
        return;
      }

      const deadline = Date.now() + timeoutMs;
      const timer = window.setInterval(() => {
        const result = predicate();
        if (result) {
          window.clearInterval(timer);
          resolve(result);
          return;
        }
        if (Date.now() >= deadline) {
          window.clearInterval(timer);
          resolve(null);
        }
      }, intervalMs);
    });
  }

  /**
   * Проверяет, является ли элемент целевым пунктом списка чатов Gemini.
   * @param {Element} el
   * @returns {boolean}
   */
  function isTargetChatElement(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    if (!STRICT_ANGULAR_CLASS_CHECK) return true;

    return Array.from(el.classList).some((cls) => CHAT_CLASS_REGEX.test(cls));
  }

  /**
   * Извлекает чистое название чата из элемента, игнорируя текстовые лигатуры иконок.
   * @param {Element} el
   * @returns {string}
   */
  function extractChatTitle(el) {
    if (!el) return '';

    const clone = el.cloneNode(true);
    clone
      .querySelectorAll(
        'mat-icon, gem-icon, svg, [aria-hidden="true"], .mat-icon, .font-icon, .mat-mdc-menu-trigger, button[aria-haspopup="menu"]'
      )
      .forEach((node) => node.remove());

    const text = (clone.textContent || '').replace(/\s+/g, ' ').trim();
    if (text) return text;

    const ariaLabel =
      el.getAttribute('aria-label') ||
      el.querySelector('[aria-label]')?.getAttribute('aria-label') ||
      '';
    return ariaLabel.replace(/\s+/g, ' ').trim();
  }

  /**
   * Извлекает полную ссылку на чат из тега <a> или (резервно) из атрибута jslog.
   * @param {Element} el
   * @returns {string | null}
   */
  function extractChatHref(el) {
    if (!el) return null;

    const anchor = el.querySelector('a[href]') || el.closest('a[href]');
    if (anchor) {
      const rawHref = anchor.getAttribute('href');
      if (rawHref) {
        try {
          return new URL(rawHref, window.location.origin).href;
        } catch (_err) {
          return null;
        }
      }
    }

    // Резервное извлечение ID чата (c_...) из jslog, если в разметке нет тега <a>
    const jslogElements = [el, ...el.querySelectorAll('[jslog]')];
    for (const node of jslogElements) {
      const jslog = node.getAttribute('jslog') || '';
      const match = jslog.match(/c_([a-f0-9]{8,})/i);
      if (match) {
        const userPrefixMatch = window.location.pathname.match(/^\/u\/\d+/);
        const userPrefix = userPrefixMatch ? userPrefixMatch[0] : '';
        return `${window.location.origin}${userPrefix}/app/${match[1]}`;
      }
    }

    return null;
  }

  /**
   * Назначает или возвращает внутренний идентификатор скрытого архивного чата.
   * @param {Element} el
   * @returns {string}
   */
  function ensureArchiveId(el) {
    let id = el.getAttribute(ARCHIVE_ID_ATTR);
    if (!id) {
      archiveIdCounter += 1;
      id = `gemini-arch-${archiveIdCounter}`;
      el.setAttribute(ARCHIVE_ID_ATTR, id);
    }
    return id;
  }

  /**
   * Проверяет, является ли указанный элемент списка текущим открытым чатом.
   * @param {Element} el
   * @returns {boolean}
   */
  function isItemCurrentlyActive(el) {
    if (!el) return false;

    if (
      el.getAttribute('aria-current') === 'page' ||
      el.getAttribute('aria-selected') === 'true' ||
      el.querySelector('[aria-current="page"], [aria-selected="true"]')
    ) {
      return true;
    }

    const activeSelectors =
      '.selected, .active, .is-active, .mat-mdc-list-item-active, .mdc-list-item--activated';
    if (el.matches(activeSelectors) || el.querySelector(activeSelectors)) {
      return true;
    }

    const href = extractChatHref(el);
    if (href) {
      try {
        const itemPath = new URL(href, window.location.origin).pathname;
        if (itemPath && itemPath !== '/' && window.location.pathname === itemPath) {
          return true;
        }
      } catch (_err) {
        // Игнорируем некорректный URL
      }
    }

    return false;
  }

  /**
   * Собирает список всех скрытых архивных чатов для передачи в popup.
   * @returns {Array<{id: string, title: string, displayTitle: string, href: string | null}>}
   */
  function collectArchivedChats() {
    processChatList();

    const items = document.querySelectorAll(`${ITEM_SELECTOR}[${HIDDEN_ATTR}="true"]`);
    const chats = [];

    items.forEach((item) => {
      const id = ensureArchiveId(item);
      const title = extractChatTitle(item);
      const displayTitle = title.startsWith(ARCHIVE_PREFIX)
        ? title.slice(ARCHIVE_PREFIX.length).trim() || title
        : title;

      chats.push({
        id,
        title,
        displayTitle,
        href: extractChatHref(item),
      });
    });

    return chats;
  }

  /**
   * Находит кнопку «Переименовать» внутри открытого меню «трёх точек»
   * по data-test-id или атрибуту иконки (без привязки к текстовому label).
   * @param {Element} menuContainer
   * @returns {HTMLElement | null}
   */
  function findRenameMenuButton(menuContainer) {
    const byTestId = menuContainer.querySelector(
      'button[data-test-id="rename-button"], [data-test-id="rename-button"]'
    );
    if (byTestId && !byTestId.hasAttribute(MENU_ARCHIVE_BTN_ATTR)) {
      return byTestId;
    }

    const menuItems = menuContainer.querySelectorAll(
      'button[mat-menu-item], button.mat-mdc-menu-item, [role="menuitem"]'
    );

    for (const btn of menuItems) {
      if (btn.hasAttribute(MENU_ARCHIVE_BTN_ATTR)) continue;

      const editIcon = btn.querySelector(
        '[fonticon="edit"], [data-mat-icon-name="edit"], gem-icon[fonticonname="edit"]'
      );
      if (editIcon) {
        return btn;
      }
    }

    return null;
  }

  /**
   * Создаёт кнопку «Архивировать» путём клонирования нативной кнопки «Переименовать»,
   * сохраняя все scoped-атрибуты Angular (_ngcontent-*) и стили меню Gemini.
   * @param {HTMLElement} renameBtn
   * @returns {HTMLElement}
   */
  function createArchiveMenuButton(renameBtn) {
    const btn = renameBtn.cloneNode(true);
    btn.setAttribute(MENU_ARCHIVE_BTN_ATTR, 'true');
    btn.setAttribute('data-test-id', 'archive-button');
    btn.removeAttribute('jslog');
    btn.classList.remove(
      'cdk-focused',
      'cdk-program-focused',
      'cdk-mouse-focused',
      'cdk-keyboard-focused'
    );

    // Обновляем иконку на schedule (lumi-symbols)
    const gemIcon = btn.querySelector('gem-icon');
    if (gemIcon) {
      gemIcon.setAttribute('fonticonname', 'schedule');
    }

    const matIcon = btn.querySelector('mat-icon');
    if (matIcon) {
      matIcon.setAttribute('fonticon', 'schedule');
      matIcon.setAttribute('data-mat-icon-name', 'schedule');
      matIcon.setAttribute('data-mat-icon-namespace', 'lumi-symbols');
      matIcon.textContent = '';
    }

    // Обновляем текст пункта меню
    const labelEl = btn.querySelector('.gem-menu-item-label');
    if (labelEl) {
      labelEl.textContent = ' Архивировать ';
    } else {
      const textWrap = btn.querySelector('.mat-mdc-menu-item-text');
      if (textWrap) {
        const span = document.createElement('span');
        span.className = 'gds-body-m gem-menu-item-label';
        span.textContent = ' Архивировать ';
        textWrap.appendChild(span);
      }
    }

    btn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      automateChatArchiving(renameBtn);
    });

    return btn;
  }

  /**
   * Внедряет кнопку «Архивировать» строго после кнопки «Переименовать»
   * и удаляет устаревший дубликат, если Angular переиспользовал контейнер меню.
   */
  function injectArchiveMenuButtons() {
    const menus = document.querySelectorAll('.mat-mdc-menu-content, [role="menu"]');

    menus.forEach((menu) => {
      const renameBtn = findRenameMenuButton(menu);
      const existingBtn = menu.querySelector(`[${MENU_ARCHIVE_BTN_ATTR}="true"]`);

      if (!renameBtn) {
        if (existingBtn) {
          existingBtn.remove();
        }
        return;
      }

      // Если кнопка уже стоит сразу после renameBtn — ничего не меняем
      if (existingBtn && renameBtn.nextElementSibling === existingBtn) {
        return;
      }

      if (existingBtn) {
        existingBtn.remove();
      }

      const archiveBtn = createArchiveMenuButton(renameBtn);
      renameBtn.insertAdjacentElement('afterend', archiveBtn);
    });
  }

  /**
   * Проверяет, что кнопка видима и активна (не disabled и не aria-disabled).
   * @param {Element | null} btn
   * @returns {btn is HTMLButtonElement}
   */
  function isActionButtonEnabled(btn) {
    return (
      btn instanceof HTMLButtonElement &&
      !btn.disabled &&
      btn.getAttribute('aria-disabled') !== 'true' &&
      btn.offsetParent !== null
    );
  }

  /**
   * Проверяет, является ли кнопка кнопкой отмены/закрытия диалога.
   * @param {Element} btn
   * @returns {boolean}
   */
  function isCancelDialogButton(btn) {
    const testId = (btn.getAttribute('data-test-id') || '').toLowerCase();
    return (
      btn.hasAttribute('mat-dialog-close') ||
      testId === 'cancel-button' ||
      testId === 'close-button'
    );
  }

  /**
   * Находит активную кнопку подтверждения в диалоге переименования,
   * гарантированно исключая кнопку отмены.
   * @param {Element} dialog
   * @returns {HTMLButtonElement | null}
   */
  function findRenameConfirmButton(dialog) {
    const explicitCandidates = dialog.querySelectorAll(
      'button[data-test-id="save-button"], button[data-test-id="confirm-button"], button[data-test-id="rename-button"], button[type="submit"]'
    );
    for (const btn of explicitCandidates) {
      if (isActionButtonEnabled(btn) && !isCancelDialogButton(btn)) {
        return btn;
      }
    }

    // Берём последнюю кнопку в блоке действий только если их >= 2 (Отмена + Подтвердить)
    const actionButtons = Array.from(
      dialog.querySelectorAll('mat-dialog-actions button, .mat-mdc-dialog-actions button')
    );

    if (actionButtons.length >= 2) {
      const confirmCandidate = actionButtons[actionButtons.length - 1];
      if (isActionButtonEnabled(confirmCandidate) && !isCancelDialogButton(confirmCandidate)) {
        return confirmCandidate;
      }
    }

    return null;
  }

  /**
   * Устанавливает значение input/textarea так, чтобы его подхватили Angular FormControl / ngModel.
   * @param {HTMLInputElement | HTMLTextAreaElement} input
   * @param {string} value
   */
  function setAngularInputValue(input, value) {
    const proto =
      input instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

    input.focus();
    if (nativeSetter) {
      nativeSetter.call(input, value);
    } else {
      input.value = value;
    }

    if (typeof InputEvent === 'function') {
      input.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          data: value,
          inputType: 'insertText',
        })
      );
    } else {
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
  }

  /**
   * Автоматизирует архивацию: открывает штатный диалог переименования,
   * дожидается загрузки текущего названия, добавляет префикс [\A\] и подтверждает сохранение.
   * @param {HTMLElement} renameBtn
   */
  async function automateChatArchiving(renameBtn) {
    if (isArchivingInProgress) return;
    isArchivingInProgress = true;

    try {
      // Открываем штатное окно переименования Gemini
      renameBtn.click();

      // Ждём появления диалогового окна и поля ввода названия
      const dialogContext = await waitForCondition(() => {
        const dialogs = document.querySelectorAll(
          'mat-dialog-container, .mat-mdc-dialog-container, [role="dialog"]'
        );
        for (const dialog of dialogs) {
          const input = dialog.querySelector('input[type="text"], input:not([type]), textarea');
          if (input && input.offsetParent !== null) {
            return { dialog, input };
          }
        }
        return null;
      }, 3000);

      if (!dialogContext) {
        console.warn('[Gemini Archive Hider] Не удалось найти диалог переименования.');
        return;
      }

      const { dialog, input } = dialogContext;

      // Даём Angular заполнить исходное название чата в поле ввода
      await waitForCondition(() => ((input.value || '').trim().length > 0 ? true : null), 600);

      const currentTitle = (input.value || '').trim();
      if (!currentTitle.startsWith(ARCHIVE_PREFIX)) {
        const archivedTitle = currentTitle
          ? `${ARCHIVE_PREFIX} ${currentTitle}`
          : ARCHIVE_PREFIX;
        setAngularInputValue(input, archivedTitle);
      }

      // Ждём тик рендера, чтобы Angular обновил состояние формы и разблокировал кнопку сохранения
      await new Promise((resolve) => window.requestAnimationFrame(resolve));

      const confirmBtn = await waitForCondition(() => findRenameConfirmButton(dialog), 2000);
      if (confirmBtn) {
        confirmBtn.click();
      } else {
        input.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
        );
      }
    } catch (error) {
      console.error('[Gemini Archive Hider] Ошибка при автоматической архивации чата:', error);
    } finally {
      isArchivingInProgress = false;
    }
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
   * Сканирует список элементов <gem-nav-list-item>, скрывает/показывает их и обновляет меню чатов.
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

      injectArchiveMenuButtons();
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
