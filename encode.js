const fs = require('fs');
const path = require('path');

// Путь к вашему файлу с патчем
const inputPath = path.join(__dirname, 'patched_main.js');
const outputPath = path.join(__dirname, 'patched_base64.txt');

try {
    // Читаем файл
    const code = fs.readFileSync(inputPath, 'utf8');
    
    // Кодируем в Base64
    const base64 = code.toString('base64');
    
    // Сохраняем в отдельный файл
    fs.writeFileSync(outputPath, base64);
    
    console.log('\n✅ Успешно закодировано!');
    console.log(`📁 Исходный файл: ${inputPath}`);
    console.log(`💾 Код сохранён в: ${outputPath}\n`);
    
} catch (err) {
    console.error('❌ Ошибка:', err.message);
}