const { ipcRenderer } = require('electron');

// DOM Elements
const selectFolderBtn = document.getElementById('selectFolder');
const stopWatchingBtn = document.getElementById('stopWatching');
const configureRemoteBtn = document.getElementById('configureRemote');
const selectedPathDisplay = document.getElementById('selectedPath');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const logContainer = document.getElementById('logContainer');

// Event Listeners
selectFolderBtn.addEventListener('click', async () => {
    const path = await ipcRenderer.invoke('select-folder');
    if (path) {
        selectedPathDisplay.textContent = path;
        updateStatus(true);
        stopWatchingBtn.disabled = false;
        configureRemoteBtn.disabled = false;
        addLogEntry(`Started watching folder: ${path}`, 'success');
    }
});

configureRemoteBtn.addEventListener('click', async () => {
    const url = await ipcRenderer.invoke('configure-remote');
    if (url) {
        addLogEntry(`Remote repository configured: ${url}`, 'success');
    }
});

stopWatchingBtn.addEventListener('click', async () => {
    const stopped = await ipcRenderer.invoke('stop-watching');
    if (stopped) {
        updateStatus(false);
        stopWatchingBtn.disabled = true;
        configureRemoteBtn.disabled = true;
        addLogEntry('Stopped watching folder', 'success');
    }
});

// IPC Event Listeners
ipcRenderer.on('commit-success', (event, data) => {
    addLogEntry(data.message, 'success', data.timestamp);
});

ipcRenderer.on('commit-error', (event, data) => {
    addLogEntry(data.message, 'error', data.timestamp);
});

// Helper Functions
function updateStatus(isActive) {
    statusDot.classList.toggle('active', isActive);
    statusText.textContent = isActive ? 'Watching' : 'Not Watching';
}

function addLogEntry(message, type, timestamp = new Date().toISOString()) {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    
    const messageSpan = document.createElement('span');
    messageSpan.textContent = message;
    
    const timestampSpan = document.createElement('span');
    timestampSpan.className = 'log-timestamp';
    timestampSpan.textContent = new Date(timestamp).toLocaleTimeString();
    
    entry.appendChild(messageSpan);
    entry.appendChild(timestampSpan);
    
    logContainer.insertBefore(entry, logContainer.firstChild);
    
    // Keep only the last 100 entries
    while (logContainer.children.length > 100) {
        logContainer.removeChild(logContainer.lastChild);
    }
} 