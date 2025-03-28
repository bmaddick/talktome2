const { app, BrowserWindow, globalShortcut, ipcMain, clipboard, desktopCapturer, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { OpenAI } = require('openai');

try {
  require('dotenv').config();
} catch (error) {
  console.log('Error loading .env file:', error);
}

let apiKey = process.env.OPENAI_API_KEY;
let openai;

let mainWindow;
let recording = false;
let mediaRecorder;
let audioChunks = [];
let recordingStream;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 300,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    },
    icon: path.join(__dirname, '../build/icon.icns')
  });

  mainWindow.loadFile('src/index.html');

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      return false;
    }
  });
}

async function startRecording() {
  if (recording) return;
  
  try {
    audioChunks = [];
    recording = true;
    
    const sources = await desktopCapturer.getSources({ types: ['audio'] });
    const audioConstraints = {
      audio: {
        mandatory: {
          chromeMediaSource: 'desktop'
        }
      },
      video: false
    };
    
    recordingStream = await navigator.mediaDevices.getUserMedia(audioConstraints);
    mediaRecorder = new MediaRecorder(recordingStream);
    
    mediaRecorder.ondataavailable = (event) => {
      audioChunks.push(event.data);
    };
    
    mediaRecorder.start();
    mainWindow.webContents.send('recording-status', true);
  } catch (error) {
    console.error('Error starting recording:', error);
    recording = false;
    mainWindow.webContents.send('recording-error', error.message);
  }
}

function initializeOpenAI() {
  try {
    openai = new OpenAI({
      apiKey: apiKey
    });
    return true;
  } catch (error) {
    console.error('Error initializing OpenAI:', error);
    return false;
  }
}

async function stopRecording() {
  if (!recording) return;
  
  recording = false;
  mediaRecorder.stop();
  
  const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
  const audioBuffer = Buffer.from(await audioBlob.arrayBuffer());
  const tempFile = path.join(app.getPath('temp'), 'recording.webm');
  fs.writeFileSync(tempFile, audioBuffer);
  
  try {
    if (!openai) {
      if (!initializeOpenAI()) {
        const result = dialog.showMessageBoxSync(mainWindow, {
          type: 'question',
          buttons: ['OK', 'Cancel'],
          defaultId: 0,
          title: 'OpenAI API Key Required',
          message: 'Please enter your OpenAI API key:',
          detail: 'Your API key is required for voice transcription. It will be stored locally and not shared.',
          inputField: ''
        });
        
        if (result.response === 0 && result.inputField) {
          apiKey = result.inputField;
          initializeOpenAI();
        } else {
          mainWindow.webContents.send('transcription-error', 'API key is required for transcription');
          return;
        }
      }
    }
    
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempFile),
      model: "whisper-1"
    });
    
    clipboard.writeText(transcription.text);
    
    mainWindow.webContents.send('transcription-result', transcription.text);
    
    recordingStream.getTracks().forEach(track => track.stop());
    fs.unlinkSync(tempFile);
  } catch (error) {
    console.error('Error transcribing audio:', error);
    mainWindow.webContents.send('transcription-error', error.message);
  }
}

app.whenReady().then(() => {
  createWindow();
  
  initializeOpenAI();

  globalShortcut.register('CommandOrControl+Shift+R', () => {
    if (!recording) {
      startRecording();
    } else {
      stopRecording();
    }
  });

  ipcMain.handle('start-recording', startRecording);
  ipcMain.handle('stop-recording', stopRecording);
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      mainWindow.show();
    }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
