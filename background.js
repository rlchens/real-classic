let connectedTabId = null;

console.log('[CDP BG] Background ready');

// === Включить Network API и слушать все запросы ===
async function initCDPInterceptor(tabId) {
    if (connectedTabId === tabId) return;
    
    try {
        connectedTabId = tabId;
        
        // Подключаемся к вкладке
        await new Promise((resolve, reject) => {
            chrome.debugger.attach({ tabId }, '1.3', () => {
                if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
                
                console.log('[CDP] Debugger attached');
                
                // Включаем Network API
                chrome.debugger.sendCommand(
                    { tabId }, 
                    'Network.enable', 
                    () => {
                        console.log('[CDP] Network API enabled');
                        
                        // Слушаем все сетевые запросы
                        resolve();
                    }
                );
            });
        });
        
        // === СЛУШАЕМ СЕТЬ ===
        chrome.debugger.onEvent.addListener(async (source, method, params) => {
            
            // === 1. ПЕРЕХВАТ ЗАПРОСОВ ===
            if (method === 'Network.requestWillBeSent') {
                const url = params.request.url;
                
                // Проверяем что это .3ds или .a3d файл
                if (/\.3ds$|\.a3d$|\.w3x$/i.test(url)) {
                    console.log('[CDP] Intercepting asset:', url);
                    
                    // Блокируем оригинальный запрос
                    await chrome.debugger.sendCommand(
                        { tabId: source.tabId },
                        'Network.abort',
                        { requestId: params.requestId }
                    );
                    
                    // Загружаем локальную версию
                    const localAsset = await loadLocalAsset();
                    
                    // Отправляем данные обратно
                    const responseHeaders = [
                        { name: 'Content-Type', value: 'application/octet-stream' },
                        { name: 'Content-Length', value: String(localAsset.byteLength) },
                        { name: 'Access-Control-Allow-Origin', value: '*' },
                        { name: 'Cache-Control', value: 'no-cache' }
                    ];
                    
                    await chrome.debugger.sendCommand(
                        { tabId: source.tabId },
                        'Network.setCacheDisabled',
                        { cacheDisabled: true }
                    );
                    
                    // Создаём fake ответ из Blob
                    const blob = new Blob([localAsset]);
                    const reader = new FileReader();
                    
                    reader.onloadend = async function() {
                        const arrayBuffer = reader.result;
                        
                        const base64Data = btoa(
                            new Uint8Array(arrayBuffer).reduce(
                                (data, byte) => data + String.fromCharCode(byte), 
                                ''
                            )
                        );
                        
                        await chrome.debugger.sendCommand(
                            { tabId: source.tabId },
                            'Network.fulfillRequest',
                            {
                                requestId: params.requestId,
                                responseCode: 200,
                                responsePhrase: 'OK',
                                responseHeaders: responseHeaders,
                                body: base64Data
                            }
                        );
                        
                        console.log('[CDP] Local asset sent:', localAsset.byteLength, 'bytes');
                    };
                    
                    reader.readAsBinaryString(blob);
                }
            }
            
            // === ОБРАБОТКА OTHER EVENTS ===
            if (method === 'ServiceWorker.versionUpdateAvailable') {
                console.log('[CDP] SW update available - ignoring...');
            }
        });
        
        // Отключаем кэш браузера для этих файлов
        await chrome.debugger.sendCommand(
            { tabId },
            'Network.setCacheDisabled',
            { cacheDisabled: true }
        );
        
        console.log('[CDP BG] Asset interception active');
        
    } catch (err) {
        console.error('[CDP BG] Error connecting:', err);
        throw err;
    }
}

// === ФУНКЦИЯ: Загрузка локального файла из расширения ===
async function loadLocalAsset() {
    try {
        // Получаем ID расширения
        const extId = chrome.runtime.id;
        const assetUrl = `chrome-extension://${extId}/assets/object.3ds`;
        
        // Читаем файл из расширения
        const response = await fetch(assetUrl);
        
        if (!response.ok) {
            console.error('[CDP] Failed to load local asset:', response.statusText);
            // Возвращаем пустой массив если файл не найден
            return new ArrayBuffer(0);
        }
        
        return await response.arrayBuffer();
    } catch (err) {
        console.error('[CDP] Error loading local asset:', err);
        return new ArrayBuffer(0);
    }
}

// === ПРИ НАВИГАЦИИ ===
chrome.webNavigation.onCommitted.addListener(async (details) => {
    if (details.url.includes('/play/') && details.tabId) {
        console.log('[CDP BG] Navigation detected:', details.url);
        await initCDPInterceptor(details.tabId);
    }
}, { url: [{ hostPrefix: "tankiclassic.com/play/" }] });

// === ПРИ УСТАНОВКЕ ===
chrome.runtime.onInstalled.addListener(() => {
    console.log('[CDP BG] Extension installed');
    
    chrome.tabs.query({}, tabs => {
        tabs.forEach(tab => {
            if (tab.url?.includes('/play/')) {
                initCDPInterceptor(tab.id).catch(err => {
                    console.warn('[CDP] Tab already has debugger:', err);
                });
            }
        });
    });
});

// === ОТСОЕДИНЕНИЕ ===
chrome.debugger.onDetach.addListener((source, reason) => {
    console.log('[CDP] Detached:', reason);
    connectedTabId = null;
});