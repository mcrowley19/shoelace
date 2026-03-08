import asyncio
import struct
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from google import genai
from google.genai.types import LiveConnectConfig, Part, Content, AudioTranscriptionConfig
import json
import base64
import traceback

PROJECT_ID = "helper-489113"
LOCATION = "us-central1"

SYSTEM_PROMPT_TEMPLATE = """
{task_prompt}

Core guidelines:
1. Every time you receive a camera frame, briefly describe what you can see. Then decide whether to proceed.
2. Move to the next step only when the camera clearly shows the expected result of that step — look for specific visual evidence (e.g. a button is tapped, a setting is toggled, an item is in place). "Probably done" is not enough; you need to be able to point to what you can see that confirms it.
3. If the image is blurry, dark, or hard to read, say so.
4. If the same step has been attempted across 5 or more frames without clear success, assume the user has done their best and move to the next step. Do not loop on the same step indefinitely.
5. Give ONE instruction at a time. Wait for the next camera frame before giving another.
6. Speak simply and slowly as if to someone learning for the first time.
7. Only give exact physical actions — "tap the button" not "open it".
8. If a step is clearly wrong (not just unclear), say what went wrong and exactly how to fix it.
9. When all steps are done, say "ALL DONE" and congratulate them warmly.
"""

app = FastAPI()
client = genai.Client(vertexai=True, project=PROJECT_ID, location=LOCATION)
active_sessions: dict[str, asyncio.Task] = {}


def build_wav(pcm_data: bytes, sample_rate: int = 24000, channels: int = 1, bits: int = 16) -> bytes:
    data_size = len(pcm_data)
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF", data_size + 36, b"WAVE",
        b"fmt ", 16, 1, channels, sample_rate,
        sample_rate * channels * bits // 8,
        channels * bits // 8, bits,
        b"data", data_size,
    )
    return header + pcm_data


def _transcription_says_complete(response) -> bool:
    """Safely check if any transcription on this response contains the completion phrase."""
    try:
        sc = response.server_content
        if not sc:
            return False
        transcription = getattr(sc, "output_transcription", None)
        if transcription:
            text = getattr(transcription, "text", None)
            print(text.upper())
            if text and "ALL DONE" in text.upper():
                return True
        # Some SDK versions surface transcription inside model_turn parts
        model_turn = getattr(sc, "model_turn", None)
        if model_turn:
            for part in getattr(model_turn, "parts", []):
                text = getattr(part, "text", None)
                if text and "ALL DONE" in text.upper():
                    return True
    except Exception:
        pass
    return False



async def _run_session(websocket: WebSocket, task_prompt: str):
    system_prompt = SYSTEM_PROMPT_TEMPLATE.format(task_prompt=task_prompt)

    connect_cm = client.aio.live.connect(
        model="gemini-2.0-flash-live-preview-04-09",
        config=LiveConnectConfig(
            response_modalities=["AUDIO"],
            output_audio_transcription=AudioTranscriptionConfig(),
            system_instruction=system_prompt,
        ),
    )

    try:
        session = await asyncio.wait_for(connect_cm.__aenter__(), timeout=30)
    except asyncio.TimeoutError:
        print("Gemini Live API connection timed out after 30s")
        try:
            await websocket.send_json({"type": "error", "message": "Connection timeout"})
        except Exception:
            pass
        return
    except Exception as e:
        print(f"Gemini Live API connection failed: {e}")
        traceback.print_exc()
        try:
            await websocket.send_json({"type": "error", "message": "Connection failed"})
        except Exception:
            pass
        return

    try:
        frame_queue: asyncio.Queue = asyncio.Queue(maxsize=1)
        done = asyncio.Event()

        async def frame_producer():
            """Reads frames from the WebSocket and puts the latest into the queue."""
            try:
                async for message in websocket.iter_text():
                    if done.is_set():
                        break
                    if frame_queue.full():
                        frame_queue.get_nowait()
                    await frame_queue.put(message)
            except asyncio.CancelledError:
                pass

        async def process_loop():
            """Sends frames to Gemini and relays responses back to the client."""
            # Prompt the frontend for the first frame in case the initial capture
            # in ws.onopen failed (e.g. camera not yet ready when the socket opened).
            try:
                await websocket.send_json({"type": "ready"})
            except Exception:
                pass

            while not done.is_set():
                try:
                    frame = await asyncio.wait_for(frame_queue.get(), timeout=1.0)
                except asyncio.TimeoutError:
                    continue

                image_bytes = base64.b64decode(frame)
                transcription_complete = False
                try:
                    # google-genai SDK API varies by version: some require await,
                    # others changed send_client_content to an async context manager.
                    _send = session.send_client_content(
                        turns=Content(
                            role="user",
                            parts=[Part.from_bytes(data=image_bytes, mime_type="image/jpeg")],
                        ),
                        turn_complete=True,
                    )
                    if hasattr(_send, '__aenter__'):
                        async with _send:
                            pass
                    else:
                        await _send

                    try:
                        async with asyncio.timeout(15):
                            async for response in session.receive():
                                if response.data:
                                    await websocket.send_bytes(build_wav(bytes(response.data)))
                                if _transcription_says_complete(response):
                                    transcription_complete = True
                                if response.server_content and response.server_content.turn_complete:
                                    break
                    except asyncio.TimeoutError:
                        print("Gemini did not respond within 15s, continuing")
                except Exception as e:
                    print(f"Gemini session error: {e}")
                    traceback.print_exc()
                    done.set()
                    try:
                        await websocket.send_json({"type": "error", "message": "Session error"})
                    except Exception:
                        pass
                    break

                if transcription_complete:
                    done.set()
                    try:
                        await websocket.send_json({"type": "TASK_COMPLETE"})
                    except Exception as e:
                        print(f"Error sending TASK_COMPLETE: {e}")
                    return

                # Drain all stale frames — the "ready" signal will prompt the
                # frontend to send a fresh one.
                while not frame_queue.empty():
                    try:
                        frame_queue.get_nowait()
                    except asyncio.QueueEmpty:
                        break

                # Signal the frontend to send a fresh frame.
                # The loop will then block at frame_queue.get() until it arrives.
                if not done.is_set():
                    try:
                        await websocket.send_json({"type": "ready"})
                    except Exception:
                        pass

        producer_task = asyncio.create_task(frame_producer())
        processor_task = asyncio.create_task(process_loop())

        try:
            _, pending = await asyncio.wait(
                [producer_task, processor_task],
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()
                try:
                    await task
                except (asyncio.CancelledError, Exception):
                    pass
        except asyncio.CancelledError:
            done.set()
            for task in [producer_task, processor_task]:
                task.cancel()
                try:
                    await task
                except (asyncio.CancelledError, Exception):
                    pass
            raise
    finally:
        try:
            await connect_cm.__aexit__(None, None, None)
        except Exception:
            pass


@app.websocket("/live/{user_id}")
async def live_ws(websocket: WebSocket, user_id: str):
    await websocket.accept()

    # Cancel any existing session for this user
    existing = active_sessions.get(user_id)
    if existing and not existing.done():
        print(f"Cancelling existing session for user {user_id}")
        existing.cancel()
        try:
            await existing
        except (asyncio.CancelledError, Exception):
            pass

    try:
        first_message = await websocket.receive_text()
        data = json.loads(first_message)

        if data.get("type") != "task":
            await websocket.close()
            return

        task_prompt = data.get("task", data.get("prompt", ""))

        session_task = asyncio.create_task(_run_session(websocket, task_prompt))
        active_sessions[user_id] = session_task

        try:
            await session_task
        except asyncio.CancelledError:
            pass
        except Exception as e:
            print(f"Session error for user {user_id}: {e}")
            traceback.print_exc()

    except WebSocketDisconnect:
        print(f"User {user_id} disconnected")
    finally:
        active_sessions.pop(user_id, None)
        print(f"WebSocket for user {user_id} closed")
