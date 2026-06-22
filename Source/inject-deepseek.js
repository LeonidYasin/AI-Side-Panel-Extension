// Source/inject-deepseek.js
// Скрипт, который внедряется в iframe DeepSeek для вставки текста

window.addEventListener('message', function(event) {
    if (event.data.type === 'INSERT_TRANSCRIPT') {
        const text = event.data.text;
        
        // Ищем поле ввода на странице DeepSeek
        const inputField = document.querySelector('textarea') || 
                          document.querySelector('div[contenteditable="true"]');
        
        if (inputField) {
            inputField.focus();
            inputField.value = text;
            inputField.dispatchEvent(new Event('input', { bubbles: true }));
            
            // Дополнительно: находим и нажимаем кнопку отправки
            const sendButton = document.querySelector('button[type="submit"]') || 
                              document.querySelector('[aria-label="Send"]');
            if (sendButton) {
                setTimeout(() => sendButton.click(), 100);
            }
        }
    }
});