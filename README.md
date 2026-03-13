# shoelace

# shoelace

Shoelase is an accessibility assistant app designed for mobile using React Native. It guides users through tasks by taking regular snapshots of the user's camera and uploading them to the Gemini API, then receiving an audio response guiding the user through the next step.

## System architecture

![System architecture](sysDiagram.png)

### Frontend

The frontend of shoelace is written in React Native. Once the user opens the app, they are given the option to select a task. Upon beginning a task, the user's camera opens. This is managed through the 'react-native-vision-camera' library which allows us to request camera permissions and then regularly take snapshots of the user's camera and send it to our backend. As the user completes tasks, they will be guided through the process through AI response audio which is sent from the backend. In addition, there is a press to talk feature in each session where the user can ask the AI questions related to the current task.

These audio responses are sent in the form of raw PCM data chunks and are converted into a playable format in useAudioSession.ts. This ensures lower latency than sending a full AI response from the backend. Once the user uses the press to speak function, the AI will stop all audio being played to ensure that the user does not get confused by past advice being played following their questions.

The core logic lives in three hooks that work together:

useTaskSession.ts

- Opens a WebSocket to the backend
- Captures camera frames every 1.5s and sends them as base64 JPEGs
- Receives PCM audio and transcription chunks back
- Triggers the CompletionOverlay when backend sends TASK_COMPLETE

useAudioSession.ts — audio playback

- Creates an AudioContext at 24kHz
- Decodes incoming PCM base64 and queues it for playback
- Blocks recording while audio is playing

useVoiceInput.ts — voice recording

- Records press-and-hold audio at 16kHz WAV
- Encodes to base64 and sends via the WebSocket
- Drives the pulsing animation on MicButton

### Backend

The backend of shoelace is written in Python and utilises FastAPI to initialise web sockets between the frontend and the Gemini Live session.
