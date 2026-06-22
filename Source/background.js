import { STORAGE_KEY_PREFIX, MAX_ATTEMPTS, ATTEMPT_WINDOW_MS, isValidEmail, isValidCode, toSortedObject } from './modules/premiumShared.js';
import { CUSTOM_SERVICE_STORAGE_KEY, SERVICE_PRESETS, buildServiceUrl, getAllActions, normalizeSettings } from './modules/customServiceConfig.js';
import { readCustomServiceSettings } from './modules/customServiceStore.js';
import { fetchYouTubeTranscript } from './modules/youtube-transcript.js';

const CONTEXT_MENU_ROOT_ID = 'ai-side-panel-custom-service';
let contextMenuRebuildInFlight = null;
let pendingContextMenuRebuild = false;
let cachedCustomServiceSettings = normalizeSettings();

function contextMenusRemoveAll() {
  return new Promise((resolve) => {
    try {
      chrome.contextMenus.removeAll(() => resolve());
    } catch (_) {
      resolve();
    }
  });
}

function contextMenusCreate(createProperties) {
  return new Promise((resolve) => {
    try {
      chrome.contextMenus.create(createProperties, () => {
        resolve(!chrome.runtime.lastError);
      });
    } catch (_) {
      resolve(false);
    }
  });
}

function initiate () {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => console.error(error));
    // Удаляем устаревший вызов updateDynamicRules - теперь правила загружаются из rules.json
    // chrome.declarativeNetRequest.updateDynamicRules(...)
    primeCustomServiceSettings().then(() => rebuildCustomContextMenus());
};

initiate();

chrome.runtime.onStartup?.addListener(() => {
  primeCustomServiceSettings().then(() => rebuildCustomContextMenus());
});

async function primeCustomServiceSettings() {
  try {
    cachedCustomServiceSettings = normalizeSettings(await readCustomServiceSettings());
  } catch (_) {
    cachedCustomServiceSettings = normalizeSettings();
  }
  return cachedCustomServiceSettings;
}

async function rebuildCustomContextMenus() {
  if (contextMenuRebuildInFlight) {
    pendingContextMenuRebuild = true;
    return contextMenuRebuildInFlight;
  }

  contextMenuRebuildInFlight = (async () => {
    try {
      await contextMenusRemoveAll();
    } catch (_) {
      // ignore
    }

    if (!cachedCustomServiceSettings) {
      await primeCustomServiceSettings();
    }
    const normalized = normalizeSettings(cachedCustomServiceSettings);
    if (!normalized.enabled) return;

    const services = SERVICE_PRESETS
      .filter((s) => normalized.enabledServices.includes(s.id))
      .filter((s) => (s.id !== 'custom' ? true : !!normalized.customBaseUrl))
      .sort((a, b) => {
        if (a.id === normalized.defaultService) return -1;
        if (b.id === normalized.defaultService) return 1;
        return a.label.localeCompare(b.label);
      });
    const actions = getAllActions(normalized).filter((a) => normalized.enabledActions.includes(a.id));

    if (!services.length || !actions.length) return;

    try {
      const rootOk = await contextMenusCreate({
        id: CONTEXT_MENU_ROOT_ID,
        title: 'AI Side Panel',
        contexts: ['selection']
      });
      if (!rootOk) return;

      for (const service of services) {
        const serviceId = `${CONTEXT_MENU_ROOT_ID}/${service.id}`;
        const serviceOk = await contextMenusCreate({
          id: serviceId,
          parentId: CONTEXT_MENU_ROOT_ID,
          title: service.label,
          contexts: ['selection']
        });
        if (!serviceOk) continue;

        for (const action of actions) {
          await contextMenusCreate({
            id: `${serviceId}/${action.id}`,
            parentId: serviceId,
            title: action.label,
            contexts: ['selection']
          });
        }
      }
    } catch (err) {
      console.warn('Failed to build context menus', err);
    }
  })();

  await contextMenuRebuildInFlight;
  contextMenuRebuildInFlight = null;

  if (pendingContextMenuRebuild) {
    pendingContextMenuRebuild = false;
    return rebuildCustomContextMenus();
  }
}

function openSidePanelForTab(tab) {
  const tabId = tab?.id;
  if (!tabId) return Promise.resolve(false);
  try {
    if (chrome.sidePanel?.open) {
      return chrome.sidePanel.open({ tabId }).then(() => true).catch((error) => {
        console.error('Failed to open side panel', error);
        return false;
      });
    }
    if (chrome.sidePanel?.setOptions) {
      return chrome.sidePanel
        .setOptions({ tabId, path: 'sidepanel.html', enabled: true })
        .then(() => (chrome.sidePanel?.open ? chrome.sidePanel.open({ tabId }) : Promise.reject(new Error('sidePanel.open unavailable'))))
        .then(() => true)
        .catch((error) => {
          console.error('Failed to open side panel', error);
          return false;
        });
    }
  } catch (error) {
    console.error('Failed to open side panel', error);
  }
  return Promise.resolve(false);
}

function sendCustomServiceToPanel(payload) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: 'OPEN_CUSTOM_SERVICE', payload }, (resp) => {
        if (chrome.runtime.lastError) {
          resolve(false);
          return;
        }
        resolve(!!resp);
      });
    } catch (_) {
      resolve(false);
    }
  });
}

chrome.storage?.onChanged?.addListener((changes, areaName) => {
  if (areaName === 'sync' || areaName === 'local') {
    if (changes[CUSTOM_SERVICE_STORAGE_KEY]) {
      const newVal = changes[CUSTOM_SERVICE_STORAGE_KEY].newValue;
      cachedCustomServiceSettings = normalizeSettings(newVal || cachedCustomServiceSettings);
      rebuildCustomContextMenus();
    }
  }
});

chrome.contextMenus?.onClicked?.addListener((info, tab) => {
  if (typeof info.menuItemId !== 'string') return;
  if (!info.menuItemId.startsWith(CONTEXT_MENU_ROOT_ID)) return;

  const parts = info.menuItemId.split('/');
  if (parts.length < 3) return; // require Service + Action

  const serviceId = parts[1];
  const actionId = parts[2];
  if (!serviceId || !actionId) return;
  if (!info.selectionText) return;

  const normalized = normalizeSettings(cachedCustomServiceSettings);
  const service = SERVICE_PRESETS.find((s) => s.id === serviceId);
  if (!service) return;

  const action = getAllActions(normalized).find((a) => a.id === actionId);
  if (!action) return;

  let baseUrl = service.baseUrl;
  if (serviceId === 'custom' && normalized.customBaseUrl) {
    baseUrl = normalized.customBaseUrl;
  }
  const url = buildServiceUrl(baseUrl, serviceId, actionId, info.selectionText);
  if (!url) return;

  openSidePanelForTab(tab).then(() => {
    sendCustomServiceToPanel({ url, text: info.selectionText });
  });
});

// Обработчик для получения транскрипта YouTube
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getTranscript') {
        const videoId = request.videoId;
        if (!videoId) {
            sendResponse({ success: false, error: 'ID видео не предоставлен' });
            return true;
        }

        fetchYouTubeTranscript(videoId)
            .then(transcript => {
                sendResponse({ success: true, transcript });
            })
            .catch(error => {
                sendResponse({ success: false, error: error.message });
            });
        return true;
    }
});

console.log('AI Side Panel Service Worker loaded');