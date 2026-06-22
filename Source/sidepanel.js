// sidepanel.js - логика для боковой панели

document.addEventListener('DOMContentLoaded', function() {
    const btn = document.getElementById('extractBtn');
    const status = document.getElementById('status');
    const iframe = document.getElementById('deepseek-frame');

    function setStatus(text, isError = false) {
        status.textContent = text;
        status.style.color = isError ? '#ff6b6b' : '#888';
    }

    btn.addEventListener('click', function() {
        if (typeof chrome === 'undefined' || !chrome.tabs) {
            setStatus('❌ Нет доступа к API', true);
            return;
        }

        setStatus('⏳ Проверка...');
        btn.disabled = true;

        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
            const tab = tabs[0];
            if (!tab || !tab.url.includes('youtube.com/watch')) {
                setStatus('❌ Откройте видео на YouTube', true);
                btn.disabled = false;
                return;
            }

            const urlParams = new URLSearchParams(new URL(tab.url).search);
            const videoId = urlParams.get('v');
            if (!videoId) {
                setStatus('❌ Не найден ID видео', true);
                btn.disabled = false;
                return;
            }

            setStatus('⏳ Загрузка транскрипта...');

            chrome.runtime.sendMessage(
                { action: 'getTranscript', videoId: videoId },
                function(response) {
                    btn.disabled = false;

                    if (chrome.runtime.lastError) {
                        setStatus('❌ Ошибка связи', true);
                        console.error('Runtime error:', chrome.runtime.lastError);
                        return;
                    }

                    if (response && response.success) {
                        const transcript = response.transcript;
                        if (iframe && iframe.contentWindow) {
                            iframe.contentWindow.postMessage({
                                type: 'INSERT_TRANSCRIPT',
                                text: transcript
                            }, 'https://chat.deepseek.com');
                            setStatus('✅ Отправлено!');
                        } else {
                            setStatus('⚠️ iframe не найден', true);
                        }
                    } else {
                        setStatus('❌ ' + (response?.error || 'Ошибка'), true);
                    }
                }
            );
        });
    });
});