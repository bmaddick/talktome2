const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  startRecording: () => ipcRenderer.invoke('start-recording'),
  stopRecording: () => ipcRenderer.invoke('stop-recording'),
  getTranscription: () => ipcRenderer.on('transcription-result', (event, text) => {
    document.getElementById('transcript').innerText = text;
  })
});
