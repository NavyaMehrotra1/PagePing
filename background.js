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

async function checkSingleWebsite(site) {
  try {
    // For local files or when we need DOM parsing, use tabs approach
    if (site.url.startsWith('file://') || site.selector) {
      await checkSiteWithContentScript(site);
    } else {
      // For remote sites without selectors, try direct fetch first
      try {
        await checkSiteDirectly(site);
      } catch (fetchError) {
        // Fallback to content script approach
        console.log(`Direct fetch failed for ${site.url}, trying content script...`);
        await checkSiteWithContentScript(site);
      }
    }
  } catch (error) {
    console.error(`Error checking ${site.url}:`, error);
  }
}

async function checkSiteDirectly(site) {
  const response = await fetch(site.url, {
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Chrome Extension Website Monitor)'
    }
  });
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  
  const html = await response.text();
  
  // Simple text extraction without DOM parsing
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
}

async function checkSiteWithContentScript(site) {
  try {
    // Check if there's already a tab with this URL
    const existingTabs = await chrome.tabs.query({ url: site.url });
    let tabId;
    let createdTab = false;
    
    if (existingTabs.length > 0) {
      tabId = existingTabs[0].id;
      // Refresh the existing tab
      await chrome.tabs.reload(tabId);
      await waitForTabLoad(tabId);
    } else {
      // Create a new background tab
      const tab = await chrome.tabs.create({ 
        url: site.url, 
        active: false  // Don't focus the tab
      });
      tabId = tab.id;
      createdTab = true;
      await waitForTabLoad(tabId);
    }
    
    // Extract content using content script
    const response = await chrome.tabs.sendMessage(tabId, {
      action: 'extractContent',
      selector: site.selector
    });
    
    if (response && response.success) {
      const currentContent = response.content;
      const currentHash = await hashContent(currentContent);
      
      if (site.lastHash && site.lastHash !== currentHash) {
        await sendNotification(site, currentContent.substring(0, 200));
      }
      
      await updateSiteHash(site.id, currentHash);
    }
    
    // Close tab if we created it
    if (createdTab) {
      try {
        await chrome.tabs.remove(tabId);
      } catch (e) {
        // Tab might already be closed
      }
    }
    
  } catch (error) {
    console.error(`Error checking with content script ${site.url}:`, error);
  }
}

function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    const listener = (tabIdUpdated, changeInfo) => {
      if (tabIdUpdated === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        // Add small delay to ensure content script is ready
        setTimeout(resolve, 1000);
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    
    // Timeout fallback
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 10000);
  });
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
  } else if (request.action === 'isPageTracked') {
    checkIfPageTracked(request.url).then(isTracked => {
      sendResponse({ isTracked });
    });
    return true; // Keep message channel open for async response
  } else if (request.action === 'contentChanged') {
    handleRealTimeChange(request.url, request.timestamp);
  }
  return true;
});

async function checkIfPageTracked(url) {
  const result = await chrome.storage.sync.get(['trackedSites']);
  const trackedSites = result.trackedSites || [];
  return trackedSites.some(site => site.url === url && site.active);
}

async function handleRealTimeChange(url, timestamp) {
  // Handle real-time changes detected by content script
  const result = await chrome.storage.sync.get(['trackedSites']);
  const trackedSites = result.trackedSites || [];
  const site = trackedSites.find(s => s.url === url);
  
  if (site) {
    // Avoid duplicate notifications - only if enough time has passed
    const timeSinceLastCheck = timestamp - (site.lastNotified || 0);
    if (timeSinceLastCheck > 60000) { // 1 minute cooldown
      await sendNotification(site, 'Real-time change detected');
      site.lastNotified = timestamp;
      await chrome.storage.sync.set({ trackedSites });
    }
  }
}

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