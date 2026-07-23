---
name: Portal dictation must use server STT
description: Why voice dictation uses MediaRecorder + server transcription instead of Web Speech API
---
Rule: all dictation in SiteSort records audio with MediaRecorder and POSTs it to a server transcription endpoint (OpenAI gpt-4o-mini-transcribe via Replit AI integration env vars). Never use the browser Web Speech API (SpeechRecognition).

**Why:** SpeechRecognition fails silently with `service-not-allowed` in iOS home-screen (standalone) PWAs — the user's primary device. It worked in Safari tab testing, masking the failure.

**How to apply:** any new dictation UI should reuse the shared DictationButton (required `transcribeUrl` prop) and pick MIME via the audio helper (iOS records audio/mp4, not webm). Portal uses the portal-scoped transcribe route; dashboard uses the project-scoped one.
