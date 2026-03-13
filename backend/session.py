import asyncio
import base64
import json

from fastapi import WebSocket, WebSocketDisconnect
from google.genai.types import Content, Part

from config import logger
from pool import session_pool
from utils import (
    _apply_fade_in,
    _drain_frame_queue,
    _extract_transcription_chunk,
    _resize_image,
    _send_error,
    _send_ready_signal,
    _send_task_complete,
)

active_sessions: dict[str, asyncio.Task] = {}


async def _frame_producer(websocket: WebSocket, frame_queue: asyncio.Queue, done: asyncio.Event) -> None:
    """Reads messages from the WebSocket and puts tagged (type, data) tuples into the queue."""
    print("ln84: frame producer started", flush=True)
    frame_count = 0
    try:
        async for message in websocket.iter_text():
            if done.is_set():
                print("ln89: done event set, stopping frame producer", flush=True)
                break
            try:
                data = json.loads(message)
                if data.get("type") == "audio":
                    item = ("audio", data["data"])
                else:
                    continue  # ignore unknown JSON types
            except (json.JSONDecodeError, KeyError, TypeError):
                item = ("image", message)  # raw base64 image frame

            if frame_queue.full():
                frame_queue.get_nowait()
                print("ln93: dropped stale item from full queue", flush=True)
            await frame_queue.put(item)
            frame_count += 1
            print(f"ln96: item {frame_count} queued (type={item[0]})", flush=True)
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
    timeout: int = 8,
) -> tuple[bool, str]:
    """Process Gemini response and send audio to frontend. Returns (task_complete, transcription)."""
    MIN_PCM_BYTES = 960  # 20ms at 24kHz 16-bit mono
    pcm_buffer = bytearray()
    transcription_complete = False
    audio_chunks_sent = 0
    transcription_buffer = ""

    print("ln115: waiting for Gemini response", flush=True)
    try:
        async with asyncio.timeout(timeout):
            async for response in session.receive():
                if response.data:
                    pcm_buffer.extend(response.data)
                    if len(pcm_buffer) >= MIN_PCM_BYTES:
                        # Trim to 2-byte boundary for 16-bit sample alignment
                        send_len = len(pcm_buffer) & ~1
                        chunk = bytes(pcm_buffer[:send_len])
                        if audio_chunks_sent == 0:
                            chunk = _apply_fade_in(chunk)
                        await websocket.send_bytes(chunk)
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
        print("ln142: Gemini response timed out after 5s", flush=True)
    except WebSocketDisconnect:
        raise

    print(f"ln146: Gemini response processed, transcription_complete={transcription_complete}, audio_chunks_sent={audio_chunks_sent}", flush=True)
    return transcription_complete, transcription_buffer


def _build_frame_reminder(last_transcription: str) -> str:
    base = (
        "New camera frame. Frames are sent automatically at regular intervals — a new frame does NOT mean the user has done anything. "
        "Evaluate this image from scratch. Do not assume progress since the last frame. "
        "Look at what is ACTUALLY visible and determine the current state independently. "
        "If they have gone backwards (something came undone, was unfolded, etc.), go back to the matching step casually."
    )
    if last_transcription:
        return (
            f"{base} "
            f"You last said: \"{last_transcription.strip()}\". "
            f"BEFORE saying anything new, check: does this image show that instruction was completed? "
            f"If it was NOT completed, do NOT advance. Either stay silent (if nothing changed) or give a short correction. "
            f"Only move to the next step if you can see specific visual proof that what you last instructed is now done."
        )
    return base


async def _safe_send(websocket: WebSocket, send_func, *args, **kwargs):
    """Guard websocket sends against closed connections."""
    try:
        if websocket.client_state.name != "CONNECTED":
            return
        await send_func(websocket, *args, **kwargs)
    except (WebSocketDisconnect, RuntimeError):
        pass


async def _process_frame(
    session,
    websocket: WebSocket,
    frame: str,
    frame_queue: asyncio.Queue,
    done: asyncio.Event,
    task_prompt: str | None = None,
    captions: bool = False,
    last_transcription: str = "",
) -> tuple[bool, str]:
    """
    Process a single camera frame. Returns (task_complete, transcription).
    If task_prompt is provided, it is prepended as a text part in the same turn
    (used for the first frame to inject task instructions into a pooled session).
    On subsequent frames a dynamic reminder is prepended that includes the last
    response so the AI does not repeat itself.
    """
    print(f"ln_pf: processing frame (base64 len={len(frame)}, inject_task={task_prompt is not None})", flush=True)

    def _is_connected():
        return websocket.client_state.name == "CONNECTED"

    try:
        raw_bytes = base64.b64decode(frame)
        print(f"ln_pf: decoded frame to {len(raw_bytes)} bytes", flush=True)
        image_bytes = await asyncio.get_event_loop().run_in_executor(None, _resize_image, raw_bytes)
        print(f"ln_pf: resized/compressed to {len(image_bytes)} bytes", flush=True)
    except Exception as e:
        print(f"ln_pf: error decoding/resizing frame: {e}", flush=True)
        if not done.is_set():
            await _safe_send(websocket, _send_ready_signal)
        return False, last_transcription

    try:
        if not _is_connected():
            print("ln_pf: websocket gone before Gemini send, aborting", flush=True)
            done.set()
            return False, last_transcription

        parts = []
        if task_prompt:
            parts.append(Part(text=task_prompt))
        else:
            parts.append(Part(text=_build_frame_reminder(last_transcription)))
        parts.append(Part.from_bytes(data=image_bytes, mime_type="image/jpeg"))

        print("ln_pf: sending frame to Gemini", flush=True)
        await session.send_client_content(
            turns=Content(role="user", parts=parts),
            turn_complete=True,
        )

        if not _is_connected():
            print("ln_pf: websocket gone after Gemini send, aborting", flush=True)
            done.set()
            return False, last_transcription

        transcription_complete, transcription = await _process_gemini_response(session, websocket, done, captions)

        if transcription_complete:
            print("ln_pf: task complete, setting done event", flush=True)
            done.set()
            await _safe_send(websocket, _send_task_complete)
            return True, transcription

        _drain_frame_queue(frame_queue)
        if not done.is_set():
            await _safe_send(websocket, _send_ready_signal)

        return False, transcription

    except WebSocketDisconnect:
        print("ln_pf: client disconnected, setting done", flush=True)
        done.set()
        raise

    except Exception as e:
        if not _is_connected():
            print(f"ln_pf: ignoring error on dead socket: {e}", flush=True)
            done.set()
            return False, last_transcription

        print(f"ln_pf: Gemini session error: {e}", flush=True)
        logger.exception(f"Gemini session error: {e}")
        done.set()
        await _safe_send(websocket, _send_error, str(e))
        return False, last_transcription


async def _process_audio_input(
    session,
    websocket: WebSocket,
    audio_b64: str,
    frame_queue: asyncio.Queue,
    done: asyncio.Event,
    captions: bool = False,
) -> tuple[bool, str]:
    """Process a discrete user voice input. Returns (task_complete, transcription)."""
    print("ln_pai: processing user audio input", flush=True)
    try:
        audio_bytes = base64.b64decode(audio_b64)
        if len(audio_bytes) < 100:
            print("ln_pai: audio data too small, skipping", flush=True)
            if not done.is_set():
                await _send_ready_signal(websocket)
            return False, ""
        print(f"ln_pai: sending {len(audio_bytes)} WAV bytes to Gemini", flush=True)
        await session.send_client_content(
            turns=Content(role="user", parts=[
                Part(text="The user is speaking to you directly. Listen to their audio message carefully and respond to what they are saying. If they are asking a question, answer it. If they are asking for help or clarification about the current step, help them."),
                Part.from_bytes(data=audio_bytes, mime_type="audio/wav"),
            ]),
            turn_complete=True,
        )
        transcription_complete, transcription = await _process_gemini_response(session, websocket, done, captions, timeout=15)
        if transcription_complete:
            print("ln_pai: task complete via user audio", flush=True)
            done.set()
            await _send_task_complete(websocket)
            return True, transcription
        _drain_frame_queue(frame_queue)
        if not done.is_set():
            await _send_ready_signal(websocket)
        return False, transcription
    except WebSocketDisconnect:
        raise
    except Exception as e:
        print(f"ln_pai: audio input error: {e}", flush=True)
        logger.exception(f"Audio input error: {e}")
        done.set()
        await _send_error(websocket, str(e))
        return False, ""


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
    last_transcription = ""

    while not done.is_set():
        try:
            item = await asyncio.wait_for(frame_queue.get(), timeout=1.0)
            frame_index += 1
        except asyncio.TimeoutError:
            continue

        msg_type, data = item
        print(f"ln_pl: got item {frame_index} (type={msg_type}) from queue", flush=True)

        if msg_type == "audio":
            task_complete, transcription = await _process_audio_input(session, websocket, data, frame_queue, done, captions)
        elif first_frame:
            task_complete, transcription = await _process_frame(session, websocket, data, frame_queue, done, task_prompt, captions)
            first_frame = False
        else:
            task_complete, transcription = await _process_frame(session, websocket, data, frame_queue, done, captions=captions, last_transcription=last_transcription)

        if transcription:
            last_transcription = transcription

        if task_complete:
            print(f"ln_pl: task complete after {frame_index} item(s)", flush=True)
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
