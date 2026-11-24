/**
 * Скрипт выпадающей панели (popup) для просмотра и открытия архивных чатов Gemini.
 */

(() => {
  'use strict';

  const extApi = typeof browser !== 'undefined' ? browser : chrome;

  const chatListEl = document.getElementById('chat-list');
  const statusEl = document.getElementById('status-message');
  const countEl = document.getElementById('chat-count');
  const refreshBtn = document.getElementById('refresh-btn');
  const searchBoxEl = document.getElementById('search-box');
  const searchInputEl = document.getElementById('search-input');

  let activeTabId = null;
  let allArchivedChats = [];

  /**
   * Показывает текстовое состояние (загрузка, пусто, ошибка) и скрывает список.
   * @param {string} text
   */
  function showStatus(text) {
    statusEl.textContent = text;
    statusEl.hidden = false;
    chatListEl.hidden = true;
  }

  /**
   * Отрисовывает список архивных чатов с учётом фильтра поиска.
   * @param {Array<{id: string, title: string, displayTitle: string, href: string | null}>} chats
   */
  function renderChats(chats) {
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

      const titleSpan = document.createElement('span');
      titleSpan.className = 'chat-title';
      titleSpan.textContent = chat.displayTitle;

      const arrowSpan = document.createElement('span');
      arrowSpan.className = 'chat-arrow';
      arrowSpan.textContent = '→';

      btn.appendChild(titleSpan);
      btn.appendChild(arrowSpan);

      btn.addEventListener('click', () => handleOpenChat(chat));

      li.appendChild(btn);
      chatListEl.appendChild(li);
    });
  }

  /**
   * Отправляет контент-скрипту команду открыть выбранный архивный чат.
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

  refreshBtn.addEventListener('click', loadArchivedChats);
  searchInputEl.addEventListener('input', applySearchFilter);

  loadArchivedChats();
})();
