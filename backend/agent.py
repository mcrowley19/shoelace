import asyncio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from google import genai
from google.genai.types import LiveConnectConfig, Part, Content, AudioTranscriptionConfig
import json
import logging
import base64
import traceback

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

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
9. When all steps are done, say "BEEP".
"""

app = FastAPI()
client = genai.Client(vertexai=True, project=PROJECT_ID, location=LOCATION)
active_sessions: dict[str, asyncio.Task] = {}


def _transcription_says_complete(response) -> bool:
    """Safely check if any transcription on this response contains the completion phrase."""
    sc = response.server_content
    if sc and getattr(sc, "output_transcription", None):
        transcription = sc.output_transcription
        text = getattr(transcription, "text", None)
        if text:
            text_upper = text.upper()
            print(f"ln44: transcription text: {text_upper}", flush=True)
            if "BEEP" in text_upper:
                print("ln46: BEEP detected, marking task complete", flush=True)
                return True
    return False


async def _send_ready_signal(websocket: WebSocket) -> None:
    """Send a ready signal to the frontend to request the next frame."""
    print("ln53: sending ready signal to frontend", flush=True)
    try:
        await websocket.send_json({"type": "ready"})
    except Exception as e:
        print(f"ln57: error sending ready signal: {e}", flush=True)


async def _send_task_complete(websocket: WebSocket) -> None:
    """Notify the frontend that the task is complete."""
    print("ln62: sending TASK_COMPLETE to frontend", flush=True)
    try:
        await websocket.send_json({"type": "TASK_COMPLETE"})
    except Exception as e:
        print(f"ln66: error sending TASK_COMPLETE: {e}", flush=True)


def _drain_frame_queue(frame_queue: asyncio.Queue) -> None:
    """Remove all stale frames from the queue."""
    drained = 0
    while not frame_queue.empty():
        try:
            frame_queue.get_nowait()
            drained += 1
        except asyncio.QueueEmpty:
            break
    if drained:
        print(f"ln79: drained {drained} stale frame(s) from queue", flush=True)


async def _frame_producer(websocket: WebSocket, frame_queue: asyncio.Queue, done: asyncio.Event) -> None:
    """Reads frames from the WebSocket and puts the latest into the queue."""
    print("ln84: frame producer started", flush=True)
    frame_count = 0
    try:
        async for message in websocket.iter_text():
            if done.is_set():
                print("ln89: done event set, stopping frame producer", flush=True)
                break
            if frame_queue.full():
                frame_queue.get_nowait()
                print("ln93: dropped stale frame from full queue", flush=True)
            await frame_queue.put(message)
            frame_count += 1
            print(f"ln96: frame {frame_count} queued (message len={len(message)})", flush=True)
    except WebSocketDisconnect as e:
        print(f"ln98: WebSocket disconnected in frame producer: {e}", flush=True)
    except asyncio.CancelledError:
        print(f"ln100: frame producer cancelled after {frame_count} frames", flush=True)
        raise


async def _process_gemini_response(
    session,
    websocket: WebSocket,
    done: asyncio.Event
) -> bool:
    """Process Gemini response and send audio to frontend. Returns True if task is complete."""
    MIN_PCM_BYTES = 12000  # 250ms at 24kHz 16-bit mono
    pcm_buffer = bytearray()
    transcription_complete = False
    audio_chunks_sent = 0

    print("ln115: waiting for Gemini response", flush=True)
    try:
        async with asyncio.timeout(15):
            async for response in session.receive():
                if response.data:
                    pcm_buffer.extend(response.data)
                    if len(pcm_buffer) >= MIN_PCM_BYTES:
                        # Trim to 2-byte boundary for 16-bit sample alignment
                        send_len = len(pcm_buffer) & ~1
                        await websocket.send_bytes(bytes(pcm_buffer[:send_len]))
                        del pcm_buffer[:send_len]
                        audio_chunks_sent += 1
                        print(f"ln127: sent audio chunk {audio_chunks_sent} ({send_len} bytes)", flush=True)

                if _transcription_says_complete(response):
                    transcription_complete = True

                if response.server_content and response.server_content.turn_complete:
                    print("ln133: Gemini turn complete", flush=True)
                    break

        if pcm_buffer:
            send_len = len(pcm_buffer) & ~1
            if send_len > 0:
                await websocket.send_bytes(bytes(pcm_buffer[:send_len]))
                print(f"ln140: flushed remaining {send_len} bytes of audio", flush=True)
    except asyncio.TimeoutError:
        print("ln142: Gemini response timed out after 15s", flush=True)
    except WebSocketDisconnect:
        raise

    print(f"ln146: Gemini response processed, transcription_complete={transcription_complete}, audio_chunks_sent={audio_chunks_sent}", flush=True)
    return transcription_complete


async def _process_frame(
    session,
    websocket: WebSocket,
    frame: str,
    frame_queue: asyncio.Queue,
    done: asyncio.Event
) -> bool:
    """Process a single camera frame. Returns True if task is complete."""
    print(f"ln158: processing frame (base64 len={len(frame)})", flush=True)
    try:
        image_bytes = base64.b64decode(frame)
        print(f"ln161: decoded frame to {len(image_bytes)} bytes", flush=True)
    except Exception as e:
        print(f"ln163: error decoding frame: {e}", flush=True)
        return False

    try:
        print("ln167: sending frame to Gemini", flush=True)
        await session.send_client_content(
            turns=Content(
                role="user",
                parts=[Part.from_bytes(data=image_bytes, mime_type="image/jpeg")],
            ),
            turn_complete=True,
        )

        transcription_complete = await _process_gemini_response(session, websocket, done)

        if transcription_complete:
            print("ln179: task complete, setting done event", flush=True)
            done.set()
            await _send_task_complete(websocket)
            return True

        # Drain stale frames and request a fresh one
        _drain_frame_queue(frame_queue)
        if not done.is_set():
            await _send_ready_signal(websocket)

        return False
    except Exception as e:
        print(f"ln191: Gemini session error: {e}", flush=True)
        logger.exception(f"Gemini session error: {e}")
        done.set()
        try:
            await websocket.close()
        except Exception:
            pass
        return False

async def _process_loop(
    session,
    websocket: WebSocket,
    frame_queue: asyncio.Queue,
    done: asyncio.Event
) -> None:
    """Main processing loop: retrieves frames and sends them to Gemini."""
    print("ln207: process loop started, sending initial ready signal", flush=True)
    await _send_ready_signal(websocket)

    frame_index = 0
    while not done.is_set():
        try:
            frame = await asyncio.wait_for(frame_queue.get(), timeout=1.0)
            frame_index += 1
            print(f"ln215: got frame {frame_index} from queue", flush=True)
        except asyncio.TimeoutError:
            continue

        task_complete = await _process_frame(session, websocket, frame, frame_queue, done)
        if task_complete:
            print(f"ln221: task complete after {frame_index} frames", flush=True)
            return


async def _run_session(websocket: WebSocket, task_prompt: str):
    """Establish Gemini session and run the main processing loop."""
    print(f"ln227: starting Gemini session, task_prompt length={len(task_prompt)}", flush=True)
    system_prompt = SYSTEM_PROMPT_TEMPLATE.format(task_prompt=task_prompt)

    connect_cm = client.aio.live.connect(
        model="gemini-2.0-flash-live-preview-04-09",
        config=LiveConnectConfig(
            response_modalities=["AUDIO"],
            output_audio_transcription=AudioTranscriptionConfig(),
            system_instruction=system_prompt,
        ),
    )
    print("ln238: connecting to Gemini live API", flush=True)
    try:
        session = await asyncio.wait_for(connect_cm.__aenter__(), timeout=10)
        print("ln241: Gemini session established", flush=True)
    except asyncio.TimeoutError:
        print("ln243: timed out connecting to Gemini (10s)", flush=True)
        return

    try:
        frame_queue: asyncio.Queue = asyncio.Queue(maxsize=1)
        done = asyncio.Event()

        print("ln250: creating producer and processor tasks", flush=True)
        producer_task = asyncio.create_task(_frame_producer(websocket, frame_queue, done))
        processor_task = asyncio.create_task(_process_loop(session, websocket, frame_queue, done))

        try:
            _, pending = await asyncio.wait(
                [producer_task, processor_task],
                return_when=asyncio.FIRST_COMPLETED,
            )
            print(f"ln259: one task finished, cancelling {len(pending)} pending task(s)", flush=True)
            for task in pending:
                task.cancel()
                try:
                    await task
                except (asyncio.CancelledError, Exception):
                    pass
        except asyncio.CancelledError:
            print("ln267: session cancelled, cleaning up tasks", flush=True)
            done.set()
            for task in [producer_task, processor_task]:
                task.cancel()
                try:
                    await task
                except (asyncio.CancelledError, Exception):
                    pass
            raise
    finally:
        print("ln277: closing Gemini session", flush=True)
        try:
            await connect_cm.__aexit__(None, None, None)
        except Exception:
            pass


async def _cancel_existing_session(user_id: str) -> None:
    """Cancel any existing session for the given user."""
    existing = active_sessions.get(user_id)
    if existing and not existing.done():
        print(f"ln288: cancelling existing session for user {user_id}", flush=True)
        existing.cancel()
        try:
            await existing
        except (asyncio.CancelledError, Exception):
            pass


async def _handle_session_startup(websocket: WebSocket) -> str | None:
    """Handle the initial message to extract the task prompt. Returns task_prompt or None."""
    print("ln298: waiting for initial task message", flush=True)
    try:
        first_message = await websocket.receive_text()
        print(f"ln301: received first message: {first_message}", flush=True)
        data = json.loads(first_message)

        if data.get("type") != "task":
            print(f"ln305: unexpected message type: {data.get('type')}, closing", flush=True)
            await websocket.close()
            return None

        task_prompt = data.get("task", data.get("prompt", ""))
        print(f"ln310: extracted task prompt (len={len(task_prompt)})", flush=True)
        return task_prompt
    except (WebSocketDisconnect, json.JSONDecodeError) as e:
        logger.warning(f"Error during session startup: {e}")
        return None


@app.websocket("/live/{user_id}")
async def live_ws(websocket: WebSocket, user_id: str):
    await websocket.accept()
    print(f"ln320: WebSocket connected for user {user_id}", flush=True)
    await _cancel_existing_session(user_id)

    try:
        task_prompt = await _handle_session_startup(websocket)
        if not task_prompt:
            print(f"ln326: no task prompt received, closing session for user {user_id}", flush=True)
            return
        print(f"ln328: task prompt received, starting session for user {user_id}", flush=True)
        session_task = asyncio.create_task(_run_session(websocket, task_prompt))
        active_sessions[user_id] = session_task

        try:
            await session_task
        except asyncio.CancelledError:
            print(f"ln335: session cancelled for user {user_id}", flush=True)
        except Exception as e:
            print(f"ln337: session error for user {user_id}: {e}", flush=True)
            traceback.print_exc()

    except WebSocketDisconnect:
        print(f"ln341: user {user_id} disconnected during startup", flush=True)
    finally:
        active_sessions.pop(user_id, None)
        print(f"ln344: WebSocket for user {user_id} closed", flush=True)
