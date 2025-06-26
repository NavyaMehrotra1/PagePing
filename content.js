// Content script for Website Monitor extension
// This runs in the context of web pages and can access the DOM

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extractContent') {
    try {
      const content = extractPageContent(request.selector);
      sendResponse({ success: true, content: content });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
    return true; // Keep message channel open for async response
  }
});

function extractPageContent(selector) {
  let content = '';
  
  if (selector) {
    // Use specific selector
    const elements = document.querySelectorAll(selector);
    if (elements.length > 0) {
      content = Array.from(elements)
        .map(el => el.textContent.trim())
        .filter(text => text.length > 0)
        .join('\n');
    }
  } else {
    // Get main content, excluding common non-content elements
    const excludeSelectors = [
      'script',
      'style',
      'nav',
      'header',
      'footer',
      '.advertisement',
      '.ads',
      '.sidebar',
      '.menu'
    ];
    
    // Clone the body to avoid modifying the original
    const bodyClone = document.body.cloneNode(true);
    
    // Remove excluded elements
    excludeSelectors.forEach(selector => {
      const elements = bodyClone.querySelectorAll(selector);
      elements.forEach(el => el.remove());
    });
    
    content = bodyClone.textContent
      .replace(/\s+/g, ' ')  // Normalize whitespace
      .trim();
  }
  
  return content;
}

// Alternative: Monitor for changes in real-time (optional)
function setupChangeMonitoring() {
  if (window.websiteMonitorObserver) {
    return; // Already set up
  }
  
  const observer = new MutationObserver((mutations) => {
    let hasChanges = false;
    
    mutations.forEach((mutation) => {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        // Check if added nodes contain meaningful content
        for (let node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const text = node.textContent?.trim();
            if (text && text.length > 10) { // Ignore trivial changes
              hasChanges = true;
              break;
            }
          }
        }
      }
    });
    
    if (hasChanges) {
      // Debounce notifications - only send after changes stop for 2 seconds
      clearTimeout(window.changeTimeout);
      window.changeTimeout = setTimeout(() => {
        chrome.runtime.sendMessage({
          action: 'contentChanged',
          url: window.location.href,
          timestamp: Date.now()
        });
      }, 2000);
    }
  });
  
  // Start observing
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: false,
    characterData: false
  });
  
  window.websiteMonitorObserver = observer;
}

// Only set up monitoring if this page is being tracked
chrome.runtime.sendMessage({
  action: 'isPageTracked',
  url: window.location.href
}, (response) => {
  if (response && response.isTracked) {
    setupChangeMonitoring();
  }
});