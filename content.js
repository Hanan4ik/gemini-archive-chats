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

  /**
   * Проверяет, соответствует ли элемент критериям чата (если включена строгая проверка класса).
   * @param {Element} element
   * @returns {boolean}
   */
  function isTargetChatElement(element) {
    if (!STRICT_ANGULAR_CLASS_CHECK) {
      return true;
    }

    // Проверяем классы на самом элементе и на его ближайших дочерних элементах
    const hasMatchingClass = (el) =>
      Array.from(el.classList).some((cls) => CHAT_CLASS_REGEX.test(cls));

    if (hasMatchingClass(element)) {
      return true;
    }

    const childWithClass = element.querySelector('[class*="ng-tns-c"]');
    return childWithClass ? hasMatchingClass(childWithClass) : false;
  }

  /**
   * Извлекает чистый текст названия чата, игнорируя иконки (<mat-icon>, <svg>) и кнопки меню,
   * чтобы лигатуры иконок (например, "chat_bubble") не мешали проверке начала строки.
   * @param {Element} item
   * @returns {string}
   */
  function extractChatTitle(item) {
    try {
      const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;

          // Пропускаем текст внутри иконок, кнопок действий и скрытых декоративных элементов
          if (
            parent.closest(
              'mat-icon, svg, button, [aria-hidden="true"], .mat-icon, .google-symbols'
            )
          ) {
            return NodeFilter.FILTER_REJECT;
          }

          return node.textContent.trim().length > 0
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        },
      });

      const textParts = [];
      let currentNode = walker.nextNode();
      while (currentNode) {
        textParts.push(currentNode.textContent.trim());
        currentNode = walker.nextNode();
      }

      const extracted = textParts.join(' ').trim();
      if (extracted) {
        return extracted;
      }

      // Резервный вариант, если текст хранится в атрибутах доступности
      return (
        item.getAttribute('aria-label') ||
        item.getAttribute('title') ||
        item.textContent ||
        ''
      ).trim();
    } catch (error) {
      console.error('[Gemini Archive Hider] Ошибка при чтении названия чата:', error);
      return '';
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

        if (shouldHide && !isAlreadyHidden) {
          item.style.setProperty('display', 'none', 'important');
          item.setAttribute(HIDDEN_ATTR, 'true');
        } else if (!shouldHide && isAlreadyHidden) {
          // Возвращаем отображение, если чат переименовали или Angular переиспользовал DOM-узел
          item.style.removeProperty('display');
          item.removeAttribute(HIDDEN_ATTR);
        }
      });
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
