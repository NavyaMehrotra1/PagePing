// Popup script for Website Monitor extension
document.addEventListener('DOMContentLoaded', function() {
  const addSiteBtn = document.getElementById('addSite');
  const quickAddBtn = document.getElementById('quickAddCurrentSite');
  const siteNameInput = document.getElementById('siteName');
  const siteUrlInput = document.getElementById('siteUrl');
  const siteSelectorInput = document.getElementById('siteSelector');
  const trackedSitesDiv = document.getElementById('trackedSites');
  const siteCountSpan = document.getElementById('siteCount');
  const statusDiv = document.getElementById('status');
  
  // Load tracked sites on popup open
  loadTrackedSites();
  
  // Add site button handler
  addSiteBtn.addEventListener('click', function() {
    const url = siteUrlInput.value.trim();
    const name = siteNameInput.value.trim();
    const selector = siteSelectorInput.value.trim();
    
    if (!url) {
      showStatus('Please enter a URL', 'error');
      return;
    }
    
    if (!isValidUrl(url)) {
      showStatus('Please enter a valid URL', 'error');
      return;
    }
    
    const siteData = {
      url: url,
      name: name || extractDomainName(url),
      selector: selector
    };
    
    chrome.runtime.sendMessage({
      action: 'addSite',
      site: siteData
    }, function(response) {
      if (response && response.success) {
        showStatus('Site added successfully!', 'success');
        clearForm();
        loadTrackedSites();
      } else {
        showStatus('Failed to add site', 'error');
      }
    });
  });
  
  // Quick add current site
  quickAddBtn.addEventListener('click', function() {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      if (tabs[0]) {
        const currentUrl = tabs[0].url;
        const currentTitle = tabs[0].title;
        
        siteUrlInput.value = currentUrl;
        siteNameInput.value = currentTitle;
        
        showStatus('Current page URL filled in', 'success');
      }
    });
  });
  
  async function loadTrackedSites() {
    try {
      const result = await chrome.storage.sync.get(['trackedSites']);
      const trackedSites = result.trackedSites || [];
      
      displayTrackedSites(trackedSites);
      siteCountSpan.textContent = trackedSites.length;
    } catch (error) {
      console.error('Error loading tracked sites:', error);
      showStatus('Error loading sites', 'error');
    }
  }
  
  function displayTrackedSites(sites) {
    if (sites.length === 0) {
      trackedSitesDiv.innerHTML = `
        <div style="text-align: center; color: #5f6368; padding: 20px;">
          No sites being tracked yet.
        </div>
      `;
      return;
    }
    
    trackedSitesDiv.innerHTML = '';
    
    sites.forEach(site => {
      const siteElement = document.createElement('div');
      siteElement.className = 'site-item';
      
      siteElement.innerHTML = `
        <div class="site-name">${escapeHtml(site.name)}</div>
        <div class="site-url">${escapeHtml(site.url)}</div>
        ${site.selector ? `<div class="help-text">Selector: ${escapeHtml(site.selector)}</div>` : ''}
        <div class="help-text">
          Added: ${new Date(site.addedAt).toLocaleDateString()}
          ${site.lastChecked ? ` | Last checked: ${new Date(site.lastChecked).toLocaleString()}` : ' | Not checked yet'}
        </div>
        <div class="site-controls">
          <button class="btn btn-secondary visit-btn">Visit</button>
          <button class="btn btn-danger remove-btn">Remove</button>
        </div>
      `;
      
      // Add event listeners to buttons
      const visitBtn = siteElement.querySelector('.visit-btn');
      const removeBtn = siteElement.querySelector('.remove-btn');
      
      visitBtn.addEventListener('click', () => {
        chrome.tabs.create({ url: site.url });
      });
      
      removeBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to remove this site from monitoring?')) {
          chrome.runtime.sendMessage({
            action: 'removeSite',
            siteId: site.id
          }, function(response) {
            if (response && response.success) {
              showStatus('Site removed', 'success');
              loadTrackedSites();
            } else {
              showStatus('Failed to remove site', 'error');
            }
          });
        }
      });
      
      trackedSitesDiv.appendChild(siteElement);
    });
  }
  
  function clearForm() {
    siteNameInput.value = '';
    siteUrlInput.value = '';
    siteSelectorInput.value = '';
  }
  
  function showStatus(message, type) {
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
    statusDiv.style.display = 'block';
    
    setTimeout(() => {
      statusDiv.style.display = 'none';
    }, 3000);
  }
  
  function isValidUrl(string) {
    try {
      new URL(string);
      return true;
    } catch (_) {
      return false;
    }
  }
  
  function extractDomainName(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace('www.', '');
    } catch (_) {
      return url;
    }
  }
  
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  // Handle enter key in form inputs
  [siteNameInput, siteUrlInput, siteSelectorInput].forEach(input => {
    input.addEventListener('keypress', function(e) {
      if (e.key === 'Enter') {
        addSiteBtn.click();
      }
    });
  });
});