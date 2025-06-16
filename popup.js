document.getElementById("trackPage").addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({active : true, currentWindow: true}); 
    const trackedItem = {
        url: tab.url, 
        selector: null, 
        interval: 5, 
        lastSnapshot: null, 
        lastChecked: null
    }
})