const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const chokidar = require('chokidar');
const simpleGit = require('simple-git');
const prompt = require('electron-prompt');
const fs = require('fs').promises;

let mainWindow;
let watcher = null;
let selectedPath = null;
let remoteUrl = null;

// Configure Git path
const gitPath = 'C:\\Program Files\\Git\\cmd\\git.exe';

// Enhanced file categories with patterns
const fileCategories = {
  images: {
    extensions: ['.jpg', '.jpeg', '.png', '.gif', '.svg', '.ico'],
    getDescription: (filename) => `Update image asset: ${filename}`
  },
  documents: {
    extensions: ['.pdf', '.doc', '.docx', '.txt', '.md', '.json', '.xml', '.yaml', '.yml'],
    getDescription: async (filename, content) => {
      if (filename.toLowerCase() === 'readme.md') {
        return 'Update documentation in README';
      }
      if (filename.endsWith('.json')) {
        try {
          const json = JSON.parse(content);
          if (json.version) {
            return `Update version to ${json.version}`;
          }
          if (json.dependencies || json.devDependencies) {
            return 'Update package dependencies';
          }
        } catch (e) {
          // Invalid JSON, fallback to default
        }
      }
      return `Update documentation: ${filename}`;
    }
  },
  code: {
    extensions: ['.js', '.jsx', '.ts', '.tsx', '.html', '.css', '.scss', '.py', '.java', '.cpp', '.c', '.cs', '.php', '.rb'],
    patterns: {
      feature: {
        patterns: ['feat:', 'feature:', 'add:', 'implement:'],
        description: 'Add new feature'
      },
      bugfix: {
        patterns: ['fix:', 'bug:', 'resolve:', 'fixes:'],
        description: 'Fix bug'
      },
      refactor: {
        patterns: ['refactor:', 'improve:', 'update:', 'enhance:'],
        description: 'Refactor code'
      },
      style: {
        patterns: ['style:', 'format:', 'lint:'],
        description: 'Update code style'
      },
      test: {
        patterns: ['test:', 'spec:', 'coverage:'],
        description: 'Update tests'
      },
      docs: {
        patterns: ['docs:', 'documentation:', 'comment:'],
        description: 'Update documentation'
      }
    },
    getDescription: async (filename, content, oldContent = '') => {
      const fileType = path.extname(filename).toLowerCase();
      
      // Get the diff if we have both old and new content
      let diff = '';
      if (oldContent && content) {
        // Simple diff - find changed lines
        const oldLines = oldContent.split('\n');
        const newLines = content.split('\n');
        const changes = [];
        
        for (let i = 0; i < newLines.length; i++) {
          if (oldLines[i] !== newLines[i]) {
            changes.push(newLines[i]);
          }
        }
        diff = changes.join('\n');
      } else {
        diff = content;
      }

      // Detect the type of change from the diff or content
      const changeType = detectChangeType(diff || content);
      if (changeType) {
        return `${changeType} in ${filename}`;
      }

      // Analyze imports to detect dependency changes
      const oldImports = oldContent ? extractImports(oldContent) : new Set();
      const newImports = content ? extractImports(content) : new Set();
      if (oldImports.size !== newImports.size) {
        const added = [...newImports].filter(imp => !oldImports.has(imp));
        const removed = [...oldImports].filter(imp => !newImports.has(imp));
        if (added.length > 0 || removed.length > 0) {
          return `Update dependencies in ${filename} (${added.length > 0 ? '+' + added.join(', ') : ''}${removed.length > 0 ? '-' + removed.join(', ') : ''})`;
        }
      }

      // Detect structural changes
      if (content.includes('class') && content.includes('extends')) {
        const className = extractClassName(content);
        return `Update ${className || 'class'} implementation in ${filename}`;
      }

      // Detect API changes
      if (content.includes('api') || content.includes('endpoint') || content.includes('route')) {
        return `Update API implementation in ${filename}`;
      }

      // Detect security changes
      if (content.includes('security') || content.includes('auth') || content.includes('password') || content.includes('encrypt')) {
        return `Update security implementation in ${filename}`;
      }

      return `Update code in ${filename}`;
    }
  },
  config: {
    extensions: ['.env', '.config', '.ini', '.conf'],
    getDescription: (filename) => `Update configuration in ${filename}`
  },
  data: {
    extensions: ['.csv', '.xlsx', '.xls', '.db', '.sqlite'],
    getDescription: (filename) => `Update data in ${filename}`
  },
  media: {
    extensions: ['.mp4', '.mp3', '.wav', '.avi', '.mov'],
    getDescription: (filename) => `Update media file: ${filename}`
  },
  archives: {
    extensions: ['.zip', '.rar', '.7z', '.tar', '.gz'],
    getDescription: (filename) => `Update archive: ${filename}`
  }
};

function getFileCategory(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  for (const [category, info] of Object.entries(fileCategories)) {
    if (info.extensions.includes(ext)) {
      return category;
    }
  }
  return 'other';
}

async function analyzeFileChange(filePath, changeType) {
  try {
    const category = getFileCategory(filePath);
    const categoryInfo = fileCategories[category];
    const filename = path.basename(filePath);

    if (changeType === 'unlink') {
      return `Remove ${filename}`;
    }

    if (categoryInfo && categoryInfo.getDescription) {
      let content = '';
      try {
        content = await fs.readFile(filePath, 'utf-8');
      } catch (e) {
        // File might be binary or unreadable
      }

      if (typeof categoryInfo.getDescription === 'function') {
        if (categoryInfo.getDescription.length === 2) {
          return await categoryInfo.getDescription(filename, content);
        }
        return categoryInfo.getDescription(filename);
      }
    }

    return `Update ${filename}`;
  } catch (error) {
    return `Update ${path.basename(filePath)}`;
  }
}

async function createCommitMessage(changedFiles, changeTypes) {
  const files = Array.from(changedFiles);
  const descriptions = new Set();
  
  // Analyze each file change
  for (const file of files) {
    const changeType = changeTypes.get(file) || 'change';
    const description = await analyzeFileChange(file, changeType);
    descriptions.add(description);
  }

  // Create a summary
  const uniqueDescriptions = Array.from(descriptions);
  let summary = '';

  if (uniqueDescriptions.length === 1) {
    summary = uniqueDescriptions[0];
  } else {
    summary = 'Multiple updates:\n' + uniqueDescriptions.map(d => `• ${d}`).join('\n');
  }

  return summary;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Handle folder selection
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  
  if (!result.canceled) {
    selectedPath = result.filePaths[0];
    startWatching(selectedPath);
    return selectedPath;
  }
  return null;
});

// Handle remote URL configuration
ipcMain.handle('configure-remote', async () => {
  try {
    const url = await prompt({
      title: 'Configure Remote Repository',
      label: 'Enter the remote repository URL:',
      value: remoteUrl || '',
      inputAttrs: {
        type: 'url',
        placeholder: 'https://github.com/username/repository.git'
      },
      type: 'input'
    });

    if (url) {
      remoteUrl = url;
      if (selectedPath) {
        const git = simpleGit({
          baseDir: selectedPath,
          binary: gitPath,
          maxConcurrentProcesses: 1,
          unsafe: {
            allowUnsafeCustomBinary: true
          }
        });

        try {
          // Remove existing remote if any
          await git.removeRemote('origin');
        } catch (error) {
          // Ignore error if remote doesn't exist
        }

        // Add new remote
        await git.addRemote('origin', remoteUrl);
        mainWindow.webContents.send('commit-success', {
          message: `Remote repository configured: ${remoteUrl}`,
          timestamp: new Date().toISOString()
        });
      }
      return remoteUrl;
    }
  } catch (error) {
    mainWindow.webContents.send('commit-error', {
      message: `Failed to configure remote: ${error.message}`,
      timestamp: new Date().toISOString()
    });
  }
  return null;
});

// Handle stop watching
ipcMain.handle('stop-watching', () => {
  if (watcher) {
    watcher.close();
    watcher = null;
    selectedPath = null;
    return true;
  }
  return false;
});

async function initializeGitRepository(git) {
  try {
    // Initialize repository
    await git.init();
    
    // Create and switch to main branch
    await git.checkoutLocalBranch('main');
    
    // Create initial commit
    await git.add('.');
    await git.commit('Initial commit');
    
    mainWindow.webContents.send('commit-success', {
      message: 'Git repository initialized with main branch',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    // If repository already exists, try to switch to main branch
    try {
      await git.checkout('main');
    } catch (error) {
      // If main branch doesn't exist, create it
      await git.checkoutLocalBranch('main');
    }
  }
}

function startWatching(folderPath) {
  if (watcher) {
    watcher.close();
  }

  const git = simpleGit({
    baseDir: folderPath,
    binary: gitPath,
    maxConcurrentProcesses: 1,
    unsafe: {
      allowUnsafeCustomBinary: true
    }
  });

  let changedFiles = new Set();
  let changeTypes = new Map(); // Track type of change for each file

  // Initialize git repository and ensure we're on main branch
  initializeGitRepository(git).catch(error => {
    mainWindow.webContents.send('commit-error', {
      message: `Git initialization error: ${error.message}. Please make sure Git is installed at ${gitPath}`,
      timestamp: new Date().toISOString()
    });
  });

  watcher = chokidar.watch(folderPath, {
    ignored: /(^|[\/\\])\../, // ignore dotfiles
    persistent: true,
    ignoreInitial: true
  });

  watcher
    .on('add', filePath => {
      changedFiles.add(filePath);
      changeTypes.set(filePath, 'add');
      mainWindow.webContents.send('commit-success', {
        message: `New file detected: ${path.basename(filePath)}`,
        timestamp: new Date().toISOString()
      });
    })
    .on('change', filePath => {
      changedFiles.add(filePath);
      changeTypes.set(filePath, 'change');
      mainWindow.webContents.send('commit-success', {
        message: `File changed: ${path.basename(filePath)}`,
        timestamp: new Date().toISOString()
      });
    })
    .on('unlink', filePath => {
      changedFiles.add(filePath);
      changeTypes.set(filePath, 'unlink');
      mainWindow.webContents.send('commit-success', {
        message: `File deleted: ${path.basename(filePath)}`,
        timestamp: new Date().toISOString()
      });
    });

  // Check for changes every 10 seconds
  setInterval(async () => {
    if (changedFiles.size > 0) {
      try {
        // Stage all changes
        await git.add('.');
        
        // Create commit with analyzed changes
        const commitMessage = await createCommitMessage(changedFiles, changeTypes);
        await git.commit(commitMessage);
        
        // Push changes if remote is configured
        if (remoteUrl) {
          await git.push('origin', 'main');
        } else {
          mainWindow.webContents.send('commit-error', {
            message: 'Remote repository not configured. Please configure it using the "Configure Remote" button.',
            timestamp: new Date().toISOString()
          });
        }
        
        // Clear the changed files set and types
        changedFiles.clear();
        changeTypes.clear();
        
        // Notify the renderer process
        mainWindow.webContents.send('commit-success', {
          message: `Successfully committed and pushed changes:\n${commitMessage}`,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        mainWindow.webContents.send('commit-error', {
          message: `Git operation failed: ${error.message}`,
          timestamp: new Date().toISOString()
        });
      }
    }
  }, 10 * 1000); // 10 seconds
} 