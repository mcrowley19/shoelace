import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from google import genai
from google.genai.types import LiveConnectConfig, Part, Content, AudioTranscriptionConfig
import json
import logging
import base64
import traceback
import io
from PIL import Image

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

PROJECT_ID = "helper-489113"
LOCATION = "us-central1"

# Generic system instruction for pooled sessions.
# Task-specific instructions are injected as the first user message at runtime,
# so sessions can be pre-warmed before any user connects.
BASE_SYSTEM_INSTRUCTION = """
You are a visual AI assistant helping users complete tasks step by step using their camera.
Your specific task instructions will be provided in the first user message, along with a camera image.

Core guidelines:
1. Read and follow the specific task instructions from the first user message carefully.
2. Every time you receive a camera frame, briefly describe what you can see. Then decide whether to proceed.
3. Move to the next step only when the camera clearly shows the expected result of that step — look for specific visual evidence (e.g. a button is tapped, a setting is toggled, an item is in place). "Probably done" is not enough; you need to be able to point to what you can see that confirms it.
4. If the image is blurry, dark, or hard to read, say so.
5. If the same step has been attempted across 5 or more frames without clear success, assume the user has done their best and move to the next step. Do not loop on the same step indefinitely.
6. Give ONE instruction at a time. Wait for the next camera frame before giving another.
7. Speak simply as if to someone learning for the first time.
8. Only give exact physical actions — "tap the button" not "open it".
9. If a step is clearly wrong (not just unclear), describe what you currently see and contrast it with what is needed.
10. When all steps are done, say "ZAP".
"""


POOL_SIZE = 2


MAX_IMAGE_LONG_SIDE = 1024
JPEG_QUALITY = 80


class GeminiSessionPool:
    """
    Maintains a pool of pre-warmed Gemini Live sessions so that users get an
    instant session instead of waiting 1-3s for the API handshake.
    """

    def __init__(self, size: int):
        self._size = size
        self._queue: asyncio.Queue = asyncio.Queue(maxsize=size)

    async def _make_session(self):
        connect_cm = client.aio.live.connect(
            model="gemini-2.0-flash-live-preview-04-09",
            config=LiveConnectConfig(
                response_modalities=["AUDIO"],
                output_audio_transcription=AudioTranscriptionConfig(),
                system_instruction=BASE_SYSTEM_INSTRUCTION,
            ),
        )
        session = await asyncio.wait_for(connect_cm.__aenter__(), timeout=15)
        return session, connect_cm

    async def _add_one(self):
        try:
            pair = await self._make_session()
            try:
                self._queue.put_nowait(pair)
                print("Pool: session added", flush=True)
            except asyncio.QueueFull:
                # Pool already full — discard the extra session
                _, connect_cm = pair
                try:
                    await connect_cm.__aexit__(None, None, None)
                except Exception:
                    pass
        except Exception as e:
            print(f"Pool: failed to create session: {e}", flush=True)

    async def warmup(self):
        """Fill the pool at startup (called before the server starts serving)."""
        tasks = [asyncio.create_task(self._add_one()) for _ in range(self._size)]
        await asyncio.gather(*tasks, return_exceptions=True)
        print(f"Pool: warmed up with {self._queue.qsize()} session(s)", flush=True)

    async def acquire(self):
        """
        Return a (session, connect_cm) pair immediately from the pool if available,
        otherwise fall back to a fresh connection. Always replenishes in the background.
        """
        try:
            pair = self._queue.get_nowait()
            print("Pool: acquired from pool", flush=True)
        except asyncio.QueueEmpty:
            print("Pool: empty, connecting fresh", flush=True)
            pair = await self._make_session()
        asyncio.create_task(self._add_one())  # replenish for the next user
        return pair

    async def close_pair(self, pair):
        _, connect_cm = pair
        try:
            await connect_cm.__aexit__(None, None, None)
        except Exception:
            pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("Warming up Gemini session pool...", flush=True)
    await session_pool.warmup()
    yield


app = FastAPI(lifespan=lifespan)
client = genai.Client(vertexai=True, project=PROJECT_ID, location=LOCATION)
session_pool = GeminiSessionPool(POOL_SIZE)
active_sessions: dict[str, asyncio.Task] = {}


def _extract_transcription_chunk(response) -> str:
    """Extract transcription text from a single response, or empty string."""
    sc = response.server_content
    if sc and getattr(sc, "output_transcription", None):
        text = getattr(sc.output_transcription, "text", None)
        if text:
            return text
    return ""


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


def _resize_image(image_bytes: bytes) -> bytes:
    """Resize image so its long side is at most MAX_IMAGE_LONG_SIDE and re-encode as JPEG."""
    img = Image.open(io.BytesIO(image_bytes))
    w, h = img.size
    long_side = max(w, h)
    if long_side > MAX_IMAGE_LONG_SIDE:
        scale = MAX_IMAGE_LONG_SIDE / long_side
        new_w, new_h = int(w * scale), int(h * scale)
        img = img.resize((new_w, new_h), Image.LANCZOS)
        print(f"ln_resize: resized {w}x{h} → {new_w}x{new_h}", flush=True)
    if img.mode != "RGB":
        img = img.convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=JPEG_QUALITY, optimize=True)
    return buf.getvalue()


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
    done: asyncio.Event,
    captions: bool = False,
) -> bool:
    """Process Gemini response and send audio to frontend. Returns True if task is complete."""
    MIN_PCM_BYTES = 2400  # 50ms at 24kHz 16-bit mono
    pcm_buffer = bytearray()
    transcription_complete = False
    audio_chunks_sent = 0
    transcription_buffer = ""

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

                chunk = _extract_transcription_chunk(response)
                if chunk:
                    transcription_buffer += chunk
                    print(f"ln131: transcription buffer: {transcription_buffer!r}", flush=True)
                    if captions:
                        try:
                            await websocket.send_json({"type": "transcription", "text": chunk})
                        except Exception as e:
                            print(f"ln_cap: error sending transcription chunk: {e}", flush=True)
                    if "ZAP" in transcription_buffer.upper().replace(" ", ""):
                        print("ln132: ZAP detected in transcription buffer, marking task complete", flush=True)
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


async def _send_error(websocket: WebSocket, message: str) -> None:
    """Send an error message to the frontend so it can trigger reconnect logic."""
    print(f"ln_err: sending error to frontend: {message}", flush=True)
    try:
        await websocket.send_json({"type": "error", "message": message})
    except Exception:
        pass


async def _process_frame(
    session,
    websocket: WebSocket,
    frame: str,
    frame_queue: asyncio.Queue,
    done: asyncio.Event,
    task_prompt: str | None = None,
    captions: bool = False,
) -> bool:
    """
    Process a single camera frame. Returns True if task is complete.
    If task_prompt is provided, it is prepended as a text part in the same turn
    (used for the first frame to inject task instructions into a pooled session).
    """
    print(f"ln_pf: processing frame (base64 len={len(frame)}, inject_task={task_prompt is not None})", flush=True)
    try:
        raw_bytes = base64.b64decode(frame)
        print(f"ln_pf: decoded frame to {len(raw_bytes)} bytes", flush=True)
        image_bytes = await asyncio.get_event_loop().run_in_executor(None, _resize_image, raw_bytes)
        print(f"ln_pf: resized/compressed to {len(image_bytes)} bytes", flush=True)
    except Exception as e:
        print(f"ln_pf: error decoding/resizing frame: {e}", flush=True)
        if not done.is_set():
            await _send_ready_signal(websocket)
        return False

    try:
        parts = []
        if task_prompt:
            parts.append(Part(text=task_prompt))
        parts.append(Part.from_bytes(data=image_bytes, mime_type="image/jpeg"))

        print("ln_pf: sending frame to Gemini", flush=True)
        await session.send_client_content(
            turns=Content(role="user", parts=parts),
            turn_complete=True,
        )

        transcription_complete = await _process_gemini_response(session, websocket, done, captions)

        if transcription_complete:
            print("ln_pf: task complete, setting done event", flush=True)
            done.set()
            await _send_task_complete(websocket)
            return True

        _drain_frame_queue(frame_queue)
        if not done.is_set():
            await _send_ready_signal(websocket)

        return False
    except WebSocketDisconnect:
        raise
    except Exception as e:
        print(f"ln_pf: Gemini session error: {e}", flush=True)
        logger.exception(f"Gemini session error: {e}")
        done.set()
        await _send_error(websocket, str(e))
        return False


async def _process_loop(
    session,
    websocket: WebSocket,
    frame_queue: asyncio.Queue,
    done: asyncio.Event,
    task_prompt: str,
    captions: bool = False,
) -> None:
    """
    Main processing loop. Does NOT send an initial "ready" signal — the frontend
    already captures and sends the first frame immediately on WS open. The first
    frame is combined with the task_prompt so the pooled session receives task
    context at the same moment it sees the camera image.
    """
    print("ln_pl: process loop started, waiting for first frame", flush=True)

    first_frame = True
    frame_index = 0

    while not done.is_set():
        try:
            frame = await asyncio.wait_for(frame_queue.get(), timeout=1.0)
            frame_index += 1
            print(f"ln_pl: got frame {frame_index} from queue", flush=True)
        except asyncio.TimeoutError:
            continue

        if first_frame:
            task_complete = await _process_frame(session, websocket, frame, frame_queue, done, task_prompt, captions)
            first_frame = False
        else:
            task_complete = await _process_frame(session, websocket, frame, frame_queue, done, captions=captions)

        if task_complete:
            print(f"ln_pl: task complete after {frame_index} frame(s)", flush=True)
            return


async def _run_session(websocket: WebSocket, task_prompt: str, captions: bool = False):
    """Acquire a pre-warmed Gemini session and run the main processing loop."""
    print("ln_rs: acquiring Gemini session from pool", flush=True)
    try:
        pair = await asyncio.wait_for(session_pool.acquire(), timeout=12)
    except Exception as e:
        print(f"ln_rs: failed to acquire session: {e}", flush=True)
        await _send_error(websocket, "Failed to connect to AI")
        return

    session, _ = pair
    print("ln_rs: session ready", flush=True)

    try:
        frame_queue: asyncio.Queue = asyncio.Queue(maxsize=1)
        done = asyncio.Event()

        print("ln_rs: creating producer and processor tasks", flush=True)
        producer_task = asyncio.create_task(_frame_producer(websocket, frame_queue, done))
        processor_task = asyncio.create_task(_process_loop(session, websocket, frame_queue, done, task_prompt, captions))

        try:
            _, pending = await asyncio.wait(
                [producer_task, processor_task],
                return_when=asyncio.FIRST_COMPLETED,
            )
            print(f"ln_rs: one task finished, cancelling {len(pending)} pending task(s)", flush=True)
            for task in pending:
                task.cancel()
                try:
                    await task
                except (asyncio.CancelledError, Exception):
                    pass
        except asyncio.CancelledError:
            print("ln_rs: session cancelled, cleaning up tasks", flush=True)
            done.set()
            for task in [producer_task, processor_task]:
                task.cancel()
                try:
                    await task
                except (asyncio.CancelledError, Exception):
                    pass
            raise
    finally:
        print("ln_rs: closing Gemini session", flush=True)
        await session_pool.close_pair(pair)


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


async def _handle_session_startup(websocket: WebSocket) -> tuple[str, bool] | tuple[None, bool]:
    """Handle the initial message to extract the task prompt and captions flag."""
    print("ln298: waiting for initial task message", flush=True)
    try:
        first_message = await websocket.receive_text()
        print(f"ln301: received first message: {first_message}", flush=True)
        data = json.loads(first_message)

        if data.get("type") != "task":
            print(f"ln305: unexpected message type: {data.get('type')}, closing", flush=True)
            await websocket.close()
            return None, False

        task_prompt = data.get("task", data.get("prompt", ""))
        captions = bool(data.get("captions", False))
        print(f"ln310: extracted task prompt (len={len(task_prompt)}), captions={captions}", flush=True)
        return task_prompt, captions
    except (WebSocketDisconnect, json.JSONDecodeError) as e:
        logger.warning(f"Error during session startup: {e}")
        return None, False


@app.websocket("/live/{user_id}")
async def live_ws(websocket: WebSocket, user_id: str):
    await websocket.accept()
    print(f"ln320: WebSocket connected for user {user_id}", flush=True)
    await _cancel_existing_session(user_id)

    try:
        task_prompt, captions = await _handle_session_startup(websocket)
        if not task_prompt:
            print(f"ln326: no task prompt received, closing session for user {user_id}", flush=True)
            return
        print(f"ln328: task prompt received, starting session for user {user_id}", flush=True)
        session_task = asyncio.create_task(_run_session(websocket, task_prompt, captions))
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
