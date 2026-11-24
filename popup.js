/**
 * Скрипт выпадающей панели (popup) для просмотра и управления архивными чатами Gemini.
 * Поддерживает:
 * - ЛКМ: открыть чат в текущей вкладке
 * - СКМ (средняя кнопка мыши): открыть чат в новой вкладке
 * - ПКМ (правая кнопка мыши): контекстное окно действий (открыть, в новой вкладке, деархивировать)
 * - Локализацию через browser.i18n
 */

(() => {
  'use strict';

  const extApi = typeof browser !== 'undefined' ? browser : chrome;

  /**
   * Возвращает локализованную строку по ключу из _locales/{lang}/messages.json.
   * @param {string} key
   * @param {string | string[]} [substitutions]
   * @param {string} [fallback='']
   * @returns {string}
   */
  function t(key, substitutions, fallback = '') {
    try {
      const msg = extApi?.i18n?.getMessage?.(key, substitutions);
      if (msg) return msg;
    } catch (_err) {
      // Игнорируем ошибку и возвращаем fallback
    }
    return fallback || key;
  }

  /**
   * Применяет локализацию ко всем статическим элементам popup.html.
   */
  function applyLocalization() {
    try {
      const uiLang = extApi?.i18n?.getUILanguage?.();
      if (uiLang) {
        document.documentElement.lang = uiLang;
      }
    } catch (_err) {
      // Оставляем язык по умолчанию
    }

    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (key) {
        el.textContent = t(key, undefined, el.textContent || '');
      }
    });

    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
      const key = el.getAttribute('data-i18n-title');
      if (key) {
        el.setAttribute('title', t(key, undefined, el.getAttribute('title') || ''));
      }
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (key) {
        el.setAttribute('placeholder', t(key, undefined, el.getAttribute('placeholder') || ''));
      }
    });

    document.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
      const key = el.getAttribute('data-i18n-aria-label');
      if (key) {
        el.setAttribute('aria-label', t(key, undefined, el.getAttribute('aria-label') || ''));
      }
    });
  }

  const chatListEl = document.getElementById('chat-list');
  const chatListContainerEl = document.getElementById('chat-list-container');
  const statusEl = document.getElementById('status-message');
  const countEl = document.getElementById('chat-count');
  const refreshBtn = document.getElementById('refresh-btn');
  const searchBoxEl = document.getElementById('search-box');
  const searchInputEl = document.getElementById('search-input');

  const contextMenuEl = document.getElementById('context-menu');
  const contextMenuTitleEl = document.getElementById('context-menu-title');
  const ctxOpenChatBtn = document.getElementById('ctx-open-chat');
  const ctxOpenNewTabBtn = document.getElementById('ctx-open-new-tab');
  const ctxUnarchiveChatBtn = document.getElementById('ctx-unarchive-chat');

  let activeTabId = null;
  let activeTabOrigin = 'https://gemini.google.com';
  let allArchivedChats = [];
  let contextMenuChat = null;
  let contextActiveBtn = null;
  let isUnarchiving = false;

  /**
   * Показывает текстовое состояние (загрузка, пусто, ошибка) и скрывает список.
   * @param {string} text
   */
  function showStatus(text) {
    closeContextMenu();
    statusEl.textContent = text;
    statusEl.hidden = false;
    chatListEl.hidden = true;
  }

  /**
   * Преобразует ссылку чата в полный абсолютный URL.
   * @param {{href: string | null}} chat
   * @returns {string | null}
   */
  function resolveChatUrl(chat) {
    if (!chat || !chat.href) return null;
    try {
      return new URL(chat.href, activeTabOrigin).href;
    } catch (_err) {
      return null;
    }
  }

  /**
   * Закрывает контекстное окно действий и снимает выделение с элемента списка.
   */
  function closeContextMenu() {
    contextMenuEl.hidden = true;
    contextMenuChat = null;
    if (contextActiveBtn) {
      contextActiveBtn.classList.remove('is-context-active');
      contextActiveBtn = null;
    }
  }

  /**
   * Открывает контекстное окно действий рядом с курсором, не выходя за границы popup.
   * @param {MouseEvent} event
   * @param {{id: string, title: string, displayTitle: string, href: string | null}} chat
   * @param {HTMLButtonElement} btnEl
   */
  function openContextMenu(event, chat, btnEl) {
    event.preventDefault();
    event.stopPropagation();

    closeContextMenu();

    contextMenuChat = chat;
    contextActiveBtn = btnEl;
    contextActiveBtn.classList.add('is-context-active');

    contextMenuTitleEl.textContent = chat.displayTitle;
    contextMenuTitleEl.title = chat.displayTitle;

    const hasUrl = Boolean(resolveChatUrl(chat));
    ctxOpenNewTabBtn.disabled = !hasUrl;
    ctxOpenNewTabBtn.title = hasUrl
      ? t('openChatInNewTabTitle', undefined, 'Open chat in a new tab')
      : t('chatUrlUnavailable', undefined, 'Chat link is unavailable');

    ctxUnarchiveChatBtn.disabled = isUnarchiving;

    // Показываем меню, чтобы измерить его размеры и корректно вписать в окно
    contextMenuEl.style.left = '0px';
    contextMenuEl.style.top = '0px';
    contextMenuEl.hidden = false;

    const menuRect = contextMenuEl.getBoundingClientRect();
    const margin = 8;
    const maxX = Math.max(margin, window.innerWidth - menuRect.width - margin);
    const maxY = Math.max(margin, window.innerHeight - menuRect.height - margin);

    const posX = Math.min(Math.max(margin, event.clientX), maxX);
    const posY = Math.min(Math.max(margin, event.clientY), maxY);

    contextMenuEl.style.left = `${posX}px`;
    contextMenuEl.style.top = `${posY}px`;
  }

  /**
   * Создаёт SVG-иконку чата в стиле боковой панели Gemini.
   * @returns {SVGSVGElement}
   */
  function createChatIcon() {
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'chat-icon');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');

    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute(
      'd',
      'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'
    );
    svg.appendChild(path);
    return svg;
  }

  /**
   * Отрисовывает список архивных чатов с учётом фильтра поиска.
   * @param {Array<{id: string, title: string, displayTitle: string, href: string | null}>} chats
   */
  function renderChats(chats) {
    closeContextMenu();
    chatListEl.textContent = '';

    if (chats.length === 0) {
      showStatus(
        allArchivedChats.length === 0
          ? t(
              'noArchivedChats',
              undefined,
              'No archived chats (with the [\\A\\] prefix) found on this page.'
            )
          : t('noSearchResults', undefined, 'No chats match your search.')
      );
      return;
    }

    statusEl.hidden = true;
    chatListEl.hidden = false;

    chats.forEach((chat) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chat-item-btn';
      btn.title = chat.title;

      const icon = createChatIcon();

      const titleSpan = document.createElement('span');
      titleSpan.className = 'chat-title';
      titleSpan.textContent = chat.displayTitle;

      btn.appendChild(icon);
      btn.appendChild(titleSpan);

      // ЛКМ: открыть чат в текущей вкладке
      btn.addEventListener('click', () => {
        closeContextMenu();
        handleOpenChat(chat);
      });

      // Отключаем режим автопрокрутки Firefox при нажатии средней кнопки мыши
      btn.addEventListener('mousedown', (event) => {
        if (event.button === 1) {
          event.preventDefault();
        }
      });

      // СКМ: открыть чат в новой вкладке
      btn.addEventListener('auxclick', (event) => {
        if (event.button === 1) {
          event.preventDefault();
          closeContextMenu();
          handleOpenChatInNewTab(chat, { active: false });
        }
      });

      // ПКМ: открыть контекстное окно действий
      btn.addEventListener('contextmenu', (event) => {
        openContextMenu(event, chat, btn);
      });

      li.appendChild(btn);
      chatListEl.appendChild(li);
    });
  }

  /**
   * Отправляет контент-скрипту команду открыть выбранный архивный чат в текущей вкладке.
   * @param {{id: string, title: string, displayTitle: string, href: string | null}} chat
   */
  async function handleOpenChat(chat) {
    if (!activeTabId) return;

    try {
      const response = await extApi.tabs.sendMessage(activeTabId, {
        type: 'OPEN_ARCHIVED_CHAT',
        payload: {
          id: chat.id,
          title: chat.title,
          href: chat.href,
        },
      });

      if (response && response.ok) {
        window.close();
      } else {
        showStatus(t('errorOpenChat', undefined, 'Could not open the chat. Try refreshing the list.'));
      }
    } catch (error) {
      console.error('[Gemini Archive Popup] Ошибка при открытии чата:', error);
      showStatus(
        t(
          'errorNoConnection',
          undefined,
          'No connection to the Gemini page. Refresh the tab and try again.'
        )
      );
    }
  }

  /**
   * Открывает архивный чат в новой вкладке браузера.
   * @param {{id: string, title: string, displayTitle: string, href: string | null}} chat
   * @param {{active?: boolean}} [options]
   */
  async function handleOpenChatInNewTab(chat, options = {}) {
    const url = resolveChatUrl(chat);
    if (!url) {
      showStatus(
        t('errorNoUrlForNewTab', undefined, 'Could not get a link to open this chat in a new tab.')
      );
      return;
    }

    const active = Boolean(options.active);

    try {
      await extApi.tabs.create({ url, active });
      if (active) {
        window.close();
      }
    } catch (error) {
      console.error('[Gemini Archive Popup] Ошибка при открытии новой вкладки:', error);
      showStatus(t('errorOpenNewTab', undefined, 'Could not open a new tab.'));
    }
  }

  /**
   * Отправляет контент-скрипту команду деархивировать выбранный чат (убрать префикс [\A\]).
   * @param {{id: string, title: string, displayTitle: string, href: string | null}} chat
   */
  async function handleUnarchiveChat(chat) {
    if (!activeTabId || isUnarchiving) return;

    isUnarchiving = true;
    showStatus(
      t('statusUnarchiving', [chat.displayTitle], `Unarchiving chat “${chat.displayTitle}”…`)
    );

    try {
      const response = await extApi.tabs.sendMessage(activeTabId, {
        type: 'UNARCHIVE_CHAT',
        payload: {
          id: chat.id,
          title: chat.title,
          href: chat.href,
        },
      });

      if (response && response.ok) {
        if (Array.isArray(response.chats)) {
          allArchivedChats = response.chats;
          countEl.textContent = String(allArchivedChats.length);
          searchBoxEl.hidden = allArchivedChats.length === 0;
          applySearchFilter();
        } else {
          await loadArchivedChats();
        }
      } else {
        showStatus(
          t(
            'errorUnarchiveChat',
            undefined,
            'Could not unarchive the chat. Open the Gemini sidebar and try again.'
          )
        );
      }
    } catch (error) {
      console.error('[Gemini Archive Popup] Ошибка при деархивации чата:', error);
      showStatus(
        t(
          'errorNoConnection',
          undefined,
          'No connection to the Gemini page. Refresh the tab and try again.'
        )
      );
    } finally {
      isUnarchiving = false;
    }
  }

  /**
   * Загружает список архивных чатов из активной вкладки gemini.google.com.
   */
  async function loadArchivedChats() {
    showStatus(t('loadingChats', undefined, 'Loading archived chats…'));
    countEl.textContent = '0';
    searchBoxEl.hidden = true;

    try {
      const tabs = await extApi.tabs.query({ active: true, currentWindow: true });
      const activeTab = tabs && tabs[0];

      if (!activeTab || !activeTab.id) {
        showStatus(t('errorNoActiveTab', undefined, 'Could not determine the active tab.'));
        return;
      }

      if (!activeTab.url || !activeTab.url.startsWith('https://gemini.google.com/')) {
        showStatus(
          t(
            'openGeminiPrompt',
            undefined,
            'Open a gemini.google.com tab to view archived chats.'
          )
        );
        return;
      }

      if (!activeTab.url || !activeTab.url.startsWith('https://gemini.google.com/')) {
        showStatus('Откройте вкладку gemini.google.com, чтобы увидеть архивные чаты.');
        return;
      }

      activeTabId = activeTab.id;
      try {
        activeTabOrigin = new URL(activeTab.url).origin;
      } catch (_err) {
        activeTabOrigin = 'https://gemini.google.com';
      }

      const response = await extApi.tabs.sendMessage(activeTabId, {
        type: 'GET_ARCHIVED_CHATS',
      });

      allArchivedChats = Array.isArray(response?.chats) ? response.chats : [];
      countEl.textContent = String(allArchivedChats.length);
      searchBoxEl.hidden = allArchivedChats.length === 0;

      applySearchFilter();
    } catch (error) {
      console.error('[Gemini Archive Popup] Ошибка при загрузке чатов:', error);
      showStatus(
        t(
          'refreshGeminiPrompt',
          undefined,
          'Refresh the gemini.google.com page to activate the extension.'
        )
      );
    }
  }

  /**
   * Фильтрует отображаемый список по строке поиска.
   */
  function applySearchFilter() {
    const query = searchInputEl.value.trim().toLowerCase();
    if (!query) {
      renderChats(allArchivedChats);
      return;
    }

    const filtered = allArchivedChats.filter((chat) =>
      chat.displayTitle.toLowerCase().includes(query)
    );
    renderChats(filtered);
  }

  // Действия контекстного меню
  ctxOpenChatBtn.addEventListener('click', () => {
    const chat = contextMenuChat;
    closeContextMenu();
    if (chat) {
      handleOpenChat(chat);
    }
  });

  ctxOpenNewTabBtn.addEventListener('click', () => {
    const chat = contextMenuChat;
    closeContextMenu();
    if (chat) {
      handleOpenChatInNewTab(chat, { active: true });
    }
  });

  ctxUnarchiveChatBtn.addEventListener('click', () => {
    const chat = contextMenuChat;
    closeContextMenu();
    if (chat) {
      handleUnarchiveChat(chat);
    }
  });

  // Закрытие контекстного меню при клике вне его, нажатии Escape или прокрутке
  document.addEventListener('click', (event) => {
    if (!contextMenuEl.hidden && !contextMenuEl.contains(event.target)) {
      closeContextMenu();
    }
  });

  document.addEventListener('contextmenu', (event) => {
    if (!event.target.closest('.chat-item-btn')) {
      closeContextMenu();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !contextMenuEl.hidden) {
      closeContextMenu();
    }
  });

  chatListContainerEl.addEventListener('scroll', closeContextMenu);

  refreshBtn.addEventListener('click', loadArchivedChats);
  searchInputEl.addEventListener('input', applySearchFilter);

  applyLocalization();
  loadArchivedChats();
})();
