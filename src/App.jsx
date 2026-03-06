import { useCallback, useEffect, useRef, useState } from "react";
import Webcam from "react-webcam";

const MAX_CAPTURES = 12;
const MAX_PERSISTED_PHOTOS = 8;
const MAX_VIDEO_DURATION_MS = 60_000;
const MAX_VIDEO_DURATION_SECONDS = 60;
const PHOTO_STORAGE_KEY = "photosot-local-photos-v1";
const VIDEO_MIME_TYPES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

function getSupportedVideoMimeType() {
  if (typeof MediaRecorder === "undefined") {
    return "";
  }

  return (
    VIDEO_MIME_TYPES.find((mimeType) =>
      MediaRecorder.isTypeSupported(mimeType),
    ) ?? ""
  );
}

function formatDuration(totalSeconds) {
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");

  return `${minutes}:${seconds}`;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load photo."));
    image.src = src;
  });
}

function formatCoordinates(latitude, longitude) {
  const latCardinal = latitude >= 0 ? "N" : "S";
  const lonCardinal = longitude >= 0 ? "E" : "W";
  const lat = `${Math.abs(latitude).toFixed(3)}°${latCardinal}`;
  const lon = `${Math.abs(longitude).toFixed(3)}°${lonCardinal}`;

  return `${lat}, ${lon}`;
}

function getLocationLabel() {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve("Location unavailable");
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        resolve(formatCoordinates(coords.latitude, coords.longitude));
      },
      () => {
        resolve("Location unavailable");
      },
      {
        enableHighAccuracy: false,
        timeout: 5000,
        maximumAge: 60_000,
      },
    );
  });
}

function truncateText(context, text, maxWidth) {
  if (context.measureText(text).width <= maxWidth) {
    return text;
  }

  let trimmed = text;

  while (
    trimmed.length > 1 &&
    context.measureText(`${trimmed}...`).width > maxWidth
  ) {
    trimmed = trimmed.slice(0, -1);
  }

  return `${trimmed}...`;
}

function triggerDownload(blob, fileName) {
  const blobUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = blobUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}

function App() {
  const webcamRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const recordingTimeoutRef = useRef(null);
  const recordingIntervalRef = useRef(null);
  const recordingStartedAtRef = useRef(null);
  const capturesRef = useRef([]);

  const [captures, setCaptures] = useState([]);
  const [screen, setScreen] = useState("capture");
  const [mode, setMode] = useState("photo");
  const [selectedCaptureId, setSelectedCaptureId] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [isApplyingEffect, setIsApplyingEffect] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [liveLocationLabel, setLiveLocationLabel] = useState("Locating...");

  const videoConstraints = {
    aspectRatio: 9 / 16,
    facingMode: "user",
  };

  const photoCaptures = captures.filter((capture) => capture.type === "photo");
  const latestPhoto = photoCaptures[0] ?? null;
  const selectedPhoto =
    photoCaptures.find((capture) => capture.id === selectedCaptureId) ?? null;
  const hasVideoSupport = typeof MediaRecorder !== "undefined";

  const safeAreaStyle = {
    paddingTop: "max(1rem, env(safe-area-inset-top))",
    paddingBottom: "max(1.2rem, env(safe-area-inset-bottom))",
  };

  useEffect(() => {
    capturesRef.current = captures;
  }, [captures]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLiveLocationLabel("Location unavailable");
      return undefined;
    }

    const watchId = navigator.geolocation.watchPosition(
      ({ coords }) => {
        setLiveLocationLabel(formatCoordinates(coords.latitude, coords.longitude));
      },
      () => {
        setLiveLocationLabel("Location unavailable");
      },
      {
        enableHighAccuracy: false,
        timeout: 10_000,
        maximumAge: 20_000,
      },
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PHOTO_STORAGE_KEY);

      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw);

      if (!Array.isArray(parsed)) {
        return;
      }

      const restoredPhotos = parsed
        .filter(
          (item) =>
            typeof item?.id === "string" &&
            typeof item?.src === "string" &&
            item?.type === "photo",
        )
        .map((item) => ({
          id: item.id,
          type: "photo",
          src: item.src,
          createdAt:
            typeof item.createdAt === "string"
              ? item.createdAt
              : new Date().toISOString(),
          locationLabel:
            typeof item.locationLabel === "string"
              ? item.locationLabel
              : "Location unavailable",
        }));

      if (restoredPhotos.length > 0) {
        setCaptures(restoredPhotos.slice(0, MAX_CAPTURES));
      }
    } catch {
      // If local photo state is corrupted, app still starts with an empty gallery.
    }
  }, []);

  useEffect(() => {
    const persistedPhotos = captures
      .filter((capture) => capture.type === "photo")
      .slice(0, MAX_PERSISTED_PHOTOS)
      .map((capture) => ({
        id: capture.id,
        type: "photo",
        src: capture.src,
        createdAt: capture.createdAt,
        locationLabel: capture.locationLabel,
      }));

    try {
      localStorage.setItem(PHOTO_STORAGE_KEY, JSON.stringify(persistedPhotos));
    } catch {
      // Ignore storage quota issues and keep runtime captures.
    }
  }, [captures]);

  useEffect(() => {
    if (!statusMessage) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => setStatusMessage(""), 3000);

    return () => window.clearTimeout(timeoutId);
  }, [statusMessage]);

  const clearRecordingTimers = useCallback(() => {
    if (recordingTimeoutRef.current) {
      window.clearTimeout(recordingTimeoutRef.current);
      recordingTimeoutRef.current = null;
    }

    if (recordingIntervalRef.current) {
      window.clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearRecordingTimers();

      capturesRef.current.forEach((capture) => {
        if (capture.type === "video") {
          URL.revokeObjectURL(capture.src);
        }
      });
    };
  }, [clearRecordingTimers]);

  const appendCapture = useCallback((nextCapture) => {
    setCaptures((currentCaptures) => {
      const nextCaptures = [nextCapture, ...currentCaptures];
      const trimmedCaptures = nextCaptures.slice(MAX_CAPTURES);

      trimmedCaptures.forEach((capture) => {
        if (capture.type === "video") {
          URL.revokeObjectURL(capture.src);
        }
      });

      return nextCaptures.slice(0, MAX_CAPTURES);
    });
  }, []);

  const capturePhoto = useCallback(() => {
    const src = webcamRef.current?.getScreenshot();

    if (!src) {
      return;
    }

    appendCapture({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: "photo",
      src,
      createdAt: new Date().toISOString(),
      locationLabel:
        liveLocationLabel === "Locating..."
          ? "Location unavailable"
          : liveLocationLabel,
    });
  }, [appendCapture, liveLocationLabel]);

  const stopVideoCapture = useCallback(() => {
    const mediaRecorder = mediaRecorderRef.current;

    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }
  }, []);

  const startVideoCapture = useCallback(() => {
    const stream = webcamRef.current?.stream;

    if (!stream || typeof MediaRecorder === "undefined") {
      return;
    }

    clearRecordingTimers();
    recordedChunksRef.current = [];

    const mimeType = getSupportedVideoMimeType();
    const mediaRecorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);

    mediaRecorderRef.current = mediaRecorder;
    recordingStartedAtRef.current = Date.now();

    mediaRecorder.ondataavailable = ({ data }) => {
      if (data && data.size > 0) {
        recordedChunksRef.current.push(data);
      }
    };

    mediaRecorder.onstop = () => {
      const durationMs = recordingStartedAtRef.current
        ? Date.now() - recordingStartedAtRef.current
        : 0;
      const duration = Math.min(
        MAX_VIDEO_DURATION_SECONDS,
        Math.max(1, Math.round(durationMs / 1000)),
      );
      const chunks = recordedChunksRef.current;
      const nextMimeType = mediaRecorder.mimeType || "video/webm";

      clearRecordingTimers();
      mediaRecorderRef.current = null;
      recordingStartedAtRef.current = null;
      recordedChunksRef.current = [];
      setIsRecording(false);
      setRecordingSeconds(0);

      if (chunks.length === 0) {
        return;
      }

      const blob = new Blob(chunks, { type: nextMimeType });

      if (blob.size === 0) {
        return;
      }

      appendCapture({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: "video",
        src: URL.createObjectURL(blob),
        duration,
        createdAt: new Date().toISOString(),
      });
    };

    mediaRecorder.start();
    setIsRecording(true);
    setRecordingSeconds(0);

    recordingIntervalRef.current = window.setInterval(() => {
      const elapsedSeconds = recordingStartedAtRef.current
        ? Math.floor((Date.now() - recordingStartedAtRef.current) / 1000)
        : 0;

      setRecordingSeconds(
        Math.min(elapsedSeconds, MAX_VIDEO_DURATION_SECONDS),
      );
    }, 250);

    recordingTimeoutRef.current = window.setTimeout(() => {
      if (mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
      }
    }, MAX_VIDEO_DURATION_MS);
  }, [appendCapture, clearRecordingTimers]);

  const handleShutter = useCallback(() => {
    if (mode === "photo") {
      capturePhoto();
      return;
    }

    if (isRecording) {
      stopVideoCapture();
      return;
    }

    startVideoCapture();
  }, [capturePhoto, isRecording, mode, startVideoCapture, stopVideoCapture]);

  const openGallery = useCallback(() => {
    setScreen("gallery");
  }, []);

  const openEditor = useCallback((captureId) => {
    setSelectedCaptureId(captureId);
    setScreen("editor");
    setStatusMessage("");
  }, []);

  const exportWithPolaroidFrame = useCallback(async () => {
    if (!selectedPhoto || isApplyingEffect) {
      return;
    }

    try {
      setIsApplyingEffect(true);
      setStatusMessage("");

      const [image, fallbackLocationLabel] = await Promise.all([
        loadImage(selectedPhoto.src),
        getLocationLabel(),
      ]);

      const capturedAt = selectedPhoto.createdAt
        ? new Date(selectedPhoto.createdAt)
        : new Date();
      const formattedDate = new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(capturedAt);
      const resolvedLocationLabel =
        selectedPhoto.locationLabel &&
        selectedPhoto.locationLabel !== "Location unavailable"
          ? selectedPhoto.locationLabel
          : liveLocationLabel !== "Locating..."
            ? liveLocationLabel
            : fallbackLocationLabel;

      const photoWidth = image.naturalWidth || image.width;
      const photoHeight = image.naturalHeight || image.height;
      const sidePadding = Math.max(32, Math.round(photoWidth * 0.065));
      const topPadding = Math.max(30, Math.round(photoWidth * 0.05));
      const bottomPadding = Math.max(170, Math.round(photoWidth * 0.28));
      const frameWidth = photoWidth + sidePadding * 2;
      const frameHeight = photoHeight + topPadding + bottomPadding;
      const canvas = document.createElement("canvas");

      canvas.width = frameWidth;
      canvas.height = frameHeight;

      const context = canvas.getContext("2d");

      if (!context) {
        throw new Error("Canvas is not available.");
      }

      context.fillStyle = "#f2efe6";
      context.fillRect(0, 0, frameWidth, frameHeight);

      // Keep photo pixels unchanged; no blur/filters/cropping are applied here.
      context.drawImage(image, sidePadding, topPadding, photoWidth, photoHeight);

      context.strokeStyle = "rgba(15, 23, 42, 0.18)";
      context.lineWidth = Math.max(2, Math.round(frameWidth * 0.003));
      context.strokeRect(
        sidePadding,
        topPadding,
        photoWidth,
        photoHeight,
      );

      const maxTextWidth = frameWidth - sidePadding * 2;
      const locationFontSize = Math.max(26, Math.round(frameWidth * 0.053));
      const dateFontSize = Math.max(17, Math.round(frameWidth * 0.031));
      const textCenterX = frameWidth / 2;
      const locationY = topPadding + photoHeight + Math.round(bottomPadding * 0.48);
      const dateY = topPadding + photoHeight + Math.round(bottomPadding * 0.75);

      context.textAlign = "center";
      context.fillStyle = "#0f172a";
      context.font = `700 ${locationFontSize}px Inter, system-ui, sans-serif`;
      context.fillText(
        truncateText(context, resolvedLocationLabel, maxTextWidth),
        textCenterX,
        locationY,
      );

      context.fillStyle = "#475569";
      context.font = `500 ${dateFontSize}px Inter, system-ui, sans-serif`;
      context.fillText(
        truncateText(context, formattedDate, maxTextWidth),
        textCenterX,
        dateY,
      );

      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(
          (result) => {
            if (!result) {
              reject(new Error("Could not create export file."));
              return;
            }

            resolve(result);
          },
          "image/jpeg",
          0.93,
        );
      });

      const fileName = `photosot-polaroid-${capturedAt
        .toISOString()
        .replace(/[:.]/g, "-")}.jpg`;

      triggerDownload(blob, fileName);
      setStatusMessage("Polaroid saved to device.");
    } catch {
      setStatusMessage("Could not export photo.");
    } finally {
      setIsApplyingEffect(false);
    }
  }, [isApplyingEffect, liveLocationLabel, selectedPhoto]);

  return (
    <main
      className="min-h-[100dvh] bg-black px-6 text-white"
      style={safeAreaStyle}
    >
      {screen === "capture" && (
        <div className="mx-auto flex min-h-[calc(100dvh-2rem)] w-full max-w-[520px] flex-col justify-center">
          <section className="relative mx-auto w-full max-w-[470px]">
            <div className="relative aspect-[3/5] overflow-hidden rounded-[2.35rem]">
              <Webcam
                ref={webcamRef}
                mirrored
                audio={false}
                screenshotFormat="image/jpeg"
                screenshotQuality={0.86}
                videoConstraints={videoConstraints}
                className="h-full w-full bg-[#0f172a] object-cover"
              />

              <div className="absolute inset-0 bg-[linear-gradient(180deg,_rgba(15,23,42,0.36)_0%,_rgba(15,23,42,0.18)_45%,_rgba(15,23,42,0.44)_100%)]" />
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_38%,rgba(255,255,255,0.11)_0%,rgba(255,255,255,0)_60%)]" />

              {mode === "video" && (
                <div className="absolute left-4 top-4 rounded-full border border-white/20 bg-black/40 px-3 py-1 text-xs uppercase tracking-[0.2em] text-white/85 backdrop-blur-sm">
                  {isRecording
                    ? `Rec ${formatDuration(recordingSeconds)} / 01:00`
                    : "Video mode"}
                </div>
              )}
            </div>
          </section>

          <section className="mx-auto mt-8 w-full max-w-[470px]">
            <div className="grid grid-cols-[4.35rem_1fr_4.35rem] items-center">
              <div aria-hidden className="size-[4.35rem]" />

              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={handleShutter}
                  className="grid size-[6.55rem] place-items-center rounded-full border border-white/20 bg-white/10 p-2 transition hover:scale-[1.02] hover:bg-white/14 active:scale-95"
                  aria-label={
                    mode === "video"
                      ? isRecording
                        ? "Stop recording"
                        : "Start recording"
                      : "Capture photo"
                  }
                >
                  <span className="grid size-full place-items-center rounded-full border-[3px] border-white/80 bg-white/95">
                    <span
                      className={`${
                        mode === "video"
                          ? isRecording
                            ? "size-9 rounded-md bg-red-600"
                            : "size-[4.18rem] rounded-full bg-red-500"
                          : "size-[4.18rem] rounded-full bg-slate-900"
                      } transition-all`}
                    />
                  </span>
                </button>
              </div>

              <button
                type="button"
                onClick={openGallery}
                className="relative size-[4.35rem] overflow-hidden rounded-full border border-white/35 bg-white/10 shadow-[0_10px_26px_rgba(0,0,0,0.36)]"
                aria-label="Open gallery"
              >
                {latestPhoto ? (
                  <img
                    src={latestPhoto.src}
                    alt="Latest captured photo"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="grid h-full w-full place-items-center text-sm text-white/55">
                    0
                  </span>
                )}
              </button>
            </div>

            <div className="mt-6 flex items-center justify-center gap-8 text-[clamp(1.5rem,4.5vw,2rem)] leading-none">
              <button
                type="button"
                onClick={() => setMode("photo")}
                disabled={isRecording}
                className={mode === "photo" ? "text-white" : "text-white/42"}
              >
                Photo
              </button>
              <button
                type="button"
                onClick={() => setMode("video")}
                disabled={isRecording || !hasVideoSupport}
                className={mode === "video" ? "text-white" : "text-white/42"}
              >
                Video
              </button>
            </div>

            <p className="mt-4 text-center text-sm text-white/55">
              {liveLocationLabel === "Locating..."
                ? "Tracking location..."
                : liveLocationLabel}
            </p>
          </section>
        </div>
      )}

      {screen === "gallery" && (
        <div className="mx-auto w-full max-w-[520px] pb-3">
          <div className="mb-6 mt-2 flex items-center justify-between">
            <h2 className="text-4xl font-semibold">Gallery</h2>
            <button
              type="button"
              onClick={() => setScreen("capture")}
              className="rounded-full bg-white px-5 py-2 text-lg font-semibold text-black"
            >
              Back to capture
            </button>
          </div>

          {photoCaptures.length > 0 ? (
            <div className="grid grid-cols-2 gap-4">
              {photoCaptures.map((photo, index) => (
                <button
                  type="button"
                  key={photo.id}
                  onClick={() => openEditor(photo.id)}
                  className="relative aspect-[3/4] overflow-hidden rounded-[1.7rem] border border-white/12"
                  aria-label={`Open photo ${index + 1} in editor`}
                >
                  <img
                    src={photo.src}
                    alt={`Captured photo ${index + 1}`}
                    className="h-full w-full object-cover"
                  />
                </button>
              ))}
            </div>
          ) : (
            <div className="mt-14 rounded-3xl border border-dashed border-white/20 bg-white/[0.03] p-10 text-center">
              <p className="text-2xl font-semibold text-white/90">
                No photos yet
              </p>
              <p className="mt-2 text-lg text-white/55">
                Capture a photo to fill this gallery.
              </p>
            </div>
          )}
        </div>
      )}

      {screen === "editor" && (
        <div className="mx-auto w-full max-w-[520px] pb-3">
          <div className="mb-6 mt-2 flex items-center justify-between">
            <h2 className="text-4xl font-semibold">Editor</h2>
            <button
              type="button"
              onClick={() => setScreen("gallery")}
              className="rounded-full bg-white px-5 py-2 text-lg font-semibold text-black"
            >
              Back to gallery
            </button>
          </div>

          {selectedPhoto ? (
            <>
              <div className="relative mx-auto aspect-[3/5] max-w-[470px] overflow-hidden rounded-[2.35rem] border border-white/12">
                <img
                  src={selectedPhoto.src}
                  alt="Selected photo for editing"
                  className="h-full w-full object-cover"
                />
              </div>

              <div className="mt-7 flex flex-col items-center gap-3">
                <button
                  type="button"
                  onClick={exportWithPolaroidFrame}
                  disabled={isApplyingEffect}
                  className="rounded-full bg-white px-6 py-3 text-lg font-semibold text-black disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isApplyingEffect
                    ? "Building polaroid..."
                    : "Apply polaroid frame"}
                </button>

                <p className="text-sm text-white/55">
                  {selectedPhoto.locationLabel || "Location unavailable"}
                </p>

                {statusMessage && (
                  <p className="text-sm text-white/75">{statusMessage}</p>
                )}
              </div>
            </>
          ) : (
            <div className="mt-14 rounded-3xl border border-dashed border-white/20 bg-white/[0.03] p-10 text-center">
              <p className="text-2xl font-semibold text-white/90">
                Select a photo from gallery
              </p>
            </div>
          )}
        </div>
      )}
    </main>
  );
}

export default App;
