(function() {
    'use strict';

    const realWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

    //localStorage.setItem('__PATCH_ASSET_BASE__', 'https://raw.githubusercontent.com/rlchens/real-classic/refs/heads/main/');
    localStorage.setItem('__PATCH_ASSET_BASE__', chrome.runtime.getURL('/'));
    localStorage.setItem('__PATCH_ASSET_BASE_2__', chrome.runtime.getURL('/'));

    (function removeCSPMeta() {
        'use strict';
        
        document.querySelectorAll('meta[http-equiv="Content-Security-Policy"]').forEach(meta => {
            meta.remove();
        });
        
        const origSetAttribute = HTMLMetaElement.prototype.setAttribute;
        HTMLMetaElement.prototype.setAttribute = function(name, value) {
            if (name.toLowerCase() === 'http-equiv' && value.toLowerCase() === 'content-security-policy') {
                console.log('[CSP] Blocked meta injection');
                return;
            }
            return origSetAttribute.call(this, name, value);
        };
        
        console.log('[CSP] Meta remover installed');
    })();

    (function setupBridge() {
        const BRIDGE_ID = 'real-classic-proxy-bridge';
        
        realWindow.addEventListener('message', (event) => {
            if (event.source !== window) return;
            if (!event.data?.type?.startsWith('REAL_CLASSIC_')) return;
            
            const { type, payload, requestId } = event.data;
            
            if (type === 'REAL_CLASSIC_PROXY_REQUEST' && payload?.url) {
                // Пересылаем в background.js
                chrome.runtime.sendMessage(
                    { type: 'PROXY_FETCH', url: payload.url, method: payload.method, headers: payload.headers },
                    response => {
                        window.postMessage({
                            type: 'REAL_CLASSIC_PROXY_RESPONSE',
                            requestId,
                            payload: response
                        }, '*');
                    }
                );
            }
        });
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
                        
                        const extensionUrl = chrome.runtime.getURL('patched_main.js');
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
                        node.src = chrome.runtime.getURL('patched_main.js');
                    }
                }
            });
        });
    }).observe(document.documentElement, { childList: true, subtree: true });

})();