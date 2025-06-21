chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "startTracking") {
    // create an alarm for this url 
    scheduleAlarmForPage(message.url); 
  }
}); 

function scheduleAlarmForPage(url) {
  chrome.storage.local.get({trackedPages : []}, (data) => {
    const trackedPages = data.trackedPages;
    const page = trackedPages.find(p => p.url === url); 
    if (!page) return; 
    chrome.alarms.create(url, {periodInMinutes: page.interval});
  }); 
} 

chrome.alarms.onAlarm.addListener(async (alarm) => {
  // to check if something changed on the page 
  const url = alarm.name; 
  chrome.storage.local.get({trackedPages : []}, async (data) => {
    const trackedPages = data.trackedPages; 
    const pageIndex = trackedPages.findIndex(p => p.url === url); 

    if (pageIndex === -1) return;
    const page = trackedPages[pageIndex];

    try {
      const response = await fetch(url); 
      const text = await response.text();

      const cleanedText = stripHTML(text); 

      if (page.lastSnapshot && page.lastSnapshot !== cleanedText) {
        sendNotification(url); 
      }

      trackedPages[pageIndex].lastSnapshot = cleanedText;
      trackedPages[pageIndex].lastChecked = new Date().toISOString();
      chrome.storage.local.set({trackedPages}); 
    } catch (err) {
      console.error(`Error fetching page ${url}:`, err);
    }
  })
}); 

