(function() {
    'use strict';

    console.log('[PATCH] Content script loaded at document_start');

    const realWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

    localStorage.setItem('__PATCH_ASSET_BASE__', 'https://cdn.jsdelivr.net/gh/rlchens/real-classic@main/');
    localStorage.setItem('__PATCH_ASSET_BASE_2__', chrome.runtime.getURL('/'));

    // 🔥 МОСТ: page context ↔ extension context
    (function setupBridge() {
        const BRIDGE_ID = 'real-classic-proxy-bridge';
        
        // 🔹 Слушаем сообщения ОТ страницы (patched_main.js)
        realWindow.addEventListener('message', (event) => {
            if (event.source !== window) return;
            if (!event.data?.type?.startsWith('REAL_CLASSIC_')) return;
            
            const { type, payload, requestId } = event.data;
            
            if (type === 'REAL_CLASSIC_PROXY_REQUEST' && payload?.url) {
                // Пересылаем в background.js
                chrome.runtime.sendMessage(
                    { type: 'PROXY_FETCH', url: payload.url, method: payload.method, headers: payload.headers },
                    response => {
                        // Отправляем ответ обратно в страницу
                        window.postMessage({
                            type: 'REAL_CLASSIC_PROXY_RESPONSE',
                            requestId,
                            payload: response
                        }, '*');
                    }
                );
            }
        });
        
        console.log('[BRIDGE] Content script bridge ready');
    })();

    

    const TARGET_REGEX = /\/play\/static\/js\/main\.[a-f0-9]{8}\.js$/i;
    let patchedMain = false;

    // === 1. ЗАГРУЗКА И ВНЕДРЕНИЕ ШРИФТОВ ===
    // Мы в контексте расширения, поэтому chrome.runtime доступен!
    function injectFonts() {
        const extId = chrome.runtime.id; // ✅ Работает точно!
        
        const fontStyle = document.createElement('style');
        fontStyle.textContent = `
            @font-face {
                font-family: 'Myriad';
                src: url(chrome-extension://${extId}/fonts/myriad.woff2) format('woff2');
                font-weight: normal;
                font-style: normal;
            }
            @font-face {
                font-family: 'Myriad';
                src: url(chrome-extension://${extId}/fonts/myriad-bold.woff2) format('woff2');
                font-weight: bold;
                font-style: normal;
            }
            @font-face {
                font-family: 'Military';
                src: url(chrome-extension://${extId}/fonts/military.woff2) format('woff2');
                font-weight: normal;
                font-style: normal;
            }

            * {
                font-family: 'Myriad', sans-serif !important;
            }
        `;
        
        (document.head || document.documentElement).appendChild(fontStyle);
        console.log('[FONTS] Shtrift vneadeny:', extId);
    }

    injectFonts();


    // === 1. ПОЛНАЯ БЛОКИРОВКА SERVICE WORKER ===
    // Переопределяем register ДО всего
    if ('serviceWorker' in navigator) {
        const originalRegister = navigator.serviceWorker.register;
        navigator.serviceWorker.register = function() {
            console.warn('[PATCH] Blocked SW registration attempt!');
            // Возвращаем фейковый Promise, который никогда не резолвится
            return new Promise(() => {});
        };
        
        // Также блокируем готовность
        Object.defineProperty(navigator.serviceWorker, 'ready', {
            get: function() {
                return new Promise(() => {});
            }
        });
    }

    // === 2. ЖЁСТКИЙ ПЕРЕХВАТ СОЗДАНИЯ СКРИПТОВ ===
    const originalCreateElement = document.createElement;
    
    document.createElement = function(tagName, options) {
        const element = originalCreateElement.call(this, tagName, options);
        
        if (tagName.toLowerCase() === 'script') {
            const descriptor = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
            
            Object.defineProperty(element, 'src', {
                configurable: true,
                get: function() {
                    return this._src || descriptor.get.call(this);
                },
                set: function(value) {
                    if (value && TARGET_REGEX.test(value) && !patchedMain) {
                        patchedMain = true;
                        console.log('[INTERCEPT] Blocking original, loading patch...');
                        
                        const extensionUrl = 'https://cdn.jsdelivr.net/gh/rlchens/real-classic@main/patched_main.min.js';
                        descriptor.set.call(this, extensionUrl);
                        return;
                    }
                    
                    descriptor.set.call(this, value);
                }
            });
        }
        
        return element;
    };

    // === 4. OBSERVER ДЛЯ ДОПОЛНИТЕЛЬНОЙ ЗАЩИТЫ ===
    new MutationObserver(mutations => {
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                if (node.tagName === 'SCRIPT' && node.getAttribute('src')) {
                    const src = node.getAttribute('src');
                    if (TARGET_REGEX.test(src) && !patchedMain) {
                        patchedMain = true;
                        console.log('[OBSERVER] Intercepting:', src);
                        node.src = 'https://cdn.jsdelivr.net/gh/rlchens/real-classic@main/patched_main.min.js';
                    }
                }
            });
        });
    }).observe(document.documentElement, { childList: true, subtree: true });

})();