/**
 * Скрипт выпадающей панели (popup) для просмотра и управления архивными чатами Gemini.
 * Поддерживает:
 * - ЛКМ: открыть чат в текущей вкладке
 * - СКМ (средняя кнопка мыши): открыть чат в новой вкладке
 * - ПКМ (правая кнопка мыши): контекстное окно действий (открыть, в новой вкладке, деархивировать)
 */

(() => {
  'use strict';

  const extApi = typeof browser !== 'undefined' ? browser : chrome;

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
      ? 'Открыть чат в новой вкладке'
      : 'Ссылка на чат недоступна';

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
          ? 'Архивных чатов (с префиксом [\\A\\]) на странице не найдено. Если список длинный, прокрутите боковую панель Gemini.'
          : 'Ничего не найдено по вашему запросу.'
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
        showStatus('Не удалось открыть чат. Попробуйте обновить список.');
      }
    } catch (error) {
      console.error('[Gemini Archive Popup] Ошибка при открытии чата:', error);
      showStatus('Нет связи со страницей Gemini. Обновите вкладку и повторите попытку.');
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
      showStatus('Не удалось получить ссылку на этот чат для открытия в новой вкладке.');
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
      showStatus('Не удалось открыть новую вкладку.');
    }
  }

  /**
   * Отправляет контент-скрипту команду деархивировать выбранный чат (убрать префикс [\A\]).
   * @param {{id: string, title: string, displayTitle: string, href: string | null}} chat
   */
  async function handleUnarchiveChat(chat) {
    if (!activeTabId || isUnarchiving) return;

    isUnarchiving = true;
    showStatus(`Деархивация чата «${chat.displayTitle}»…`);

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
        showStatus('Не удалось деархивировать чат. Откройте боковую панель Gemini и повторите попытку.');
      }
    } catch (error) {
      console.error('[Gemini Archive Popup] Ошибка при деархивации чата:', error);
      showStatus('Нет связи со страницей Gemini. Обновите вкладку и повторите попытку.');
    } finally {
      isUnarchiving = false;
    }
  }

  /**
   * Загружает список архивных чатов из активной вкладки gemini.google.com.
   */
  async function loadArchivedChats() {
    showStatus('Загрузка архивных чатов…');
    countEl.textContent = '0';
    searchBoxEl.hidden = true;

    try {
      const tabs = await extApi.tabs.query({ active: true, currentWindow: true });
      const activeTab = tabs && tabs[0];

      if (!activeTab || !activeTab.id) {
        showStatus('Не удалось определить активную вкладку.');
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
      showStatus('Обновите страницу gemini.google.com, чтобы активировать расширение.');
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

  loadArchivedChats();
})();
