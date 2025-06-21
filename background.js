chrome.alarms.onAlarm.addListener((alarm) => {
  // to check if something changed on the page 

}); 

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "startTracking") {
    // create an alarm for this url 
  }
}); 

