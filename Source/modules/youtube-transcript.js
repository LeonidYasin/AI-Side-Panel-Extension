// Source/modules/youtube-transcript.js
// Модуль для извлечения транскрипта с YouTube (адаптировано из Quoth)

export async function fetchYouTubeTranscript(videoId) {
    try {
        // 1. Получаем страницу видео
        const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`);
        const html = await response.text();

        // 2. Извлекаем данные плеера
        const ytDataRegex = /var ytInitialPlayerResponse = ({.*?});/;
        const match = html.match(ytDataRegex);
        if (!match) throw new Error("Не удалось найти данные плеера");

        const playerData = JSON.parse(match[1]);
        
        // 3. Получаем информацию о субтитрах
        const captionsData = playerData?.captions?.playerCaptionsTracklistRenderer;
        if (!captionsData) throw new Error("Субтитры не найдены для этого видео");

        // 4. Выбираем первый доступный трек
        const track = captionsData.captionTracks?.[0];
        if (!track) throw new Error("Нет доступных треков субтитров");

        // 5. Загружаем XML с субтитрами
        const transcriptResponse = await fetch(track.baseUrl);
        const transcriptXml = await transcriptResponse.text();

        // 6. Парсим XML и извлекаем текст
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(transcriptXml, "text/xml");
        const textNodes = xmlDoc.getElementsByTagName("text");
        
        let transcript = [];
        for (let node of textNodes) {
            const text = node.textContent.trim();
            if (text) transcript.push(text);
        }

        if (transcript.length === 0) throw new Error("Транскрипт пуст");

        return transcript.join(" ");

    } catch (error) {
        console.error("Ошибка при получении транскрипта:", error);
        throw error;
    }
}