// Background service worker for Chrome extension
chrome.runtime.onInstalled.addListener(() => {
  // Create alarm for periodic checking
  chrome.alarms.create('checkWebsites', { delayInMinutes: 1, periodInMinutes: 15 });
});

// Handle alarm trigger
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'checkWebsites') {
    checkAllWebsites();
  }
});

async function checkAllWebsites() {
  try {
    // Get all tracked websites from storage
    const result = await chrome.storage.sync.get(['trackedSites']);
    const trackedSites = result.trackedSites || [];
    
    for (const site of trackedSites) {
      if (site.active) {
        await checkSingleWebsite(site);
      }
    }
  } catch (error) {
    console.error('Error checking websites:', error);
  }
}

async function checkSingleWebsite(site) {
  try {
    // For local files or sites that need DOM parsing, use content script injection
    if (site.url.startsWith('file://') || site.selector) {
      await checkSiteWithContentScript(site);
    } else {
      // For simple HTML fetching without selectors
      await checkSiteDirectly(site);
    }
  } catch (error) {
    console.error(`Error checking ${site.url}:`, error);
  }
}

async function checkSiteDirectly(site) {
  try {
    const response = await fetch(site.url);
    const html = await response.text();
    
    // Simple text extraction without DOM parsing
    // Remove HTML tags using regex (basic approach)
    const textContent = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    const currentHash = await hashContent(textContent);
    
    if (site.lastHash && site.lastHash !== currentHash) {
      await sendNotification(site, textContent.substring(0, 200));
    }
    
    await updateSiteHash(site.id, currentHash);
  } catch (error) {
    console.error(`Error fetching ${site.url}:`, error);
  }
}

async function checkSiteWithContentScript(site) {
  try {
    // Find or create a tab with the URL
    const tabs = await chrome.tabs.query({ url: site.url });
    let tabId;
    
    if (tabs.length > 0) {
      tabId = tabs[0].id;
      // Reload the tab to get fresh content
      await chrome.tabs.reload(tabId);
      // Wait for the page to load
      await new Promise(resolve => setTimeout(resolve, 3000));
    } else {
      // Create a new tab (this will be visible to user)
      const tab = await chrome.tabs.create({ url: site.url, active: false });
      tabId = tab.id;
      // Wait for the page to load
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
    // Inject content script to extract content
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: extractContent,
      args: [site.selector]
    });
    
    if (results && results[0] && results[0].result) {
      const currentContent = results[0].result;
      const currentHash = await hashContent(currentContent);
      
      if (site.lastHash && site.lastHash !== currentHash) {
        await sendNotification(site, currentContent);
      }
      
      await updateSiteHash(site.id, currentHash);
    }
    
    // Close the tab if we created it
    if (tabs.length === 0) {
      await chrome.tabs.remove(tabId);
    }
    
  } catch (error) {
    console.error(`Error checking with content script ${site.url}:`, error);
  }
}

// Function that runs in the webpage context
function extractContent(selector) {
  try {
    if (selector) {
      const element = document.querySelector(selector);
      return element ? element.textContent.trim() : '';
    } else {
      // Get all visible text content
      return document.body.textContent.trim();
    }
  } catch (error) {
    return '';
  }
}

async function hashContent(content) {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sendNotification(site, newContent) {
  const options = {
    type: 'basic',
    iconUrl: 'icon.png',
    title: 'Website Changed!',
    message: `Changes detected on ${site.name || site.url}`,
    buttons: [
      { title: 'View Site' },
      { title: 'Dismiss' }
    ]
  };
  
  const notificationId = await chrome.notifications.create(options);
  
  // Store notification data for handling clicks
  await chrome.storage.local.set({
    [`notification_${notificationId}`]: {
      url: site.url,
      content: newContent.substring(0, 200) // Store preview
    }
  });
}

// Handle notification clicks
chrome.notifications.onClicked.addListener(async (notificationId) => {
  const result = await chrome.storage.local.get([`notification_${notificationId}`]);
  const notificationData = result[`notification_${notificationId}`];
  
  if (notificationData) {
    chrome.tabs.create({ url: notificationData.url });
    chrome.notifications.clear(notificationId);
  }
});

chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
  if (buttonIndex === 0) { // View Site
    const result = await chrome.storage.local.get([`notification_${notificationId}`]);
    const notificationData = result[`notification_${notificationId}`];
    
    if (notificationData) {
      chrome.tabs.create({ url: notificationData.url });
    }
  }
  
  chrome.notifications.clear(notificationId);
});

async function updateSiteHash(siteId, hash) {
  const result = await chrome.storage.sync.get(['trackedSites']);
  const trackedSites = result.trackedSites || [];
  
  const siteIndex = trackedSites.findIndex(site => site.id === siteId);
  if (siteIndex !== -1) {
    trackedSites[siteIndex].lastHash = hash;
    trackedSites[siteIndex].lastChecked = Date.now();
    await chrome.storage.sync.set({ trackedSites });
  }
}

// Message handling for popup communication
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'addSite') {
    addSiteToTracking(request.site);
    sendResponse({ success: true });
  } else if (request.action === 'removeSite') {
    removeSiteFromTracking(request.siteId);
    sendResponse({ success: true });
  }
});

async function addSiteToTracking(siteData) {
  const result = await chrome.storage.sync.get(['trackedSites']);
  const trackedSites = result.trackedSites || [];
  
  const newSite = {
    id: Date.now().toString(),
    url: siteData.url,
    name: siteData.name,
    selector: siteData.selector,
    active: true,
    addedAt: Date.now(),
    lastChecked: null,
    lastHash: null
  };
  
  trackedSites.push(newSite);
  await chrome.storage.sync.set({ trackedSites });
}

async function removeSiteFromTracking(siteId) {
  const result = await chrome.storage.sync.get(['trackedSites']);
  const trackedSites = result.trackedSites || [];
  
  const updatedSites = trackedSites.filter(site => site.id !== siteId);
  await chrome.storage.sync.set({ trackedSites: updatedSites });
}