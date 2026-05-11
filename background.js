// 🔥 background.js — прокси + кеш через Cache API
console.log('[BG] Service Worker started');

const CACHE_NAME = 'real-classic-assets-v1'; // ← Меняй версию для сброса кеша
const MAX_CACHE_SIZE = 1500 * 1024 * 1024; // 500 МБ лимит (опционально)

// 🔹 Инициализация кеша при старте
self.addEventListener('install', () => {
    console.log('[BG] Installing, preparing cache...');
    caches.open(CACHE_NAME).then(cache => {
        console.log('[BG] Cache ready:', CACHE_NAME);
    });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // 🔹 Проверка связи
    if (request.type === 'PING') {
        sendResponse({ pong: true, ts: Date.now() });
        return true;
    }
    
    // 🔹 ПРОКСИ-ЗАПРОС С КЕШИРОВАНИЕМ
    if (request.type === 'PROXY_FETCH' && request.url) {
        console.log(`[BG] 📦 Request: ${request.url}`);
        
        // 1. Сначала пробуем взять из кеша
        caches.open(CACHE_NAME).then(async cache => {
            const cached = await cache.match(request.url);
            
            if (cached) {
                console.log(`[BG] ✅ Cache HIT: ${request.url}`);
                // Возвращаем из кеша
                const arrayBuffer = await cached.arrayBuffer();
                sendResponse({
                    success: true,
                    buffer: Array.from(new Uint8Array(arrayBuffer)),
                    contentType: cached.headers.get('Content-Type') || 'application/octet-stream',
                    status: cached.status,
                    fromCache: true
                });
                return;
            }
            
            console.log(`[BG] ⏳ Cache MISS, fetching: ${request.url}`);
            
            // 2. Если нет в кеше — грузим из сети
            try {
                const response = await fetch(request.url, {
                    method: request.method || 'GET',
                    headers: request.headers || {},
                    cache: 'force-cache', // Позволяем браузеру тоже кешировать
                    mode: 'cors'
                });
                
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                
                // 3. Клонируем ответ: один для отправки, один для кеша
                const responseClone = response.clone();
                const arrayBuffer = await response.arrayBuffer();
                
                // 4. Сохраняем в Cache API
                await cache.put(request.url, responseClone);
                console.log(`[BG] 💾 Cached: ${request.url}`);
                
                // 5. Отправляем данные
                sendResponse({
                    success: true,
                    buffer: Array.from(new Uint8Array(arrayBuffer)),
                    contentType: response.headers.get('Content-Type') || 'application/octet-stream',
                    status: response.status,
                    fromCache: false
                });
                
                // 6. (Опционально) Контроль размера кеша
                await enforceCacheLimit(MAX_CACHE_SIZE);
                
            } catch (error) {
                console.error(`[BG] ❌ Fetch failed: ${request.url}`, error);
                sendResponse({ success: false, error: error.message });
            }
        }).catch(err => {
            console.error('[BG] Cache error:', err);
            sendResponse({ success: false, error: 'Cache API failed' });
        });
        
        // 🔥 КРИТИЧНО: вернуть true для асинхронного ответа!
        return true;
    }
});

// 🔹 Очистка старого кеша при обновлении версии
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(names => {
            return Promise.all(
                names.filter(name => name !== CACHE_NAME)
                     .map(name => caches.delete(name))
            );
        })
    );
});

// 🔹 (Опционально) Ограничение размера кеша
async function enforceCacheLimit(maxBytes) {
    try {
        const cache = await caches.open(CACHE_NAME);
        const keys = await cache.keys();
        let totalSize = 0;
        const items = [];
        
        // Считаем размер каждого элемента
        for (const key of keys) {
            const response = await cache.match(key);
            if (response) {
                const blob = await response.blob();
                items.push({ url: key.url, size: blob.size });
                totalSize += blob.size;
            }
        }
        
        // Удаляем самые старые, если превышен лимит
        if (totalSize > maxBytes) {
            items.sort((a, b) => a.size - b.size); // Сначала маленькие
            for (const item of items) {
                if (totalSize <= maxBytes) break;
                await cache.delete(item.url);
                totalSize -= item.size;
                console.log(`[BG] 🗑️ Evicted: ${item.url} (${item.size} bytes)`);
            }
        }
    } catch (e) {
        console.warn('[BG] Cache limit enforcement failed:', e);
    }
}