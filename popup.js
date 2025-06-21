document.getElementById("trackPage").addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({active : true, currentWindow: true}); 
    const trackedItem = {
        url: tab.url, 
        selector: null, 
        interval: 5, 
        lastSnapshot: null, 
        lastChecked: null
    }; 

    chrome.storage.local.get({ trackedPages: []}, (data) => {
        const trackedPages = data.trackedPages; 
        trackedPages.push(trackedItem); 
        chrome.storage.local.set({trackedPages}); 
        document.getElementById("status").textContent = "Page is now being tracked"; 
    }); 
}); 