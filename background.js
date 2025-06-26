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
    // Fetch the website content
    const response = await fetch(site.url);
    const html = await response.text();
    
    // Extract relevant content based on selector
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    let currentContent;
    if (site.selector) {
      const element = doc.querySelector(site.selector);
      currentContent = element ? element.textContent.trim() : '';
    } else {
      // Default: check entire body text
      currentContent = doc.body.textContent.trim();
    }
    
    // Create a simple hash of the content
    const currentHash = await hashContent(currentContent);
    
    // Compare with stored hash
    if (site.lastHash && site.lastHash !== currentHash) {
      // Content changed - send notification
      await sendNotification(site, currentContent);
    }
    
    // Update stored hash
    await updateSiteHash(site.id, currentHash);
    
  } catch (error) {
    console.error(`Error checking ${site.url}:`, error);
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