Gemini Archive Hider

A lightweight Firefox extension (Manifest V3) that adds chat archiving to the Google Gemini web interface without external servers or third-party storage.

Features

Automatic hiding of archived chats: Any chat in the Gemini sidebar whose title begins with [\A\] is automatically hidden from the main conversation list.

Native "Archive" button: Injects an Archive option directly into each chat's three-dots menu (right below Rename), automating the prefix addition through Gemini's native rename dialog.

Gemini-styled Archive popup:

View all archived chats with clean titles (the [\A\] prefix is stripped visually).

Live search and chat counter badge.

Adapts automatically to light and dark themes.

Flexible mouse controls in the popup:

Left-click: Open the chat in the current Gemini tab (preserving SPA state).

Middle-click: Open the chat in a new background tab.

Right-click: Open a context menu with Open chat, Open in new tab, and Unarchive.

"Archived chat" status badge: Displays a floating Material 3 badge in the top-right corner of the page whenever an archived chat is open.

Localization (i18n): Supports English (default) and Russian, automatically matching your Firefox UI language.

How It Works

Google Gemini does not currently have a native archive feature. This extension uses a title prefix ([\A\]) so that archived state is stored natively inside your Google account and stays synced across devices:

content.js watches <gem-nav-list-item> conversation nodes with a MutationObserver and hides items starting with [\A\].

Archiving and unarchiving automate Gemini's built-in Rename modal via DOM events rather than relying on private or obfuscated API endpoints.

popup.js queries the active gemini.google.com tab for hidden conversations and communicates with content.js using browser.tabs.sendMessage.

Installation (Firefox)

Clone or download this repository to a local folder.

Open Firefox and navigate to about:debugging#/runtime/this-firefox.

Click Load Temporary Add-on… and select manifest.json from the extension folder.

Open or reload gemini.google.com.

Note: Temporary add-ons loaded via about:debugging are removed when Firefox restarts. For permanent installation, sign the extension package as an unlisted add-on via Mozilla Add-on Developer Hub.

Usage

Archive a chat: Click the three-dots menu (⋮) next to any chat in the Gemini sidebar and select Archive (or manually rename the chat to start with [\A\]).

Browse archived chats: Click the extension icon in the Firefox toolbar while on gemini.google.com.

Unarchive a chat: Right-click a chat inside the extension popup and choose Unarchive.

Project Structure

gemini-archive/
├── manifest.json             # Manifest V3 configuration (Firefox >= 109.0)
├── content.js                # DOM observer, menu injection, rename automation & badge
├── popup.html                # Archive popup markup
├── popup.css                 # Gemini Material 3 popup styles (light & dark themes)
├── popup.js                  # Popup logic, search, mouse & context menu handlers
├── icon.jpg                  # Extension icon
├── LICENSE                   # MIT License
├── README.md                 # Project documentation
└── _locales/
    ├── en/
    │   └── messages.json     # English strings (default)
    └── ru/
        └── messages.json     # Russian strings


Known Limitations

Lazy loading: Gemini loads older conversations dynamically as you scroll the sidebar. Only archived chats currently loaded in the sidebar DOM will appear in the popup.

UI updates: Because the extension interacts with Gemini's DOM structure and native rename modal, future Google UI changes may require updating selectors in content.js.

Permissions

activeTab — Used only when you open the popup to read the active gemini.google.com tab URL and communicate with the content script.

Content script host match is strictly restricted to https://gemini.google.com/*.

Privacy

This extension runs entirely locally in your browser. It does not collect, store, or transmit personal data, chat contents, or analytics to any third-party servers. All archived states are represented solely through your own chat titles on gemini.google.com.

Disclaimer

This is an independent, unofficial open-source project and is not affiliated with, endorsed by, or sponsored by Google LLC. Google and Gemini are trademarks of Google LLC.

License

This project is licensed under the MIT License — see the LICENSE file for details.
